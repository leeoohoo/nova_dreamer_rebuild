export function mount({ container, host, slots }) {
  if (!container) throw new Error('container is required');
  if (!host || typeof host !== 'object') throw new Error('host is required');

  const headerSlot =
    slots?.header && typeof slots.header === 'object' && typeof slots.header.appendChild === 'function' ? slots.header : null;

  const cleanups = [];
  const ctx = typeof host?.context?.get === 'function' ? host.context.get() : { pluginId: '', appId: '', theme: 'light' };
  const bridgeEnabled = Boolean(ctx?.bridge?.enabled);

  const appendLog = (el, type, payload) => {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${type}${payload !== undefined ? ` ${JSON.stringify(payload, null, 2)}` : ''}\n`;
    el.textContent += line;
    el.scrollTop = el.scrollHeight;
  };

  const root = document.createElement('div');
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.padding = '14px';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.justifyContent = 'space-between';
  header.style.gap = '12px';

  const title = document.createElement('div');
  title.textContent = 'Hello Module · Template';
  title.style.fontWeight = '750';
  title.style.letterSpacing = '0.2px';

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.opacity = '0.72';
  meta.textContent = `${ctx?.pluginId || ''}:${ctx?.appId || ''} · theme=${ctx?.theme || 'light'} · bridge=${bridgeEnabled ? 'enabled' : 'disabled'}`;

  const left = document.createElement('div');
  left.appendChild(title);
  left.appendChild(meta);

  const themePill = document.createElement('div');
  themePill.style.fontSize = '12px';
  themePill.style.padding = '6px 10px';
  themePill.style.borderRadius = '999px';
  themePill.style.border = '1px solid rgba(0,0,0,0.12)';
  themePill.style.background = 'rgba(0,0,0,0.04)';
  themePill.textContent = `theme: ${ctx?.theme || 'light'}`;

  header.appendChild(left);
  header.appendChild(themePill);

  const content = document.createElement('div');
  content.style.display = 'grid';
  content.style.gridTemplateColumns = '360px 1fr';
  content.style.gap = '12px';
  content.style.flex = '1';
  content.style.minHeight = '0';

  const actions = document.createElement('div');
  actions.style.border = '1px solid rgba(0,0,0,0.12)';
  actions.style.borderRadius = '14px';
  actions.style.overflow = 'hidden';

  const actionsTitle = document.createElement('div');
  actionsTitle.textContent = 'Actions';
  actionsTitle.style.padding = '10px 12px';
  actionsTitle.style.borderBottom = '1px solid rgba(0,0,0,0.10)';
  actionsTitle.style.fontSize = '13px';
  actionsTitle.style.fontWeight = '650';

  const actionsBody = document.createElement('div');
  actionsBody.style.padding = '10px 12px';
  actionsBody.style.display = 'grid';
  actionsBody.style.gap = '10px';

  const mkBtn = (label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.padding = '9px 10px';
    btn.style.borderRadius = '12px';
    btn.style.border = '1px solid rgba(0,0,0,0.14)';
    btn.style.background = 'rgba(0,0,0,0.04)';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '650';
    return btn;
  };

  const btnContext = mkBtn('context.get');
  const btnRegistry = mkBtn('registry.list');
  const btnPing = mkBtn('backend.invoke ping');
  const btnEnsureAgent = mkBtn('chat.agents.ensureDefault');
  const btnCreateForApp = mkBtn('chat.agents.createForApp');
  const btnEnsureSession = mkBtn('chat.sessions.ensureDefault');

  const input = document.createElement('textarea');
  input.placeholder = '输入要发给智能体的内容…';
  input.style.width = '100%';
  input.style.minHeight = '86px';
  input.style.boxSizing = 'border-box';
  input.style.borderRadius = '12px';
  input.style.border = '1px solid rgba(0,0,0,0.14)';
  input.style.background = 'rgba(0,0,0,0.04)';
  input.style.padding = '10px 10px';
  input.style.resize = 'vertical';
  input.style.outline = 'none';

  const btnSend = mkBtn('chat.send');
  const btnSub = mkBtn('chat.events.subscribe');
  const btnUnsub = mkBtn('chat.events.unsubscribe');

  actionsBody.appendChild(btnContext);
  actionsBody.appendChild(btnRegistry);
  actionsBody.appendChild(btnPing);
  actionsBody.appendChild(btnEnsureAgent);
  actionsBody.appendChild(btnCreateForApp);
  actionsBody.appendChild(btnEnsureSession);
  actionsBody.appendChild(input);
  actionsBody.appendChild(btnSend);
  actionsBody.appendChild(btnSub);
  actionsBody.appendChild(btnUnsub);
  actions.appendChild(actionsTitle);
  actions.appendChild(actionsBody);

  const logCard = document.createElement('div');
  logCard.style.border = '1px solid rgba(0,0,0,0.12)';
  logCard.style.borderRadius = '14px';
  logCard.style.overflow = 'hidden';
  logCard.style.minHeight = '0';

  const logTitle = document.createElement('div');
  logTitle.textContent = 'Log';
  logTitle.style.padding = '10px 12px';
  logTitle.style.borderBottom = '1px solid rgba(0,0,0,0.10)';
  logTitle.style.fontSize = '13px';
  logTitle.style.fontWeight = '650';

  const log = document.createElement('pre');
  log.style.margin = '0';
  log.style.padding = '12px';
  log.style.height = '100%';
  log.style.boxSizing = 'border-box';
  log.style.overflow = 'auto';
  log.style.fontFamily =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  log.style.fontSize = '12px';
  log.style.lineHeight = '1.45';

  logCard.appendChild(logTitle);
  logCard.appendChild(log);

  content.appendChild(actions);
  content.appendChild(logCard);

  if (headerSlot) {
    try {
      headerSlot.textContent = '';
    } catch {
      // ignore
    }
    try {
      headerSlot.appendChild(header);
    } catch {
      root.appendChild(header);
    }
  } else {
    root.appendChild(header);
  }
  root.appendChild(content);

  try {
    container.textContent = '';
  } catch {
    // ignore
  }
  container.appendChild(root);

  let activeSessionId = '';
  let chatUnsub = null;

  const run = async (label, fn) => {
    try {
      const res = await fn();
      appendLog(log, label, res);
      return res;
    } catch (err) {
      appendLog(log, `${label}.error`, { message: err?.message || String(err) });
      return null;
    }
  };

  btnContext.addEventListener('click', () => run('context.get', () => host.context.get()));
  btnRegistry.addEventListener('click', () => run('registry.list', () => host.registry.list()));
  btnPing.addEventListener('click', () => run('backend.invoke', () => host.backend.invoke('ping', { hello: 'world' })));
  btnEnsureAgent.addEventListener('click', () => run('chat.agents.ensureDefault', () => host.chat.agents.ensureDefault()));
  btnCreateForApp.addEventListener('click', () =>
    run('chat.agents.createForApp', () =>
      host.chat.agents.createForApp({
        name: 'Hello Module · Dedicated Agent',
        description: 'Template app generated agent (auto binds current app)',
      })
    )
  );
  btnEnsureSession.addEventListener('click', async () => {
    const agents = await run('chat.agents.list', () => host.chat.agents.list());
    const agentId = agents?.agents?.[0]?.id || '';
    const res = await run('chat.sessions.ensureDefault', () => host.chat.sessions.ensureDefault({ agentId }));
    activeSessionId = res?.session?.id || '';
    if (activeSessionId) appendLog(log, 'activeSessionId', activeSessionId);
  });

  btnSend.addEventListener('click', async () => {
    const text = String(input.value || '').trim();
    if (!text) return;
    btnSend.disabled = true;
    try {
      if (!activeSessionId) {
        btnEnsureSession.click();
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!activeSessionId) throw new Error('no sessionId');
      await run('chat.send', () => host.chat.send({ sessionId: activeSessionId, text }));
      input.value = '';
    } catch (err) {
      appendLog(log, 'chat.send.error', { message: err?.message || String(err) });
    } finally {
      btnSend.disabled = false;
    }
  });

  btnSub.addEventListener('click', async () => {
    if (!activeSessionId) {
      btnEnsureSession.click();
      await new Promise((r) => setTimeout(r, 0));
    }
    if (!activeSessionId) {
      appendLog(log, 'chat.events.subscribe.error', { message: 'no sessionId' });
      return;
    }
    if (chatUnsub) {
      try {
        chatUnsub();
      } catch {
        // ignore
      }
      chatUnsub = null;
    }
    try {
      chatUnsub = host.chat.events.subscribe({ sessionId: activeSessionId }, (payload) => {
        appendLog(log, 'chat.event', payload);
        if (payload?.type === 'assistant_delta' && payload?.delta) {
          log.textContent += payload.delta;
          log.scrollTop = log.scrollHeight;
        }
      });
      appendLog(log, 'chat.events.subscribe', { ok: true });
    } catch (err) {
      appendLog(log, 'chat.events.subscribe.error', { message: err?.message || String(err) });
    }
  });

  btnUnsub.addEventListener('click', () => {
    if (chatUnsub) {
      try {
        chatUnsub();
      } catch {
        // ignore
      }
      chatUnsub = null;
      appendLog(log, 'chat.events.unsubscribe', { ok: true });
      return;
    }
    run('chat.events.unsubscribe', () => host.chat.events.unsubscribe());
  });

  if (typeof host?.theme?.onChange === 'function') {
    const themeUnsub = host.theme.onChange((theme) => {
      themePill.textContent = `theme: ${theme}`;
      appendLog(log, 'theme.change', theme);
    });
    if (typeof themeUnsub === 'function') cleanups.push(themeUnsub);
  }

  appendLog(log, 'boot', { note: 'Hello Module mounted', context: ctx });

  return () => {
    if (chatUnsub) {
      try {
        chatUnsub();
      } catch {
        // ignore
      }
      chatUnsub = null;
    }
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
    cleanups.length = 0;
    try {
      container.textContent = '';
    } catch {
      // ignore
    }
    if (headerSlot) {
      try {
        headerSlot.textContent = '';
      } catch {
        // ignore
      }
    }
  };
}
