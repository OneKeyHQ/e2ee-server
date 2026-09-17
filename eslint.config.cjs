const js = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const prettier = require('eslint-config-prettier');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = defineConfig([
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**'] },
  {
    files: ['packages/*/{src,test}/**/*.ts', 'examples/*/{src,test}/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended, prettier],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    files: ['**/test/**/*.ts'],
    languageOptions: { globals: globals.jest },
  },
]);
