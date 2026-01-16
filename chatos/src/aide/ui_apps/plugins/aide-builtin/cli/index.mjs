export function mount({ container, host }) {
  if (!container) throw new Error('container is required');
  if (!host || typeof host !== 'object') throw new Error('host is required');

  const ctx = typeof host?.context?.get === 'function' ? host.context.get() : {};
  const bridgeEnabled = Boolean(ctx?.bridge?.enabled);
  const canNavigate = typeof host?.ui?.navigate === 'function';

  const root = document.createElement('div');
  root.style.height = '100%';
  root.style.boxSizing = 'border-box';
  root.style.padding = '14px';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '12px';

  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.flexDirection = 'column';
  header.style.gap = '4px';

  const title = document.createElement('div');
  title.textContent = 'AIDE 引擎';
  title.style.fontWeight = '750';
  title.style.fontSize = '16px';

  const meta = document.createElement('div');
  meta.style.fontSize = '12px';
  meta.style.opacity = '0.72';
  meta.textContent = `${ctx?.pluginId || ''}:${ctx?.appId || ''} · bridge=${bridgeEnabled ? 'enabled' : 'disabled'}`;

  header.appendChild(title);
  header.appendChild(meta);

  const desc = document.createElement('div');
  desc.style.fontSize = '13px';
  desc.style.opacity = '0.82';
  desc.textContent = '该应用用于从「应用中心」快速进入内置 CLI 面板。';

  const grid = document.createElement('div');
  grid.style.display = 'grid';
  grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(220px, 1fr))';
  grid.style.gap = '10px';

  const mkCard = (label, detail, route) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.style.padding = '12px 12px';
    card.style.borderRadius = '14px';
    card.style.border = '1px solid rgba(0,0,0,0.12)';
    card.style.background = 'rgba(0,0,0,0.03)';
    card.style.cursor = canNavigate ? 'pointer' : 'not-allowed';
    card.style.textAlign = 'left';
    card.style.display = 'grid';
    card.style.gap = '4px';

    const name = document.createElement('div');
    name.textContent = label;
    name.style.fontWeight = '700';
    name.style.fontSize = '14px';

    const sub = document.createElement('div');
    sub.textContent = detail;
    sub.style.fontSize = '12px';
    sub.style.opacity = '0.72';

    card.appendChild(name);
    card.appendChild(sub);

    card.addEventListener('click', () => {
      if (!canNavigate) return;
      const next = typeof route === 'string' ? route.trim() : '';
      if (!next) return;
      host.ui.navigate(next);
    });

    return card;
  };

  grid.appendChild(mkCard('会话', '查看会话、任务、终端状态', 'cli/session'));
  grid.appendChild(mkCard('文件', '按 workspace 浏览文件/改动', 'cli/workspace'));
  grid.appendChild(mkCard('轨迹', '查看事件流/日志', 'cli/events'));
  grid.appendChild(mkCard('设置', '运行配置 / 终端命令安装', 'admin/settings'));

  const hint = document.createElement('div');
  hint.style.fontSize = '12px';
  hint.style.opacity = '0.72';
  hint.textContent = canNavigate ? '提示：点击卡片跳转到对应页面。' : '当前宿主未开放导航能力（host.ui.navigate），无法跳转。';

  root.appendChild(header);
  root.appendChild(desc);
  root.appendChild(grid);
  root.appendChild(hint);

  container.appendChild(root);

  return () => {
    try {
      container.textContent = '';
    } catch {
      // ignore
    }
  };
}
