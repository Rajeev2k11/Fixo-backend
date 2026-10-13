import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests run against the docker-compose Postgres (`docker compose up -d --wait`).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int-spec.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    env: { LOG_LEVEL: 'silent' },
  },
});
