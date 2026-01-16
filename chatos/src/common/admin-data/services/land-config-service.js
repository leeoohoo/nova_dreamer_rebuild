import { BaseService } from './base-service.js';
import { landConfigSchema } from '../schema.js';

export class LandConfigService extends BaseService {
  constructor(db) {
    super(db, 'landConfigs', landConfigSchema);
  }
}
