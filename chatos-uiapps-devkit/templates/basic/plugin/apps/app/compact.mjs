export function mount({ container, host }) {
  if (!container) throw new Error('container is required');

  const ctx = typeof host?.context?.get === 'function' ? host.context.get() : {};
  const root = document.createElement('div');
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.padding = '16px';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '10px';

  const title = document.createElement('div');
  title.textContent = 'Compact View';
  title.style.fontWeight = '700';
  title.style.fontSize = '15px';

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.opacity = '0.72';
  meta.textContent = `${ctx?.pluginId || ''}:${ctx?.appId || ''} · compact`;

  const desc = document.createElement('div');
  desc.style.fontSize = '13px';
  desc.style.opacity = '0.82';
  desc.textContent = 'Provide a lightweight UI here for side drawers or split views.';

  root.appendChild(title);
  root.appendChild(meta);
  root.appendChild(desc);

  container.appendChild(root);

  return () => {
    try {
      container.textContent = '';
    } catch {
      // ignore
    }
  };
}
