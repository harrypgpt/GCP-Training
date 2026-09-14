import globals from 'globals';

import { baseConfig } from './index.js';

/**
 * React / Next.js additions on top of {@link baseConfig}.
 * The Next.js plugin rules themselves are wired in the web app's own
 * `eslint.config.mjs` (it ships with `eslint-config-next`).
 *
 * @type {import('eslint').Linter.Config[]}
 */
export const reactConfig = [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
];

export default reactConfig;
