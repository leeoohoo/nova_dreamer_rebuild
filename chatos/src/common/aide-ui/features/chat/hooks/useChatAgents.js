import { useEffect, useMemo, useState } from 'react';
import { message as toast } from 'antd';

import { api, hasApi } from '../../../lib/api.js';

function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function useChatAgents({ models } = {}) {
  const [agents, setAgents] = useState([]);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [agentModalInitial, setAgentModalInitial] = useState(null);

  const defaultModelId = useMemo(() => {
    const list = Array.isArray(models) ? models : [];
    return normalizeId(list.find((m) => m?.isDefault)?.id) || normalizeId(list?.[0]?.id);
  }, [models]);

  const refreshAgents = async () => {
    const res = await api.invoke('chat:agents:list');
    if (res?.ok === false) throw new Error(res?.message || '加载 agents 失败');
    setAgents(Array.isArray(res?.agents) ? res.agents : []);
  };

  useEffect(() => {
    if (!hasApi) return;
    void (async () => {
      try {
        await api.invoke('chat:agents:ensureDefault');
        await refreshAgents();
      } catch (err) {
        toast.error(err?.message || '加载 agents 失败');
      }
    })();
  }, []);

  const openNewAgentModal = () => {
    setAgentModalInitial({
      name: '',
      description: '',
      prompt: '',
      modelId: defaultModelId,
      uiApps: [],
    });
    setAgentModalOpen(true);
  };

  const openEditAgentModal = (agent) => {
    if (!agent) return;
    setAgentModalInitial({
      id: agent.id,
      name: agent.name || '',
      description: agent.description || '',
      prompt: agent.prompt || '',
      modelId: agent.modelId || '',
      uiApps: Array.isArray(agent.uiApps) ? agent.uiApps : [],
    });
    setAgentModalOpen(true);
  };

  const closeAgentModal = () => {
    setAgentModalOpen(false);
    setAgentModalInitial(null);
  };

  const saveAgent = async (values) => {
    const id = normalizeId(values?.id);
    const payload = {
      name: values?.name,
      description: values?.description,
      prompt: values?.prompt,
      modelId: values?.modelId,
      uiApps: values?.uiApps,
    };
    if (id) {
      const res = await api.invoke('chat:agents:update', { id, data: payload });
      if (res?.ok === false) throw new Error(res?.message || '保存 Agent 失败');
    } else {
      const res = await api.invoke('chat:agents:create', payload);
      if (res?.ok === false) throw new Error(res?.message || '创建 Agent 失败');
    }
    closeAgentModal();
    await refreshAgents();
    toast.success('已保存 Agent');
  };

  const deleteAgent = async (agentId) => {
    const id = normalizeId(agentId);
    if (!id) return;
    const res = await api.invoke('chat:agents:delete', { id });
    if (res?.ok === false) {
      toast.error(res?.message || '删除 Agent 失败');
      return;
    }
    await refreshAgents();
    toast.success('已删除 Agent');
  };

  return {
    agents,
    refreshAgents,
    agentModalOpen,
    agentModalInitial,
    openNewAgentModal,
    openEditAgentModal,
    closeAgentModal,
    saveAgent,
    deleteAgent,
  };
}
