export async function createUiAppsBackend(ctx) {
  const llmComplete = async (params, runtimeCtx) => {
    const api = runtimeCtx?.llm || ctx?.llm || null;
    if (!api || typeof api.complete !== 'function') {
      throw new Error('Host LLM bridge is not available (ctx.llm.complete)');
    }
    const input = typeof params?.input === 'string' ? params.input : typeof params?.prompt === 'string' ? params.prompt : '';
    const normalized = String(input || '').trim();
    if (!normalized) {
      throw new Error('input is required');
    }
    return await api.complete({
      input: normalized,
      modelId: typeof params?.modelId === 'string' ? params.modelId : undefined,
      modelName: typeof params?.modelName === 'string' ? params.modelName : undefined,
      systemPrompt: typeof params?.systemPrompt === 'string' ? params.systemPrompt : undefined,
      disableTools: params?.disableTools,
    });
  };

  return {
    methods: {
      async ping(params, runtimeCtx) {
        return {
          ok: true,
          now: new Date().toISOString(),
          pluginId: runtimeCtx?.pluginId || ctx?.pluginId || '',
          params: params ?? null,
        };
      },

      async llmComplete(params, runtimeCtx) {
        return await llmComplete(params, runtimeCtx);
      },
    },
  };
}
