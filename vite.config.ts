import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  // 第3引数 '' で VITE_ 以外も読む。値は dev server プロセス内でのみ使い、
  // define 等でクライアントへ渡さないことでバンドルへの混入を防ぐ。
  const env = loadEnv(mode, process.cwd(), '')
  const devKey = env.AI_GATEWAY_API_KEY
  return {
    // GitHub Pages はリポジトリ名のサブパスで配信されるため相対 base にする
    base: './',
    plugins: [react()],
    worker: { format: 'es' },
    server: {
      proxy: {
        '/dev-jev': {
          target: 'https://ai-gateway.vercel.sh',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/dev-jev/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (req) => {
              if (devKey) req.setHeader('Authorization', `Bearer ${devKey}`)
            })
          },
        },
      },
    },
    test: { include: ['tests/**/*.test.ts', 'packages/*/test/**/*.test.ts'] },
  }
})
