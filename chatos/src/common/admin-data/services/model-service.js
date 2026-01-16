import { BaseService } from './base-service.js';
import { modelSchema } from '../schema.js';

export class ModelService extends BaseService {
  constructor(db) {
    super(db, 'models', modelSchema);
  }

  create(payload) {
    const created = super.create(payload);
    if (created?.isDefault) {
      this.clearOtherDefaults(created.id);
    }
    return created;
  }

  update(id, payload) {
    const updated = super.update(id, payload);
    if (updated?.isDefault) {
      this.clearOtherDefaults(id);
    }
    return updated;
  }

  setDefault(id) {
    const target = this.get(id);
    if (!target) return null;
    this.clearOtherDefaults(id);
    const updated = this.db.update(this.tableName, id, { isDefault: true });
    return updated;
  }

  clearOtherDefaults(keepId) {
    const items = this.db.list(this.tableName) || [];
    items.forEach((item) => {
      if (item.id !== keepId && item.isDefault) {
        this.db.update(this.tableName, item.id, { isDefault: false });
      }
    });
  }
}
