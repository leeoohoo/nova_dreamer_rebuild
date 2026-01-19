import React from 'react';
import { Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export function ChatSessionHeader({ session, streaming }) {
  const title = session?.title || 'Chat';

  return (
    <Space size={10} align="center" wrap style={{ width: '100%', justifyContent: 'space-between' }}>
      <div style={{ fontWeight: 650, fontSize: 16, lineHeight: '22px' }}>{title}</div>
      {streaming ? <Tag color="gold">生成中</Tag> : <Text type="secondary">就绪</Text>}
    </Space>
  );
}

