# dsh-power-control

Reload, restart, or shut down the **DeepSeek Harness** desktop app from inside its own
window — no trip to the taskbar, no hunting for the tray icon.

A small, dependency-free DSH plugin: one power button in the sidebar footer, one menu,
one confirmation dialog. Refresh works in any DSH surface; restart and shut down are
Windows-desktop only, because that is where the app process tree lives.

> 在 DSH 界面里直接「刷新界面 / 重启应用 / 关闭应用」，不用再去任务栏关窗口。
> 刷新在任何 DSH 环境都能用；重启与关机只支持 Windows 桌面版。

## Download

- **Installable bundle:** [`dsh-power-control-1.2.0.zip`](https://github.com/w17her/dsh-power-control/releases/download/v1.2.0/dsh-power-control-1.2.0.zip) — unzip it and install the folder (see below).
- **Or clone this repository** — its root *is* the plugin: `package.json`, `index.js`,
  `client.js`, `cordis.patch.yml`, `locale/`, `icon.svg`. There is no build step and no
  compiled output to fetch.


---

## Features

| Action | What happens |
| --- | --- |
| **Reload window** | `window.location.reload()` — rebuilds the web UI from the running Host. |
| **Restart app** | Flushes open sessions to disk, then restarts the whole desktop app (same executable, same profile, same workspace). |
| **Shut down app** | Flushes open sessions to disk, then quits the whole desktop app. |

- One 40 px power button in the sidebar footer, beside Settings.
- Menu opens upward as a frame-wide popover, so no sidebar scroll container can clip it.
- Destructive actions are confirmed first; the confirmation names exactly what will be interrupted.
- A status veil covers the window while the process is going down, with a fallback
  "reload this window" link if the process is still alive after 9 seconds.
- Light/dark friendly: every color comes from DSH theme tokens (`--dsw-alias-*`).
- Chinese and English UI, following the active DSH locale.

## Requirements

- Windows 10/11.
- DeepSeek Harness **desktop app** (Electron shell) for restart and shut down.
  The reload action works in any DSH surface.
- The plugin manager can load local bundles (the standard DSH plugin surface).

## Install

The plugin is a local DSH bundle, not an npm package. Either way works:

**Option 1 — the release zip.** Download
[`dsh-power-control-1.2.0.zip`](https://github.com/w17her/dsh-power-control/releases/download/v1.2.0/dsh-power-control-1.2.0.zip),
unzip it, and install the unzipped folder (the one that contains `package.json`) with DSH's
plugin manager:

```
plugin_manager install_bundle  target = <path to the unzipped dsh-power-control folder>
```

**Option 2 — clone.** Clone it somewhere stable and install the same folder:

```powershell
git clone https://github.com/w17her/dsh-power-control.git "$env:USERPROFILE\dsh-power-control"
```

In both cases DSH links the directory into the active profile and reloads the Host, and the
power button appears in the sidebar footer immediately. In the GUI, **Settings → Plugins**
shows the same entry; installing from a local folder is the supported path for a bundle
that is not published to a registry.

To update a clone: `git pull`. Client changes hot-reload; Host changes need the plugin to
be toggled off and on (or the app restarted).


## Uninstall

Disable the plugin in **Settings → Plugins**, or ask your DSH agent to uninstall the
bundle `@local/dsh-power-control`. Nothing outside the DSH profile is touched.

## How it works

DSH's desktop shell gives the page no quit or relaunch channel. The main window's `close`
is intercepted and turned into "hide to tray", and the Host process is a child of the
Electron main process: if the Host exits on its own, the parent treats it as a crash and
shows the fatal-recovery dialog.

So the plugin splits the job in two:

1. **Host half** (`index.js`, ESM) registers one route, `POST /__dsh-power`, with
   `{ "action": "probe" | "restart" | "shutdown" }`. It:
   - verifies the caller comes from the desktop shell proxy (same-origin is not enough,
     so a foreign `Origin` is rejected),
   - identifies the desktop target: `DSH_DESKTOP_NODE_EXECUTABLE`, else the parent
     process image via `Get-Process -Id <ppid>`, and refuses to act unless the parent is
     the same executable (this is what keeps `dsh web` in a terminal safe),
   - flushes open sessions (`ctx.get('sessions')` → `flush`) with a 3 s budget,
   - answers `200`, then hands the job to a **Windows scheduled task** and returns. The
     task runs outside the Host, which is the point: it is the only actor that can kill
     the process tree the Host lives in.
2. **Client half** (`client.js`, `window.__ModuleLoader__`) renders the button and menu in
   `sidebar.footer.action`, and the menu/confirmation overlay in `shell.overlay`.

The Host writes two small scripts into `%TEMP%\dsh-power-<id>\` and starts a **launcher**
that stays attached to the Host, so the Host always sees its child. The launcher creates a
one-shot scheduled task (`dsh-power-control-<id>`, `schtasks.exe /Create /SC ONCE`),
runs it, and reports back whether the task actually executed. The task body
(`teardown.ps1`) logs to `%TEMP%\dsh-power-control.log`, waits 900 ms so the HTTP response
lands, then `Stop-Process -Name <image> -Force`. For a restart it waits for the old
instance to disappear (up to 30 s), clears the desktop-only environment variables, and
`Start-Process` the executable again — it never starts a second instance while the old
one is still alive, so two instances can't race over the profile lock. The task deletes
itself and its temp folder on the way out.

Why a scheduled task instead of a detached child: in DSH 0.2.x the Host's detached
`powershell.exe` gets a pid but is never scheduled — the script does not run a single
line. An ordinary attached child works, so the task is created by an attached launcher,
and the killing runs in the Task Scheduler service, outside the tree it is about to end.

`taskkill` is deliberately not used: it is unreliable here (it can report
`Access denied` even for a PID that no longer exists), while `Stop-Process` behaves.

## Troubleshooting

- **Nothing happens when you click restart or shut down.** Read
  `%TEMP%\dsh-power-control.log`. A normal run starts with `launcher start`, then
  `task create` / `task run`, then `teardown-start action=… image=…`, then either
  `stopped` or `relaunched`. A missing log means the task never ran.
- **`task-did-not-run` in the log.** Task Scheduler refused to start it (policy, UAC, or a
  locked-down machine). Check `schtasks /Query /TN dsh-power-control-*`.
- **Buttons greyed out, status line shows an error.** The Host route did not answer. Ask
  your DSH agent to `POST /__dsh-power {"action":"probe"}` and read the JSON.
- **Self-check without killing anything.** `{"action":"selftest"}` runs a harmless task and
  returns its marker; `{"action":"verify"}` starts a throwaway `ping.exe`, tears it down
  through the real path, and returns before/after counts.

## Safety and limits

- **Running tasks are interrupted.** Both restart and shut down end the app; the
  confirmation dialog says so. Sessions are flushed first, but an in-flight tool call is
  not resumed afterwards.
- **Scheduled tasks do not run while the app is closed.**
- The route only accepts requests that arrive through the desktop shell proxy and only on
  the loopback listener; it never trusts a remote `Origin`.
- The plugin has no network client of its own and sends nothing anywhere.
- Not affiliated with, or endorsed by, DeepSeek.

## Repository layout

```
index.js            Host half: the /__dsh-power route, launcher and teardown task
client.js           Client half: sidebar button, menu, confirmation overlay
cordis.patch.yml    Bundle patch that inserts the plugin into the profile
locale/en.json      Plugin display metadata (English)
locale/zh.json      Plugin display metadata (Chinese)
icon.svg            Plugin icon
```

## License

MIT — see [LICENSE](LICENSE).
