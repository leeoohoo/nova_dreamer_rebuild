import React, { useState } from 'react';
import { Button, Form, Input, Space, message } from 'antd';
import { api, hasApi } from '../../../lib/api.js';

export function ConfigSettings({ config, onUpdated }) {
  const [saving, setSaving] = useState(false);

  const handleFinish = async (values) => {
    if (!hasApi || !config?.id) return;
    setSaving(true);
    try {
      const result = await api.invoke('configs:update', { id: config.id, updates: values });
      if (result?.ok) {
        message.success('配置已更新');
        onUpdated?.();
      } else {
        message.error(result?.message || '配置更新失败');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form layout="vertical" initialValues={config} onFinish={handleFinish}>
      <Form.Item
        label="配置名称"
        name="name"
        rules={[{ required: true, message: '请输入配置名称' }]}
      >
        <Input />
      </Form.Item>
      <Form.Item label="配置描述" name="description">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Space>
        <Button type="primary" htmlType="submit" loading={saving}>
          保存设置
        </Button>
      </Space>
    </Form>
  );
}
