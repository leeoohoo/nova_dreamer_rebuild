import { useCallback, useEffect, useState } from 'react';

import { api, hasApi } from '../../../lib/api.js';

const CACHE_TTL_MS = 8000;
const registryCache = {
  data: null,
  error: null,
  loading: true,
  updatedAt: 0,
  inflight: null,
  listeners: new Set(),
};

function getSnapshot() {
  return { loading: registryCache.loading, error: registryCache.error, data: registryCache.data };
}

function emitSnapshot() {
  const snapshot = getSnapshot();
  registryCache.listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // ignore listener errors
    }
  });
}

function subscribe(listener) {
  if (typeof listener !== 'function') return () => {};
  registryCache.listeners.add(listener);
  return () => registryCache.listeners.delete(listener);
}

async function loadRegistry({ force = false } = {}) {
  if (!hasApi) {
    registryCache.loading = false;
    registryCache.error = 'IPC bridge not available. Is preload loaded?';
    registryCache.data = null;
    emitSnapshot();
    return null;
  }

  const now = Date.now();
  if (!force && registryCache.data && now - registryCache.updatedAt < CACHE_TTL_MS) {
    return registryCache.data;
  }
  if (registryCache.inflight) return registryCache.inflight;

  registryCache.loading = true;
  registryCache.error = null;
  emitSnapshot();

  registryCache.inflight = (async () => {
    try {
      const res = await api.invoke('uiApps:list');
      if (res?.ok === false) {
        throw new Error(res?.message || '加载应用列表失败');
      }
      registryCache.data = res || null;
      registryCache.error = null;
      registryCache.updatedAt = Date.now();
      return registryCache.data;
    } catch (err) {
      registryCache.error = err?.message || '加载应用列表失败';
      registryCache.data = registryCache.data || null;
      throw err;
    } finally {
      registryCache.loading = false;
      registryCache.inflight = null;
      emitSnapshot();
    }
  })();

  return registryCache.inflight;
}

export function useUiAppsRegistry() {
  const [state, setState] = useState(() => getSnapshot());

  useEffect(() => subscribe(setState), []);

  useEffect(() => {
    void loadRegistry({ force: false });
  }, []);

  const refresh = useCallback(async () => {
    try {
      await loadRegistry({ force: true });
    } catch {
      // errors already reflected in state
    }
  }, []);

  return { ...state, refresh };
}

