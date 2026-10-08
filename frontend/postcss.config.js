import { fileURLToPath } from 'node:url'

export default {
  plugins: {
    // Resolve the theme from this file, even when Vite is launched from the repo root.
    tailwindcss: { config: fileURLToPath(new URL('./tailwind.config.js', import.meta.url)) },
    autoprefixer: {},
  },
}
