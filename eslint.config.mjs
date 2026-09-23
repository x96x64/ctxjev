import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // examples/eval-tasks holds deliberately buggy throwaway repos, not project code.
  { ignores: ['**/dist/**', '**/node_modules/**', '.claude/**', 'examples/eval-tasks/*/template/**', 'examples/eval-tasks/*/solution/**', 'examples/eval-tasks/*/hidden/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', URL: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
    },
  },
)
