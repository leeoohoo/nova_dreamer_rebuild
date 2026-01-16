import { useEffect } from 'react';

import { api, hasApi } from '../../../lib/api.js';

export function useAppsPluginIframeBridge({
  iframeRef,
  chatEventsUnsubRef,
  chatEventsFilterRef,
  chatEventsToIframeRef,
  chatEventsListenersRef,
  pluginId,
  appId,
  onNavigate,
  hostBridgeEnabled,
}) {
  useEffect(() => {
    const handleMessage = async (event) => {
      const frame = iframeRef.current;
      const sourceWindow = frame?.contentWindow;
      if (!sourceWindow || event.source !== sourceWindow) return;

      const message = event?.data;
      if (!message || typeof message !== 'object') return;
      if (message.__aideui !== 'apps' || message.type !== 'invoke') return;

      const requestId = typeof message.requestId === 'string' ? message.requestId : '';
      const method = typeof message.method === 'string' ? message.method.trim() : '';
      if (!requestId || !method) return;

      const reply = async (payload) => {
        try {
          sourceWindow.postMessage({ __aideui: 'apps', type: 'response', requestId, ...payload }, '*');
        } catch {
          // ignore postMessage errors
        }
      };

      try {
        if (method === 'context.get') {
          const theme = document?.documentElement?.dataset?.theme || 'light';
          await reply({
            ok: true,
            result: {
              pluginId,
              appId,
              theme,
              bridge: { enabled: hostBridgeEnabled },
            },
          });
          return;
        }

        if (!hostBridgeEnabled) {
          await reply({ ok: false, error: 'Host bridge is disabled for URL apps. Use iframe file-based plugins instead.' });
          return;
        }

        if (method === 'registry.list') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('uiApps:list');
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'list failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'admin.state') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('admin:state');
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'admin.models.list') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('admin:models:list');
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'admin.secrets.list') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('admin:secrets:list');
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'backend.invoke') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const backendMethod = typeof message?.params?.method === 'string' ? message.params.method.trim() : '';
          if (!backendMethod) {
            await reply({ ok: false, error: 'params.method is required' });
            return;
          }
          const res = await api.invoke('uiApps:invoke', { pluginId, method: backendMethod, params: message?.params?.params });
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'invoke failed' });
            return;
          }
          await reply({ ok: true, result: res?.result });
          return;
        }

        if (method === 'ui.navigate') {
          const target = typeof message?.params?.menu === 'string' ? message.params.menu.trim() : '';
          if (!target) {
            await reply({ ok: false, error: 'params.menu is required' });
            return;
          }
          if (typeof onNavigate === 'function') {
            onNavigate(target);
          }
          await reply({ ok: true, result: { ok: true } });
          return;
        }

        if (method === 'chat.agents.list') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('chat:agents:list');
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'chat agents list failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.agents.ensureDefault') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('chat:agents:ensureDefault');
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'ensureDefault agent failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.agents.create') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const payload = message?.params && typeof message.params === 'object' ? message.params : {};
          const res = await api.invoke('chat:agents:create', payload);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'create agent failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.agents.update') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const payload = message?.params && typeof message.params === 'object' ? message.params : {};
          const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
          if (!id) {
            await reply({ ok: false, error: 'params.id is required' });
            return;
          }
          const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
          const res = await api.invoke('chat:agents:update', { id, data });
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'update agent failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.agents.delete') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const payload = message?.params && typeof message.params === 'object' ? message.params : {};
          const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
          if (!id) {
            await reply({ ok: false, error: 'params.id is required' });
            return;
          }
          const res = await api.invoke('chat:agents:delete', { id });
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'delete agent failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.agents.createForApp') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const payload = message?.params && typeof message.params === 'object' ? message.params : {};
          const preferredName = typeof payload?.name === 'string' ? payload.name.trim() : '';
          const preferredDescription = typeof payload?.description === 'string' ? payload.description.trim() : '';
          const preferredPrompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
          const preferredModelId = typeof payload?.modelId === 'string' ? payload.modelId.trim() : '';
          const base = await api.invoke('chat:agents:ensureDefault');
          if (base?.ok === false) {
            await reply({ ok: false, error: base?.message || 'ensureDefault agent failed' });
            return;
          }
          const modelId = preferredModelId || base?.agent?.modelId || '';
          if (!modelId) {
            await reply({ ok: false, error: 'modelId is required' });
            return;
          }
          const agentPayload = {
            name: preferredName || `${pluginId}:${appId} Agent`,
            description: preferredDescription || `应用专用 Agent（${pluginId}:${appId}）`,
            prompt: preferredPrompt,
            modelId,
            promptIds: Array.isArray(payload?.promptIds) ? payload.promptIds : [],
            subagentIds: Array.isArray(payload?.subagentIds) ? payload.subagentIds : [],
            skills: Array.isArray(payload?.skills) ? payload.skills : [],
            mcpServerIds: Array.isArray(payload?.mcpServerIds) ? payload.mcpServerIds : [],
            uiApps: [{ pluginId, appId, mcp: true, prompt: true }],
          };
          const res = await api.invoke('chat:agents:create', agentPayload);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'create agent failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.sessions.list') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const res = await api.invoke('chat:sessions:list');
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'chat sessions list failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.sessions.ensureDefault') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const params = message?.params && typeof message.params === 'object' ? message.params : {};
          const res = await api.invoke('chat:sessions:ensureDefault', params);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'ensureDefault failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.sessions.create') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const params = message?.params && typeof message.params === 'object' ? message.params : {};
          const res = await api.invoke('chat:sessions:create', params);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'create session failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.messages.list') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const params = message?.params && typeof message.params === 'object' ? message.params : {};
          const res = await api.invoke('chat:messages:list', params);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'list messages failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.send') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const params = message?.params && typeof message.params === 'object' ? message.params : {};
          const res = await api.invoke('chat:send', params);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'send failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.abort') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const params = message?.params && typeof message.params === 'object' ? message.params : {};
          const res = await api.invoke('chat:abort', params);
          if (res?.ok === false) {
            await reply({ ok: false, error: res?.message || 'abort failed' });
            return;
          }
          await reply({ ok: true, result: res });
          return;
        }

        if (method === 'chat.events.subscribe') {
          if (!hasApi) {
            await reply({ ok: false, error: 'IPC bridge not available' });
            return;
          }
          const params = message?.params && typeof message.params === 'object' ? message.params : {};
          const sessionId = typeof params?.sessionId === 'string' ? params.sessionId.trim() : '';
          const types = Array.isArray(params?.types) ? params.types.map((t) => String(t || '').trim()).filter(Boolean) : null;
          chatEventsFilterRef.current = { sessionId, types: types && types.length ? types : null };
          chatEventsToIframeRef.current = true;

          if (!chatEventsUnsubRef.current) {
            chatEventsUnsubRef.current = api.on('chat:event', (payload) => {
              if (!payload || typeof payload !== 'object') return;
              const filter = chatEventsFilterRef.current || { sessionId: '', types: null };
              if (filter?.sessionId && String(payload?.sessionId || '') !== filter.sessionId) return;
              if (Array.isArray(filter?.types) && filter.types.length > 0) {
                const eventType = String(payload?.type || '');
                if (!filter.types.includes(eventType)) return;
              }

              if (chatEventsToIframeRef.current) {
                const targetWindow = iframeRef.current?.contentWindow;
                if (targetWindow) {
                  try {
                    targetWindow.postMessage({ __aideui: 'apps', type: 'event', event: 'chat.event', payload }, '*');
                  } catch {
                    // ignore
                  }
                }
              }

              const listeners = chatEventsListenersRef.current;
              if (!listeners || listeners.size === 0) return;
              for (const listener of listeners) {
                try {
                  listener(payload);
                } catch {
                  // ignore listener errors
                }
              }
            });
          }

          await reply({ ok: true, result: { ok: true } });
          return;
        }

        if (method === 'chat.events.unsubscribe') {
          chatEventsToIframeRef.current = false;
          if (!chatEventsListenersRef.current || chatEventsListenersRef.current.size === 0) {
            if (chatEventsUnsubRef.current) {
              try {
                chatEventsUnsubRef.current();
              } catch {
                // ignore
              }
              chatEventsUnsubRef.current = null;
            }
            chatEventsFilterRef.current = { sessionId: '', types: null };
          }
          await reply({ ok: true, result: { ok: true } });
          return;
        }

        await reply({ ok: false, error: `Unknown method: ${method}` });
      } catch (err) {
        await reply({ ok: false, error: err?.message || String(err) });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [pluginId, appId, onNavigate, hostBridgeEnabled]);

  useEffect(() => {
    return () => {
      if (chatEventsUnsubRef.current) {
        try {
          chatEventsUnsubRef.current();
        } catch {
          // ignore
        }
      }
      chatEventsUnsubRef.current = null;
      chatEventsToIframeRef.current = false;
      chatEventsFilterRef.current = { sessionId: '', types: null };
      chatEventsListenersRef.current.clear();
    };
  }, []);
}
