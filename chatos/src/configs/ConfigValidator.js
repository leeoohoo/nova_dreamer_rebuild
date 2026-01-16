export class ConfigValidator {
  validateConfig({ config, items = [] } = {}) {
    const errors = [];
    const grouped = {
      model: [],
      mcp_server: [],
      prompt: [],
      subagent: [],
    };

    const list = Array.isArray(items) ? items : [];
    list.forEach((item) => {
      const type = item?.itemType;
      if (grouped[type]) grouped[type].push(item);
    });

    if (grouped.model.length === 0) {
      errors.push('至少需要一个模型配置');
    }

    grouped.mcp_server.forEach((item) => {
      const data = item?.itemData || {};
      const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : item?.itemId;
      const url = typeof data.url === 'string' ? data.url.trim() : '';
      if (!name || !url) {
        errors.push(`MCP服务器 ${name || '未知'} 配置不完整`);
      }
    });

    grouped.prompt.forEach((item) => {
      const data = item?.itemData || {};
      const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : item?.itemId;
      const content = typeof data.content === 'string' ? data.content.trim() : '';
      if (!name || !content) {
        errors.push(`提示词 ${name || '未知'} 配置不完整`);
      }
    });

    return errors;
  }
}
