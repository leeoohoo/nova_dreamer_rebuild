import { z } from 'zod';

const manifestVersionSchema = z.number().int().min(1).max(1).optional().default(1);

const iframeEntrySchema = z.object({
  type: z.literal('iframe'),
  path: z.string().trim().min(1, 'entry.path is required for iframe apps'),
});

const moduleEntrySchema = z.object({
  type: z.literal('module'),
  path: z.string().trim().min(1, 'entry.path is required for module apps'),
});

const urlEntrySchema = z.object({
  type: z.literal('url'),
  url: z.string().trim().url('entry.url must be a valid url'),
});

const entrySchema = z
  .union([iframeEntrySchema, moduleEntrySchema, urlEntrySchema, z.string().trim().min(1)])
  .transform((value) => (typeof value === 'string' ? { type: 'iframe', path: value } : value));

const aiPromptSourceSchema = z
  .object({
    path: z.string().trim().min(1).optional(),
    content: z.string().trim().min(1).optional(),
  })
  .refine((value) => Boolean(value?.path || value?.content), 'ai prompt source requires path or content');

const aiMcpPromptSchema = z
  .union([
    z.string().trim().min(1),
    z.object({
      title: z.string().trim().optional().default(''),
      zh: z.union([z.string().trim().min(1), aiPromptSourceSchema]).optional(),
      en: z.union([z.string().trim().min(1), aiPromptSourceSchema]).optional(),
    }),
  ])
  .transform((value) => {
    if (typeof value === 'string') {
      return { title: '', zh: { path: value } };
    }
    const normalizeSource = (src) => {
      if (!src) return undefined;
      if (typeof src === 'string') return { path: src };
      return src;
    };
    return {
      title: value.title || '',
      zh: normalizeSource(value.zh),
      en: normalizeSource(value.en),
    };
  })
  .refine((value) => Boolean(value?.zh || value?.en), 'ai.mcpPrompt requires zh or en');

const aiMcpAuthSchema = z
  .object({
    token: z.string().trim().optional(),
    basic: z
      .object({
        username: z.string().trim().optional(),
        password: z.string().trim().optional(),
      })
      .partial()
      .optional(),
    headers: z.record(z.string().trim()).optional(),
  })
  .partial();

const aiMcpServerSchema = z.object({
  url: z.string().trim().min(1).optional(),
  command: z.string().trim().min(1).optional(),
  entry: z.string().trim().min(1).optional(),
  args: z.array(z.string().trim()).optional().default([]),
  description: z.string().trim().optional().default(''),
  tags: z.array(z.string().trim()).optional().default([]),
  enabled: z.boolean().optional(),
  allowMain: z.boolean().optional(),
  allowSub: z.boolean().optional(),
  auth: aiMcpAuthSchema.optional(),
}).refine((value) => Boolean(value?.url || value?.entry), 'ai.mcp requires url or entry');

const aiAgentTemplateSchema = z.object({
  name: z.string().trim().min(1, 'ai.agent.name is required'),
  description: z.string().trim().optional().default(''),
  modelId: z.string().trim().optional().default(''),
});

const uiAppAiSchema = z.object({
  mcp: aiMcpServerSchema.optional(),
  mcpPrompt: aiMcpPromptSchema.optional(),
  agent: aiAgentTemplateSchema.optional(),
});

export const uiAppSchema = z.object({
  id: z.string().trim().min(1, 'app.id is required'),
  name: z.string().trim().min(1, 'app.name is required'),
  description: z.string().trim().optional().default(''),
  icon: z.string().trim().optional().default(''),
  entry: entrySchema,
  ai: uiAppAiSchema.optional(),
});

export const uiAppsPluginSchema = z.object({
  manifestVersion: manifestVersionSchema,
  id: z.string().trim().min(1, 'plugin.id is required'),
  name: z.string().trim().min(1, 'plugin.name is required'),
  version: z.string().trim().optional().default('0.0.0'),
  description: z.string().trim().optional().default(''),
  backend: z
    .object({
      entry: z.string().trim().min(1, 'backend.entry is required'),
    })
    .optional(),
  apps: z.array(uiAppSchema).optional().default([]),
});
