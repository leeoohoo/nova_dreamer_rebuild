import React from 'react';

import { GlobalStyles as BaseGlobalStyles } from '../../../../src/common/aide-ui/components/GlobalStyles.jsx';

const EXTRA_CSS = `
      .ds-seg .ant-segmented-group {
        flex-wrap: nowrap;
      }
      .ds-ui-app-header-slot:empty {
        display: none;
      }
      .ds-ui-app-header-slot {
        padding: 12px 14px;
        border-bottom: 1px solid var(--ds-panel-border);
      }

      .ds-ui-prompts-fab {
        position: fixed;
        right: 18px;
        bottom: 18px;
        z-index: 1304;
        pointer-events: auto;
      }
      .ds-ui-prompts-button.ant-btn {
        width: 52px;
        height: 52px;
        border-radius: 999px !important;
        border: 1px solid var(--ds-floating-border);
        background: linear-gradient(135deg, rgba(0, 212, 255, 0.22), rgba(124, 58, 237, 0.16));
        box-shadow: var(--ds-floating-shadow);
        backdrop-filter: blur(10px);
        transition: transform 140ms ease, box-shadow 140ms ease;
      }
      :root[data-theme='dark'] .ds-ui-prompts-button.ant-btn {
        background: linear-gradient(135deg, rgba(0, 212, 255, 0.18), rgba(168, 85, 247, 0.16));
      }
      .ds-ui-prompts-button.ant-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 18px 54px rgba(15, 23, 42, 0.18);
      }
      :root[data-theme='dark'] .ds-ui-prompts-button.ant-btn:hover {
        box-shadow: 0 18px 54px rgba(0, 0, 0, 0.8);
      }
      .ds-ui-prompts-button.ant-btn:focus-visible {
        outline: 2px solid var(--ds-focus-ring);
        outline-offset: 2px;
      }
    `;

export function GlobalStyles() {
  return <BaseGlobalStyles extraCss={EXTRA_CSS} />;
}
