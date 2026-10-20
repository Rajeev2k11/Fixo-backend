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
      OTP_HMAC_SECRET: 'unit-test-secret-unit-test-secret-0000',
      JWT_SECRET: 'unit-test-jwt-secret-unit-test-jwt-0000',
      MFA_ENCRYPTION_KEY: 'a'.repeat(64),
      CORS_ORIGINS: 'http://localhost:8082',
    },
  },
});
