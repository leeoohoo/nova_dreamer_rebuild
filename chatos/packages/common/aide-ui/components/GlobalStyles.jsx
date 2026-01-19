import React from 'react';

export function GlobalStyles({ extraCss = '' } = {}) {
  const extra = typeof extraCss === 'string' ? extraCss : '';
  return (
    <style>{`
      :root {
        --ds-accent: #00d4ff;
        --ds-accent-2: #7c3aed;
        --ds-accent-app: #00ffa8;

        --ds-page-bg: radial-gradient(1200px circle at 20% -20%, rgba(0, 212, 255, 0.18), transparent 58%),
          radial-gradient(900px circle at 100% 0%, rgba(124, 58, 237, 0.12), transparent 62%),
          linear-gradient(180deg, #f8fbff 0%, #f3f6ff 55%, #f5f7fb 100%);

        --ds-header-bg: rgba(255, 255, 255, 0.72);
        --ds-header-border: rgba(15, 23, 42, 0.08);
        --ds-header-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
        --ds-panel-bg: rgba(255, 255, 255, 0.86);
        --ds-panel-border: rgba(15, 23, 42, 0.08);
        --ds-panel-shadow: 0 12px 30px rgba(15, 23, 42, 0.07);
        --ds-subtle-bg: rgba(255, 255, 255, 0.62);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.14), rgba(124, 58, 237, 0.08));
        --ds-splitter-bg: #d9d9d9;

        --ds-floating-bg: rgba(255, 255, 255, 0.82);
        --ds-floating-border: rgba(15, 23, 42, 0.1);
        --ds-floating-shadow: 0 14px 40px rgba(15, 23, 42, 0.12);
        --ds-focus-ring: rgba(0, 212, 255, 0.32);

        --ds-nav-bg: rgba(255, 255, 255, 0.55);
        --ds-nav-border: rgba(15, 23, 42, 0.1);
        --ds-nav-shadow: 0 10px 26px rgba(15, 23, 42, 0.08);
        --ds-nav-hover-bg: rgba(15, 23, 42, 0.06);

        --ds-change-bg-error: #fff1f0;
        --ds-change-bg-warning: #fffbe6;
        --ds-change-bg-success: #f6ffed;

        --ds-code-bg: #f7f9fb;
        --ds-code-border: #eef2f7;
        --ds-code-inline-bg: #f1f3f5;
        --ds-code-inline-border: #e9ecef;
        --ds-code-line-number: #9aa4b2;
        --ds-blockquote-border: #d0d7de;
        --ds-blockquote-text: #57606a;

        --ds-code-text: #1f2328;
        --ds-code-comment: #6a737d;
        --ds-code-keyword: #d73a49;
        --ds-code-string: #032f62;
        --ds-code-number: #005cc5;
        --ds-code-built-in: #6f42c1;
        --ds-code-attr: #005cc5;
        --ds-code-title: #6f42c1;
        --ds-code-meta: #6f42c1;
      }

      :root[data-theme='dark'] {
        --ds-accent: #00d4ff;
        --ds-accent-2: #a855f7;
        --ds-accent-app: #00ffa8;

        --ds-page-bg: radial-gradient(1100px circle at 20% 0%, rgba(0, 212, 255, 0.16), transparent 56%),
          radial-gradient(900px circle at 100% 10%, rgba(168, 85, 247, 0.14), transparent 62%),
          linear-gradient(180deg, #070910 0%, #0f1115 55%, #070910 100%);

        --ds-header-bg: rgba(10, 12, 18, 0.66);
        --ds-header-border: rgba(255, 255, 255, 0.12);
        --ds-header-shadow: 0 14px 40px rgba(0, 0, 0, 0.55);
        --ds-panel-bg: rgba(17, 19, 28, 0.82);
        --ds-panel-border: rgba(255, 255, 255, 0.14);
        --ds-panel-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
        --ds-subtle-bg: rgba(255, 255, 255, 0.04);
        --ds-selected-bg: linear-gradient(90deg, rgba(0, 212, 255, 0.18), rgba(168, 85, 247, 0.14));
        --ds-splitter-bg: #30363d;

        --ds-floating-bg: rgba(10, 12, 18, 0.78);
        --ds-floating-border: rgba(255, 255, 255, 0.14);
        --ds-floating-shadow: 0 16px 50px rgba(0, 0, 0, 0.7);
        --ds-focus-ring: rgba(0, 212, 255, 0.5);

        --ds-nav-bg: rgba(10, 12, 18, 0.6);
        --ds-nav-border: rgba(255, 255, 255, 0.12);
        --ds-nav-shadow: 0 16px 50px rgba(0, 0, 0, 0.6);
        --ds-nav-hover-bg: rgba(255, 255, 255, 0.08);

        --ds-change-bg-error: rgba(248, 81, 73, 0.18);
        --ds-change-bg-warning: rgba(250, 173, 20, 0.18);
        --ds-change-bg-success: rgba(46, 160, 67, 0.2);

        --ds-code-bg: #0d1117;
        --ds-code-border: #30363d;
        --ds-code-inline-bg: #161b22;
        --ds-code-inline-border: #30363d;
        --ds-code-line-number: #8b949e;
        --ds-blockquote-border: #30363d;
        --ds-blockquote-text: #8b949e;

        --ds-code-text: #c9d1d9;
        --ds-code-comment: #8b949e;
        --ds-code-keyword: #ff7b72;
        --ds-code-string: #a5d6ff;
        --ds-code-number: #79c0ff;
        --ds-code-built-in: #d2a8ff;
        --ds-code-attr: #ffa657;
        --ds-code-title: #d2a8ff;
        --ds-code-meta: #a5d6ff;

        color-scheme: dark;
      }

      :root[data-theme='light'] {
        color-scheme: light;
      }

      html,
      body {
        background: var(--ds-page-bg);
        background-attachment: fixed;
        -webkit-font-smoothing: antialiased;
        text-rendering: geometricPrecision;
      }

      .ds-app-header {
        position: relative;
        overflow: hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        box-shadow: var(--ds-header-shadow);
      }
      .ds-app-header::before {
        content: '';
        position: absolute;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(700px circle at 18% 0%, rgba(0, 212, 255, 0.18), transparent 60%),
          radial-gradient(620px circle at 92% 10%, rgba(124, 58, 237, 0.14), transparent 62%);
        opacity: 0.55;
      }
      .ds-app-header[data-mode='chat']::before {
        background: radial-gradient(760px circle at 18% 0%, rgba(0, 212, 255, 0.22), transparent 62%),
          radial-gradient(520px circle at 92% 10%, rgba(0, 212, 255, 0.1), transparent 60%);
      }
      .ds-app-header[data-mode='cli']::before {
        background: radial-gradient(760px circle at 18% 0%, rgba(124, 58, 237, 0.18), transparent 62%),
          radial-gradient(520px circle at 92% 10%, rgba(124, 58, 237, 0.1), transparent 60%);
      }
      .ds-app-header[data-mode='apps']::before {
        background: radial-gradient(760px circle at 18% 0%, rgba(0, 255, 168, 0.18), transparent 62%),
          radial-gradient(520px circle at 92% 10%, rgba(0, 212, 255, 0.1), transparent 60%);
      }
      .ds-app-header > * {
        position: relative;
      }

      .ds-app-title {
        background: linear-gradient(90deg, var(--ds-accent), var(--ds-accent-2));
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
        letter-spacing: 0.6px;
      }

      .ds-nav-merged {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px;
        border-radius: 999px;
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 212, 255, 0.4), rgba(124, 58, 237, 0.28)) border-box;
        border: 1px solid transparent;
        box-shadow: var(--ds-nav-shadow);
        overflow: hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        color: rgba(15, 23, 42, 0.84);
      }
      :root[data-theme='dark'] .ds-nav-merged {
        color: rgba(255, 255, 255, 0.9);
      }
      .ds-nav-merged[data-mode='chat'] {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 212, 255, 0.55), rgba(0, 212, 255, 0.22)) border-box;
      }
      .ds-nav-merged[data-mode='cli'] {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(124, 58, 237, 0.5), rgba(124, 58, 237, 0.22)) border-box;
      }
      .ds-nav-merged[data-mode='apps'] {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 255, 168, 0.5), rgba(0, 212, 255, 0.22)) border-box;
      }

      .ds-nav-divider {
        width: 1px;
        height: 18px;
        background: rgba(15, 23, 42, 0.16);
        margin-inline: 4px;
      }
      :root[data-theme='dark'] .ds-nav-divider {
        background: rgba(255, 255, 255, 0.16);
      }

      .ds-seg.ant-segmented {
        background: transparent !important;
        padding: 0 !important;
        border-radius: 999px;
      }
      .ds-seg .ant-segmented-group {
        gap: 2px;
      }
      .ds-seg .ant-segmented-item {
        border-radius: 999px !important;
        transition: background 160ms ease, color 160ms ease;
      }
      .ds-seg .ant-segmented-item-label {
        padding: 0 12px !important;
        height: 34px;
        line-height: 34px;
        font-weight: 650;
        letter-spacing: 0.2px;
      }
      .ds-seg .ant-segmented-item:hover:not(.ant-segmented-item-selected) {
        background: var(--ds-nav-hover-bg) !important;
      }
      .ds-seg .ant-segmented-thumb {
        border-radius: 999px !important;
        border: 1px solid rgba(15, 23, 42, 0.14);
        background: rgba(15, 23, 42, 0.06);
        box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.06) inset;
      }
      :root[data-theme='dark'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.06);
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
      }

      .ds-nav-merged[data-mode='chat'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(0, 212, 255, 0.22);
        background: linear-gradient(90deg, rgba(0, 212, 255, 0.22), rgba(0, 212, 255, 0.08)) !important;
        box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.18) inset, 0 14px 36px rgba(0, 212, 255, 0.14);
      }
      .ds-nav-merged[data-mode='cli'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(124, 58, 237, 0.22);
        background: linear-gradient(90deg, rgba(124, 58, 237, 0.22), rgba(124, 58, 237, 0.08)) !important;
        box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.18) inset, 0 14px 36px rgba(124, 58, 237, 0.14);
      }
      .ds-nav-merged[data-mode='apps'] .ds-seg .ant-segmented-thumb {
        border-color: rgba(0, 255, 168, 0.22);
        background: linear-gradient(90deg, rgba(0, 255, 168, 0.24), rgba(0, 255, 168, 0.08)) !important;
        box-shadow: 0 0 0 1px rgba(0, 255, 168, 0.18) inset, 0 14px 36px rgba(0, 255, 168, 0.14);
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal {
        background: linear-gradient(var(--ds-nav-bg), var(--ds-nav-bg)) padding-box,
          linear-gradient(90deg, rgba(0, 212, 255, 0.4), rgba(124, 58, 237, 0.28)) border-box !important;
        border: 1px solid transparent !important;
        box-shadow: var(--ds-nav-shadow);
        border-radius: 999px;
        padding: 4px;
        overflow: hidden;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }

      .ds-nav.ant-menu-horizontal > .ant-menu-item,
      .ds-nav.ant-menu-horizontal > .ant-menu-submenu {
        border-radius: 999px;
        margin: 0 2px;
        padding-inline: 14px;
        transition: background 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu {
        height: 34px;
        line-height: 34px;
        padding-inline: 12px;
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group {
        pointer-events: none;
        cursor: default;
        opacity: 1 !important;
        font-weight: 650;
        letter-spacing: 0.4px;
        padding-inline: 10px;
        background: transparent !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group:hover {
        background: transparent !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group.ds-menu-group-chat {
        color: var(--ds-accent) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group.ds-menu-group-cli {
        color: var(--ds-accent-2) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-menu-group.ds-menu-group-app {
        color: var(--ds-accent-app) !important;
      }

      .ds-nav.ant-menu-horizontal .ant-menu-item-divider {
        width: 1px;
        height: 18px;
        background: rgba(15, 23, 42, 0.16);
        margin-inline: 6px;
        margin-block: 8px;
      }
      :root[data-theme='dark'] .ds-nav.ant-menu-horizontal .ant-menu-item-divider {
        background: rgba(255, 255, 255, 0.16);
      }

      .ds-nav.ant-menu-horizontal > .ant-menu-item::after,
      .ds-nav.ant-menu-horizontal > .ant-menu-submenu::after {
        border-bottom: none !important;
      }

      .ds-nav.ant-menu-horizontal > .ant-menu-item:hover,
      .ds-nav.ant-menu-horizontal > .ant-menu-submenu:hover {
        background: var(--ds-nav-hover-bg) !important;
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-chat:hover {
        background: rgba(0, 212, 255, 0.1) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-cli:hover {
        background: rgba(124, 58, 237, 0.1) !important;
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-app:hover {
        background: rgba(0, 255, 168, 0.12) !important;
      }

      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-chat.ant-menu-item-selected,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-chat.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 212, 255, 0.18), rgba(0, 212, 255, 0.06)) !important;
        box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.22) inset, 0 14px 36px rgba(0, 212, 255, 0.12);
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-cli.ant-menu-item-selected,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-cli.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(124, 58, 237, 0.18), rgba(124, 58, 237, 0.06)) !important;
        box-shadow: 0 0 0 1px rgba(124, 58, 237, 0.22) inset, 0 14px 36px rgba(124, 58, 237, 0.12);
      }
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-app.ant-menu-item-selected,
      .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-app.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 255, 168, 0.2), rgba(0, 255, 168, 0.06)) !important;
        box-shadow: 0 0 0 1px rgba(0, 255, 168, 0.22) inset, 0 14px 36px rgba(0, 255, 168, 0.12);
      }
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-chat.ant-menu-item-selected,
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-chat.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 212, 255, 0.24), rgba(0, 212, 255, 0.12)) !important;
        box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.26) inset, 0 18px 46px rgba(0, 212, 255, 0.14);
      }
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-cli.ant-menu-item-selected,
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-cli.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(168, 85, 247, 0.24), rgba(168, 85, 247, 0.12)) !important;
        box-shadow: 0 0 0 1px rgba(168, 85, 247, 0.26) inset, 0 18px 46px rgba(168, 85, 247, 0.14);
      }
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-item.ds-item-app.ant-menu-item-selected,
      :root[data-theme='dark'] .ds-nav.ds-nav-main.ant-menu-horizontal > .ant-menu-submenu.ds-item-app.ant-menu-submenu-selected {
        background: linear-gradient(90deg, rgba(0, 255, 168, 0.26), rgba(0, 255, 168, 0.12)) !important;
        box-shadow: 0 0 0 1px rgba(0, 255, 168, 0.26) inset, 0 18px 46px rgba(0, 255, 168, 0.14);
      }

      .ds-icon-button.ant-btn {
        border: 1px solid var(--ds-nav-border);
        background: var(--ds-nav-bg);
        box-shadow: var(--ds-nav-shadow);
        transition: transform 160ms ease, box-shadow 160ms ease;
      }
      .ds-icon-button.ant-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 0 0 3px var(--ds-focus-ring), var(--ds-nav-shadow);
      }

      .ant-card {
        background: var(--ds-panel-bg);
        border-color: var(--ds-panel-border);
        box-shadow: var(--ds-panel-shadow);
      }

      *::-webkit-scrollbar {
        width: 10px;
        height: 10px;
      }
      *::-webkit-scrollbar-thumb {
        background: rgba(15, 23, 42, 0.22);
        border-radius: 999px;
        border: 2px solid transparent;
        background-clip: content-box;
      }
      :root[data-theme='dark'] *::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.16);
        border: 2px solid transparent;
        background-clip: content-box;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: rgba(0, 212, 255, 0.28);
      }
      *::-webkit-scrollbar-corner {
        background: transparent;
      }

      /* highlight.js (minimal, themeable) */
      .hljs {
        color: var(--ds-code-text);
      }
      .hljs-comment,
      .hljs-quote {
        color: var(--ds-code-comment);
      }
      .hljs-keyword,
      .hljs-selector-tag,
      .hljs-subst {
        color: var(--ds-code-keyword);
      }
      .hljs-string,
      .hljs-doctag {
        color: var(--ds-code-string);
      }
      .hljs-title,
      .hljs-section,
      .hljs-selector-id {
        color: var(--ds-code-title);
      }
      .hljs-number,
      .hljs-literal,
      .hljs-symbol,
      .hljs-bullet {
        color: var(--ds-code-number);
      }
      .hljs-built_in,
      .hljs-builtin-name {
        color: var(--ds-code-built-in);
      }
      .hljs-attr,
      .hljs-attribute,
      .hljs-variable,
      .hljs-template-variable,
      .hljs-type,
      .hljs-selector-class {
        color: var(--ds-code-attr);
      }
      .hljs-meta,
      .hljs-meta-string {
        color: var(--ds-code-meta);
      }
      .hljs-emphasis {
        font-style: italic;
      }
      .hljs-strong {
        font-weight: 600;
      }
      .hljs-link {
        text-decoration: underline;
      }

      .ds-workspace-tree .ant-tree-node-content-wrapper,
      .ds-workspace-tree .ant-tree-title {
        white-space: nowrap;
      }

      .ds-floating-island {
        position: fixed;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        /* Ensure draggable items can be dropped onto the island even when antd Drawer/Modal masks are visible. */
        z-index: 1200;
        width: calc(100vw - 24px);
        max-width: 2000px;
        pointer-events: none;
      }
      .ds-floating-island-inner {
        pointer-events: auto;
        background: var(--ds-floating-bg);
        border: 1px solid var(--ds-floating-border);
        border-radius: 22px;
        box-shadow: var(--ds-floating-shadow);
        padding: 16px 18px;
        backdrop-filter: blur(10px);
        width: 100%;
        transition: padding 180ms ease, border-radius 180ms ease;
      }
      .ds-floating-island-inner.is-drag-over {
        border-color: var(--ds-focus-ring);
        box-shadow: 0 0 0 3px rgba(22, 119, 255, 0.2), var(--ds-floating-shadow);
      }
      .ds-floating-island-inner.is-collapsed {
        padding: 10px 14px;
        border-radius: 999px;
      }
      .ds-floating-island-handle {
        cursor: pointer;
        user-select: none;
        width: 100%;
      }
      .ds-floating-island-handle:focus-visible {
        outline: 2px solid var(--ds-focus-ring);
        outline-offset: 2px;
        border-radius: 999px;
      }
      .ds-floating-island-inner .ant-space-vertical,
      .ds-floating-island-inner .ant-space-vertical > .ant-space-item {
        width: 100%;
      }
      .ds-floating-island .ant-select-selector,
      .ds-floating-island .ant-input-affix-wrapper,
      .ds-floating-island .ant-input {
        border-radius: 16px !important;
      }
      .ds-floating-island .ant-input-textarea,
      .ds-floating-island .ant-input-textarea textarea.ant-input,
      .ds-floating-island .ds-dispatch-input,
      .ds-floating-island .ds-dispatch-input textarea.ant-input {
        width: 100% !important;
      }
      .ds-floating-island textarea.ant-input {
        resize: none;
      }
${extra}
    `}</style>
  );
}
