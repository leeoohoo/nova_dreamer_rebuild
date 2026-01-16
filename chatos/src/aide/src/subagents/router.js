import { ChatSession } from '../session.js';

async function routeWithModel(client, currentModel, manager, userTask, options = {}) {
  if (!client || !manager || !userTask || !userTask.trim()) {
    return null;
  }
  const signal = options?.signal;
  const agents = manager.listAgents();
  if (!agents || agents.length === 0) {
    return null;
  }
  const catalog = agents.map((agent) => {
    const skills = Array.isArray(agent.skills)
      ? agent.skills.map((s) => s.id).join(', ')
      : '';
    return `- id=${agent.id}; name=${agent.name}; category=${agent.pluginId || 'general'}; skills=[${skills}]; desc=${agent.description || ''}`;
  });
  const system = [
    '你是子代理路由器，必须仅输出 JSON 对象，字段：',
    '{ "agent_id": "<id或null>", "skills": ["skill_id", ...], "reason": "<简述决策>" }',
    '从候选列表中选择最合适的 agent_id，若没有合适的返回 null。',
    'skills 填写希望激活的技能 ID 数组，可为空数组。',
    '必须是有效 JSON，禁止额外文本或注释。'
  ].join('\n');
  const user = [
    '用户任务：', userTask,
    '\n可用子代理：',
    catalog.join('\n') || '(无可用 agent)'
  ].join('\n');
  const session = new ChatSession(system);
  session.addUser(user);
  let resultText = '';
  try {
    resultText = await client.chat(currentModel, session, { stream: false, signal });
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return null;
  }
  if (!resultText) {
    return null;
  }
  try {
    const parsed = JSON.parse(resultText);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const agentId = typeof parsed.agent_id === 'string' ? parsed.agent_id.trim() : null;
    const skills = Array.isArray(parsed.skills)
      ? parsed.skills.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    if (!agentId) {
      return null;
    }
    const ref = manager.getAgent(agentId);
    if (!ref) {
      return null;
    }
    return { agentRef: ref, skills };
  } catch {
    return null;
  }
}

export { routeWithModel };

async function routeCommandWithModel(client, currentModel, manager, userTask, options = {}) {
  if (!client || !manager || !userTask || !userTask.trim()) {
    return null;
  }
  const signal = options?.signal;
  const commands = manager.listCommands();
  if (!commands || commands.length === 0) {
    return null;
  }
  const catalog = commands.map((cmd) => {
    return `- plugin=${cmd.pluginId}; command=${cmd.id}; name=${cmd.name}; desc=${cmd.description || ''}`;
  });
  const system = [
    '你是子代理命令路由器，必须仅输出 JSON 对象，字段：',
    '{ "plugin_id": "<id或null>", "command_id": "<id或null>", "arguments": "<传给命令的文本，可为空字符串>", "reason": "<简述决策>" }',
    '从候选列表中选择最合适的命令。若没有合适的返回 plugin_id/command_id=null。',
    '必须是有效 JSON，禁止额外文本或注释。'
  ].join('\n');
  const user = [
    '用户任务：', userTask,
    '\n可用命令：',
    catalog.join('\n') || '(无可用命令)'
  ].join('\n');
  const session = new ChatSession(system);
  session.addUser(user);
  let resultText = '';
  try {
    resultText = await client.chat(currentModel, session, { stream: false, signal });
  } catch (err) {
    if (err?.name === 'AbortError' || signal?.aborted) {
      throw err;
    }
    return null;
  }
  if (!resultText) {
    return null;
  }
  try {
    const parsed = JSON.parse(resultText);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const pluginId = typeof parsed.plugin_id === 'string' ? parsed.plugin_id.trim() : null;
    const commandId = typeof parsed.command_id === 'string' ? parsed.command_id.trim() : null;
    const args = typeof parsed.arguments === 'string' ? parsed.arguments : '';
    const reason = typeof parsed.reason === 'string' ? parsed.reason : '';
    if (!pluginId || !commandId) {
      return null;
    }
    const ref = manager.getCommand(pluginId, commandId);
    if (!ref) {
      return null;
    }
    return { commandRef: ref, argumentsText: args, reason };
  } catch {
    return null;
  }
}

export { routeCommandWithModel };
