/**
 * dsh-power-control  -  Host half.
 *
 * Serves one loopback route that the sidebar control calls, and stands up the
 * teardown that ends the desktop app.
 *
 * Why Task Scheduler and not `spawn(..., { detached: true })`: in this shell a
 * detached child is created (it gets a pid) but is never scheduled  -nothing it
 * writes ever appears- while an ordinary child runs fine. Handing the teardown
 * to schtasks lifts it out of this process tree entirely, so it survives the
 * app being stopped and can relaunch the executable afterwards.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const ROUTE = '/__dsh-power';
const HELPER_DELAY_MS = 150;
const TASK_PREFIX = 'dsh-power-control';
const LOG_PATH = join(tmpdir(), 'dsh-power-control.log');

let inFlight = false;
/** Last failure the page reported, so a silent client-side fault stays visible. */
let lastClientReport = null;

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 8192) {
        const error = new Error('payload-too-large');
        error.code = 'payload-too-large';
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw === '') {
        resolve({});
        return;
      }
      try {
        const value = JSON.parse(raw);
        resolve(typeof value === 'object' && value !== null ? value : {});
      } catch {
        const error = new Error('invalid-json');
        error.code = 'invalid-json';
        reject(error);
      }
    });
    req.on('error', (error) => reject(error));
  });
}

function electronVersion() {
  const version = process.versions.electron;
  return typeof version === 'string' && version !== '' ? version : null;
}

function declaredExecutable() {
  const declared = process.env.DSH_DESKTOP_NODE_EXECUTABLE;
  if (typeof declared !== 'string' || declared === '' || !existsSync(declared)) return null;
  return declared;
}

