import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // The Express CORS policy allows this frontend origin. Do not silently move
  // to another port: Firebase may work there while profile API calls are blocked.
  server: { port: 5173, strictPort: true },
  preview: { port: 5173, strictPort: true },
  test: {
    testTimeout: 15000,
    exclude: ['**/node_modules/**', '**/dist/**', 'test/market-api.test.mjs'],
  },
})
