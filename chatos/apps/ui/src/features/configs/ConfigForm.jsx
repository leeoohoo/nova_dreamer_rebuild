import React, { useState } from 'react';
import { Button, Form, Input, Space } from 'antd';

export function ConfigForm({ initialValues = {}, onSubmit, onCancel }) {
  const [submitting, setSubmitting] = useState(false);

  const handleFinish = async (values) => {
    if (typeof onSubmit !== 'function') return;
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form layout="vertical" initialValues={initialValues} onFinish={handleFinish}>
      <Form.Item
        label="名称"
        name="name"
        rules={[{ required: true, message: '请输入配置名称' }]}
      >
        <Input placeholder="例如：默认配置" />
      </Form.Item>
      <Form.Item label="描述" name="description">
        <Input.TextArea rows={3} placeholder="可选描述" />
      </Form.Item>
      <Space>
        <Button type="primary" htmlType="submit" loading={submitting}>
          保存
        </Button>
        <Button onClick={onCancel}>取消</Button>
      </Space>
    </Form>
  );
}
