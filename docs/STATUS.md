# JEV Geo Race — 状態メモ

## 決定事項（根拠）
- **構成**: Vite + React + TS の静的 SPA → GitHub Pages（`.github/workflows/pages.yml`、`base: './'`）。
- **JEV の経路**: 本番（Pages 版）は AI Gateway 経由のみ。TypeSafe 直接は**開発時のみ**（ユーザー決定 2026-09-25）。
  choice 最大 255 候補、state 32k tokens。
  - AI Gateway 経由: `https://ai-gateway.vercel.sh/v1/evaluate`。CORS 許可済み → ブラウザからユーザーのキーで直接呼ぶ。
  - TypeSafe 直接: `https://api.typesafe.ai/v1/systemone`。CORS 不可 → dev server の `/dev-jev/typesafe` 経由でだけ呼ぶ。
    経路は開発モードの設定画面でのみ選べ、TypeSafe のキーはブラウザに保存しない（.env のみ）。CLI は `--route`。料金は返らないので概算表示。
- **認証**: 本番 = ユーザーが設定画面で入力した AI Gateway のキー（localStorage または sessionStorage）。
  開発 = `.env` の `AI_GATEWAY_API_KEY` / `TYPESAFE_API_KEY` を jev-client の `jevDevProxy`（`/dev-jev/gateway`・`/dev-jev/typesafe`）が
  サーバー側で付与（バンドルに入らない。localhost 以外の Origin は 403）。
- **JEV クライアント**: 独立リポジトリ `jumboly/jev-client`（`github:jumboly/jev-client#v0.2.0` で依存）。使い方と実測結果は同 README が正本。
  汎用的な JEV の知識はユーザースキル `j-jev`（`~/src/cc-jumboly/skills/j-jev/` → `~/.claude/skills/j-jev/`）。
- **429/503 対策**: 経路ごとに全 JEV 呼び出しで共有する `JevGate`（jev-client の `defaultGates`）。
  1 件失敗したら全員で共有待機、失敗で同時実行数半減→成功で回復、1 呼び出し 20 秒で打ち切り。
  回数上限は**既定 auto = 上限なし**。429 が出た時だけ直近 1 分の成功数から上限を推定してペースを落とし、
  429 が止めば 1 分ごとに 25% 緩めて上限なしへ戻す（設定で固定値も可）。最大 20 回試行後は代打ちせず一時停止。
- **JEV エラー傾向の実測**（2026-09-25 時点・JEV 公開直後の混雑による**一時的な値**。恒久仕様として扱わない。
  再計測は `npm run probe -- --mode gateway|typesafe`）:
  - 429 = 毎分約 30 回の上限超過（retry-after は次の分の区切りまで）。503/500 = 上流障害で数秒単位で連続。
  - 応答なしで固まる呼び出しあり。成功時の遅延は中央値 0.34 秒。
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

## エンジン単独実行（CLI）と判断役の差し替え
- 判断役は jev-client の `Evaluator`。`jev` / `mock` / `replay`（録画再生）を `withFallback` で連結できる。
  手ごとに判断元（`MoveRecord.source`）を記録し、JEV 以外が混ざったレースは正式扱いしない。本番（Pages 版）は jev 単体。
- `npm run race -- --goal 大阪城 --runners 4`（既定 `--jev live --route gateway --fallback replay,mock`）。成功した JEV 回答は
  `.cache/jev-recordings.json` に録画、Wikipedia 応答は `.cache/wiki/` にキャッシュ。
  `--jev replay` はキャッシュと録画だけで同じレースを完全再現（ネット不要）。`--jev mock` はダミー。
- Claude などの他 AI による代打は使わない（要件「AI は JEV のみ」、ユーザー決定 2026-09-25）。

## テスト
- `npm test`: リンク抽出（実データ fixture）・ルール・ヘッドレス結合テスト（架空リンク網で代替/録画再生を検証）
- `node e2e/mock-race.mjs` / `node e2e/human-mobile.mjs`: dev server 起動中に実行（`APP_URL`・`SHOT` 環境変数。
  mock-race は `REAL=1` で実 JEV、`ROUTE=typesafe` で TypeSafe 直接）
