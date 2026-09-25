import { useState } from 'react'
import { clearApiKey, loadApiKey, saveApiKey, type KeyStorage } from '../storage/apiKey'

export interface AppSettings {
  lang: string
  useMock: boolean
  maxTurns: number
  backLimit: number
  radiusKm: number
  startMinKm: number
  startMaxKm: number
  choiceMode: 'argmax' | 'sample'
  flatLimit: number
  regionId: string
  autoIntervalMs: number
  /** JEV の 1 分あたり呼び出し上限。0 = 自動（429 発生時のみ学習して抑え、止めば徐々に解除） */
  jevRatePerMin: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  lang: 'ja',
  useMock: false,
  maxTurns: 30,
  backLimit: 3,
  radiusKm: 2,
  startMinKm: 30,
  startMaxKm: 300,
  choiceMode: 'argmax',
  flatLimit: 200,
  regionId: 'japan',
  autoIntervalMs: 1500,
  jevRatePerMin: 0,
}

interface Props {
  settings: AppSettings
  onChange: (s: AppSettings) => void
}

export function SettingsView({ settings: s, onChange }: Props) {
  const [stored, setStored] = useState(loadApiKey())
  const [key, setKey] = useState('')
  const [where, setWhere] = useState<KeyStorage>('local')
  const num = (k: keyof AppSettings) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...s, [k]: Number(e.target.value) })

  return (
    <div className="page narrow">
      <h2>設定</h2>
      <section className="card">
        <h3>Vercel AI Gateway API キー</h3>
        <p className="small muted">
          JEV (typesafe-ai/jev) は Vercel AI Gateway 経由で呼び出します。キーはこのブラウザ内にのみ保存され、AI Gateway
          以外には送信されません。共用 PC では「このタブのみ」を選ぶか、使用後に削除してください。
          キーには AI Gateway の予算上限を設定しておくことを推奨します。
        </p>
        {stored ? (
          <div className="row wrap">
            <span>
              保存済み: <code>{stored.key.slice(0, 6)}…{stored.key.slice(-4)}</code>（{stored.storage === 'local' ? 'このブラウザ' : 'このタブのみ'}）
            </span>
            <button
              className="danger"
              onClick={() => {
                clearApiKey()
                setStored(null)
              }}
            >
              削除
            </button>
          </div>
        ) : (
          <>
            <input type="password" autoComplete="off" placeholder="AI Gateway API key" value={key} onChange={(e) => setKey(e.target.value)} />
            <div className="row wrap">
              <label className="inline">
                <input type="radio" checked={where === 'local'} onChange={() => setWhere('local')} /> このブラウザに保存
              </label>
              <label className="inline">
                <input type="radio" checked={where === 'session'} onChange={() => setWhere('session')} /> このタブのみ
              </label>
              <button
                className="primary"
                disabled={!key.trim()}
                onClick={() => {
                  saveApiKey(key, where)
                  setKey('')
                  setStored(loadApiKey())
                }}
              >
                保存
              </button>
            </div>
            {import.meta.env.DEV && <p className="small muted">開発モード: キー未入力時は .env の AI_GATEWAY_API_KEY を dev proxy 経由で使用します。</p>}
          </>
        )}
        <label>
          JEV 呼び出し上限（回/分、0 = 自動）
          <input type="number" min={0} max={600} value={s.jevRatePerMin} onChange={num('jevRatePerMin')} />
          <span className="small muted">
            自動: 普段は上限なし。回数上限エラー（429）が出た時だけ送信ペースを落とし、収まれば徐々に元に戻します。
            数値を入れるとその回数に固定します。
          </span>
        </label>
        <label className="inline">
          <input type="checkbox" checked={s.useMock} onChange={(e) => onChange({ ...s, useMock: e.target.checked })} /> モック JEV（API を呼ばずランダムに選択。動作確認用）
        </label>
      </section>

      <section className="card grid2">
        <h3 className="span2">ゲーム既定値</h3>
        <label>
          Wikipedia 言語
          <select value={s.lang} onChange={(e) => onChange({ ...s, lang: e.target.value })}>
            <option value="ja">日本語 (ja)</option>
            <option value="en">English (en)</option>
          </select>
        </label>
        <label>
          最大ターン
          <input type="number" min={5} max={200} value={s.maxTurns} onChange={num('maxTurns')} />
        </label>
        <label>
          BACK 回数
          <input type="number" min={0} max={20} value={s.backLimit} onChange={num('backLimit')} />
        </label>
        <label>
          ゴール半径 (km)
          <input type="number" min={0.2} max={50} step={0.1} value={s.radiusKm} onChange={num('radiusKm')} />
        </label>
        <label>
          ランダムスタート 最小距離 (km)
          <input type="number" min={1} value={s.startMinKm} onChange={num('startMinKm')} />
        </label>
        <label>
          ランダムスタート 最大距離 (km)
          <input type="number" min={1} value={s.startMaxKm} onChange={num('startMaxKm')} />
        </label>
        <label>
          JEV の手の決め方
          <select value={s.choiceMode} onChange={(e) => onChange({ ...s, choiceMode: e.target.value as AppSettings['choiceMode'] })}>
            <option value="argmax">最有力の手（決定的）</option>
            <option value="sample">JEV の確率分布からサンプリング（揺らぎあり）</option>
          </select>
        </label>
        <label>
          一括 Choice の上限候補数（超えるとセクション→リンクの2段階）
          <input type="number" min={10} max={255} value={s.flatLimit} onChange={num('flatLimit')} />
        </label>
      </section>
    </div>
  )
}
