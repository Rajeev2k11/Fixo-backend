import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // SWC instead of esbuild: Nest's dependency injection needs emitted decorator metadata.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.spec.ts', 'test/*.e2e-spec.ts'],
    environment: 'node',
    env: {
      LOG_LEVEL: 'silent',
      // Unit/e2e tests never need a database: point at a closed port so any accidental
      // query fails fast. Real-database tests live in test/integration.
      DATABASE_URL: 'postgres://unit:unit@127.0.0.1:1/unit',
      REDIS_URL: 'redis://127.0.0.1:1',
    },
  },
});
