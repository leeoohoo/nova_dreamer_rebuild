import { createApp, h } from 'vue';
import App from './ui/App.vue';

export function mount({ container, host, slots }) {
  if (!container) throw new Error('container is required');

  const app = createApp({
    render: () => h(App, { host, slots, compact: true }),
  });

  app.provide('host', host);
  app.mount(container);

  return () => {
    app.unmount();
    try {
      container.textContent = '';
    } catch {
      // ignore
    }
  };
}
