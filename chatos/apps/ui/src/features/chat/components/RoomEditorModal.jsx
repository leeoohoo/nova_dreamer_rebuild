import React, { useEffect, useMemo } from 'react';
import { Form, Input, Modal, Select } from 'antd';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueIds(list) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((item) => {
    const value = normalizeId(item);
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  });
  return out;
}

export function RoomEditorModal({ open, initialValues, agents, onCancel, onSave }) {
  const [form] = Form.useForm();

  const agentOptions = useMemo(
    () =>
      (Array.isArray(agents) ? agents : []).map((agent) => ({
        value: agent.id,
        label: agent.name || agent.id,
      })),
    [agents]
  );

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      title: initialValues?.title || '',
      hostAgentId: initialValues?.hostAgentId || '',
      memberAgentIds: Array.isArray(initialValues?.memberAgentIds) ? initialValues.memberAgentIds : [],
    });
  }, [open, initialValues, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const hostAgentId = normalizeId(values?.hostAgentId);
    const memberAgentIds = uniqueIds(values?.memberAgentIds).filter((id) => id && id !== hostAgentId);
    await onSave?.({
      ...(initialValues && initialValues.id ? { id: initialValues.id } : {}),
      title: values?.title,
      hostAgentId,
      memberAgentIds,
    });
  };

  return (
    <Modal
      open={open}
      title={initialValues?.id ? '编辑聊天室' : '新建聊天室'}
      okText="保存"
      cancelText="取消"
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnClose
    >
      <Form layout="vertical" form={form}>
        <Form.Item
          name="title"
          label="聊天室名称"
          rules={[{ required: true, message: '请输入聊天室名称' }]}
        >
          <Input placeholder="请输入聊天室名称" />
        </Form.Item>
        <Form.Item
          name="hostAgentId"
          label="默认助手"
          rules={[{ required: true, message: '请选择默认助手' }]}
        >
          <Select
            options={agentOptions}
            showSearch
            optionFilterProp="label"
            placeholder="请选择默认助手"
          />
        </Form.Item>
        <Form.Item name="memberAgentIds" label="成员 Agent（可多选）">
          <Select
            mode="multiple"
            options={agentOptions}
            showSearch
            optionFilterProp="label"
            placeholder="选择聊天室成员"
            maxTagCount="responsive"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
