import React from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from './components/ErrorBoundary.jsx';
import { CliApp } from './CliApp.jsx';

export function mount({ container, host }) {
  if (!container) throw new Error('container is required');

  const prevStyle = {
    display: container.style.display,
    flexDirection: container.style.flexDirection,
    flex: container.style.flex,
    height: container.style.height,
    minHeight: container.style.minHeight,
    overflow: container.style.overflow,
  };
  try {
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.flex = '1 1 auto';
    container.style.height = container.style.height || '100%';
    container.style.minHeight = container.style.minHeight || '0';
    container.style.overflow = 'hidden';
  } catch {
    // ignore style injection failures
  }

  const root = createRoot(container);
  root.render(
    <ErrorBoundary>
      <CliApp host={host || null} mountContainer={container} />
    </ErrorBoundary>
  );

  return () => {
    try {
      root.unmount();
    } catch {
      // ignore
    }
    try {
      container.style.display = prevStyle.display;
      container.style.flexDirection = prevStyle.flexDirection;
      container.style.flex = prevStyle.flex;
      container.style.height = prevStyle.height;
      container.style.minHeight = prevStyle.minHeight;
      container.style.overflow = prevStyle.overflow;
    } catch {
      // ignore
    }
    try {
      container.textContent = '';
    } catch {
      // ignore
    }
  };
}
