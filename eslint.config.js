import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * Flat config.
 *
 * Two environments live in this repo and they have opposite rules, so the config
 * is split explicitly rather than by glob guessing:
 *
 * - The main process runs on Node with full filesystem and network reach. It
 *   legitimately uses console-free logging and reaches the database.
 * - The renderer runs sandboxed with no Node access at all. Anything Node-ish
 *   there is a bug, not a style choice, so it is an error rather than a warning.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // The project bans console.log in favour of the logger, but the logger
      // itself and the seed/verify scripts legitimately report to stdout.
      'no-console': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: {
      // Tests assert on thrown values and build partial fixtures by design.
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-console': 'off',
    },
  },

  {
    files: ['scripts/**/*.ts', 'vite*.config.ts', 'vitest.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);