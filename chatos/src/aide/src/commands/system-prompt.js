export function resolveSystemPrompt(_client, _modelName, systemOverride, options = {}) {
  if (options.landConfigPrompt !== undefined) {
    return typeof options.landConfigPrompt === 'string' ? options.landConfigPrompt : '';
  }
  if (systemOverride !== undefined) {
    return typeof systemOverride === 'string' ? systemOverride : '';
  }
  return '';
}

