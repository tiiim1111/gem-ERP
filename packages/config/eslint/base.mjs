// GEM ERP shared ESLint flat config (ESLint 9 + typescript-eslint 8).
//
// Deliberately pragmatic: non-type-checked recommended rules so linting stays
// fast and never fails on generated code (Prisma client, OpenAPI clients,
// Next.js build artifacts). Correctness beyond this is the typechecker's job
// (`pnpm typecheck`), formatting is Prettier's job.
//
// Root eslint.config.mjs re-exports this config; ESLint 9 resolves the root
// config for every workspace package, so packages only need their own
// eslint.config.mjs if they add app-specific plugins (e.g. eslint-config-next).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/generated/**',
      '**/*.min.*',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Plain JS config files (next.config.js, jest.config.cjs, ...) may use require().
    files: ['**/*.{js,cjs,mjs,jsx}'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Must stay last: disables stylistic rules that would fight Prettier.
  prettier,
);