/** Ask Windows for a live process image path. Null when the pid is gone. */
function imagePathOf(pid) {
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`],
      { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const value = out.trim();
    return value !== '' && existsSync(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the shell process this Host belongs to.
 *
 * The spawn contract carries DSH_DESKTOP_NODE_EXECUTABLE and Electron exposes
 * process.versions.electron; when either is present the shell executable is
 * known outright. Builds that omit the environment marker fall back to the
 * parent process image, but only accept it when the parent shares this
 * process's image name  -that is the Electron Node-mode relationship, and it
 * refuses to mistake a terminal-launched `dsh web` (parent = the terminal) for
 * a desktop shell.
 */
function detectTarget() {
  if (process.platform !== 'win32') return { desktop: false, reason: 'unsupported-platform' };
  const parentPid = process.ppid;
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1) return { desktop: false, reason: 'parent-unavailable' };
  const known = declaredExecutable() ?? (electronVersion() !== null && existsSync(process.execPath) ? process.execPath : null);
  if (known !== null) return { desktop: true, exe: known, image: basename(known), parentPid };
  const parentExe = imagePathOf(parentPid);
  if (parentExe === null) return { desktop: false, reason: 'not-desktop-shell' };
  const sameImage = basename(parentExe).toLowerCase() === basename(process.execPath).toLowerCase();
  if (!sameImage) return { desktop: false, reason: 'not-desktop-shell' };
  return { desktop: true, exe: parentExe, image: basename(parentExe), parentPid };
}

/** Non-secret facts about this Host's embedding, returned by the probe. */
function diagnostics() {
  return {
    platform: process.platform,
    electron: electronVersion(),
    runAsNode: process.env.ELECTRON_RUN_AS_NODE === '1',
    declaredExecutable: declaredExecutable() !== null,
    executable: basename(process.execPath),
    parentPid: process.ppid,
  };
}

function originOf(ctx) {
  try {
    return ctx.webServer.getOrigin();
  } catch {
    return '';
  }
}

/**
 * Origin fence. The desktop shell validates `dsh-app://app` itself and normally
 * strips the header before forwarding; a browser sends its own origin. Both are
 * acceptable, anything else is not.
 */
function originAllowed(req, origin) {
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin !== 'string' || requestOrigin === '') return true;
  if (requestOrigin === 'dsh-app://app') return true;
  if (requestOrigin === 'null') return true;
  if (typeof origin !== 'string' || origin === '') return false;
  if (requestOrigin === origin) return true;
  try {
    return new URL(requestOrigin).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Flush live session write-behind before the process tree is terminated, so a
 * message that landed just before the click is on disk. Bounded per session:
 * a stuck writer must never block the exit. The service is optional  -a Host
 * without session storage simply skips this.
 */
async function flushSessions(ctx, perSessionMs) {
  let sessions;
  try {
    sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
  } catch {
    return;
  }
  if (sessions === undefined || sessions === null || typeof sessions.flush !== 'function') return;
  let live;
  try {
    live = typeof sessions.list === 'function' ? sessions.list() : [];
  } catch {
    return;
  }
  if (!Array.isArray(live) || live.length === 0) return;
  const stopper = () => new Promise((resolve) => {
    const timer = setTimeout(resolve, perSessionMs);
    timer.unref?.();
  });
  await Promise.all(live.map((session) => Promise.race([
    Promise.resolve().then(() => sessions.flush(session)).catch(() => undefined),
    stopper(),
  ])));
}

function logLine(message) {
  return `Write-Log ${psQuote(message)}`;
}

/**
 * The teardown. It runs as a scheduled task, so by design it outlives the app
 * it stops: it logs to %TEMP%, waits for the click's response to flush, stops
 * every process of the shell image, and  -for a restart- relaunches the
 * executable once the old tree is really gone. A second instance is never
 * started while the first is alive: that would only hit the single-instance
 * lock and leave a broken window behind.
 */
function teardownScript(info, action, taskName, directory) {
  const stem = info.image.replace(/\.exe$/i, '');
  const name = psQuote(stem);
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$log = ${psQuote(LOG_PATH)}`,
    'function Write-Log($m) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString("o") + " " + $m) }',
    logLine(`teardown-start action=${action} image=${info.image} task=${taskName}`),
    'Start-Sleep -Milliseconds 900',
    `Stop-Process -Name ${name} -Force`,
  ];
  if (action === 'restart') {
    lines.push(
      '$deadline = (Get-Date).AddSeconds(30)',
      `while ((Get-Process -Name ${name} -ErrorAction SilentlyContinue) -ne $null -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }`,
      `if ((Get-Process -Name ${name} -ErrorAction SilentlyContinue) -eq $null) {`,
      '  Start-Sleep -Milliseconds 1200',
      '  $env:ELECTRON_RUN_AS_NODE = $null',
      '  $env:DSH_DESKTOP_NODE_EXECUTABLE = $null',
      `  Start-Process -FilePath ${psQuote(info.exe)} -WorkingDirectory ${psQuote(dirname(info.exe))}`,
      logLine('relaunched'),
      '} else {',
      logLine('relaunch-skipped app-still-running'),
      '}',
    );
  } else {
    lines.push(`Write-Log ('stopped remaining=' + (Get-Process -Name ${name} -ErrorAction SilentlyContinue | Measure-Object).Count)`);
  }
  lines.push(
    `schtasks.exe /Delete /TN ${psQuote(taskName)} /F | Out-Null`,
    logLine('task-deleted'),
    `Start-Process -WindowStyle Hidden -FilePath 'cmd.exe' -ArgumentList ('/c ping -n 3 127.0.0.1 >nul & rmdir /s /q ' + ${psQuote(directory)})`,
  );
  return `${lines.join('\n')}\n`;
}

/**
 * The launcher is an ordinary child process: it registers the one-shot task,
 * starts it, and reports what happened. It stays attached on purpose  -the
 * detached flag is exactly what silently fails here.
 */
function launcherScript(taskName, teardownPath) {
  const task = psQuote(taskName);
  const command = psQuote(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File ${teardownPath}`);
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$log = ${psQuote(LOG_PATH)}`,
    'function Write-Log($m) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString("o") + " " + $m) }',
    logLine('launcher start'),
    `$create = schtasks.exe /Create /TN ${task} /SC ONCE /ST 23:59 /TR ${command} /F 2>&1`,
    "Write-Log ('task create: ' + ($create -join ' '))",
    `$run = schtasks.exe /Run /TN ${task} 2>&1`,
    "Write-Log ('task run: ' + ($run -join ' '))",
    'Start-Sleep -Seconds 8',
    `$hit = Select-String -LiteralPath $log -Pattern ${psQuote(`teardown-start.*${taskName}`)} -ErrorAction SilentlyContinue`,
    'if ($null -eq $hit) {',
    `  schtasks.exe /Delete /TN ${task} /F | Out-Null`,
    "  Write-Log 'task-did-not-run'",
    '} else {',
    "  Write-Log 'task-ran'",
    '}',
    '',
  ].join('\n');
}

/** Register and start the one-shot teardown task. */
function launchHelper(info, action) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-power-'));
  const taskName = `${TASK_PREFIX}-${Date.now().toString(36)}`;
  const teardownPath = join(directory, 'teardown.ps1');
  const launcherPath = join(directory, 'launch.ps1');
  const stem = info.image.replace(/\.exe$/i, '');
  writeFileSync(teardownPath, teardownScript(info, action, taskName, directory), 'utf8');
  writeFileSync(launcherPath, launcherScript(taskName, teardownPath), 'utf8');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', launcherPath],
    { cwd: directory, stdio: 'ignore', windowsHide: true },
  );
  child.on('error', (error) => {
    console.warn('[dsh-power-control] launcher did not start', error);
  });
  child.unref();
  return taskName;
}

function countProcess(image) {
  const stem = image.replace(/\.exe$/i, '');
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(Get-Process -Name ${psQuote(stem)} -ErrorAction SilentlyContinue | Measure-Object).Count`],
      { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

/**
 * Exercise the real teardown against a harmless image (ping.exe): stop branch
 * must remove it, restart branch must bring it back. Production code path, safe
 * target.
 */
async function runVerify() {
  const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
  const pingExe = 'C:\\Windows\\System32\\PING.EXE';
  const startPing = () => spawn('ping.exe', ['-n', '300', '127.0.0.1'], { stdio: 'ignore', windowsHide: true }).unref();
  startPing();
  await delay(800);
  const before = countProcess('ping.exe');
  const shutdownTask = launchHelper({ desktop: true, exe: pingExe, image: 'ping.exe' }, 'shutdown');
  await delay(7000);
  const afterShutdown = countProcess('ping.exe');
  startPing();
  await delay(800);
  const restartTask = launchHelper({ desktop: true, exe: pingExe, image: 'ping.exe' }, 'restart');
  await delay(9000);
  const afterRestart = countProcess('ping.exe');
  const log = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, 'utf8').slice(-1200) : null;
  return { before, afterShutdown, afterRestart, shutdownTask, restartTask, log };
}

/**
 * End-to-end check of the escape route: a task runs a script that writes a
 * marker and deletes the task. Used when the controls look dead but the route
 * answers, to tell a launch problem from a UI problem.
 */
async function runSelfTest() {
  const delay = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });
  const directory = mkdtempSync(join(tmpdir(), 'dsh-power-selftest-'));
  const marker = join(directory, 'marker.txt');
  const taskName = `${TASK_PREFIX}-selftest-${Date.now().toString(36)}`;
  const payload = join(directory, 'payload.ps1');
  const launcher = join(directory, 'launch.ps1');
  const logPath = join(directory, 'schtasks.log');
  writeFileSync(payload, [
    "'ran ' + (Get-Date).ToString('o') | Set-Content -LiteralPath " + psQuote(marker),
    `schtasks.exe /Delete /TN ${psQuote(taskName)} /F | Out-Null`,
    '',
  ].join('\n'), 'utf8');
  writeFileSync(launcher, [
    `$create = schtasks.exe /Create /TN ${psQuote(taskName)} /SC ONCE /ST 23:59 /TR ${psQuote(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${payload}`)} /F 2>&1`,
    `$run = schtasks.exe /Run /TN ${psQuote(taskName)} 2>&1`,
    `('create: ' + ($create -join ' ')) | Out-File -LiteralPath ${psQuote(logPath)} -Append`,
    `('run: ' + ($run -join ' ')) | Out-File -LiteralPath ${psQuote(logPath)} -Append`,
    '',
  ].join('\n'), 'utf8');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', launcher],
    { cwd: directory, stdio: 'ignore', windowsHide: true },
  );
  child.unref();
  await delay(5000);
  return {
    tempDir: directory,
    marker: existsSync(marker),
    markerText: existsSync(marker) ? readFileSync(marker, 'utf8').trim().slice(0, 80) : null,
    log: existsSync(logPath) ? readFileSync(logPath, 'utf8').replace(/\u0000/g, '').slice(0, 600) : null,
  };
}

async function handleRequest(ctx, req, res) {
  if (!originAllowed(req, originOf(ctx))) {
    sendJson(res, 403, { ok: false, code: 'forbidden-origin' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    sendJson(res, 405, { ok: false, code: 'method-not-allowed' });
    return;
  }
  let body;
  try {
    body = await readJson(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, code: error.code ?? 'invalid-body' });
    return;
  }
  const action = body.action;
  if (action === 'report') {
    const code = typeof body.code === 'string' ? body.code.slice(0, 120) : 'unknown';
    const status = Number.isSafeInteger(body.status) ? body.status : null;
    lastClientReport = { code, status, at: new Date().toISOString() };
    console.info(`[dsh-power-control] client reported ${code}${status === null ? '' : ` (HTTP ${String(status)})`}`);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (action === 'probe') {
    const info = detectTarget();
    sendJson(res, 200, {
      ok: true,
      plugin: 'dsh-power-control',
      platform: process.platform,
      desktop: info.desktop,
      reason: info.reason ?? null,
      target: info.desktop ? basename(info.exe) : null,
      lastClientReport,
      diagnostics: diagnostics(),
    });
    return;
  }
  if (action === 'selftest') {
    const result = await runSelfTest();
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  if (action === 'verify') {
    const result = await runVerify();
    sendJson(res, 200, { ok: true, ...result });
    return;
  }
  if (action !== 'restart' && action !== 'shutdown') {
    sendJson(res, 400, { ok: false, code: 'unknown-action' });
    return;
  }
  const info = detectTarget();
  if (!info.desktop) {
    sendJson(res, 409, { ok: false, code: info.reason ?? 'desktop-only' });
    return;
  }
  if (inFlight) {
    sendJson(res, 429, { ok: false, code: 'busy' });
    return;
  }
  inFlight = true;
  await flushSessions(ctx, 3000);
  sendJson(res, 200, { ok: true, action });
  const timer = setTimeout(() => {
    try {
      const task = launchHelper(info, action);
      console.info(`[dsh-power-control] ${action} queued as ${task}`);
      const release = setTimeout(() => {
        inFlight = false;
      }, 20000);
      release.unref?.();
    } catch (error) {
      inFlight = false;
      console.error('[dsh-power-control] launcher failed', error);
    }
  }, HELPER_DELAY_MS);
  timer.unref?.();
}

export const inject = ['webServer'];

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => handleRequest(ctx, req, res).catch((error) => {
      console.error('[dsh-power-control] request failed', error);
      try {
        sendJson(res, 500, { ok: false, code: 'internal-error' });
      } catch {
        /* the socket is already gone */
      }
    }),
  }));
}
