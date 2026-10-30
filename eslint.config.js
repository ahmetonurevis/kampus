import js from '@eslint/js'
import vue from 'eslint-plugin-vue'
import globals from 'globals'
import prettier from 'eslint-config-prettier'
import react from 'eslint-plugin-react-x'
import reactHooks from 'eslint-plugin-react-hooks'
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
  prettier,
  {
    files: ['apps/mobile/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: { 'react/no-missing-key': 'error', 'react/rules-of-hooks': 'error' },
  },
  {
    files: ['apps/web-react/**/*.{ts,tsx}'],
    ...react.configs['recommended-typescript'],
  },
  {
    files: ['apps/web-react/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // shadcn CLI çıktısı yalnız token ve erişilebilirlik için düzenlenir; üretim kalıbındaki
    // biçim uyarıları CLI güncellemesinde yeniden çıkmasın diye bu klasörde kapalıdır.
    files: ['apps/web-react/src/components/ui/**/*.tsx'],
    rules: {
      'react-x/no-array-index-key': 'off',
      'react-x/no-context-provider': 'off',
      'react-x/no-use-context': 'off',
    },
  },
]
