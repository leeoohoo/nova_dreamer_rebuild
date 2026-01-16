function normalizeId(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function toIdSet(list) {
  return new Set((Array.isArray(list) ? list : []).map((id) => normalizeId(id)).filter(Boolean));
}

export function createRestrictedSubAgentManager(baseManager, options = {}) {
  if (!baseManager) return null;
  const allowedPluginIds = toIdSet(options.allowedPluginIds);
  const allowedSkills = toIdSet(options.allowedSkills);

  const pluginAllowed = (pluginId) => {
    if (allowedPluginIds.size === 0) return true;
    return allowedPluginIds.has(normalizeId(pluginId));
  };

  const filterSkills = (skills) => {
    const list = Array.isArray(skills) ? skills : [];
    if (allowedSkills.size === 0) return list;
    return list.filter((skillId) => allowedSkills.has(normalizeId(skillId)));
  };

  return {
    listAgents() {
      const agents = baseManager.listAgents();
      return agents.filter((agent) => pluginAllowed(agent?.pluginId));
    },
    getAgent(agentId) {
      const id = normalizeId(agentId);
      if (!id) return null;
      const ref = baseManager.getAgent(id);
      if (!ref) return null;
      if (!pluginAllowed(ref?.plugin?.id)) return null;
      return ref;
    },
    buildSystemPrompt(agentRef, requestedSkills = []) {
      const filteredSkills = filterSkills(requestedSkills);
      return baseManager.buildSystemPrompt(agentRef, filteredSkills);
    },
    listCommands() {
      const commands = baseManager.listCommands();
      return commands.filter((cmd) => pluginAllowed(cmd?.pluginId));
    },
    getCommand(pluginId, commandId) {
      if (!pluginAllowed(pluginId)) return null;
      return baseManager.getCommand(pluginId, commandId);
    },
  };
}

