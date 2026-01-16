export class BaseService {
  constructor(db, tableName, schema) {
    this.db = db;
    this.tableName = tableName;
    this.schema = schema;
  }

  list() {
    return this.db.list(this.tableName);
  }

  get(id) {
    return this.db.get(this.tableName, id);
  }

  create(payload) {
    const parsed = this.parseInput(payload);
    return this.db.insert(this.tableName, parsed);
  }

  update(id, payload) {
    const parsed = this.parsePartial(payload);
    return this.db.update(this.tableName, id, parsed);
  }

  remove(id) {
    return this.db.remove(this.tableName, id);
  }

  parseInput(payload) {
    try {
      return this.schema.parse(payload);
    } catch (err) {
      throw new Error(this.formatSchemaError(err));
    }
  }

  parsePartial(payload) {
    try {
      if (this.schema && typeof this.schema.partial === 'function') {
        return this.schema.partial().parse(payload);
      }
      return this.schema.parse(payload);
    } catch (err) {
      throw new Error(this.formatSchemaError(err));
    }
  }

  formatSchemaError(err) {
    const issues = Array.isArray(err?.errors) ? err.errors : Array.isArray(err?.issues) ? err.issues : null;
    if (!issues) return err?.message || String(err);
    return issues
      .map((issue) => {
        const pathParts = Array.isArray(issue?.path) ? issue.path : [];
        const key = pathParts.filter((p) => typeof p === 'string' || typeof p === 'number').join('.') || 'field';
        const msg = issue?.message || 'Invalid';
        return `${key}: ${msg}`;
      })
      .join('; ');
  }
}

