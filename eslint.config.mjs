// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      // The web app is linted by its own config, which layers on the Next.js and React rules.
      'apps/web/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'error',
    },
  },
  {
    // Financial correctness guard rails for the domain core.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Float parsing is unsafe on the money path. Use Decimal.' },
        { name: 'parseInt', message: 'Use BigInt or Decimal on the money path.' },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'round',
          message: 'Use Decimal rounding with an explicit mode.',
        },
        {
          object: 'Math',
          property: 'floor',
          message: 'Use Decimal rounding with an explicit mode.',
        },
        {
          object: 'Math',
          property: 'ceil',
          message: 'Use Decimal rounding with an explicit mode.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'Non-deterministic. Financial calculations must be reproducible.',
        },
        {
          object: 'Number',
          property: 'parseFloat',
          message: 'Float parsing is unsafe on the money path.',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Inject the Clock port instead of reading the wall clock directly.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'Inject the Clock port instead of reading the wall clock directly.',
        },
      ],
    },
  },
  {
    // The Clock port is the single place the wall clock may be read; everything else injects it.
    files: ['packages/core/src/ports/clock.ts'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/vitest.config.ts', '**/*.config.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
