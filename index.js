/**
 * @local/dsh-power-control 鈥?Host half.
 *
 * The DSH Web application answers on an HTTP server owned by the Host process,
 * and the desktop shell renders that same application inside its window. The
 * shell exposes no renderer API for quitting or relaunching itself, so the only
 * honest way to offer in-window power controls is to ask the Host to end the
 * desktop process tree and, for a restart, start the application again.
 *
 * The route below does exactly that, and only when the Host is provably running
 * under the desktop shell on Windows: `ELECTRON_RUN_AS_NODE=1` plus the
 * `DSH_DESKTOP_NODE_EXECUTABLE` path the shell injects into its child process.
 * A plain `dsh web` Host refuses power actions, leaving the page with refresh.
 *
 * The teardown runs in a detached PowerShell helper so it survives this process
 * being terminated, and it selects targets by image name rather than by a
 * process tree, because the helper itself is a descendant of that tree.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

const ROUTE = '/__dsh-power';
const HELPER_DELAY_MS = 150;

let inFlight = false;

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
 * process's image name 鈥?that is the Electron Node-mode relationship, and it
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
 * The desktop shell forwards page requests after deleting `origin` (it validates
 * `dsh-app://app` itself), while a browser sends its own origin. An origin that
 * is present must therefore match this server.
 */
function originAllowed(req, origin) {
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin !== 'string' || requestOrigin === '') return true;
  return typeof origin === 'string' && requestOrigin === origin;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Flush live session write-behind before the process tree is terminated, so a
 * message that landed just before the click is on disk. Bounded per session:
 * a stuck writer must never block the exit. The service is optional 鈥?a Host
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

/**
 * The helper body. It runs after this process may already be gone, so it keeps
 * its own log under %TEMP% and refuses to start a second instance while the old
 * one is still alive 鈥?a duplicate launch would only hit the single-instance
 * lock and leave a broken window behind.
 */
function helperScript(info, action, scriptPath) {
  const stem = info.image.replace(/\.exe$/i, '');
  const name = psQuote(stem);
  const log = "Join-Path $env:TEMP 'dsh-power-control.log'";
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$log = ${log}`,
    'function Write-Log($message) { Add-Content -LiteralPath $log -Value ((Get-Date).ToString("o") + " " + $message) }',
    `Write-Log ('start action=${action} image=' + ${psQuote(info.image)})`,
    'Start-Sleep -Milliseconds 700',
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
      '  Write-Log "relaunched"',
      '} else {',
      '  Write-Log "relaunch-skipped app-still-running"',
      '}',
    );
  } else {
    lines.push(`Write-Log ('stopped remaining=' + (Get-Process -Name ${name} -ErrorAction SilentlyContinue | Measure-Object).Count)`);
  }
  lines.push(`Remove-Item -LiteralPath ${psQuote(scriptPath)} -Force`);
  return `${lines.join('\n')}\n`;
}

/** Start the detached helper that ends the app (and optionally relaunches it). */
function launchHelper(info, action) {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-power-'));
  const scriptPath = join(directory, 'power.ps1');
  writeFileSync(scriptPath, helperScript(info, action, scriptPath), 'utf8');
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
    { cwd: directory, detached: true, stdio: 'ignore', windowsHide: true },
  );
  child.on('error', (error) => {
    console.warn('[dsh-power-control] helper did not start', error);
  });
  child.unref();
  return true;
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
  if (action === 'probe') {
    const info = detectTarget();
    sendJson(res, 200, {
      ok: true,
      plugin: 'dsh-power-control',
      platform: process.platform,
      desktop: info.desktop,
      reason: info.reason ?? null,
      target: info.desktop ? basename(info.exe) : null,
      diagnostics: diagnostics(),
    });
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
      launchHelper(info, action);
      console.info(`[dsh-power-control] ${action} requested by the in-app control`);
    } catch (error) {
      inFlight = false;
      console.error('[dsh-power-control] helper failed', error);
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
