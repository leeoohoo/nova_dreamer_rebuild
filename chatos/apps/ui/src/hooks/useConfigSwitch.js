import { useCallback, useEffect, useState } from 'react';
import { message } from 'antd';

import { api, hasApi } from '../lib/api.js';

export function useConfigSwitch() {
  const [isSwitching, setIsSwitching] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [currentConfig, setCurrentConfig] = useState(null);

  const switchConfig = useCallback(async (configId) => {
    if (!hasApi) return false;
    setIsSwitching(true);
    setLastError(null);
    try {
      const result = await api.invoke('configs:quickSwitch', { configId });
      if (result?.ok) {
        setCurrentConfig(configId);
        message.success('配置已切换');
        return true;
      }
      setLastError(result?.error || result?.message || '配置切换失败');
      message.error('配置切换失败');
      return false;
    } catch (err) {
      setLastError(err?.message || '配置切换失败');
      message.error('配置切换失败');
      return false;
    } finally {
      setIsSwitching(false);
    }
  }, []);

  useEffect(() => {
    if (!hasApi) return undefined;
    const unsubscribe = api.on('config:switched', (_event, data) => {
      if (data?.success) {
        setCurrentConfig(data.configId);
      } else {
        setLastError(data?.error || '配置切换失败');
      }
      setIsSwitching(false);
    });
    return () => unsubscribe?.();
  }, []);

  const cancelSwitch = useCallback(() => {
    if (!hasApi) return;
    api.invoke('configs:cancelApply').catch(() => {});
    setIsSwitching(false);
  }, []);

  return {
    isSwitching,
    lastError,
    currentConfig,
    switchConfig,
    cancelSwitch,
    clearError: () => setLastError(null),
  };
}
