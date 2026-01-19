import { BaseService } from './base-service.js';
import { secretSchema } from '../schema.js';

export class SecretService extends BaseService {
  constructor(db) {
    super(db, 'secrets', secretSchema);
  }

  create(payload) {
    const parsed = this.parseInput(payload);
    this.#ensureUniqueName(null, parsed.name);
    return this.db.insert(this.tableName, parsed);
  }

  update(id, payload) {
    const parsed = this.parsePartial(payload);
    if (parsed?.name) {
      this.#ensureUniqueName(id, parsed.name);
    }
    return this.db.update(this.tableName, id, parsed);
  }

  getByName(name) {
    const normalized = this.#normalizeName(name);
    if (!normalized) return null;
    const items = this.list() || [];
    return items.find((item) => this.#normalizeName(item?.name) === normalized) || null;
  }

  #normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  #ensureUniqueName(currentId, name) {
    const normalized = this.#normalizeName(name);
    if (!normalized) return;
    const items = this.list() || [];
    const conflict = items.find(
      (item) => item?.id !== currentId && this.#normalizeName(item?.name) === normalized
    );
    if (conflict) {
      throw new Error(`secrets.name already exists: ${name}`);
    }
  }
}

