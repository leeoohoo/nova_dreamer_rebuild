import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Space } from 'antd';
import {
  AppstoreOutlined,
  DoubleLeftOutlined,
  DoubleRightOutlined,
  HomeOutlined,
} from '@ant-design/icons';

import { ChatView as BaseChatView } from '../../../../../src/common/aide-ui/features/chat/ChatView.jsx';
import { AppsHubView } from '../apps/AppsHubView.jsx';
import { AppsPluginView } from '../apps/AppsPluginView.jsx';

const DEFAULT_DRAWER_WIDTH = 520;

function decodeRouteSegment(value) {
  if (typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseAppsRoute(route) {
  const raw = typeof route === 'string' ? route.trim() : '';
  if (!raw) return { type: 'unknown', route: '' };
  if (raw === 'apps' || raw === 'apps/home') return { type: 'home', route: raw };
  if (raw.startsWith('apps/plugin/')) {
    const parts = raw.split('/');
    const pluginId = decodeRouteSegment(parts[2] || '');
    const appId = decodeRouteSegment(parts[3] || '');
    if (pluginId && appId) return { type: 'app', route: raw, pluginId, appId };
  }
  return { type: 'external', route: raw };
}

export function ChatView({ admin, onNavigate }) {
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [drawerFullscreen, setDrawerFullscreen] = useState(false);
  const [activeApp, setActiveApp] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const sidebarCollapsedBeforeAppRef = useRef(false);

  const showApp = Boolean(activeApp?.pluginId && activeApp?.appId);
  const headerTitle = showApp ? '应用' : '应用列表';

  useEffect(() => {
    if (showApp) {
      setSidebarCollapsed((prev) => {
        sidebarCollapsedBeforeAppRef.current = prev;
        return true;
      });
      return;
    }
    setSidebarCollapsed(sidebarCollapsedBeforeAppRef.current);
  }, [showApp]);

  const handleDrawerNavigate = useCallback(
    (route) => {
      const parsed = parseAppsRoute(route);
      if (parsed.type === 'home') {
        setActiveApp(null);
        setDrawerFullscreen(false);
        setDrawerOpen(true);
        return;
      }
      if (parsed.type === 'app') {
        setActiveApp({ pluginId: parsed.pluginId, appId: parsed.appId });
        setDrawerOpen(true);
        return;
      }
      if (typeof onNavigate === 'function' && parsed.route) {
        onNavigate(parsed.route);
      }
    },
    [onNavigate]
  );

  const drawerStyle = useMemo(() => {
    const width = drawerFullscreen ? '100%' : showApp ? '50%' : DEFAULT_DRAWER_WIDTH;
    return {
      width,
      minWidth: drawerFullscreen ? 0 : showApp ? '50%' : DEFAULT_DRAWER_WIDTH,
      maxWidth: '100%',
      flex: drawerFullscreen ? '1 1 auto' : showApp ? '0 0 50%' : '0 0 auto',
      background: 'var(--ds-panel-bg)',
      borderLeft: drawerFullscreen ? 'none' : '1px solid var(--ds-panel-border)',
      boxShadow: 'var(--ds-panel-shadow)',
      display: 'flex',
      flexDirection: 'column',
      minHeight: 0,
    };
  }, [drawerFullscreen, showApp]);

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 0, display: 'flex', gap: 4 }}>
      {!drawerFullscreen ? (
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <BaseChatView
            admin={admin}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarCollapsedChange={setSidebarCollapsed}
          />
          {!drawerOpen ? (
            <Button
              type="primary"
              size="small"
              icon={<AppstoreOutlined />}
              onClick={() => setDrawerOpen(true)}
              style={{
                position: 'absolute',
                right: 8,
                top: 16,
                borderRadius: 8,
                zIndex: 10,
              }}
              title="Apps"
            />
          ) : null}
        </div>
      ) : null}

      {drawerOpen ? (
        <div style={drawerStyle} aria-hidden={!drawerOpen}>
          <div
            style={{
              padding: '10px 12px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid var(--ds-panel-border)',
              background: 'var(--ds-subtle-bg)',
            }}
          >
            <AppstoreOutlined />
            <span style={{ fontWeight: 600 }}>{headerTitle}</span>
            <div style={{ flex: 1 }} />
            <Space size={6}>
              <Button
                size="small"
                icon={<HomeOutlined />}
                onClick={() => {
                  setActiveApp(null);
                  setDrawerFullscreen(false);
                }}
                disabled={!showApp}
              >
                Home
              </Button>
              <Button
                size="small"
                icon={<DoubleLeftOutlined />}
                onClick={() => setDrawerFullscreen((prev) => !prev)}
              >
                {drawerFullscreen ? '退出全屏' : '全屏'}
              </Button>
              <Button
                size="small"
                icon={<DoubleRightOutlined />}
                onClick={() => {
                  setDrawerOpen(false);
                  setDrawerFullscreen(false);
                }}
              >
                收起
              </Button>
            </Space>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', padding: 12 }}>
            {showApp ? (
              <AppsPluginView
                pluginId={activeApp.pluginId}
                appId={activeApp.appId}
                onNavigate={handleDrawerNavigate}
                surface={drawerFullscreen ? 'full' : 'compact'}
                onRequestFullscreen={() => setDrawerFullscreen(true)}
              />
            ) : (
              <AppsHubView onNavigate={handleDrawerNavigate} />
            )}
          </div>

        </div>
      ) : null}
    </div>
  );
}
