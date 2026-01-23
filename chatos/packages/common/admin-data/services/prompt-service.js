import { BaseService } from './base-service.js';
import { promptSchema } from '../schema.js';
import { extractVariables } from '../legacy.js';

const RESERVED_SYSTEM_PROMPTS = new Set([
  'internal',
  'internal_main',
  'internal_subagent',
  'default',
  // Deprecated legacy entries (kept reserved to avoid confusion)
  'user_prompt',
  'subagent_user_prompt',
]);

export class PromptService extends BaseService {
  constructor(db) {
    super(db, 'prompts', promptSchema);
  }

  create(payload) {
    const name = typeof payload?.name === 'string' ? payload.name.trim() : '';
    if (name && RESERVED_SYSTEM_PROMPTS.has(name)) {
      throw new Error(`Prompt 名称 "${name}" 为系统保留项`);
    }
    const enriched = this.withVariables(payload);
    return super.create(enriched);
  }

  update(id, payload) {
    const existing = this.get(id);
    if (existing?.locked || RESERVED_SYSTEM_PROMPTS.has(existing?.name)) {
      throw new Error('该 Prompt 为内置锁定，禁止修改');
    }
    const enriched = this.withVariables(payload);
    return super.update(id, enriched);
  }

  remove(id) {
    const existing = this.get(id);
    if (existing?.builtin || existing?.locked || RESERVED_SYSTEM_PROMPTS.has(existing?.name)) {
      throw new Error('该 Prompt 为内置，禁止删除');
    }
    return super.remove(id);
  }

  withVariables(payload) {
    const next = { ...payload };
    if (typeof next.content === 'string' && !next.variables) {
      next.variables = extractVariables(next.content);
    }
    return next;
  }
}
