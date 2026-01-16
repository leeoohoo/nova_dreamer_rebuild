import React from 'react';
import { Card, Col, Row, Statistic, Typography } from 'antd';

const { Text } = Typography;

function SessionStats({ stats }) {
  const cards = [
    {
      title: '事件总数',
      value: stats.total,
      hint: stats.lastEvent ? `最新 ${stats.lastEvent.tsText}` : '等待事件写入',
      color: '#1677ff',
    },
    {
      title: '对话轮次',
      value: stats.user + stats.assistant,
      hint: `用户 ${stats.user} · 助手 ${stats.assistant}`,
      color: '#13c2c2',
    },
    {
      title: '工具 / 子代理',
      value: stats.tool + stats.subagent,
      hint: `工具 ${stats.tool} · 子代理 ${stats.subagent}`,
      color: '#722ed1',
    },
    {
      title: '任务',
      value: stats.tasks,
      hint: '来自 admin.db (tasks)',
      color: '#fa8c16',
    },
  ];
  return (
    <Row gutter={[12, 12]}>
      {cards.map((card) => (
        <Col xs={12} sm={12} md={6} key={card.title}>
          <Card size="small" style={{ height: '100%' }}>
            <Statistic title={card.title} value={card.value} valueStyle={{ color: card.color }} />
            {card.hint && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {card.hint}
              </Text>
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}

export { SessionStats };

