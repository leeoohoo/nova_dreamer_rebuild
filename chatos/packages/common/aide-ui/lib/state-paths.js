import { STATE_ROOT_DIRNAME } from '../../state-core/state-constants.js';

function normalizeText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

export function formatStateRootLabel({ style = 'tilde', rootName } = {}) {
  const name = normalizeText(rootName, STATE_ROOT_DIRNAME);
  if (style === 'token') return '<stateRoot>';
  if (style === 'dirname') return name;
  if (style === 'home') return `<home>/${name}`;
  return `~/${name}`;
}

export function formatStateDirLabel({ hostApp = '<hostApp>', style = 'tilde' } = {}) {
  if (style === 'token') return '<stateDir>';
  const host = normalizeText(hostApp, '<hostApp>');
  const root = formatStateRootLabel({ style });
  return `${root}/${host}`;
}
