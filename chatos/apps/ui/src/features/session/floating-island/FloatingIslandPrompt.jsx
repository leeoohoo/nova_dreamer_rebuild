import React, { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Checkbox,
  Empty,
  Input,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';

import { CodeBlock } from '../../../components/CodeBlock.jsx';

const { Text } = Typography;
const { TextArea } = Input;

export function FloatingIslandPrompt({
  promptActive,
  promptKind,
  prompt,
  requestId,
  promptRunId,
  allowCancel,
  pendingCount,
  onUiPromptRespond,
  constrainHeight = true,
}) {
  const safeRequestId = typeof requestId === 'string' ? requestId : '';
  const safeKind = typeof promptKind === 'string' ? promptKind : '';
  const safePrompt = prompt && typeof prompt === 'object' ? prompt : null;
  const safeRunId = typeof promptRunId === 'string' ? promptRunId : '';
  const canCancel = allowCancel !== false;
  const count = Number.isFinite(Number(pendingCount)) ? Number(pendingCount) : 0;

  const [promptSubmitting, setPromptSubmitting] = useState(false);
  const [kvDraft, setKvDraft] = useState({});
  const [choiceDraft, setChoiceDraft] = useState('');
  const [multiDraft, setMultiDraft] = useState([]);
  const [tasksDraft, setTasksDraft] = useState([]);
  const [remarkDraft, setRemarkDraft] = useState('');

  useEffect(() => {
    if (!promptActive) {
      setPromptSubmitting(false);
      return;
    }
    if (safeKind === 'kv') {
      const next = {};
      const fields = Array.isArray(safePrompt?.fields) ? safePrompt.fields : [];
      fields.forEach((field) => {
        const key = typeof field?.key === 'string' ? field.key.trim() : '';
        if (!key) return;
        const def = typeof field?.default === 'string' ? field.default : '';
        next[key] = def;
      });
      setKvDraft(next);
      setChoiceDraft('');
      setMultiDraft([]);
      setTasksDraft([]);
      setRemarkDraft('');
      setPromptSubmitting(false);
      return;
    }
    if (safeKind === 'choice') {
      const multiple = safePrompt?.multiple === true;
      if (multiple) {
        const raw = safePrompt?.default;
        const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
        setMultiDraft(values.filter((v) => typeof v === 'string' && v.trim()));
        setChoiceDraft('');
      } else {
        setChoiceDraft(typeof safePrompt?.default === 'string' ? safePrompt.default : '');
        setMultiDraft([]);
      }
      setKvDraft({});
      setTasksDraft([]);
      setRemarkDraft('');
      setPromptSubmitting(false);
      return;
    }
    if (safeKind === 'task_confirm') {
      const list = Array.isArray(safePrompt?.tasks) ? safePrompt.tasks : [];
      const normalized = list
        .filter((t) => t && typeof t === 'object')
        .map((t, idx) => ({
          draftId:
            typeof t.draftId === 'string' && t.draftId.trim()
              ? t.draftId.trim()
              : `draft_${Date.now().toString(36)}_${idx}_${Math.random().toString(16).slice(2, 8)}`,
          title: typeof t.title === 'string' ? t.title : '',
          details: typeof t.details === 'string' ? t.details : '',
          priority: typeof t.priority === 'string' ? t.priority : '',
          status: typeof t.status === 'string' ? t.status : '',
          tags: Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [],
        }));
      setTasksDraft(normalized);
      setRemarkDraft(typeof safePrompt?.defaultRemark === 'string' ? safePrompt.defaultRemark : '');
      setKvDraft({});
      setChoiceDraft('');
      setMultiDraft([]);
      setPromptSubmitting(false);
      return;
    }
    if (safeKind === 'file_change_confirm') {
      setRemarkDraft(typeof safePrompt?.defaultRemark === 'string' ? safePrompt.defaultRemark : '');
      setTasksDraft([]);
      setKvDraft({});
      setChoiceDraft('');
      setMultiDraft([]);
      setPromptSubmitting(false);
    }
  }, [promptActive, safeKind, safeRequestId]);

  const handlePromptCancel = async () => {
    if (!promptActive) return;
    if (!canCancel) return;
    if (promptSubmitting) return;
    if (typeof onUiPromptRespond !== 'function') {
      message.error('IPC bridge not available');
      return;
    }
    try {
      setPromptSubmitting(true);
      await onUiPromptRespond({
        requestId: safeRequestId,
        runId: safeRunId,
        response: { status: 'canceled' },
      });
    } catch (err) {
      message.error(err?.message || '提交失败');
    } finally {
      setPromptSubmitting(false);
    }
  };

  const handlePromptConfirm = async () => {
    if (!promptActive) return;
    if (promptSubmitting) return;
    if (typeof onUiPromptRespond !== 'function') {
      message.error('IPC bridge not available');
      return;
    }

    try {
      setPromptSubmitting(true);

      if (safeKind === 'kv') {
        const fields = Array.isArray(safePrompt?.fields) ? safePrompt.fields : [];
        const values = {};
        const missing = [];
        fields.forEach((field) => {
          const key = typeof field?.key === 'string' ? field.key.trim() : '';
          if (!key) return;
          const raw = kvDraft?.[key];
          const text = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
          values[key] = text;
          if (field?.required === true && !text.trim()) {
            missing.push(typeof field?.label === 'string' && field.label.trim() ? field.label.trim() : key);
          }
        });
        if (missing.length > 0) {
          message.error(`请填写：${missing.join('、')}`);
          return;
        }
        await onUiPromptRespond({
          requestId: safeRequestId,
          runId: safeRunId,
          response: { status: 'ok', values },
        });
        message.success('已提交');
        return;
      }

      if (safeKind === 'task_confirm') {
        const list = Array.isArray(tasksDraft) ? tasksDraft : [];
        const cleaned = list
          .filter((t) => t && typeof t === 'object')
          .map((t) => ({
            draftId: typeof t.draftId === 'string' ? t.draftId.trim() : '',
            title: typeof t.title === 'string' ? t.title : '',
            details: typeof t.details === 'string' ? t.details : '',
            priority: typeof t.priority === 'string' ? t.priority : '',
            status: typeof t.status === 'string' ? t.status : '',
            tags: Array.isArray(t.tags) ? t.tags.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : [],
          }))
          .filter((t) => t.draftId && t.title && t.title.trim());
        if (cleaned.length === 0) {
          message.error('至少保留 1 个任务（或点击取消）');
          return;
        }
        await onUiPromptRespond({
          requestId: safeRequestId,
          runId: safeRunId,
          response: { status: 'ok', tasks: cleaned, remark: typeof remarkDraft === 'string' ? remarkDraft : '' },
        });
        message.success('已提交');
        return;
      }

      if (safeKind === 'file_change_confirm') {
        await onUiPromptRespond({
          requestId: safeRequestId,
          runId: safeRunId,
          response: { status: 'ok', remark: typeof remarkDraft === 'string' ? remarkDraft : '' },
        });
        message.success('已提交');
        return;
      }

      const options = Array.isArray(safePrompt?.options) ? safePrompt.options : [];
      const allowed = new Set(
        options.map((opt) => (typeof opt?.value === 'string' ? opt.value.trim() : '')).filter(Boolean)
      );
      const multiple = safePrompt?.multiple === true;
      if (multiple) {
        const selected = Array.isArray(multiDraft) ? multiDraft : [];
        const cleaned = Array.from(
          new Set(selected.map((v) => String(v ?? '').trim()).filter((v) => v && allowed.has(v)))
        );
        const minSelections = Number.isFinite(Number(safePrompt?.minSelections)) ? Number(safePrompt.minSelections) : 0;
        const maxSelections = Number.isFinite(Number(safePrompt?.maxSelections))
          ? Number(safePrompt.maxSelections)
          : options.length;
        if (cleaned.length < minSelections) {
          message.error(`至少选择 ${minSelections} 项`);
          return;
        }
        if (cleaned.length > maxSelections) {
          message.error(`最多选择 ${maxSelections} 项`);
          return;
        }
        await onUiPromptRespond({
          requestId: safeRequestId,
          runId: safeRunId,
          response: { status: 'ok', selection: cleaned },
        });
        message.success('已提交');
        return;
      }

      const selected = typeof choiceDraft === 'string' ? choiceDraft.trim() : '';
      if (!selected) {
        message.error('请选择一项');
        return;
      }
      if (!allowed.has(selected)) {
        message.error('选择项无效');
        return;
      }
      await onUiPromptRespond({
        requestId: safeRequestId,
        runId: safeRunId,
        response: { status: 'ok', selection: selected },
      });
      message.success('已提交');
    } catch (err) {
      message.error(err?.message || '提交失败');
    } finally {
      setPromptSubmitting(false);
    }
  };

  if (!promptActive) return null;

  const title =
    typeof safePrompt?.title === 'string' && safePrompt.title.trim()
      ? safePrompt.title.trim()
      : safeKind === 'choice'
        ? '需要你做出选择'
        : '需要你补充信息';
  const desc = typeof safePrompt?.message === 'string' ? safePrompt.message.trim() : '';

  if (safeKind === 'task_confirm') {
    const list = Array.isArray(tasksDraft) ? tasksDraft : [];
    const parseTags = (text) =>
      String(text || '')
        .split(/[,，]/g)
        .map((t) => t.trim())
        .filter(Boolean);
    const updateAt = (index, patch) =>
      setTasksDraft((prev) =>
        (Array.isArray(prev) ? prev : []).map((t, idx) => (idx === index ? { ...(t || {}), ...(patch || {}) } : t))
      );
    const move = (index, delta) =>
      setTasksDraft((prev) => {
        const next = Array.isArray(prev) ? prev.slice() : [];
        const target = index + delta;
        if (target < 0 || target >= next.length) return next;
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        return next;
      });
    const removeAt = (index) =>
      setTasksDraft((prev) => (Array.isArray(prev) ? prev.filter((_t, idx) => idx !== index) : []));
    const addTask = () => {
      const id =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `draft_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
      setTasksDraft((prev) => [
        ...(Array.isArray(prev) ? prev : []),
        { draftId: id, title: '', details: '', priority: 'medium', status: 'todo', tags: [] },
      ]);
    };

    return (
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space align="center" wrap size={8}>
            <Text strong>{title || '任务创建确认'}</Text>
            {safeRunId ? <Tag color="blue">{safeRunId}</Tag> : null}
            {count > 1 ? <Tag color="purple">{count} 个待处理</Tag> : null}
            {typeof safePrompt?.source === 'string' && safePrompt.source.trim() ? (
              <Tag color="geekblue">{safePrompt.source.trim()}</Tag>
            ) : null}
          </Space>
        </Space>
        {desc ? <Text type="secondary">{desc}</Text> : null}
        <div style={{ maxHeight: constrainHeight ? 360 : undefined, overflow: constrainHeight ? 'auto' : 'visible', paddingRight: 4 }}>
          {list.length === 0 ? (
            <Empty description="暂无任务" />
          ) : (
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              {list.map((task, index) => {
                const safeTask = task && typeof task === 'object' ? task : {};
                const tagsText = Array.isArray(safeTask.tags) ? safeTask.tags.join(', ') : '';
                return (
                  <Card
                    key={safeTask.draftId || `${index}`}
                    size="small"
                    bodyStyle={{ padding: 12 }}
                    style={{ width: '100%' }}
                  >
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space align="center" wrap size={8} style={{ flex: 1, minWidth: 0 }}>
                          <Tag>{index + 1}</Tag>
                          <Input
                            value={typeof safeTask.title === 'string' ? safeTask.title : ''}
                            onChange={(e) => updateAt(index, { title: e.target.value })}
                            placeholder="任务标题"
                            disabled={promptSubmitting}
                            style={{ minWidth: 220, flex: 1 }}
                            allowClear
                          />
                          <Select
                            value={
                              typeof safeTask.priority === 'string' && safeTask.priority ? safeTask.priority : 'medium'
                            }
                            onChange={(val) => updateAt(index, { priority: val })}
                            options={[
                              { label: '高', value: 'high' },
                              { label: '中', value: 'medium' },
                              { label: '低', value: 'low' },
                            ]}
                            disabled={promptSubmitting}
                            style={{ width: 110 }}
                          />
                          <Select
                            value={typeof safeTask.status === 'string' && safeTask.status ? safeTask.status : 'todo'}
                            onChange={(val) => updateAt(index, { status: val })}
                            options={[
                              { label: 'todo', value: 'todo' },
                              { label: 'doing', value: 'doing' },
                              { label: 'blocked', value: 'blocked' },
                              { label: 'done', value: 'done' },
                            ]}
                            disabled={promptSubmitting}
                            style={{ width: 120 }}
                          />
                        </Space>
                        <Space size={6} wrap>
                          <Button size="small" onClick={() => move(index, -1)} disabled={promptSubmitting || index === 0}>
                            上移
                          </Button>
                          <Button
                            size="small"
                            onClick={() => move(index, 1)}
                            disabled={promptSubmitting || index === list.length - 1}
                          >
                            下移
                          </Button>
                          <Button size="small" danger onClick={() => removeAt(index)} disabled={promptSubmitting}>
                            删除
                          </Button>
                        </Space>
                      </Space>
                      <Input
                        value={tagsText}
                        onChange={(e) => updateAt(index, { tags: parseTags(e.target.value) })}
                        placeholder="标签（逗号分隔，可选）"
                        disabled={promptSubmitting}
                        allowClear
                      />
                      <TextArea
                        value={typeof safeTask.details === 'string' ? safeTask.details : ''}
                        onChange={(e) => updateAt(index, { details: e.target.value })}
                        placeholder="详情 / 验收标准（可选）"
                        disabled={promptSubmitting}
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        allowClear
                      />
                    </Space>
                  </Card>
                );
              })}
            </Space>
          )}
        </div>

        <Space size={10} wrap>
          <Button onClick={addTask} disabled={promptSubmitting}>
            新增任务
          </Button>
        </Space>

        <TextArea
          value={remarkDraft}
          onChange={(e) => setRemarkDraft(e.target.value)}
          placeholder="备注（可选，给 AI 的建议）"
          disabled={promptSubmitting}
          autoSize={{ minRows: 2, maxRows: 6 }}
          allowClear
        />

        <Space size={10} align="center" style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
          {canCancel ? (
            <Button size="large" onClick={handlePromptCancel} disabled={promptSubmitting}>
              取消
            </Button>
          ) : null}
          <Button size="large" type="primary" loading={promptSubmitting} onClick={handlePromptConfirm}>
            确定
          </Button>
        </Space>
      </Space>
    );
  }

  if (safeKind === 'file_change_confirm') {
    const diffText = typeof safePrompt?.diff === 'string' ? safePrompt.diff : '';
    const pathLabel = typeof safePrompt?.path === 'string' ? safePrompt.path.trim() : '';
    const origin = typeof safePrompt?.source === 'string' ? safePrompt.source.trim() : '';
    const command = typeof safePrompt?.command === 'string' ? safePrompt.command.trim() : '';
    const cwdLabel = typeof safePrompt?.cwd === 'string' ? safePrompt.cwd.trim() : '';

    return (
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space align="center" wrap size={8}>
            <Text strong>{title || '文件变更确认'}</Text>
            {safeRunId ? <Tag color="blue">{safeRunId}</Tag> : null}
            {pathLabel ? <Tag color="gold">{pathLabel}</Tag> : null}
            {origin ? <Tag color="geekblue">{origin}</Tag> : null}
            {count > 1 ? <Tag color="purple">{count} 个待处理</Tag> : null}
          </Space>
        </Space>
        {desc ? <Text type="secondary">{desc}</Text> : null}
        {command ? (
          <CodeBlock text={command} maxHeight={120} highlight={false} wrap alwaysExpanded constrainHeight={constrainHeight} />
        ) : null}
        {cwdLabel ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            cwd: {cwdLabel}
          </Text>
        ) : null}
        <CodeBlock
          text={diffText || '（无 diff 内容）'}
          maxHeight={320}
          highlight
          language="diff"
          wrap={false}
          alwaysExpanded
          constrainHeight={constrainHeight}
        />
        <TextArea
          value={remarkDraft}
          onChange={(e) => setRemarkDraft(e.target.value)}
          placeholder="备注（可选，给 AI 的建议）"
          disabled={promptSubmitting}
          autoSize={{ minRows: 2, maxRows: 6 }}
          allowClear
        />
        <Space size={10} align="center" style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
          {canCancel ? (
            <Button size="large" onClick={handlePromptCancel} disabled={promptSubmitting}>
              取消
            </Button>
          ) : null}
          <Button size="large" type="primary" loading={promptSubmitting} onClick={handlePromptConfirm}>
            确定
          </Button>
        </Space>
      </Space>
    );
  }

  if (safeKind === 'kv') {
    const origin = typeof safePrompt?.source === 'string' ? safePrompt.source.trim() : '';
    const fields = Array.isArray(safePrompt?.fields) ? safePrompt.fields : [];
    const dataSource = fields.map((field) => ({
      key: typeof field?.key === 'string' ? field.key.trim() : '',
      label: typeof field?.label === 'string' ? field.label.trim() : '',
      description: typeof field?.description === 'string' ? field.description.trim() : '',
      placeholder: typeof field?.placeholder === 'string' ? field.placeholder : '',
      required: field?.required === true,
      multiline: field?.multiline === true,
      secret: field?.secret === true,
    }));
    const columns = [
      {
        title: 'Key',
        dataIndex: 'key',
        key: 'key',
        width: 360,
        render: (_value, record) => (
          <Space direction="vertical" size={0} style={{ width: '100%' }}>
            <Space size={6} align="center" wrap>
              <Text strong>{record?.label || record?.key}</Text>
              {record?.required ? <Text type="danger">*</Text> : null}
              {record?.label && record?.label !== record?.key ? <Tag>{record?.key}</Tag> : null}
            </Space>
            {record?.description ? (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {record.description}
              </Text>
            ) : null}
          </Space>
        ),
      },
      {
        title: 'Value',
        dataIndex: 'value',
        key: 'value',
        render: (_value, record) => {
          const key = typeof record?.key === 'string' ? record.key : '';
          const value = typeof kvDraft?.[key] === 'string' ? kvDraft[key] : '';
          const placeholder = typeof record?.placeholder === 'string' ? record.placeholder : '';
          const onChange = (next) =>
            setKvDraft((prev) => ({
              ...(prev || {}),
              [key]: typeof next === 'string' ? next : '',
            }));
          if (record?.multiline) {
            return (
              <TextArea
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                autoSize={{ minRows: 1, maxRows: 6 }}
                disabled={promptSubmitting}
                allowClear
              />
            );
          }
          if (record?.secret) {
            return (
              <Input.Password
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                disabled={promptSubmitting}
                allowClear
              />
            );
          }
          return (
            <Input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={placeholder}
              disabled={promptSubmitting}
              allowClear
            />
          );
        },
      },
    ];

    return (
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space align="center" wrap size={8}>
            <Text strong>{title}</Text>
            {safeRunId ? <Tag color="blue">{safeRunId}</Tag> : null}
            {origin ? <Tag color="geekblue">{origin}</Tag> : null}
            {count > 1 ? <Tag color="purple">{count} 个待处理</Tag> : null}
          </Space>
        </Space>
        {desc ? <Text type="secondary">{desc}</Text> : null}
        <Table size="small" pagination={false} rowKey="key" dataSource={dataSource.filter((row) => row.key)} columns={columns} />
        <Space size={10} align="center" style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
          {canCancel ? (
            <Button size="large" onClick={handlePromptCancel} disabled={promptSubmitting}>
              取消
            </Button>
          ) : null}
          <Button size="large" type="primary" loading={promptSubmitting} onClick={handlePromptConfirm}>
            确定
          </Button>
        </Space>
      </Space>
    );
  }

  const options = Array.isArray(safePrompt?.options) ? safePrompt.options : [];
  const multiple = safePrompt?.multiple === true;
  const minSelections = Number.isFinite(Number(safePrompt?.minSelections)) ? Number(safePrompt.minSelections) : 0;
  const maxSelections = Number.isFinite(Number(safePrompt?.maxSelections)) ? Number(safePrompt.maxSelections) : options.length;
  const origin = typeof safePrompt?.source === 'string' ? safePrompt.source.trim() : '';

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space align="center" wrap size={8}>
          <Text strong>{title}</Text>
          {safeRunId ? <Tag color="blue">{safeRunId}</Tag> : null}
          {origin ? <Tag color="geekblue">{origin}</Tag> : null}
          {count > 1 ? <Tag color="purple">{count} 个待处理</Tag> : null}
        </Space>
      </Space>
      {desc ? <Text type="secondary">{desc}</Text> : null}
      {multiple ? (
        <>
          {minSelections > 0 || maxSelections < options.length ? (
            <Text type="secondary">
              选择范围：{minSelections} - {maxSelections} 项
            </Text>
          ) : null}
          <Checkbox.Group value={multiDraft} onChange={(vals) => setMultiDraft(vals)} style={{ width: '100%' }}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {options.map((opt) => {
                const value = typeof opt?.value === 'string' ? opt.value.trim() : '';
                const label = typeof opt?.label === 'string' && opt.label.trim() ? opt.label.trim() : value;
                const help = typeof opt?.description === 'string' ? opt.description.trim() : '';
                if (!value) return null;
                return (
                  <Checkbox key={value} value={value} disabled={promptSubmitting}>
                    <Space direction="vertical" size={0}>
                      <Text>{label}</Text>
                      {help ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {help}
                        </Text>
                      ) : null}
                    </Space>
                  </Checkbox>
                );
              })}
            </Space>
          </Checkbox.Group>
        </>
      ) : (
        <Radio.Group
          value={choiceDraft}
          onChange={(e) => setChoiceDraft(e.target.value)}
          style={{ width: '100%' }}
          disabled={promptSubmitting}
        >
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {options.map((opt) => {
              const value = typeof opt?.value === 'string' ? opt.value.trim() : '';
              const label = typeof opt?.label === 'string' && opt.label.trim() ? opt.label.trim() : value;
              const help = typeof opt?.description === 'string' ? opt.description.trim() : '';
              if (!value) return null;
              return (
                <Radio key={value} value={value}>
                  <Space direction="vertical" size={0}>
                    <Text>{label}</Text>
                    {help ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {help}
                      </Text>
                    ) : null}
                  </Space>
                </Radio>
              );
            })}
          </Space>
        </Radio.Group>
      )}
      <Space size={10} align="center" style={{ width: '100%', justifyContent: 'flex-end' }} wrap>
        {canCancel ? (
          <Button size="large" onClick={handlePromptCancel} disabled={promptSubmitting}>
            取消
          </Button>
        ) : null}
        <Button size="large" type="primary" loading={promptSubmitting} onClick={handlePromptConfirm}>
          确定
        </Button>
      </Space>
    </Space>
  );
}
