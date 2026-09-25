# JEV Geo Race — 状態メモ

## 決定事項（根拠）
- **構成**: Vite + React + TS の静的 SPA → GitHub Pages（`.github/workflows/pages.yml`、`base: './'`）。
- **JEV**: `POST https://ai-gateway.vercel.sh/v1/evaluate` / model `typesafe-ai/jev` / `Authorization: Bearer`。
  AI Gateway は CORS 許可済み（preflight 実測）→ ブラウザから直接呼ぶ。choice 最大 255 候補、state 32k tokens。
- **認証**: 本番 = ユーザーが設定画面で入力したキー（localStorage または sessionStorage）。
  開発 = `.env` の `AI_GATEWAY_API_KEY` を Vite dev proxy `/dev-jev` がサーバー側で付与（バンドルに入らない）。
- **429/503 多発**: Limiter(3) + `retry-after`/`x-should-retry` 準拠の指数バックオフ（最大 8 回）。
  最終失敗時は代打ちせずレース一時停止 →「再試行」。
- **MediaWiki**: `origin=*` + `Api-User-Agent`、同時 4 接続、maxlag=5。
  合法手 = parse HTML 本文の `/wiki/` リンク − 除外 class（navbox, reference, hatnote 等）− 脚注/外部リンク節 − 名前空間 − 赤リンク。
  `mw-redirect` のみ query で正規化。ルールは `src/lib/wiki/rules.ts` に一元化（Reader と共有）。
- **候補過多**: 候補+BACK ≤ flatLimit(200) なら一括 Choice、超えたら セクション→リンク の2段階（255 超の節は文書順分割）。
  候補の並べ替え・絞り込みは一切しない（文書順）。
- **Worker**: `src/worker/race.worker.ts` で Wikipedia 取得・HTML 解析(htmlparser2)・JEV 呼び出し・レース進行。
  Reader の表示（DOMPurify）のみメインスレッド。レース中の最大フレーム間隔 17ms を実測。
- **ルール細部**: 同ターン GOAL は同順位。全員 GOAL/DNF まで継続（打ち切りボタンあり）。強制 BACK はターン開始時に無料実行。
- **保存**: IndexedDB（runners / races / memories / settings）。キーのみ Web Storage。
- **地図**: MapLibre GL JS + 地理院地図 Vector（最適化ベクトルタイル・標準地図スタイル。PMTiles 指定を XYZ に差し替え）。
  淡色スタイルは最適化ベクトルタイル用が未提供のため標準のみ。日本国外は背景が空になる。
- **GOAL 判定**: 記事座標の dim（対象のおおよその大きさ）がゴール半径を超える記事は GOAL 対象外（広域記事対策、ユーザー決定）。
- **ZDR**: Vercel Hobby では zeroDataRetention 指定が 403 になるため指定しない。

## 実装済み（Vertical Slice）
ゴール設定（記事/地図/ランダム）、スタート（各自ランダム/全員同一/手動）、複数 Runner、Personality プリセット、
半同期ターン、Human Reader（選択→決定の2段階、スマホ対応）、BACK/強制BACK/DNF、Step/Auto/速度/Fast、
結果画面（順位・予想 HIT/MISS・ルート・BACK 使用）、Replay（1x/2x/4x）、レース履歴、モック JEV。

## 実測
- 実 JEV: 1 呼び出し約 0.5 秒・約 $0.00002。レスポンス形式は想定通り（choice / probabilities / confidence）。
- レースは短め（有名ゴール 3 ターン前後、ランダム 3〜13 ターン）。429 時は retry-after 30〜55 秒の待機が入る。

## 次の作業
GitHub issues で管理（jumboly/wikipedia-geo-runner）。

## テスト
- `npm test`: リンク抽出（実データ fixture）とルールのユニットテスト
- `node e2e/mock-race.mjs` / `node e2e/human-mobile.mjs`: dev server 起動中に実行（`APP_URL`・`SHOT` 環境変数）
