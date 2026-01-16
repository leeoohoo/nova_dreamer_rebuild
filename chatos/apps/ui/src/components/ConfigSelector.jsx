import React, { useMemo } from 'react';
import { Badge, Button, Dropdown, Space } from 'antd';
import { CheckOutlined, SettingOutlined } from '@ant-design/icons';

export function ConfigSelector({ configs = [], activeConfigId, onSelectConfig, onManageConfigs, loading }) {
  const activeConfig = useMemo(
    () => configs.find((config) => config.id === activeConfigId) || null,
    [configs, activeConfigId]
  );

  const items = useMemo(() => {
    const list = configs.map((config) => ({
      key: config.id,
      label: (
        <Space size={8}>
          <span>{config.name}</span>
          {config.description ? <span style={{ color: '#999', fontSize: 12 }}>{config.description}</span> : null}
        </Space>
      ),
      icon: config.id === activeConfigId ? <CheckOutlined /> : null,
    }));
    list.push({ type: 'divider' });
    list.push({
      key: '__manage__',
      label: (
        <Space size={8}>
          <SettingOutlined />
          管理配置
        </Space>
      ),
    });
    return list;
  }, [configs, activeConfigId]);

  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === '__manage__') {
            onManageConfigs?.();
            return;
          }
          onSelectConfig?.(key);
        },
      }}
    >
      <Button type="text" disabled={loading} style={{ border: '1px solid var(--ds-panel-border)' }}>
        <Space size={6}>
          <span>{activeConfig ? activeConfig.name : '选择配置'}</span>
          {activeConfig ? <Badge dot /> : null}
        </Space>
      </Button>
    </Dropdown>
  );
}
