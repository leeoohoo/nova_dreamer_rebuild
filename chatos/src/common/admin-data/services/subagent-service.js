import { BaseService } from './base-service.js';
import { subagentSchema } from '../schema.js';

export class SubagentService extends BaseService {
  constructor(db) {
    super(db, 'subagents', subagentSchema);
  }
}
