import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      src: resolve(__dirname, './src'),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit-chromium',
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [
              {
                browser: 'chromium',
              },
            ],
            headless: true,
          },
          include: ['src/**/*.spec.ts'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],
  },
  optimizeDeps: {
    include: [
      'pixi.js',
      'gl-transitions',
      'wrapbox',
      'opfs-tools',
      'microdiff',
      'wave-resampler',
    ],
  },
});
