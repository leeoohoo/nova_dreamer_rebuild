import React from 'react';
import { Alert } from 'antd';

export function ConfigSwitchFeedback({ isSwitching, currentConfig, lastError, onCloseError }) {
  if (!isSwitching && !lastError) return null;
  if (isSwitching) {
    return (
      <Alert
        message="正在切换配置..."
        description={currentConfig ? `正在应用配置: ${currentConfig}` : undefined}
        type="info"
        showIcon
        closable
      />
    );
  }
  if (lastError) {
    return (
      <Alert
        message="配置切换失败"
        description={lastError}
        type="error"
        showIcon
        closable
        onClose={onCloseError}
      />
    );
  }
  return null;
}
