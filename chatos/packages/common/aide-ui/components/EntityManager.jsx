import React, { useEffect, useState } from 'react';
import { Button, Card, Drawer, Form, Input, Popconfirm, Select, Space, Switch, Table, Typography, message } from 'antd';

const { Paragraph } = Typography;
const { TextArea } = Input;

function renderField(field, control = {}) {
  const disabled = control?.disabled === true;
  const commonProps = { placeholder: field.placeholder, style: field.inputStyle, disabled };
  switch (field.type) {
    case 'textarea':
      return <TextArea rows={field.rows || 4} autoSize={field.autoSize} {...commonProps} />;
    case 'password':
      return <Input.Password {...commonProps} />;
    case 'tags':
      return (
        <Select
          mode="tags"
          tokenSeparators={[',', ' ']}
          open={false}
          {...commonProps}
        />
      );
    case 'switch':
      return <Switch disabled={disabled} />;
    case 'select':
      return (
        <Select
          options={field.options || []}
          mode={field.mode}
          placeholder={field.placeholder}
          disabled={disabled}
        />
      );
    default:
      return <Input {...commonProps} />;
  }
}

function resolveFieldFlag(flag, values, meta) {
  if (typeof flag === 'function') {
    try {
      return Boolean(flag(values, meta));
    } catch {
      return false;
    }
  }
  return Boolean(flag);
}

function EntityDrawer({
  open,
  onClose,
  initialValues,
  title,
  fields,
  onSubmit,
  saving,
  drawerWidth = 520,
  isEditing = false,
}) {
  const [form] = Form.useForm();

  useEffect(() => {
    const defaults = {};
    fields.forEach((f) => {
      if (f.defaultValue !== undefined) {
        defaults[f.name] = f.defaultValue;
      }
    });
    const sanitizedInitial = { ...(initialValues || {}) };
    fields.forEach((f) => {
      if (f.omitInitialValue) {
        delete sanitizedInitial[f.name];
      }
    });
    form.resetFields();
    form.setFieldsValue({ ...defaults, ...sanitizedInitial });
  }, [initialValues, open, fields, form]);

  const handleFinish = (values) => {
    const normalized = { ...values };
    fields.forEach((f) => {
      if (f.type === 'tags' && !Array.isArray(normalized[f.name])) {
        normalized[f.name] = [];
      }
    });
    const meta = { isEditing: Boolean(isEditing) };
    fields.forEach((f) => {
      const hidden = resolveFieldFlag(f.hidden, normalized, meta);
      if (hidden) {
        delete normalized[f.name];
      }
    });
    onSubmit(normalized);
  };

  return (
    <Drawer
      title={title}
      open={open}
      width={drawerWidth}
      onClose={onClose}
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => form.submit()} loading={saving}>
            保存
          </Button>
        </Space>
      }
    >
      <Form layout="vertical" form={form} onFinish={handleFinish}>
        {fields.map((field) => (
          <Form.Item key={field.name} noStyle shouldUpdate>
            {() => {
              const values = form.getFieldsValue(true);
              const meta = { isEditing: Boolean(isEditing) };
              const hidden = resolveFieldFlag(field.hidden, values, meta);
              if (hidden) return null;
              const disabled = resolveFieldFlag(field.disabled, values, meta);
              return (
                <Form.Item
                  name={field.name}
                  label={field.label}
                  extra={field.extra}
                  valuePropName={field.type === 'switch' ? 'checked' : 'value'}
                  rules={
                    field.required ||
                    (field.requiredOnCreate && !isEditing) ||
                    (field.requiredOnEdit && isEditing)
                      ? [{ required: true, message: `${field.label}为必填项` }]
                      : undefined
                  }
                >
                  {renderField(field, { disabled })}
                </Form.Item>
              );
            }}
          </Form.Item>
        ))}
      </Form>
    </Drawer>
  );
}

export function EntityManager({
  title,
  description,
  data,
  fields,
  columns,
  onCreate,
  onUpdate,
  onDelete,
  loading,
  renderActions,
  tableProps = {},
  drawerWidth = 520,
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const rows = (data || []).map((item) => ({ ...item, key: item.id }));

  const handleSubmit = async (values) => {
    try {
      setSaving(true);
      if (editing) {
        await onUpdate(editing.id, values);
        message.success('已更新');
      } else {
        await onCreate(values);
        message.success('已创建');
      }
      setDrawerOpen(false);
      setEditing(null);
    } catch (err) {
      message.error(err.message || '操作失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record) => {
    try {
      setSaving(true);
      await onDelete(record.id);
      message.success('已删除');
    } catch (err) {
      message.error(err.message || '删除失败');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (record) => {
    setEditing(record);
    setDrawerOpen(true);
  };

  const actionColumn = {
    title: '操作',
    width: 180,
    render: (_text, record) =>
      renderActions ? (
        renderActions(record, { onEdit: () => handleEdit(record), onDelete: () => handleDelete(record) })
      ) : (
        <Space>
          <Button size="small" onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
  };

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card
        title={title}
        extra={
          <Button type="primary" size="small" onClick={() => { setEditing(null); setDrawerOpen(true); }}>
            新建
          </Button>
        }
      >
        {description && (
          <Paragraph type="secondary" style={{ marginBottom: 12 }}>
            {description}
          </Paragraph>
        )}
        <Table
          size="small"
          dataSource={rows}
          loading={loading || saving}
          columns={[...columns, actionColumn]}
          pagination={{ pageSize: 8 }}
          {...tableProps}
        />
      </Card>
      <EntityDrawer
        title={editing ? `编辑 ${title}` : `新建 ${title}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        initialValues={editing}
        fields={fields}
        onSubmit={handleSubmit}
        saving={saving}
        drawerWidth={drawerWidth}
        isEditing={Boolean(editing)}
      />
    </Space>
  );
}
