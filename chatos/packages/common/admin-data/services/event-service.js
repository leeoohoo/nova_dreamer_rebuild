import { BaseService } from './base-service.js';
import { eventSchema } from '../schema.js';

export class EventService extends BaseService {
  constructor(db) {
    super(db, 'events', eventSchema);
  }

  append(type, payload, meta = {}) {
    return this.create({
      type,
      payload,
      meta,
      ts: new Date().toISOString(),
    });
  }
}
