export function mount({ container, host, slots }) {
  if (!container) throw new Error('container is required');
  if (!host || typeof host !== 'object') throw new Error('host is required');

  const headerSlot =
    slots?.header && typeof slots.header === 'object' && typeof slots.header.appendChild === 'function' ? slots.header : null;

  const ctx = typeof host?.context?.get === 'function' ? host.context.get() : { pluginId: '', appId: '', theme: 'light' };
  const bridgeEnabled = Boolean(ctx?.bridge?.enabled);
  const appMetaPrefix = `${ctx?.pluginId || ''}:${ctx?.appId || ''}`;

  const root = document.createElement('div');
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.padding = '14px';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';

  const title = document.createElement('div');
  title.textContent = '__PLUGIN_NAME__ · __APP_ID__';
  title.style.fontWeight = '800';

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.opacity = '0.75';
  const renderMeta = (theme) => {
    meta.textContent = `${appMetaPrefix} · theme=${theme || 'light'} · bridge=${bridgeEnabled ? 'enabled' : 'disabled'}`;
  };
  renderMeta(ctx?.theme || 'light');

  const header = document.createElement('div');
  header.appendChild(title);
  header.appendChild(meta);

  const applyTheme = (theme) => {
    const nextTheme = theme || 'light';
    root.dataset.theme = nextTheme;
    renderMeta(nextTheme);
  };
  applyTheme(ctx?.theme || 'light');

  const body = document.createElement('div');
  body.style.display = 'grid';
  body.style.gridTemplateColumns = '320px 1fr';
  body.style.gap = '12px';
  body.style.flex = '1';
  body.style.minHeight = '0';

  const actions = document.createElement('div');
  actions.style.border = '1px solid var(--ds-panel-border, rgba(0,0,0,0.12))';
  actions.style.borderRadius = '14px';
  actions.style.padding = '12px';
  actions.style.display = 'grid';
  actions.style.gap = '10px';

  const input = document.createElement('textarea');
  input.placeholder = '输入要发送给 ChatOS / 后端 LLM 的内容…';
  input.style.width = '100%';
  input.style.minHeight = '86px';
  input.style.boxSizing = 'border-box';
  input.style.borderRadius = '12px';
  input.style.border = '1px solid var(--ds-panel-border, rgba(0,0,0,0.14))';
  input.style.background = 'var(--ds-subtle-bg, rgba(0,0,0,0.04))';
  input.style.padding = '10px 10px';
  input.style.resize = 'vertical';
  input.style.outline = 'none';

  const log = document.createElement('pre');
  log.style.border = '1px solid var(--ds-panel-border, rgba(0,0,0,0.12))';
  log.style.borderRadius = '14px';
  log.style.padding = '12px';
  log.style.margin = '0';
  log.style.overflow = 'auto';
  log.style.minHeight = '0';

  const appendLog = (type, payload) => {
    const ts = new Date().toISOString();
    log.textContent += `[${ts}] ${type}${payload !== undefined ? ` ${JSON.stringify(payload, null, 2)}` : ''}\n`;
    log.scrollTop = log.scrollHeight;
  };

  const mkBtn = (label) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.style.padding = '9px 10px';
    btn.style.borderRadius = '12px';
    btn.style.border = '1px solid var(--ds-panel-border, rgba(0,0,0,0.14))';
    btn.style.background = 'var(--ds-subtle-bg, rgba(0,0,0,0.04))';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = '650';
    return btn;
  };

  const run = async (label, fn) => {
    try {
      const res = await fn();
      appendLog(label, res);
      return res;
    } catch (e) {
      appendLog(`${label}.error`, { message: e?.message || String(e) });
      return null;
    }
  };

  const btnPing = mkBtn('backend.invoke("ping")');
  btnPing.addEventListener('click', () => run('backend.invoke', () => host.backend.invoke('ping', { hello: 'world' })));

  const btnLlmComplete = mkBtn('backend.invoke("llmComplete")');
  btnLlmComplete.addEventListener('click', async () => {
    const text = String(input.value || '').trim();
    if (!text) return;
    btnLlmComplete.disabled = true;
    try {
      const res = await run('backend.invoke.llmComplete', () => host.backend.invoke('llmComplete', { input: text }));
      if (res?.content) {
        log.textContent += `\n[sandbox llm]\n${String(res.content)}\n`;
        log.scrollTop = log.scrollHeight;
      }
    } finally {
      btnLlmComplete.disabled = false;
    }
  });

  const btnPrompt = mkBtn('uiPrompts.request(kv)');
  btnPrompt.addEventListener('click', async () => {
    try {
      const res = await host.uiPrompts.request({
        prompt: {
          kind: 'kv',
          title: '需要你补充信息',
          message: '填写后点 Submit',
          fields: [
            { key: 'name', label: '姓名', placeholder: '请输入', required: true },
            { key: 'note', label: '备注', placeholder: '可选', multiline: true },
          ],
        },
      });
      appendLog('uiPrompts.request', res);
      host.uiPrompts.open();
    } catch (e) {
      appendLog('uiPrompts.request.error', { message: e?.message || String(e) });
    }
  });

  let activeSessionId = '';
  let chatUnsub = null;
  let themeUnsub = null;

  if (typeof host?.theme?.onChange === 'function') {
    themeUnsub = host.theme.onChange((theme) => applyTheme(theme));
  }

  const ensureSession = async () => {
    const agents = await run('chat.agents.list', () => host.chat.agents.list());
    let agentId = agents?.agents?.[0]?.id || '';
    if (!agentId) {
      const ensured = await run('chat.agents.ensureDefault', () => host.chat.agents.ensureDefault());
      agentId = ensured?.agent?.id || ensured?.agents?.[0]?.id || '';
    }
    if (!agentId) throw new Error('no agentId');

    const res = await run('chat.sessions.ensureDefault', () => host.chat.sessions.ensureDefault({ agentId }));
    activeSessionId = res?.session?.id || '';
    if (activeSessionId) appendLog('activeSessionId', activeSessionId);
    return activeSessionId;
  };

  const btnEnsureSession = mkBtn('chat.sessions.ensureDefault');
  btnEnsureSession.addEventListener('click', () => ensureSession().catch((e) => appendLog('chat.ensureSession.error', { message: e?.message || String(e) })));

  const btnSend = mkBtn('chat.send');
  btnSend.addEventListener('click', async () => {
    const text = String(input.value || '').trim();
    if (!text) return;
    btnSend.disabled = true;
    try {
      if (!activeSessionId) await ensureSession();
      if (!activeSessionId) throw new Error('no sessionId');
      await run('chat.send', () => host.chat.send({ sessionId: activeSessionId, text }));
      input.value = '';
    } finally {
      btnSend.disabled = false;
    }
  });

  const btnSub = mkBtn('chat.events.subscribe');
  btnSub.addEventListener('click', async () => {
    if (!activeSessionId) await ensureSession();
    if (!activeSessionId) {
      appendLog('chat.events.subscribe.error', { message: 'no sessionId' });
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
        appendLog('chat.event', payload);
        if (payload?.type === 'assistant_delta' && payload?.delta) {
          log.textContent += payload.delta;
          log.scrollTop = log.scrollHeight;
        }
      });
      appendLog('chat.events.subscribe', { ok: true });
    } catch (e) {
      appendLog('chat.events.subscribe.error', { message: e?.message || String(e) });
    }
  });

  const btnUnsub = mkBtn('chat.events.unsubscribe');
  btnUnsub.addEventListener('click', () => {
    if (chatUnsub) {
      try {
        chatUnsub();
      } catch {
        // ignore
      }
      chatUnsub = null;
      appendLog('chat.events.unsubscribe', { ok: true });
      return;
    }
    run('chat.events.unsubscribe', () => host.chat.events.unsubscribe());
  });

  actions.appendChild(btnPing);
  actions.appendChild(btnLlmComplete);
  actions.appendChild(btnPrompt);
  actions.appendChild(input);
  actions.appendChild(btnEnsureSession);
  actions.appendChild(btnSend);
  actions.appendChild(btnSub);
  actions.appendChild(btnUnsub);

  body.appendChild(actions);
  body.appendChild(log);

  root.appendChild(body);

  if (headerSlot) {
    try {
      headerSlot.textContent = '';
      headerSlot.appendChild(header);
    } catch {
      root.prepend(header);
    }
  } else {
    root.prepend(header);
  }

  try {
    container.textContent = '';
  } catch {
    // ignore
  }
  container.appendChild(root);

  return () => {
    if (chatUnsub) {
      try {
        chatUnsub();
      } catch {
        // ignore
      }
      chatUnsub = null;
    }
    if (themeUnsub) {
      try {
        themeUnsub();
      } catch {
        // ignore
      }
      themeUnsub = null;
    }
    try {
      container.textContent = '';
    } catch {
      // ignore
    }
  };
}
