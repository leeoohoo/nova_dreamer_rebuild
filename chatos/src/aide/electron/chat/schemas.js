import { z } from 'zod';

const toolCallSchema = z
  .object({
    id: z.string().trim().min(1, 'tool call id is required'),
    type: z.string().trim().optional(),
    function: z
      .object({
        name: z.string().trim().optional().default(''),
        arguments: z.string().optional().default(''),
      })
      .optional(),
  })
  .passthrough();

const imageAttachmentSchema = z
  .object({
    id: z.string().trim().optional().default(''),
    type: z.literal('image').optional().default('image'),
    name: z.string().trim().optional().default(''),
    mimeType: z.string().trim().optional().default(''),
    dataUrl: z.string().trim().min(1, 'dataUrl is required'),
  })
  .passthrough();

export const chatAgentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, 'name is required'),
  description: z.string().trim().optional().default(''),
  prompt: z.string().optional().default(''),
  modelId: z.string().trim().min(1, 'modelId is required'),
  promptIds: z.array(z.string().trim()).optional().default([]),
  subagentIds: z.array(z.string().trim()).optional().default([]),
  skills: z.array(z.string().trim()).optional().default([]),
  mcpServerIds: z.array(z.string().trim()).optional().default([]),
  uiApps: z
    .array(
      z.object({
        pluginId: z.string().trim().min(1, 'uiApps[].pluginId is required'),
        appId: z.string().trim().min(1, 'uiApps[].appId is required'),
        mcp: z.boolean().optional().default(true),
        prompt: z.boolean().optional().default(true),
        mcpServerIds: z.array(z.string().trim()).optional().default([]),
        promptIds: z.array(z.string().trim()).optional().default([]),
      })
    )
    .optional()
    .default([]),
});

export const chatSessionSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().optional().default('新会话'),
  agentId: z.string().trim().optional().default(''),
  workspaceRoot: z.string().trim().optional().default(''),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
});

export const chatMessageSchema = z.object({
  id: z.string().uuid().optional(),
  sessionId: z.string().trim().min(1, 'sessionId is required'),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().optional().default(''),
  reasoning: z.string().optional().default(''),
  attachments: z.array(imageAttachmentSchema).optional().default([]),
  toolCallId: z.string().trim().optional().default(''),
  toolName: z.string().trim().optional().default(''),
  toolCalls: z.array(toolCallSchema).optional(),
  hidden: z.boolean().optional(),
});
