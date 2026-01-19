import React, { useState } from 'react';
import { Popover, Tag } from 'antd';

const TAG_STYLE = {
  cursor: 'pointer',
  userSelect: 'none',
  fontSize: 11,
  lineHeight: '16px',
  padding: '0 4px',
  borderRadius: 5,
  marginInlineEnd: 3,
  marginBottom: 3,
};

export function PopoverTag({ color, text, title, children, maxWidth = 720, maxHeight = 360 }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      trigger="click"
      open={open}
      onOpenChange={setOpen}
      title={title}
      content={<div style={{ maxWidth, maxHeight, overflow: 'auto' }}>{children}</div>}
    >
      <Tag color={color} style={TAG_STYLE}>
        {text}
      </Tag>
    </Popover>
  );
}
