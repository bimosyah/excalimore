import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: './tests/setup.ts',
    // All test files share the same testcontainers Postgres.
    // Run everything in a single forked process serially so afterEach
    // cleanup in one file cannot race with another file's setup.
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    fileParallelism: false,
    sequence: { concurrent: false },
  },
})
