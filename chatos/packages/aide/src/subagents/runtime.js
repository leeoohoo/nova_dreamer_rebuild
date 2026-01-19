import { AsyncLocalStorage } from 'async_hooks';

let contextRef = null;
const asyncContext = new AsyncLocalStorage();

export function setSubAgentContext(context) {
  contextRef = context || null;
}

export function getSubAgentContext() {
  return asyncContext.getStore() || contextRef;
}

export async function runWithSubAgentContext(context, fn) {
  if (typeof fn !== 'function') {
    throw new Error('fn is required');
  }
  const payload = context || null;
  return asyncContext.run(payload, fn);
}
