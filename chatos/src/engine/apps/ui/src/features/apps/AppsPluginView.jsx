import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Segmented, Space, Typography, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';
import { useUiAppsRegistry } from './hooks/useUiAppsRegistry.js';

const { Title, Text } = Typography;

function normalizeBuiltinCliTab(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (raw === 'session' || raw === 'workspace' || raw === 'events') return raw;
  return 'session';
}

export function AppsPluginView({ pluginId, appId, onNavigate, surface = 'full', onRequestFullscreen }) {
  const { loading, error, data, refresh } = useUiAppsRegistry();
  const apps = useMemo(() => (Array.isArray(data?.apps) ? data.apps : []), [data]);
  const iframeRef = useRef(null);
  const chatEventsUnsubRef = useRef(null);
  const chatEventsFilterRef = useRef({ sessionId: '', types: null });
  const chatEventsToIframeRef = useRef(false);
  const chatEventsListenersRef = useRef(new Set());
  const moduleContainerRef = useRef(null);
  const moduleDisposeRef = useRef(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [moduleStatus, setModuleStatus] = useState({ loading: false, error: null });
  const isBuiltinCliConsole = String(pluginId || '') === 'com.leeoohoo.aideui.builtin' && String(appId || '') === 'cli';
  const [cliTab, setCliTab] = useState(() =>
    normalizeBuiltinCliTab(typeof window !== 'undefined' ? window.__aideuiCliTab : '')
  );

  const app = useMemo(
    () =>
      apps.find(
        (item) =>
          String(item?.plugin?.id || '') === String(pluginId || '') && String(item?.id || '') === String(appId || '')
      ),
    [apps, pluginId, appId]
  );

  const surfaceMode = surface === 'compact' ? 'compact' : 'full';
  const baseEntry = app?.entry || null;
  const compactEntry = baseEntry?.compact || null;
  const activeEntry = surfaceMode === 'compact' ? compactEntry : baseEntry;
  const entryUrl = typeof activeEntry?.url === 'string' ? activeEntry.url : '';
  const entryType = typeof activeEntry?.type === 'string' ? activeEntry.type : 'iframe';
  const isModuleApp = entryType === 'module';
  const hostBridgeEnabled = entryType !== 'url' && entryUrl.startsWith('file://');
  const compactMissing = surfaceMode === 'compact' && Boolean(app) && !compactEntry;

  useEffect(() => {
    if (!isBuiltinCliConsole) return undefined;
    const handler = (event) => {
      const next = normalizeBuiltinCliTab(event?.detail?.tab);
      setCliTab(next);
      try {
        window.__aideuiCliTab = next;
      } catch {
        // ignore
      }
    };
    window.addEventListener('aideui:cli:tabChange', handler);
    return () => window.removeEventListener('aideui:cli:tabChange', handler);
  }, [isBuiltinCliConsole]);


  const handleCliTabChange = useCallback((value) => {
    const next = normalizeBuiltinCliTab(String(value || ''));
    setCliTab(next);
    try {
      window.__aideuiCliTab = next;
    } catch {
      // ignore
    }
    try {
      window.dispatchEvent(new CustomEvent('aideui:cli:setTab', { detail: { tab: next } }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!isModuleApp || !entryUrl) return;

    let canceled = false;

    const getTheme = () => document?.documentElement?.dataset?.theme || 'light';

    const onThemeChange = (listener) => {
      if (typeof listener !== 'function') return () => {};
      const root = document?.documentElement;
      if (!root || typeof MutationObserver !== 'function') return () => {};
      let last = getTheme();
      const observer = new MutationObserver(() => {
        const next = getTheme();
        if (next === last) return;
        last = next;
        try {
          listener(next);
        } catch {
          // ignore listener errors
        }
      });
      observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    };

    const ensureBridge = () => {
      if (!hostBridgeEnabled) {
        throw new Error('Host bridge is disabled for URL apps. Use file-based plugins instead.');
      }
      if (!hasApi) {
        throw new Error('IPC bridge not available. Is preload loaded?');
      }
    };

    const ensureChatEventsSubscription = () => {
      ensureBridge();
      if (chatEventsUnsubRef.current) return;
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
    };

    const host = {
      bridge: { enabled: hostBridgeEnabled && hasApi },
      context: {
        get: () => ({
          pluginId,
          appId,
          theme: getTheme(),
          surface: surfaceMode,
          bridge: { enabled: hostBridgeEnabled && hasApi },
        }),
      },
      theme: { get: getTheme, onChange: onThemeChange },
      admin: {
        state: async () => {
          ensureBridge();
          return await api.invoke('admin:state');
        },
        onUpdate: (listener) => {
          ensureBridge();
          if (typeof listener !== 'function') return () => {};
          return api.on('admin:update', (payload) => listener(payload));
        },
        models: {
          list: async () => {
            ensureBridge();
            return await api.invoke('admin:models:list');
          },
        },
        secrets: {
          list: async () => {
            ensureBridge();
            return await api.invoke('admin:secrets:list');
          },
        },
      },
      registry: {
        list: async () => {
          ensureBridge();
          const res = await api.invoke('uiApps:list');
          if (res?.ok === false) throw new Error(res?.message || 'list failed');
          return res;
        },
      },
      backend: {
        invoke: async (method, params) => {
          ensureBridge();
          const backendMethod = typeof method === 'string' ? method.trim() : '';
          if (!backendMethod) throw new Error('method is required');
          const res = await api.invoke('uiApps:invoke', { pluginId, method: backendMethod, params });
          if (res?.ok === false) throw new Error(res?.message || 'invoke failed');
          return res?.result;
        },
      },
      ui: {
        surface: surfaceMode,
        navigate: (menu) => {
          const target = typeof menu === 'string' ? menu.trim() : '';
          if (!target) throw new Error('menu is required');
          if (typeof onNavigate === 'function') onNavigate(target);
          return { ok: true };
        },
        aideui: {
          hideTopBar: isBuiltinCliConsole,
        },
      },
      chat: {
        agents: {
          list: async () => {
            ensureBridge();
            const res = await api.invoke('chat:agents:list');
            if (res?.ok === false) throw new Error(res?.message || 'chat agents list failed');
            return res;
          },
          ensureDefault: async () => {
            ensureBridge();
            const res = await api.invoke('chat:agents:ensureDefault');
            if (res?.ok === false) throw new Error(res?.message || 'ensureDefault agent failed');
            return res;
          },
          create: async (params) => {
            ensureBridge();
            const payload = params && typeof params === 'object' ? params : {};
            const res = await api.invoke('chat:agents:create', payload);
            if (res?.ok === false) throw new Error(res?.message || 'create agent failed');
            return res;
          },
          update: async (id, data) => {
            ensureBridge();
            const targetId = typeof id === 'string' ? id.trim() : '';
            if (!targetId) throw new Error('id is required');
            const patch = data && typeof data === 'object' ? data : {};
            const res = await api.invoke('chat:agents:update', { id: targetId, data: patch });
            if (res?.ok === false) throw new Error(res?.message || 'update agent failed');
            return res;
          },
          delete: async (id) => {
            ensureBridge();
            const targetId = typeof id === 'string' ? id.trim() : '';
            if (!targetId) throw new Error('id is required');
            const res = await api.invoke('chat:agents:delete', { id: targetId });
            if (res?.ok === false) throw new Error(res?.message || 'delete agent failed');
            return res;
          },
          createForApp: async (params) => {
            ensureBridge();
            const payload = params && typeof params === 'object' ? params : {};
            const preferredName = typeof payload?.name === 'string' ? payload.name.trim() : '';
            const preferredDescription = typeof payload?.description === 'string' ? payload.description.trim() : '';
            const preferredPrompt = typeof payload?.prompt === 'string' ? payload.prompt : '';
            const preferredModelId = typeof payload?.modelId === 'string' ? payload.modelId.trim() : '';
            const base = await api.invoke('chat:agents:ensureDefault');
            if (base?.ok === false) throw new Error(base?.message || 'ensureDefault agent failed');
            const modelId = preferredModelId || base?.agent?.modelId || '';
            if (!modelId) throw new Error('modelId is required');

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
            if (res?.ok === false) throw new Error(res?.message || 'create agent failed');
            return res;
          },
        },
        sessions: {
          list: async () => {
            ensureBridge();
            const res = await api.invoke('chat:sessions:list');
            if (res?.ok === false) throw new Error(res?.message || 'chat sessions list failed');
            return res;
          },
          ensureDefault: async (params) => {
            ensureBridge();
            const payload = params && typeof params === 'object' ? params : {};
            const res = await api.invoke('chat:sessions:ensureDefault', payload);
            if (res?.ok === false) throw new Error(res?.message || 'ensureDefault failed');
            return res;
          },
          create: async (params) => {
            ensureBridge();
            const payload = params && typeof params === 'object' ? params : {};
            const res = await api.invoke('chat:sessions:create', payload);
            if (res?.ok === false) throw new Error(res?.message || 'create session failed');
            return res;
          },
        },
        messages: {
          list: async (params) => {
            ensureBridge();
            const payload = params && typeof params === 'object' ? params : {};
            const res = await api.invoke('chat:messages:list', payload);
            if (res?.ok === false) throw new Error(res?.message || 'list messages failed');
            return res;
          },
        },
        send: async (params) => {
          ensureBridge();
          const payload = params && typeof params === 'object' ? params : {};
          const res = await api.invoke('chat:send', payload);
          if (res?.ok === false) throw new Error(res?.message || 'send failed');
          return res;
        },
        abort: async (params) => {
          ensureBridge();
          const payload = params && typeof params === 'object' ? params : {};
          const res = await api.invoke('chat:abort', payload);
          if (res?.ok === false) throw new Error(res?.message || 'abort failed');
          return res;
        },
        events: {
          subscribe: (params, listener) => {
            ensureBridge();
            const payload = params && typeof params === 'object' ? params : {};
            const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : '';
            const types = Array.isArray(payload?.types) ? payload.types.map((t) => String(t || '').trim()).filter(Boolean) : null;
            chatEventsFilterRef.current = { sessionId, types: types && types.length ? types : null };

            if (typeof listener === 'function') {
              chatEventsListenersRef.current.add(listener);
            }
            ensureChatEventsSubscription();

            return () => {
              if (typeof listener === 'function') {
                chatEventsListenersRef.current.delete(listener);
              }
              if (!chatEventsToIframeRef.current && chatEventsListenersRef.current.size === 0) {
                if (chatEventsUnsubRef.current) {
                  try {
                    chatEventsUnsubRef.current();
                  } catch {
                    // ignore
                  }
                }
                chatEventsUnsubRef.current = null;
                chatEventsFilterRef.current = { sessionId: '', types: null };
              }
            };
          },
          unsubscribe: () => {
            chatEventsListenersRef.current.clear();
            if (!chatEventsToIframeRef.current) {
              if (chatEventsUnsubRef.current) {
                try {
                  chatEventsUnsubRef.current();
                } catch {
                  // ignore
                }
              }
              chatEventsUnsubRef.current = null;
              chatEventsFilterRef.current = { sessionId: '', types: null };
            }
            return { ok: true };
          },
        },
      },
    };

    const mountModule = async () => {
      setModuleStatus({ loading: true, error: null });

      if (moduleDisposeRef.current) {
        try {
          await moduleDisposeRef.current();
        } catch {
          // ignore dispose errors
        }
        moduleDisposeRef.current = null;
      }

      const container = moduleContainerRef.current;
      if (container) {
        try {
          container.textContent = '';
        } catch {
          // ignore
        }
      }

      try {
        const url = `${entryUrl}${entryUrl.includes('?') ? '&' : '?'}mtime=${encodeURIComponent(String(reloadToken))}`;
        const mod = await import(url);
        if (canceled) return;

        const mount = mod?.mount || mod?.default?.mount || mod?.default;
        if (typeof mount !== 'function') {
          throw new Error('Module entry must export "mount({ container, host })"');
        }

        const root = moduleContainerRef.current;
        if (!root) throw new Error('Module container not available');

        const res = await mount({ container: root, host });
        const dispose =
          typeof res === 'function'
            ? res
            : res && typeof res === 'object' && typeof res.dispose === 'function'
              ? res.dispose.bind(res)
              : null;

        if (canceled) {
          if (dispose) {
            try {
              await dispose();
            } catch {
              // ignore
            }
          }
          return;
        }

        moduleDisposeRef.current = dispose;
        setModuleStatus({ loading: false, error: null });
      } catch (err) {
        if (canceled) return;
        setModuleStatus({ loading: false, error: err?.message || String(err) });
      }
    };

    mountModule();

    return () => {
      canceled = true;
      if (moduleDisposeRef.current) {
        try {
          moduleDisposeRef.current();
        } catch {
          // ignore
        }
      }
      moduleDisposeRef.current = null;
      chatEventsListenersRef.current.clear();
      if (!chatEventsToIframeRef.current) {
        if (chatEventsUnsubRef.current) {
          try {
            chatEventsUnsubRef.current();
          } catch {
            // ignore
          }
        }
        chatEventsUnsubRef.current = null;
        chatEventsFilterRef.current = { sessionId: '', types: null };
      }
    };
  }, [appId, entryUrl, hostBridgeEnabled, isModuleApp, onNavigate, pluginId, reloadToken, surfaceMode]);

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

  const reload = () => {
    refresh();
    setReloadToken((prev) => prev + 1);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 40,
          padding: '12px 12px 0 12px',
          background: 'var(--ds-header-bg, rgba(255, 255, 255, 0.72))',
          borderBottom: '1px solid var(--ds-header-border, rgba(15, 23, 42, 0.08))',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12 }}>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => (typeof onNavigate === 'function' ? onNavigate('apps/home') : null)}
          >
            返回
          </Button>
          <Title level={5} style={{ margin: 0 }}>
            {app?.name || '应用'}
          </Title>
          {isBuiltinCliConsole ? (
            <Segmented
              className="ds-seg"
              value={cliTab}
              options={[
                { label: '主页', value: 'session' },
                { label: '文件浏览器', value: 'workspace' },
                { label: '轨迹', value: 'events' },
              ]}
              onChange={handleCliTabChange}
            />
          ) : null}
          <div style={{ flex: 1 }} />
          {isBuiltinCliConsole ? null : (
            <Button icon={<ReloadOutlined />} onClick={reload} disabled={loading}>
              刷新
            </Button>
          )}
        </div>
      </div>

      {error ? <Alert type="error" showIcon message="加载失败" description={error} /> : null}

      {!loading && !error && !app ? (
        <Alert
          type="warning"
          showIcon
          message="应用不存在或尚未安装"
          description={
            <Text type="secondary">
              {pluginId}:{appId}
            </Text>
          }
        />
      ) : null}

      <Card size="small" style={{ flex: 1, minHeight: 0, borderRadius: 14 }} styles={{ body: { padding: 0, height: '100%' } }}>
        <div style={{ height: '100%', minHeight: 0 }}>
          {compactMissing ? (
            <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Alert type="info" showIcon message="This app only provides a fullscreen UI." />
              <Button
                type="primary"
                onClick={() => {
                  if (typeof onRequestFullscreen === 'function') onRequestFullscreen();
                }}
              >
                Open Fullscreen
              </Button>
            </div>
          ) : entryUrl ? (
            isModuleApp ? (
              <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                {moduleStatus?.error ? (
                  <div style={{ padding: 12 }}>
                    <Alert type="error" showIcon message="应用加载失败" description={moduleStatus.error} />
                  </div>
                ) : null}
                {moduleStatus?.loading ? (
                  <div style={{ padding: 12 }}>
                    <Text type="secondary">加载中…</Text>
                  </div>
                ) : null}
                <div ref={moduleContainerRef} style={{ flex: 1, minHeight: 0, overflow: 'auto' }} />
              </div>
            ) : (
              <iframe
                key={reloadToken}
                ref={iframeRef}
                title={app?.name || `${pluginId}:${appId}`}
                src={entryUrl}
                style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
                onLoad={() => {
                  try {
                    const theme = document?.documentElement?.dataset?.theme || 'light';
                    iframeRef.current?.contentWindow?.postMessage(
                      {
                        __aideui: 'apps',
                        type: 'event',
                        event: 'host.ready',
                        payload: { pluginId, appId, theme, surface: surfaceMode, bridge: { enabled: hostBridgeEnabled } },
                      },
                      '*'
                    );
                  } catch {
                    // ignore
                  }
                }}
              />
            )
          ) : (
            <div style={{ padding: 14 }}>
              <Space direction="vertical" size={6}>
                <Text type="secondary">等待加载…</Text>
              </Space>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
