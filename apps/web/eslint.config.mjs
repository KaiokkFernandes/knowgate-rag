// Extends the monorepo base config and adds the Next.js rules (React, hooks, a11y, Core Web Vitals).
import nextVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import { base } from '../../eslint.config.mjs';

const config = [
  ...nextVitals,
  ...base,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];

export default config;
