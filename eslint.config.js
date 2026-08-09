const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const prettierConfig = require('eslint-config-prettier/flat');

module.exports = defineConfig([
  globalIgnores(['**/dist/**', '.mobile-agent/**']),
  expoConfig,
  {
    settings: {
      'import/resolver': {
        typescript: {
          extensions: [
            '.ios.tsx',
            '.android.tsx',
            '.ios.ts',
            '.android.ts',
            '.native.tsx',
            '.native.ts',
            '.tsx',
            '.ts',
            '.jsx',
            '.js',
          ],
          project: './tsconfig.json',
        },
      },
    },
  },
  prettierConfig,
]);
