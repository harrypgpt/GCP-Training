import { baseConfig } from '@gcp/eslint-config';

/** @type {import('eslint').Linter.Config[]} */
export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // NestJS relies heavily on parameter decorators and DI classes.
      '@typescript-eslint/no-extraneous-class': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
  {
    ignores: ['dist/**', 'coverage/**', 'prisma/migrations/**'],
  },
];
