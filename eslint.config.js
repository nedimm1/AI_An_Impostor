// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    /*
     * The Expo config describes the app, which runs in React Native. The
     * server and the scripts run in Node — `__dirname`, `Buffer`, `process`
     * and `fetch` are all real there — and the tests run in Jest. Without
     * this every one of those was a `no-undef`, which is a lint run nobody
     * reads and so a lint run that catches nothing.
     */
    files: ['server/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        module: 'writable',
        process: 'readonly',
        require: 'readonly',
        setTimeout: 'readonly',
        // Jest, for the two test files that sit beside the code they test.
        describe: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        test: 'readonly',
        it: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
  },
  {
    ignores: ['dist/*'],
  },
]);
