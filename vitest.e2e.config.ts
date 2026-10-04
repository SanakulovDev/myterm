import { defineConfig } from 'vitest/config'

// End-to-end tests drive the test build of the app (out-e2e/, with test
// hooks compiled in); run with `npm run test:e2e`.
// They are not picked up by `npm test` (the default include is *.test.ts).
export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.e2e.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    fileParallelism: false
  }
})
