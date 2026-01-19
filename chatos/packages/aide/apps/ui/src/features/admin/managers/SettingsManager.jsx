import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';

import { api, hasApi } from '../../../lib/api.js';

const { Text, Paragraph } = Typography;

function SettingsManager({ data, loading }) {
  const runtime = useMemo(() => {
    if (Array.isArray(data) && data.length > 0) {
      return data.find((item) => item?.id === 'runtime') || data[0];
    }
    return {};
  }, [data]);
  const [form] = Form.useForm();
  const [cliStatus, setCliStatus] = useState(null);
  const [cliBusy, setCliBusy] = useState(false);
  const [langBusy, setLangBusy] = useState(false);
  const promptLanguage = useMemo(() => {
    const raw = typeof runtime?.promptLanguage === 'string' ? runtime.promptLanguage.trim().toLowerCase() : '';
    return raw === 'en' ? 'en' : 'zh';
  }, [runtime]);

  useEffect(() => {
    form.setFieldsValue(runtime || {});
  }, [runtime, form]);

  const setPromptLanguage = async (next) => {
    const value = typeof next === 'string' ? next.trim().toLowerCase() : '';
    const normalized = value === 'en' ? 'en' : 'zh';
    if (!hasApi) {
      message.error('IPC bridge not available');
      return;
    }
    if (!normalized || normalized === promptLanguage) {
      return;
    }
    try {
      setLangBusy(true);
      await api.invoke('admin:settings:save', { promptLanguage: normalized });
      message.success(`已切换 Prompt 语言版本：${normalized === 'en' ? 'English' : '中文'}`);
    } catch (err) {
      message.error(err?.message || '保存失败');
    } finally {
      setLangBusy(false);
    }
  };

  const refreshCliStatus = async () => {
    if (!hasApi) return;
    try {
      const result = await api.invoke('cli:status');
      setCliStatus(result);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshCliStatus();
  }, []);

  const installCliCommand = async ({ force = false } = {}) => {
    if (!hasApi) return;
    setCliBusy(true);
    try {
      const result = await api.invoke('cli:install', { force });
      setCliStatus(result);
      if (result?.ok) {
        message.success(`已安装命令：${result.command || 'chatos'}`);
        return;
      }
      if (result?.reason === 'exists' && force !== true) {
        Modal.confirm({
          title: '命令已存在',
          content: '是否覆盖安装（更新到当前桌面 App 路径）？',
          okText: '覆盖安装',
          cancelText: '取消',
          onOk: async () => installCliCommand({ force: true }),
        });
        return;
      }
      message.error(result?.message || '安装失败');
    } catch (err) {
      message.error(err?.message || '安装失败');
    } finally {
      setCliBusy(false);
    }
  };

  const uninstallCliCommand = async () => {
    if (!hasApi) return;
    setCliBusy(true);
    try {
      const result = await api.invoke('cli:uninstall');
      setCliStatus(result);
      message.success('已卸载命令');
    } catch (err) {
      message.error(err?.message || '卸载失败');
    } finally {
      setCliBusy(false);
    }
  };

  const pathHint = typeof cliStatus?.pathHint === 'string' ? cliStatus.pathHint : '';
  const directExample = typeof cliStatus?.examples?.direct === 'string' ? cliStatus.examples.direct : '';
  const installedExample = typeof cliStatus?.examples?.command === 'string' ? cliStatus.examples.command : '';
  const cliCommand =
    typeof cliStatus?.command === 'string' && cliStatus.command.trim() ? cliStatus.command.trim() : 'chatos';
  const legacyInstalled = cliStatus?.legacyInstalled === true;
  const legacyCommand =
    typeof cliStatus?.legacyCommand === 'string' && cliStatus.legacyCommand.trim() ? cliStatus.legacyCommand.trim() : 'chatos';
  const legacyInstalledPath = typeof cliStatus?.legacyInstalledPath === 'string' ? cliStatus.legacyInstalledPath : '';

  return (
    <>
      <Card title="Prompt 语言版本" loading={loading} style={{ marginBottom: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          选择 CLI 运行时使用的内置 Prompt 语言版本（中文/英文语义一致，用于提升不同模型对提示词的理解稳定性）。
          该设置对“新启动/新会话”的 CLI 生效；已在运行的会话需重启或 /reset 才会完全应用。
        </Paragraph>
        <Space wrap>
          <Button
            type={promptLanguage === 'zh' ? 'primary' : 'default'}
            loading={langBusy}
            disabled={loading || langBusy || promptLanguage === 'zh' || !hasApi}
            onClick={() => setPromptLanguage('zh')}
          >
            使用中文版本
          </Button>
          <Button
            type={promptLanguage === 'en' ? 'primary' : 'default'}
            loading={langBusy}
            disabled={loading || langBusy || promptLanguage === 'en' || !hasApi}
            onClick={() => setPromptLanguage('en')}
          >
            Use English version
          </Button>
          <Text type="secondary">当前：{promptLanguage === 'en' ? 'English' : '中文'}</Text>
        </Space>
        {!hasApi ? (
          <Alert style={{ marginTop: 12 }} type="warning" showIcon message="IPC bridge 不可用，无法保存设置。" />
        ) : null}
      </Card>

      <Card title="运行配置（只读）" loading={loading}>
        <Paragraph type="secondary" style={{ marginBottom: 16 }}>
          配置 AI 调用的高级参数，所有 CLI/子代理共享。本页面为只读视图。
        </Paragraph>
        <Form layout="vertical" form={form} initialValues={runtime} style={{ maxWidth: 720 }} disabled>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={12}>
              <Form.Item
                name="maxToolPasses"
                label="工具最大循环次数"
                extra="模型连续调用工具的最大轮次，默认 240"
                rules={[{ type: 'number', min: 1, max: 500, message: '1-500' }]}
              >
                <InputNumber min={1} max={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item name="promptLanguage" label="Prompt 语言版本" extra="zh 或 en（由上方按钮切换）">
                <Input />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="summaryTokenThreshold"
                label="自动总结阈值 (估算 token)"
                extra="超过该字数估算触发历史压缩，默认 60000"
                rules={[{ type: 'number', min: 0, max: 1000000, message: '0-1000000' }]}
              >
                <InputNumber min={0} max={1000000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="toolPreviewLimit"
                label="工具写文件预览截断"
                extra="预览输出截断长度，默认 6000"
                rules={[{ type: 'number', min: 0, max: 1000000, message: '0-1000000' }]}
              >
                <InputNumber min={0} max={1000000} step={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="retry"
                label="模型重试次数"
                extra="网络/超时自动重试次数，默认 2"
                rules={[{ type: 'number', min: 0, max: 10, message: '0-10' }]}
              >
                <InputNumber min={0} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="mcpTimeoutMs"
                label="MCP 单次超时 (ms)"
                extra="默认 600000 (10 分钟)"
                rules={[{ type: 'number', min: 1000, max: 1800000, message: '1000-1800000' }]}
              >
                <InputNumber min={1000} max={1800000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={12}>
              <Form.Item
                name="mcpMaxTimeoutMs"
                label="MCP 最大超时 (ms)"
                extra="默认 1200000 (20 分钟)"
                rules={[{ type: 'number', min: 1000, max: 1800000, message: '1000-1800000' }]}
              >
                <InputNumber min={1000} max={1800000} step={1000} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="autoRoute" label="自动路由到子代理" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="logRequests" label="打印请求 payload" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
            <Col xs={24} md={8}>
              <Form.Item name="streamRaw" label="流式原样输出" valuePropName="checked">
                <Switch />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      <Card title="终端命令（无需 Node）" style={{ marginTop: 16 }}>
        <Paragraph type="secondary" style={{ marginBottom: 12 }}>
          安装后可在系统终端直接运行 <Text code>{`${cliCommand} chat`}</Text>，无需单独安装 Node（使用桌面 App 内置运行时）。
        </Paragraph>

        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Space size={10} wrap>
            <Button
              type="primary"
              loading={cliBusy}
              disabled={!hasApi}
              onClick={() => installCliCommand({ force: false })}
            >
              安装/更新 {cliCommand}
            </Button>
            <Popconfirm
              title="确认卸载命令?"
              okText="卸载"
              cancelText="取消"
              onConfirm={uninstallCliCommand}
              disabled={!hasApi}
            >
              <Button danger loading={cliBusy} disabled={!hasApi || !cliStatus?.installed}>
                卸载
              </Button>
            </Popconfirm>
            <Button loading={cliBusy} disabled={!hasApi} onClick={refreshCliStatus}>
              刷新状态
            </Button>
          </Space>

          <Text>
            状态：{cliStatus?.installed ? '已安装' : '未安装'}
            {cliStatus?.installedPath ? <Text type="secondary">（{cliStatus.installedPath}）</Text> : null}
          </Text>

          {legacyInstalled ? (
            <Alert
              type="warning"
              showIcon
              message={
                <span>
                  检测到旧命令 <Text code>{legacyCommand}</Text>
                  {legacyInstalledPath ? <Text type="secondary">（{legacyInstalledPath}）</Text> : null}
                  。为避免与 npm 全局安装的终端命令冲突，Windows 默认改为安装 <Text code>{cliCommand}</Text>
                  ，点击“安装/更新”会自动清理旧命令。
                </span>
              }
            />
          ) : null}

          {pathHint ? <Alert type="info" showIcon message={pathHint} /> : null}

          {installedExample ? (
            <Paragraph copyable={{ text: installedExample }} style={{ margin: 0 }}>
              <Text type="secondary">安装后：</Text> <Text code>{installedExample}</Text>
            </Paragraph>
          ) : null}

          {directExample ? (
            <Paragraph copyable={{ text: directExample }} style={{ margin: 0 }}>
              <Text type="secondary">不安装命令（直接运行）：</Text> <Text code>{directExample}</Text>
            </Paragraph>
          ) : null}
        </Space>
      </Card>
    </>
  );
}

export { SettingsManager };
