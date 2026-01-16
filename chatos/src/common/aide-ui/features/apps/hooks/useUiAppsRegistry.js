import { useCallback, useEffect, useState } from 'react';

import { api, hasApi } from '../../../lib/api.js';

export function useUiAppsRegistry() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const refresh = useCallback(async () => {
    if (!hasApi) {
      setState({ loading: false, error: 'IPC bridge not available. Is preload loaded?', data: null });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await api.invoke('uiApps:list');
      if (res?.ok === false) {
        throw new Error(res?.message || '加载应用列表失败');
      }
      setState({ loading: false, error: null, data: res || null });
    } catch (err) {
      setState({ loading: false, error: err?.message || '加载应用列表失败', data: null });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...state, refresh };
}

