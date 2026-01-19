export const CONFIG_TABLE = 'configs';
export const CONFIG_ITEMS_TABLE = 'config_items';

export const CONFIG_ITEM_TYPES = ['model', 'mcp_server', 'prompt', 'subagent', 'setting'];

// SQL definitions are kept for reference/documentation. Data is stored via admin DB records.
export const CONFIG_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

export const CONFIG_ITEMS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS config_items (
  id TEXT PRIMARY KEY,
  config_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_data TEXT,
  enabled BOOLEAN DEFAULT 1,
  order_index INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (config_id) REFERENCES configs(id) ON DELETE CASCADE
);
`;

export const CONFIG_INDEXES_SQL = `
CREATE INDEX idx_configs_active ON configs(is_active);
CREATE INDEX idx_config_items_config ON config_items(config_id);
CREATE INDEX idx_config_items_type ON config_items(item_type);
CREATE UNIQUE INDEX idx_config_items_unique ON config_items(config_id, item_type, item_id);
`;
