import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      "/ws": {
        target: "http://localhost:8080",
        ws: true,
      },
    },
  },
})
