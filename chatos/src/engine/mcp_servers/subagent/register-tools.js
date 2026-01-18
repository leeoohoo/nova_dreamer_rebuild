export function registerSubagentTools(context = {}) {
  const {
    server,
    z,
    manager,
    jsonTextResponse,
    serializeAgent,
    normalizeSkills,
    pickAgent,
    executeSubAgent,
    buildJobResultPayload,
    createAsyncJob,
    startAsyncJob,
    formatJobStatus,
    hydrateStaleStatus,
    getJobStore,
    performance,
  } = context;

  if (!server) throw new Error('Missing MCP server');
  if (!z) throw new Error('Missing zod');
  if (!manager) throw new Error('Missing subagent manager');
  if (typeof jsonTextResponse !== 'function') throw new Error('Missing jsonTextResponse');
  if (typeof serializeAgent !== 'function') throw new Error('Missing serializeAgent');
  if (typeof pickAgent !== 'function') throw new Error('Missing pickAgent');
  if (typeof executeSubAgent !== 'function') throw new Error('Missing executeSubAgent');
  if (typeof buildJobResultPayload !== 'function') throw new Error('Missing buildJobResultPayload');
  if (typeof createAsyncJob !== 'function') throw new Error('Missing createAsyncJob');
  if (typeof startAsyncJob !== 'function') throw new Error('Missing startAsyncJob');
  if (typeof formatJobStatus !== 'function') throw new Error('Missing formatJobStatus');
  if (typeof hydrateStaleStatus !== 'function') throw new Error('Missing hydrateStaleStatus');
  if (typeof getJobStore !== 'function') throw new Error('Missing getJobStore');

  server.registerTool(
    'get_sub_agent',
    {
      title: 'Get sub-agent details',
      description: 'Return details by agent_id (description, skills, commands, model, default command).',
      inputSchema: z.object({
        agent_id: z.string().min(1).describe('Sub-agent ID'),
      }),
    },
    async ({ agent_id: agentId }) => {
      const ref = manager.getAgent(agentId);
      if (!ref) {
        throw new Error(`Sub-agent ${agentId} not found. Install the plugin first.`);
      }
      const prompt = manager.buildSystemPrompt(ref, []);
      const commands = Array.isArray(ref.plugin?.commands)
        ? ref.plugin.commands.map((cmd) => cmd?.name || cmd?.id).filter(Boolean)
        : [];
      const previewStack = [prompt.systemPrompt, prompt.internalPrompt].filter(Boolean).join('\n\n');
      return jsonTextResponse({
        agent: serializeAgent(ref.agent),
        plugin: ref.plugin.id,
        model: ref.agent.model || null,
        default_skills: ref.agent.defaultSkills || [],
        commands,
        system_prompt_preview: previewStack.slice(0, 500),
      });
    }
  );

  server.registerTool(
    'suggest_sub_agent',
    {
      title: 'Suggest sub-agent',
      description:
        'Pick the best sub-agent for a task using optional category/skills/command hints. Returns agent + skills + command.',
      inputSchema: z.object({
        task: z.string().min(1).describe('Task description'),
        category: z.string().optional().describe('Preferred category/plugin (e.g., python, java)'),
        skills: z.array(z.string()).optional().describe('Skills to activate/prefer'),
        query: z.string().optional().describe('Optional keyword search (name/description/skills/commands)'),
        command_id: z.string().optional().describe('Optional command ID/name to prioritize agents that support it'),
      }),
    },
    async ({ task, category, skills = [], query, command_id: commandId }) => {
      if (process.env.SUBAGENT_SUGGEST_FAST === '1') {
        return jsonTextResponse({
          agent_id: 'fast-agent',
          agent_name: 'Fast Agent',
          plugin: 'mock',
          model: 'mock-model',
          command_id: null,
          skills: [],
          reason: 'Fast mode response',
        });
      }
      console.error('[suggest_sub_agent] invoked', { category, skillsCount: skills?.length || 0, query, commandId });
      const agentRef = await pickAgent({ agentId: null, category, skills, query, commandId, task });
      console.error('[suggest_sub_agent] pickAgent resolved', agentRef?.agent?.id);
      if (!agentRef) {
        return jsonTextResponse({
          agent_id: null,
          skills: [],
          reason: 'No matching sub-agent. Install relevant plugins first.',
        });
      }
      if (process.env.SUBAGENT_SUGGEST_MIN === '1') {
        return jsonTextResponse({
          agent_id: agentRef.agent.id,
          agent_name: agentRef.agent.name || '',
        });
      }
      let usedSkills = normalizeSkills(skills);
      if (usedSkills.length === 0) {
        // Prefer agent default skills; if missing, fall back to declared skills/skills in plugin.
        const defaults = Array.isArray(agentRef.agent.defaultSkills) ? agentRef.agent.defaultSkills : [];
        if (defaults.length > 0) {
          usedSkills = defaults.map((s) => String(s || '').trim()).filter(Boolean);
        } else {
          const fallbackSkills =
            (Array.isArray(agentRef.agent.skills) && agentRef.agent.skills.length > 0
              ? agentRef.agent.skills
              : Array.isArray(agentRef.plugin?.skills)
                ? agentRef.plugin.skills
                : []) || [];
          usedSkills = fallbackSkills
            .map((s) => (typeof s === 'string' ? s : s?.id || s?.name || ''))
            .map((s) => String(s || '').trim())
            .filter(Boolean);
        }
      }
      const commands = Array.isArray(agentRef.plugin?.commands) ? agentRef.plugin.commands : [];
      let chosenCommandId = commandId || agentRef.agent.defaultCommand || null;
      if (!chosenCommandId && commands.length > 0) {
        const fallback = commands[0];
        chosenCommandId = fallback?.id || fallback?.name || null;
      }

      let aiReason = null;
      if (agentRef.agent.id && query === undefined && commandId === undefined && category === undefined && task) {
        // If we auto-picked this agent, maybe try to explain why if we have the AI context?
        // Actually, `suggestAgentWithAI` result isn't passed here directly unless we change `pickAgent` to return it.
        // For now, let's keep it simple.
        aiReason = null;
      }

      const payload = {
        agent_id: agentRef.agent.id,
        agent_name: agentRef.agent.name,
        plugin: agentRef.plugin.id,
        model: agentRef.agent.model || null,
        command_id: chosenCommandId,
        skills: usedSkills,
        reason: aiReason || 'Best match by category/skills routing',
      };
      console.error('[suggest_sub_agent] returning payload', payload);
      return jsonTextResponse(payload);
    }
  );

  server.registerTool(
    'run_sub_agent',
    {
      title: 'Run sub-agent',
      description:
        'Select and run a sub-agent for a task (auto-pick or by agent_id). Returns response and used skills/command.',
      inputSchema: z.object({
        task: z.string().min(1).describe('Task description'),
        agent_id: z.string().optional().describe('Explicit sub-agent ID; if omitted, auto-pick'),
        category: z.string().optional().describe('Category hint for auto-pick'),
        skills: z.array(z.string()).optional().describe('Skills to activate/prefer'),
        model: z.string().optional().describe('Optional model override'),
        query: z.string().optional().describe('Keyword search for names/descriptions/skills/commands'),
        command_id: z.string().optional().describe('Optional command ID/name; will run that command if present'),
      }),
    },
    async ({ task, agent_id: agentId, category, skills = [], model, query, command_id: commandId }) => {
      try {
        const result = await executeSubAgent({
          task,
          agentId,
          category,
          skills,
          model,
          query,
          commandId,
        });
        return jsonTextResponse(buildJobResultPayload(result));
      } catch (err) {
        return jsonTextResponse({
          agent_id: agentId || null,
          error: err?.message || String(err),
          hint: 'Ensure agent_id/command exists, model is configured, or list agents via /sub agents.',
        });
      }
    }
  );

  server.registerTool(
    'start_sub_agent_async',
    {
      title: 'Start sub-agent (async)',
      description: 'Internal: start a sub-agent run asynchronously and return a job_id for polling.',
      inputSchema: z.object({
        task: z.string().min(1).describe('Task description'),
        agent_id: z.string().optional().describe('Explicit sub-agent ID; if omitted, auto-pick'),
        category: z.string().optional().describe('Category hint for auto-pick'),
        skills: z.array(z.string()).optional().describe('Skills to activate/prefer'),
        model: z.string().optional().describe('Optional model override'),
        query: z.string().optional().describe('Keyword search for names/descriptions/skills/commands'),
        command_id: z.string().optional().describe('Optional command ID/name; will run that command if present'),
      }),
    },
    async ({ task, agent_id: agentId, category, skills = [], model, query, command_id: commandId }) => {
      const job = createAsyncJob({ task, agentId, category, skills, model, query, commandId });
      startAsyncJob(job);
      return jsonTextResponse({
        job_id: job.id,
        status: job.status,
        created_at: job.createdAt,
      });
    }
  );

  server.registerTool(
    'get_sub_agent_status',
    {
      title: 'Get async sub-agent status',
      description: 'Internal: poll async sub-agent job status.',
      inputSchema: z.object({
        job_id: z.string().min(1).describe('Job ID returned by start_sub_agent_async'),
      }),
    },
    async ({ job_id: jobId }) => {
      const store = getJobStore();
      const job = store?.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      hydrateStaleStatus(job);
      return jsonTextResponse(formatJobStatus(job));
    }
  );

  server.registerTool(
    'cancel_sub_agent_job',
    {
      title: 'Cancel async sub-agent job',
      description:
        'Internal: cancel a running sub-agent job (best-effort; sends SIGTERM then SIGKILL to the worker process).',
      inputSchema: z.object({
        job_id: z.string().min(1).describe('Job ID returned by start_sub_agent_async'),
      }),
    },
    async ({ job_id: jobId }) => {
      const store = getJobStore();
      const job = store?.get(jobId);
      if (!job) {
        throw new Error(`Job ${jobId} not found`);
      }
      const child = job.worker;
      if (job.status !== 'running' || !child) {
        return jsonTextResponse({
          ok: true,
          job_id: jobId,
          status: job.status,
          message: 'job is not running',
        });
      }
      job.status = 'error';
      job.result = null;
      job.error = 'cancelled';
      job.updatedAt = new Date().toISOString();
      job.updatedAtMono = typeof performance?.now === 'function' ? performance.now() : Date.now();
      job.heartbeatStale = false;

      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }

      return jsonTextResponse({
        ok: true,
        job_id: jobId,
        status: job.status,
        error: job.error,
      });
    }
  );
}
