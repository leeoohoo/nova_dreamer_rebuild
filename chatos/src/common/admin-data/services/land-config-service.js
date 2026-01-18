import { BaseService } from './base-service.js';
import { landConfigSchema } from '../schema.js';

export class LandConfigService extends BaseService {
  constructor(db) {
    super(db, 'landConfigs', landConfigSchema);
  }

  update(id, payload) {
    const existing = this.get(id);
    if (existing?.locked) {
      throw new Error('该 land_config 为内置配置，禁止编辑。');
    }
    return super.update(id, payload);
  }

  remove(id) {
    const existing = this.get(id);
    if (existing?.locked) {
      throw new Error('该 land_config 为内置配置，禁止删除。');
    }
    return super.remove(id);
  }
}
