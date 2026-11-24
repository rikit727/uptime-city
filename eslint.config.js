import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The simulation must stay pure: no Three.js, DOM, UI, render or platform code.
    files: ['src/sim/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['three', 'three/*'], message: 'src/sim must not import Three.js.' },
            {
              group: ['**/render/**', '**/ui/**', '**/platform/**', '**/app/**'],
              message: 'src/sim must not depend on render, ui, platform or app code.',
            },
          ],
        },
      ],
    },
  },
  {
    // The UI talks to the sim through commands only; it must not import Three.js.
    files: ['src/ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['three', 'three/*'], message: 'src/ui is HTML/CSS only.' }] },
      ],
    },
  },
  prettier,
);
