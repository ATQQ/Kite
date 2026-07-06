import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig(({ command }) => ({
  plugins: [vue()],
  base: command === 'build' ? '/__KITE_BASE__/' : '/',
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === 'js') {
        return { runtime: `window.__kiteAsset(${JSON.stringify(filename)})` }
      }
      return { relative: false }
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    port: 5429,
    proxy: {
      '/api/terminal/ws': {
        target: 'ws://localhost:5430',
        ws: true,
        changeOrigin: true,
      },
      '/api': {
        target: 'http://localhost:5430',
        changeOrigin: true
      }
    }
  }
}))
