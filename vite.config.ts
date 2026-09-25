import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { jevDevProxy } from '@jumboly/jev-client/node'

export default defineConfig({
  // GitHub Pages はリポジトリ名のサブパスで配信されるため相対 base にする
  base: './',
  plugins: [
    react(),
    // 開発時のみ（vite build には入らない）。.env のキーをサーバー側で付けるのでバンドルにキーが入らず、
    // CORS 不可の typesafe 経路もブラウザから呼べる。キーが .env に無ければブラウザの Authorization を中継する
    jevDevProxy({ mode: 'gateway' }), // /dev-jev/gateway
    jevDevProxy({ mode: 'typesafe' }), // /dev-jev/typesafe
  ],
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
})
