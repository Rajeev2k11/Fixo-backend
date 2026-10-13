import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Integration tests run against the docker-compose Postgres (`docker compose up -d --wait`).
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/integration/**/*.int-spec.ts'],
    environment: 'node',
    globalSetup: ['test/integration/global-setup.ts'],
    // All files share one test database (e.g. outbox tests truncate outbox_event, which config
    // tests write to), so files run one at a time.
    // ponytail: a database per file would allow parallelism if the suite gets slow.
    fileParallelism: false,
    env: { LOG_LEVEL: 'silent' },
  },
});
