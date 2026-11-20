// Review-only: type-aware promise rules the project config does not enable.
//   npx eslint --no-config-lookup -c docs/review/2026-11-19/evidence/quality-stage7/eslint.promises.config.js 'src/**/*.{ts,tsx}' --ignore-pattern 'src/**/*.test.*' --ignore-pattern 'src/test/**'
import tseslint from 'typescript-eslint'

export default tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { project: './tsconfig.app.json', tsconfigRootDir: process.cwd() },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
  },
})
