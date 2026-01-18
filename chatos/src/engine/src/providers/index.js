import { ConfigError } from '../config.js';
import { OpenAIProvider } from './openai.js';

// Provider is a UI-facing label; all current providers share the OpenAI-compatible SDK.
// Keep aliases here so configs can use "deepseek"/"azure" etc without changing runtime code.
const registry = new Map([
  [OpenAIProvider.name, OpenAIProvider],
  ['deepseek', OpenAIProvider],
  ['azure', OpenAIProvider],
  ['openai_compatible', OpenAIProvider],
  ['openai-compatible', OpenAIProvider],
]);

export function registerProvider(name, provider) {
  registry.set(name, provider);
}

export function createProvider(providerName, settings) {
  const key = typeof providerName === 'string' ? providerName.trim().toLowerCase() : '';
  const Provider = registry.get(key);
  if (!Provider) {
    const available = Array.from(registry.keys()).sort().join(', ') || '<none>';
    throw new ConfigError(`Unknown provider ${providerName}. Available: ${available}`);
  }
  return new Provider(settings);
}

export function listProviders() {
  return Array.from(registry.keys());
}
