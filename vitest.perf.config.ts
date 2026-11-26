import { defineConfig } from 'vitest/config';

/** `npm run profile`: the sim profiler on a fully built map (tests/perf). */
export default defineConfig({
  test: {
    include: ['tests/perf/**/*.perf.ts'],
    environment: 'node',
    silent: false,
  },
});
