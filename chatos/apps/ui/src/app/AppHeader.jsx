import React from 'react';
import { Button, Dropdown, Layout, Segmented, Space, Typography } from 'antd';
import {
  AppstoreOutlined,
  MessageOutlined,
  MoonOutlined,
  RobotOutlined,
  SettingOutlined,
  SunOutlined,
} from '@ant-design/icons';

const { Header } = Layout;
const { Title } = Typography;

export function AppHeader({
  themeMode = 'light',
  onToggleTheme,
  menu,
  onMenuChange,
  onAdminBack,
  developerMode: _developerMode = false,
}) {
  const rawMenu = typeof menu === 'string' ? menu : '';
  const currentMenu = rawMenu;
  const setMenu = typeof onMenuChange === 'function' ? onMenuChange : () => {};
  const normalizedMenu = rawMenu === 'chat' ? 'chat/session' : rawMenu === 'apps' ? 'apps/home' : rawMenu;
  const legacyCliMenu =
    normalizedMenu === 'cli' ||
    normalizedMenu === 'session' ||
    normalizedMenu === 'workspace' ||
    normalizedMenu === 'events' ||
    normalizedMenu.startsWith('cli/');
  const effectiveMenu = legacyCliMenu ? 'chat/session' : normalizedMenu;
  const mode = effectiveMenu.startsWith('apps/') ? 'apps' : 'chat';
  const primaryValue = mode;
  const secondaryValue = mode === 'apps' ? 'apps/home' : effectiveMenu.startsWith('chat/') ? effectiveMenu : 'chat/session';

  const builtinCliMenu = 'apps/plugin/com.leeoohoo.aideui.builtin/cli';
  const showAdminBack = normalizedMenu.startsWith('admin/');
  const handleAdminBack = typeof onAdminBack === 'function' ? onAdminBack : () => setMenu(builtinCliMenu);

  const adminMenuItems = [
    { key: 'admin/models', label: '模型' },
    { key: 'admin/secrets', label: 'API Keys' },
    { key: 'admin/advanced', label: '高级设置' },
  ];

  return (
    <Header
      className="ds-app-header"
      data-mode={mode}
      style={{
        background: 'var(--ds-header-bg)',
        padding: '0 16px',
        borderBottom: '1px solid var(--ds-header-border)',
        minHeight: 64,
        height: 64,
        display: 'flex',
        alignItems: 'center',
        lineHeight: 'normal',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', flexWrap: 'nowrap', overflow: 'hidden' }}>
        <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
          <span className="ds-app-title">chatos</span>
        </Title>

        {showAdminBack ? (
          <Button size="small" onClick={handleAdminBack}>
            返回
          </Button>
        ) : null}

        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 0 }}>
          <div className="ds-nav-merged ds-nav-fixed" data-mode={mode}>
            <Segmented
              className="ds-seg ds-seg-primary"
              value={primaryValue}
              options={[
                {
                  label: (
                    <Space size={6}>
                      <MessageOutlined />
                      chatos
                    </Space>
                  ),
                  value: 'chat',
                },
                {
                  label: (
                    <Space size={6}>
                      <AppstoreOutlined />
                      应用
                    </Space>
                  ),
                  value: 'apps',
                },
              ]}
              onChange={(value) => {
                const v = String(value || '');
                setMenu(v === 'apps' ? 'apps/home' : 'chat/session');
              }}
            />

            <div className="ds-nav-divider" />

            <Segmented
              className="ds-seg ds-seg-secondary"
              value={secondaryValue}
              options={
                mode === 'apps'
                  ? [
                      {
                        label: (
                          <Space size={6}>
                            <AppstoreOutlined />
                            应用中心
                          </Space>
                        ),
                        value: 'apps/home',
                      },
                    ]
                  : [
                      {
                        label: (
                          <Space size={6}>
                            <MessageOutlined />
                            对话
                          </Space>
                        ),
                        value: 'chat/session',
                      },
                      {
                        label: (
                          <Space size={6}>
                            <RobotOutlined />
                            Agent
                          </Space>
                        ),
                        value: 'chat/agents',
                      },
                    ]
              }
              onChange={(value) => setMenu(String(value))}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Button
            className="ds-icon-button"
            aria-label="切换主题"
            title={themeMode === 'dark' ? '切换到浅色' : '切换到深色'}
            shape="circle"
            icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={() => (typeof onToggleTheme === 'function' ? onToggleTheme() : null)}
          />
          <Dropdown
            placement="bottomRight"
            trigger={['click']}
            menu={{
              items: adminMenuItems,
              onClick: ({ key }) => setMenu(String(key)),
            }}
          >
            <Button
              className="ds-icon-button"
              aria-label="设置"
              shape="circle"
              type={currentMenu.startsWith('admin') ? 'primary' : 'default'}
              icon={<SettingOutlined />}
            />
          </Dropdown>
        </div>
      </div>
    </Header>
  );
}
