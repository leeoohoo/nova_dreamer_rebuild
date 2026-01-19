export const api = window.api;
export const hasApi = api && typeof api.invoke === 'function' && typeof api.on === 'function';

