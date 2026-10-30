import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react-x'
import tseslint from 'typescript-eslint'

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'artifacts/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
      'apps/mobile/.expo/**',
      '.claude/worktrees/**',
    ],
  },
  js.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'vue/multi-word-component-names': 'off' },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    // TODO(ts): C2 taşıması bitince kaldırılır; tiplenmemiş core dosyaları geçici olarak denetim dışıdır.
    files: ['packages/school-core/src/**/*.ts'],
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-nocheck': 'allow-with-description' }],
    },
  },
  prettier,
  {
    files: ['apps/mobile/**/*.{js,jsx,ts,tsx}'],
    plugins: { react },
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'react/no-missing-key': 'error', 'react/rules-of-hooks': 'error' },
  },
]
