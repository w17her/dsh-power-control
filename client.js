window.__ModuleLoader__.load({
  id: '@local/dsh-power-control',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const ROUTE = '/__dsh-power';

    const COPY = {
      zh: {
        trigger: '电源',
        menu: '电源操作',
        refresh: '刷新界面',
        restart: '重启应用',
        shutdown: '关闭应用',
        checking: '正在检查桌面环境…',
        desktopOnly: '仅 Windows 桌面版支持重启与关机',
        probeFailed: '未连接到本机服务，电源操作不可用',
        restartConfirmTitle: '重启 DeepSeek Harness？',
        restartConfirmBody: '正在运行的任务会被中断。应用关闭后会自动重新打开，会话与工作区保持不变。',
        shutdownConfirmTitle: '关闭 DeepSeek Harness？',
        shutdownConfirmBody: '正在运行的任务会被中断。应用关闭期间，已排定的定时任务不会运行。',
        cancel: '取消',
        confirmRestart: '确认重启',
        confirmShutdown: '确认关闭',
        restarting: '正在重启，请稍候…',
        shuttingDown: '正在关闭，请稍候…',
        stalled: '进程似乎没有退出？点此重新加载界面',
        failed: '操作失败：',
      },
      en: {
        trigger: 'Power',
        menu: 'Power actions',
        refresh: 'Reload window',
        restart: 'Restart app',
        shutdown: 'Shut down app',
        checking: 'Checking the desktop environment…',
        desktopOnly: 'Restart and shut down need the Windows desktop app',
        probeFailed: 'The local service is unreachable, so power actions are unavailable',
        restartConfirmTitle: 'Restart DeepSeek Harness?',
        restartConfirmBody: 'Running tasks will be interrupted. The app closes and reopens automatically; sessions and workspaces are kept.',
        shutdownConfirmTitle: 'Shut down DeepSeek Harness?',
        shutdownConfirmBody: 'Running tasks will be interrupted, and scheduled tasks will not run while the app is closed.',
        cancel: 'Cancel',
        confirmRestart: 'Restart now',
        confirmShutdown: 'Shut down now',
        restarting: 'Restarting, please wait…',
        shuttingDown: 'Shutting down, please wait…',
        stalled: 'Still running? Reload this window',
        failed: 'Action failed: ',
      },
    };

    const ICONS = {
      power: ['M12 3.2v8.4', 'M7.4 6.4a7 7 0 1 0 9.2 0'],
      refresh: ['M20 11a8 8 0 1 0-2.3 6.3', 'M20 4v5h-5'],
      restart: ['M4 13a8 8 0 1 0 2.3-7.3', 'M4 20v-5h5'],
      shutdown: ['M12 3v9', 'M7 6.2a7.5 7.5 0 1 0 10 0'],
    };

    const STYLE = `
.dpc-slot{display:inline-flex;align-items:center}
.dpc-power{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;padding:0;border:0;border-radius:11px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;cursor:pointer;transition:background 120ms ease,color 120ms ease}
.dpc-power:hover,.dpc-power[aria-expanded="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dpc-power:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dpc-power svg{width:24px;height:24px;flex:none}
.dpc-menu{position:fixed;z-index:45;min-width:184px;padding:5px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 14px 36px rgba(0,0,0,.26);font-family:inherit;font-size:13.5px;pointer-events:auto}
.dpc-item{display:flex;align-items:center;gap:10px;width:100%;height:38px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13.5px;text-align:left;cursor:pointer;white-space:nowrap}
.dpc-item:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dpc-item:disabled{opacity:.4;cursor:not-allowed}
.dpc-item svg{width:18px;height:18px;flex:none;color:var(--dsw-alias-label-secondary)}
.dpc-item.dpc-danger:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}
.dpc-hint{padding:7px 12px 6px;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary);white-space:normal;max-width:220px}
.dpc-veil{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.28);z-index:40;pointer-events:auto}
.dpc-dialog{width:min(360px,calc(100vw - 48px));box-sizing:border-box;padding:18px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 20px 48px rgba(0,0,0,.24);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.6}
.dpc-dialog h2{margin:0 0 6px;font-size:14px;font-weight:600}
.dpc-dialog p{margin:0 0 14px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.dpc-dialog p.dpc-failure{color:var(--dsw-alias-state-error-primary)}
.dpc-actions{display:flex;justify-content:flex-end;gap:8px}
.dpc-actions button{height:28px;padding:0 12px;border-radius:7px;font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.dpc-actions button:disabled{opacity:.6;cursor:progress}
.dpc-actions button.dpc-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#ffffff}
.dpc-actions button.dpc-danger{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:#ffffff}
.dpc-status{display:flex;flex-direction:column;align-items:center;gap:10px;width:min(280px,calc(100vw - 48px))}
.dpc-status p{margin:0;color:var(--dsw-alias-label-primary)}
.dpc-spinner{width:16px;height:16px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:dpc-spin 800ms linear infinite}
.dpc-link{border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;cursor:pointer;text-decoration:underline}
@keyframes dpc-spin{to{transform:rotate(360deg)}}
`;

    function copyFor(active) {
      return String(active === undefined || active === null ? '' : active).toLowerCase().startsWith('zh') ? COPY.zh : COPY.en;
    }

    /* ---------------------------------------------------------------- store */
    /**
     * Shared state. The trigger lives in the sidebar footer, the menu and the
     * confirmation dialog live in the frame-wide overlay: a popover rendered
     * inside the sidebar would be clipped by its scroll container.
     */
    let state = {
      probe: 'loading',
      desktop: false,
      menu: false,
      anchor: null,
      pending: null,
      busy: null,
      sent: null,
      failure: null,
    };
    let triggerNode = null;
    const listeners = new Set();
    function patch(next) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    }
    const store = {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    const useStore = typeof React.useSyncExternalStore === 'function'
      ? () => React.useSyncExternalStore(store.subscribe, store.get)
      : () => {
        const [snapshot, setSnapshot] = React.useState(store.get);
        React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), []);
        return snapshot;
      };

    const useActiveLocale = (locale) => {
      const [active, setActive] = React.useState(() => locale.getLocale().active);
      React.useEffect(() => {
        const off = locale.subscribe(() => setActive(locale.getLocale().active));
        return typeof off === 'function' ? off : undefined;
      }, [locale]);
      return active;
    };

    async function callPower(payload, signal) {
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify(payload),
        signal,
      });
      let value = null;
      try {
        value = await response.json();
      } catch {
        value = null;
      }
      if (!response.ok || value === null || value.ok !== true) {
        const code = value !== null && typeof value.code === 'string' ? value.code : `http-${response.status}`;
        const error = new Error(code);
        error.code = code;
        throw error;
      }
      return value;
    }

    let probed = false;
    function probeOnce() {
      if (probed) return;
      probed = true;
      callPower({ action: 'probe' })
        .then((value) => patch({ probe: 'ready', desktop: value.desktop === true }))
        .catch(() => patch({ probe: 'error', desktop: false }));
    }

    function run(action) {
      patch({ failure: null, busy: action });
      callPower({ action })
        .then(() => patch({ busy: null, pending: null, sent: action }))
        .catch((error) => patch({ busy: null, failure: error.message || 'unknown' }));
    }

    function icon(paths) {
      return h('svg', {
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.9,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, paths.map((d, index) => h('path', { key: index, d })));
    }

    /* -------------------------------------------------------- sidebar trigger */
    function PowerButton(props) {
      const snapshot = useStore();
      const active = useActiveLocale(props.locale);
      const copy = copyFor(active);
      const rootRef = React.useRef(null);

      React.useEffect(() => {
        probeOnce();
        triggerNode = rootRef.current;
        return () => {
          triggerNode = null;
        };
      }, []);

      const hint = snapshot.probe === 'loading'
        ? copy.checking
        : snapshot.probe === 'error'
          ? copy.probeFailed
          : snapshot.desktop
            ? null
            : copy.desktopOnly;

      return h('div', { className: 'dpc-slot', ref: rootRef },
        h('button', {
          type: 'button',
          className: 'dpc-power',
          'aria-label': copy.trigger,
          'aria-haspopup': 'menu',
          'aria-expanded': snapshot.menu ? 'true' : 'false',
          title: hint === null ? copy.trigger : `${copy.trigger} — ${hint}`,
          onClick: () => {
            const node = rootRef.current;
            if (node === null) return;
            const rect = node.getBoundingClientRect();
            patch({
              menu: !snapshot.menu,
              anchor: snapshot.menu ? null : { left: rect.left, top: rect.top },
            });
          },
        }, icon(ICONS.power)));
    }

    /* ------------------------------------------------------- menu + dialog */
    function Overlay(props) {
      const snapshot = useStore();
      const active = useActiveLocale(props.locale);
      const copy = copyFor(active);
      const [stalled, setStalled] = React.useState(false);
      const menuRef = React.useRef(null);
      const cancelRef = React.useRef(null);

      React.useEffect(() => {
        if (!snapshot.menu) return undefined;
        const onPointerDown = (event) => {
          const menu = menuRef.current;
          const trigger = triggerNode;
          if (menu !== null && menu.contains(event.target)) return;
          if (trigger !== null && trigger.contains(event.target)) return;
          patch({ menu: false, anchor: null });
        };
        const close = () => patch({ menu: false, anchor: null });
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') close();
        }, true);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', close, true);
        return () => {
          document.removeEventListener('pointerdown', onPointerDown, true);
          window.removeEventListener('resize', close);
          window.removeEventListener('scroll', close, true);
        };
      }, [snapshot.menu]);

      React.useEffect(() => {
        if (snapshot.sent === null) return undefined;
        const timer = setTimeout(() => setStalled(true), 9000);
        return () => clearTimeout(timer);
      }, [snapshot.sent]);

      React.useEffect(() => {
        if (snapshot.pending === null) return undefined;
        if (cancelRef.current !== null) cancelRef.current.focus();
        const onKeyDown = (event) => {
          if (event.key !== 'Escape') return;
          event.preventDefault();
          event.stopPropagation();
          if (snapshot.busy === null) patch({ pending: null });
        };
        window.addEventListener('keydown', onKeyDown, true);
        return () => window.removeEventListener('keydown', onKeyDown, true);
      }, [snapshot.pending, snapshot.busy]);

      const hint = snapshot.probe === 'loading'
        ? copy.checking
        : snapshot.probe === 'error'
          ? copy.probeFailed
          : snapshot.desktop
            ? null
            : copy.desktopOnly;

      const item = (key, paths, label, onClick, danger) => h('button', {
        key,
        type: 'button',
        role: 'menuitem',
        className: `dpc-item${danger === true ? ' dpc-danger' : ''}`,
        disabled: key !== 'refresh' && (!snapshot.desktop || snapshot.busy !== null),
        onClick,
      }, icon(paths), h('span', null, label));

      let menu = null;
      if (snapshot.menu && snapshot.anchor !== null) {
        const width = 196;
        const left = Math.max(8, Math.min(snapshot.anchor.left, window.innerWidth - width - 8));
        const bottom = Math.max(8, window.innerHeight - snapshot.anchor.top + 6);
        menu = h('div', {
          className: 'dpc-menu',
          role: 'menu',
          'aria-label': copy.menu,
          ref: menuRef,
          style: { left: `${left}px`, bottom: `${bottom}px` },
        },
          item('refresh', ICONS.refresh, copy.refresh, () => {
            patch({ menu: false, anchor: null });
            window.location.reload();
          }, false),
          item('restart', ICONS.restart, copy.restart, () => {
            patch({ menu: false, anchor: null, failure: null, pending: 'restart' });
          }, false),
          item('shutdown', ICONS.shutdown, copy.shutdown, () => {
            patch({ menu: false, anchor: null, failure: null, pending: 'shutdown' });
          }, true),
          hint === null ? null : h('div', { className: 'dpc-hint' }, hint));
      }

      let dialog = null;
      if (snapshot.sent !== null) {
        const stalledLink = stalled ? h('button', {
          type: 'button',
          className: 'dpc-link',
          onClick: () => window.location.reload(),
        }, copy.stalled) : null;
        const status = h('div', {
          className: 'dpc-dialog dpc-status',
          role: 'status',
          'aria-live': 'polite',
        },
          h('div', { className: 'dpc-spinner', 'aria-hidden': 'true' }),
          h('p', null, snapshot.sent === 'restart' ? copy.restarting : copy.shuttingDown),
          stalledLink);
        dialog = h('div', { className: 'dpc-veil' }, status);
      } else if (snapshot.pending !== null) {
        const confirming = snapshot.pending;
        const confirmLabel = snapshot.busy === confirming
          ? (confirming === 'restart' ? copy.restarting : copy.shuttingDown)
          : (confirming === 'restart' ? copy.confirmRestart : copy.confirmShutdown);
        const cancelButton = h('button', {
          type: 'button',
          ref: cancelRef,
          disabled: snapshot.busy !== null,
          onClick: () => {
            if (snapshot.busy === null) patch({ pending: null });
          },
        }, copy.cancel);
        const confirmButton = h('button', {
          type: 'button',
          className: confirming === 'shutdown' ? 'dpc-danger' : 'dpc-primary',
          disabled: snapshot.busy !== null,
          onClick: () => run(confirming),
        }, confirmLabel);
        const body = h('div', {
          className: 'dpc-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'dpc-power-title',
          'aria-describedby': 'dpc-power-body',
          onClick: (event) => event.stopPropagation(),
        },
          h('h2', { id: 'dpc-power-title' }, confirming === 'restart' ? copy.restartConfirmTitle : copy.shutdownConfirmTitle),
          h('p', { id: 'dpc-power-body' }, confirming === 'restart' ? copy.restartConfirmBody : copy.shutdownConfirmBody),
          snapshot.failure === null ? null : h('p', { className: 'dpc-failure', role: 'alert' }, `${copy.failed}${snapshot.failure}`),
          h('div', { className: 'dpc-actions' }, cancelButton, confirmButton));
        dialog = h('div', {
          className: 'dpc-veil',
          onClick: () => {
            if (snapshot.busy === null) patch({ pending: null });
          },
        }, body);
      }

      if (menu === null && dialog === null) return null;
      return h(React.Fragment, null, menu, dialog);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-power-control',
          order: 50,
        }, (props) => h(PowerButton, { ...props, locale: ctx.locale })));

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'dsh-power-control-overlay',
          order: 50,
        }, (props) => h(React.Fragment, null,
          h('style', null, STYLE),
          h(Overlay, { ...props, locale: ctx.locale }))));
      },
    };
  },
});
