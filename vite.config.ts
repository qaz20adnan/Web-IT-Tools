import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { netlifyDevApi } from './scripts/dev-api-plugin'

export default defineConfig(({ command, mode }) => {
  // The Netlify Functions run in this Node process during `npm run dev`, so
  // they read process.env rather than import.meta.env. Copy .env values there
  // without ever exposing non-VITE_ keys to the browser bundle.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(fileEnv)) {
    if (process.env[key] === undefined) process.env[key] = value
  }

  // `npm run dev` uses the temporary file-backed auth provider unless the
  // developer explicitly opts out with NEXORA_LOCAL_AUTH=0. Production builds
  // never set this flag, so the server-side production guards stay authoritative.
  if (command === 'serve' && !process.env.NEXORA_LOCAL_AUTH) {
    process.env.NEXORA_LOCAL_AUTH = '1'
  }

  return {
    plugins: [react(), tailwindcss(), netlifyDevApi()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  }
})
