import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Card, Space, Typography, message } from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';

import { api, hasApi } from '../../lib/api.js';
import { useUiAppsRegistry } from './hooks/useUiAppsRegistry.js';

const { Title, Text } = Typography;

export function AppsPluginView({ pluginId, appId, onNavigate, surface = 'full', onRequestFullscreen }) {
  const { loading, error, data, refresh } = useUiAppsRegistry();
  const apps = useMemo(() => (Array.isArray(data?.apps) ? data.apps : []), [data]);

  const chatEventsUnsubRef = useRef(null);
  const chatEventsFilterRef = useRef({ sessionId: '', types: null });
  const chatEventsListenersRef = useRef(new Set());

  const moduleHeaderRef = useRef(null);
  const moduleContainerRef = useRef(null);
  const moduleDisposeRef = useRef(null);

  const [reloadToken, setReloadToken] = useState(0);
  const [moduleStatus, setModuleStatus] = useState({ loading: false, error: null });
  const [trusting, setTrusting] = useState(false);

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
  const entryType = typeof activeEntry?.type === 'string' ? activeEntry.type : 'module';
  const isModuleApp = entryType === 'module';
  const pluginTrusted = app?.plugin?.trusted === true;
  const hostBridgeEnabled =
    pluginTrusted && hasApi && isModuleApp && typeof entryUrl === 'string' && entryUrl.startsWith('file://');
  const compactMissing = surfaceMode === 'compact' && Boolean(app) && !compactEntry;

  useEffect(() => {
    if (!isModuleApp || !entryUrl || !pluginTrusted) return;

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
          // ignore
        }
      });
      observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
      return () => observer.disconnect();
    };

    const ensureBridge = () => {
      if (!hostBridgeEnabled) {
        throw new Error('Host bridge not available. Ensure the plugin is trusted and entry is file-based.');
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

        const listeners = chatEventsListenersRef.current;
        if (!listeners || listeners.size === 0) return;
        for (const listener of listeners) {
          try {
            listener(payload);
          } catch {
            // ignore
          }
        }
      });
    };

    const host = {
      bridge: { enabled: hostBridgeEnabled },
      context: {
        get: () => ({
          pluginId,
          appId,
          theme: getTheme(),
          surface: surfaceMode,
          bridge: { enabled: hostBridgeEnabled },
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
      uiPrompts: {
        read: async () => {
          ensureBridge();
          return await api.invoke('uiPrompts:read');
        },
        onUpdate: (listener) => {
          ensureBridge();
          if (typeof listener !== 'function') return () => {};
          return api.on('uiPrompts:update', (payload) => listener(payload));
        },
        respond: async (params) => {
          ensureBridge();
          const payload = params && typeof params === 'object' ? params : {};
          const res = await api.invoke('uiPrompts:respond', payload);
          if (res?.ok === false) throw new Error(res?.message || 'respond failed');
          return res;
        },
        request: async (params) => {
          ensureBridge();
          const raw = params && typeof params === 'object' ? params : {};
          const promptRaw = raw?.prompt && typeof raw.prompt === 'object' ? raw.prompt : null;
          const prompt = promptRaw ? { ...promptRaw } : null;
          if (prompt) {
            const source = typeof prompt.source === 'string' ? prompt.source.trim() : '';
            if (!source) prompt.source = `${pluginId}:${appId}`;
          }
          const res = await api.invoke('uiPrompts:request', { ...raw, ...(prompt ? { prompt } : {}) });
          if (res?.ok === false) throw new Error(res?.message || 'request failed');
          return res;
        },
        open: () => {
          try {
            window.dispatchEvent(new CustomEvent('chatos:uiPrompts:open'));
          } catch {
            // ignore
          }
          return { ok: true };
        },
        close: () => {
          try {
            window.dispatchEvent(new CustomEvent('chatos:uiPrompts:close'));
          } catch {
            // ignore
          }
          return { ok: true };
        },
        toggle: () => {
          try {
            window.dispatchEvent(new CustomEvent('chatos:uiPrompts:toggle'));
          } catch {
            // ignore
          }
          return { ok: true };
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
            const res = await api.invoke('chat:sessions:list', { mode: 'session' });
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
              if (chatEventsListenersRef.current.size === 0) {
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
            if (chatEventsUnsubRef.current) {
              try {
                chatEventsUnsubRef.current();
              } catch {
                // ignore
              }
            }
            chatEventsUnsubRef.current = null;
            chatEventsFilterRef.current = { sessionId: '', types: null };
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
          // ignore
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
      const headerContainer = moduleHeaderRef.current;
      if (headerContainer) {
        try {
          headerContainer.textContent = '';
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
          throw new Error('Module entry must export "mount({ container, host, slots })"');
        }

        const root = moduleContainerRef.current;
        if (!root) throw new Error('Module container not available');

        const res = await mount({ container: root, host, slots: { header: moduleHeaderRef.current } });
        const dispose =
          typeof res === 'function' ? res : res && typeof res === 'object' && typeof res.dispose === 'function' ? res.dispose.bind(res) : null;

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
      if (moduleHeaderRef.current) {
        try {
          moduleHeaderRef.current.textContent = '';
        } catch {
          // ignore
        }
      }
      if (moduleContainerRef.current) {
        try {
          moduleContainerRef.current.textContent = '';
        } catch {
          // ignore
        }
      }
      chatEventsListenersRef.current.clear();
      if (chatEventsUnsubRef.current) {
        try {
          chatEventsUnsubRef.current();
        } catch {
          // ignore
        }
      }
      chatEventsUnsubRef.current = null;
      chatEventsFilterRef.current = { sessionId: '', types: null };
    };
  }, [appId, entryUrl, hostBridgeEnabled, isModuleApp, onNavigate, pluginId, pluginTrusted, reloadToken, surfaceMode]);

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
      chatEventsFilterRef.current = { sessionId: '', types: null };
      chatEventsListenersRef.current.clear();
    };
  }, []);

  const reload = () => {
    refresh();
    setReloadToken((prev) => prev + 1);
  };

  const trustPlugin = async () => {
    if (!hasApi) {
      message.error('IPC bridge not available. Is preload loaded?');
      return;
    }
    const targetId = typeof pluginId === 'string' ? pluginId.trim() : '';
    if (!targetId) {
      message.error('pluginId is required');
      return;
    }
    setTrusting(true);
    try {
      const res = await api.invoke('uiApps:plugins:trust', { pluginId: targetId, trusted: true });
      if (res?.ok === false) throw new Error(res?.message || '信任失败');
      message.success('插件已标记为可信');
      await refresh();
    } catch (err) {
      message.error(err?.message || '信任失败');
    } finally {
      setTrusting(false);
    }
  };

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => (typeof onNavigate === 'function' ? onNavigate('apps/home') : null)}>
          返回
        </Button>
        <Title level={5} style={{ margin: 0 }}>
          {app?.name || '应用'}
        </Title>
        <div style={{ flex: 1 }} />
        <Button icon={<ReloadOutlined />} onClick={reload} disabled={loading}>
          刷新
        </Button>
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

      <Card
        size="small"
        style={{ flex: 1, minHeight: 0, borderRadius: 14 }}
        styles={{ body: { padding: 0, height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }}
      >
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
              !pluginTrusted ? (
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Alert
                    type="warning"
                    showIcon
                    message="插件未受信任"
                    description="为安全起见，模块入口已禁用。若确认来源可信，可手动标记为可信。"
                  />
                  <Space>
                    <Button type="primary" loading={trusting} onClick={trustPlugin}>
                      信任并启用
                    </Button>
                    <Text type="secondary">{pluginId}</Text>
                  </Space>
                </div>
              ) : (
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
                  <div ref={moduleHeaderRef} className="ds-ui-app-header-slot" style={{ flex: 'none' }} />
                  <div
                    ref={moduleContainerRef}
                    className="ds-ui-app-body-slot"
                    style={{ flex: 1, minHeight: 0, overflow: 'auto', overscrollBehavior: 'contain' }}
                  />
                </div>
              )
            ) : (
              <div style={{ padding: 14 }}>
                <Alert
                  type="warning"
                  showIcon
                  message="嵌入式入口已禁用"
                  description={`当前入口类型：${entryType || 'unknown'}`}
                />
              </div>
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
