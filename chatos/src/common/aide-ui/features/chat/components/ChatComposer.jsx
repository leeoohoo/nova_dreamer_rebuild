import React, { useEffect, useMemo, useRef } from 'react';
import { Button, Input, Space, message } from 'antd';
import { CloseOutlined, PauseCircleOutlined, PictureOutlined, SendOutlined } from '@ant-design/icons';

function generateId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export function ChatComposer({
  value,
  onChange,
  attachments,
  onAttachmentsChange,
  visionEnabled = false,
  onSend,
  onStop,
  sending,
}) {
  const fileInputRef = useRef(null);
  const list = useMemo(() => (Array.isArray(attachments) ? attachments.filter(Boolean) : []), [attachments]);
  const images = useMemo(
    () =>
      list.filter((att) => att?.type === 'image' && typeof att?.dataUrl === 'string' && att.dataUrl.startsWith('data:image/')),
    [list]
  );
  const effectiveImages = visionEnabled ? images : [];
  const trimmedText = String(value || '').trim();
  const canSend = !sending && (trimmedText.length > 0 || effectiveImages.length > 0);

  const MAX_IMAGES = 4;
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

  const addFiles = async (files) => {
    if (!visionEnabled) return;
    const next = [...effectiveImages];
    for (const file of Array.isArray(files) ? files : []) {
      if (next.length >= MAX_IMAGES) {
        message.warning(`最多只能添加 ${MAX_IMAGES} 张图片`);
        break;
      }
      if (!file || typeof file !== 'object') continue;
      const mimeType = typeof file.type === 'string' ? file.type : '';
      if (!mimeType.startsWith('image/')) {
        message.warning('仅支持图片文件');
        continue;
      }
      const size = Number.isFinite(file.size) ? file.size : 0;
      if (size > MAX_IMAGE_BYTES) {
        message.error('图片过大（单张上限 10MB）');
        continue;
      }
      let dataUrl = '';
      try {
        dataUrl = await readFileAsDataUrl(file);
      } catch {
        message.error('读取图片失败');
        continue;
      }
      if (!dataUrl.startsWith('data:image/')) {
        message.error('图片格式不支持');
        continue;
      }
      next.push({
        id: generateId(),
        type: 'image',
        name: typeof file.name === 'string' ? file.name : '',
        mimeType,
        dataUrl,
      });
    }
    onAttachmentsChange?.(next);
  };

  const removeImage = (id) => {
    const target = typeof id === 'string' ? id : '';
    if (!target) return;
    onAttachmentsChange?.(effectiveImages.filter((img) => img?.id !== target));
  };

  useEffect(() => {
    if (!visionEnabled && images.length > 0) {
      onAttachmentsChange?.([]);
    }
  }, [images.length, onAttachmentsChange, visionEnabled]);

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {visionEnabled && effectiveImages.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {effectiveImages.map((img) => (
            <div
              key={img.id}
              style={{
                position: 'relative',
                width: 132,
                height: 98,
                borderRadius: 10,
                overflow: 'hidden',
                border: '1px solid var(--ds-panel-border)',
                background: 'var(--ds-panel-bg)',
              }}
            >
              <img
                src={img.dataUrl}
                alt={img.name || 'attachment'}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
              <Button
                size="small"
                type="text"
                icon={<CloseOutlined />}
                onClick={() => removeImage(img.id)}
                disabled={sending}
                style={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  width: 28,
                  height: 28,
                  padding: 0,
                  borderRadius: 8,
                  background: 'rgba(0,0,0,0.45)',
                  color: '#fff',
                }}
              />
            </div>
          ))}
        </div>
      ) : null}

      <Input.TextArea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="输入消息，Enter 发送（Shift+Enter 换行）"
        autoSize={{ minRows: 2, maxRows: 6 }}
        onPaste={(e) => {
          if (!visionEnabled || sending) return;
          const items = e.clipboardData?.items;
          if (!items || items.length === 0) return;
          const files = [];
          for (const item of items) {
            if (!item || !item.type || !String(item.type).startsWith('image/')) continue;
            const file = item.getAsFile?.();
            if (file) files.push(file);
          }
          if (files.length > 0) {
            void addFiles(files);
          }
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          if (e.shiftKey) return;
          e.preventDefault();
          if (canSend) onSend?.();
        }}
        disabled={sending}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {visionEnabled ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  e.target.value = '';
                  void addFiles(files);
                }}
              />
              <Button
                icon={<PictureOutlined />}
                onClick={() => fileInputRef.current?.click?.()}
                disabled={sending}
              >
                添加图片
              </Button>
              <span style={{ color: 'var(--ds-text-secondary)', fontSize: 12 }}>可粘贴图片</span>
            </>
          ) : (
            <span style={{ color: 'var(--ds-text-secondary)', fontSize: 12 }}>当前模型不支持图片输入</span>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <Button icon={<PauseCircleOutlined />} onClick={() => onStop?.()} disabled={!sending}>
            停止
          </Button>
          <Button type="primary" icon={<SendOutlined />} onClick={() => onSend?.()} disabled={!canSend}>
            发送
          </Button>
        </div>
      </div>
    </Space>
  );
}

