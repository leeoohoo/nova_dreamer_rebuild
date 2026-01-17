import React from 'react';
import { Button, Dropdown, Layout, Typography } from 'antd';
import { MoonOutlined, SettingOutlined, SunOutlined } from '@ant-design/icons';

const { Header } = Layout;
const { Title } = Typography;

export function AppHeader({ themeMode = 'light', onToggleTheme, menu, onMenuChange, developerMode: _developerMode = false }) {
  const currentMenu = typeof menu === 'string' ? menu : '';
  const setMenu = typeof onMenuChange === 'function' ? onMenuChange : () => {};
  const mode = 'cli';
  const showBackToConsole = currentMenu.startsWith('admin/');

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
        display: 'flex',
        alignItems: 'center',
        lineHeight: 'normal',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
        <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>
          <span className="ds-app-title">AIDE</span>
        </Title>

        {showBackToConsole ? (
          <Button size="small" onClick={() => setMenu('cli')}>
            返回控制台
          </Button>
        ) : null}

        <div style={{ flex: 1 }} />

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
