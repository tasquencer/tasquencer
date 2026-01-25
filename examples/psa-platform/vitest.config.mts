import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'edge-runtime',
    server: { deps: { inline: ['convex-test'] } },
    // Workflow integration tests require 30-60 seconds due to complex async operations
    // with fake timers and multiple rounds of scheduled function execution
    testTimeout: 60000,
  },
})
