import { useMemo } from 'react';

import { useChatAgents } from './useChatAgents.js';
import { useChatSessions } from './useChatSessions.js';

export function useChatController({ admin } = {}) {
  const models = useMemo(() => (Array.isArray(admin?.models) ? admin.models : []), [admin]);
  const agents = useChatAgents({ models });
  const sessions = useChatSessions();

  const refreshAll = async () => {
    await Promise.all([agents.refreshAgents?.(), sessions.refreshAll?.()]);
  };

  return {
    ...sessions,
    ...agents,
    refreshAll,
  };
}

