import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * Config separada so para scripts/smoke-osm.test.ts (SPEC 1.2 FASE 7): usa rede real,
 * entao fica fora do include de vitest.config.mts para nunca rodar dentro do `npm test`.
 *
 *   npm run smoke:osm
 */
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['scripts/**/*.test.ts'],
  },
});
