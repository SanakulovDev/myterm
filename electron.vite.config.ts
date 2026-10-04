import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // Test hooks (window.__myterm, MYTERM_DEBUG) exist only in `electron-vite
  // dev` and in builds made with MYTERM_TEST_HOOKS=1 (npm run test:e2e).
  // Production builds compile them out; scripts/check-release.mjs verifies it.
  const testHooks = mode === 'development' || process.env.MYTERM_TEST_HOOKS === '1'
  const define = { __MYTERM_TEST_HOOKS__: JSON.stringify(testHooks) }

  return {
    main: {
      define,
      plugins: [externalizeDepsPlugin()],
      build: {
        rollupOptions: {
          external: ['node-pty']
        }
      }
    },
    preload: {
      define,
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      define,
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          '@shared': resolve('src/shared')
        }
      },
      plugins: [react()]
    }
  }
})
