import { useCallback, useEffect, useRef, useState } from 'react'
import { computeResults } from './engine/rules'
import type { RaceSnapshot } from './engine/types'
import { resolveAuth } from './storage/apiKey'
import { getSetting, listRaces, listRunners, putSetting, requestPersistence, saveRace, saveRunner, uid, type RaceRecord, type RunnerProfile } from './storage/db'
import { DEFAULT_RUNNERS } from './ui/presets'
import { RaceView } from './ui/RaceView'
import { ResultView } from './ui/ResultView'
import { RunnersView } from './ui/RunnersView'
import { DEFAULT_SETTINGS, SettingsView, type AppSettings } from './ui/SettingsView'
import { SetupView } from './ui/SetupView'
import { useRace } from './ui/useRace'
import { BACK_KEY } from './engine/runnerAgent'
import { formatUsd } from './ui/JevMeter'

type Page = 'setup' | 'race' | 'result' | 'runners' | 'history' | 'settings'

let seeding: Promise<void> | null = null
/** 初回起動時はプリセット性格の Runner と Human を用意し、すぐ遊べるようにする。
 * StrictMode で effect が二重実行されても一度だけ登録されるようモジュールで保持する */
function seedRunners() {
  seeding ??= (async () => {
    if ((await listRunners()).length > 0) return
    const now = Date.now()
    for (const [i, r] of DEFAULT_RUNNERS.entries()) await saveRunner({ ...r, id: uid(), kind: 'jev', createdAt: now + i })
    await saveRunner({ id: uid(), name: 'あなた', icon: '🧑', kind: 'human', personality: '', createdAt: now + 99 })
  })()
  return seeding
}

export default function App() {
  const [page, setPage] = useState<Page>('setup')
  const [runners, setRunners] = useState<RunnerProfile[]>([])
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [races, setRaces] = useState<RaceRecord[]>([])
  const [result, setResult] = useState<RaceRecord | null>(null)
  const [authError, setAuthError] = useState(false)
  const prediction = useRef<string | undefined>(undefined)

  const reloadRunners = useCallback(async () => setRunners(await listRunners()), [])

  useEffect(() => {
    ;(async () => {
      requestPersistence()
      setSettings({ ...DEFAULT_SETTINGS, ...(await getSetting<Partial<AppSettings>>('app', {})) })
      await seedRunners()
      await reloadRunners()
      setRaces(await listRaces())
    })()
  }, [reloadRunners])

  const onFinished = useCallback(async (snapshot: RaceSnapshot) => {
    const record: RaceRecord = {
      id: snapshot.config.id,
      createdAt: snapshot.config.createdAt,
      snapshot,
      results: computeResults(snapshot),
      prediction: prediction.current,
    }
    await saveRace(record)
    setRaces(await listRaces())
    setResult(record)
    setPage('result')
  }, [])

  const race = useRace(onFinished)

  const updateSettings = (s: AppSettings) => {
    setSettings(s)
    putSetting('app', s)
  }

  const nav: [Page, string][] = [
    ['setup', '🏁 レース'],
    ['runners', '🏃 Runners'],
    ['history', '📜 履歴'],
    ['settings', '⚙ 設定'],
  ]

  return (
    <div className="app">
      <header>
        <h1>JEV Geo Race</h1>
        <nav>
          {race.snapshot && !race.finished && (
            <button className={page === 'race' ? 'on' : ''} onClick={() => setPage('race')}>
              ▶ 進行中
            </button>
          )}
          {nav.map(([p, l]) => (
            <button key={p} className={page === p ? 'on' : ''} onClick={() => setPage(p)}>
              {l}
            </button>
          ))}
        </nav>
      </header>
      {authError && (
        <div className="banner">
          JEV を使うには 設定 で Vercel AI Gateway API キーを入力してください（またはモック JEV を有効化）。
        </div>
      )}
      <main>
        {page === 'setup' && (
          <SetupView
            runners={runners}
            settings={settings}
            onStart={(config, pred) => {
              const needsJev = config.entries.some((e) => e.kind === 'jev')
              const auth = resolveAuth(settings.useMock)
              if (needsJev && !auth) {
                setAuthError(true)
                setPage('settings')
                return
              }
              setAuthError(false)
              prediction.current = pred
              race.setIntervalMs(settings.autoIntervalMs)
              race.start(config, auth ?? { mode: 'mock', avoidKeys: [BACK_KEY] }, settings.jevRatePerMin)
              setPage('race')
            }}
          />
        )}
        {page === 'race' && <RaceView race={race} />}
        {page === 'result' && result && <ResultView record={result} onBack={() => setPage('history')} />}
        {page === 'runners' && <RunnersView runners={runners} onChange={reloadRunners} />}
        {page === 'settings' && <SettingsView settings={settings} onChange={updateSettings} />}
        {page === 'history' && (
          <div className="page narrow">
            <h2>レース履歴</h2>
            {races.length > 0 && (
              <p className="small muted">
                累計 JEV コスト: {formatUsd(races.reduce((a, r) => a + (r.snapshot.jev?.costUsd ?? 0), 0))}（
                {races.reduce((a, r) => a + (r.snapshot.jev?.calls ?? 0), 0)} 回・{races.length} レース。AI Gateway の定価ベースの概算）
              </p>
            )}
            {races.length === 0 && <p className="muted">まだレースがありません。</p>}
            {races.map((r) => {
              const w = r.results.filter((x) => x.rank === 1).map((x) => r.snapshot.config.entries.find((e) => e.runnerId === x.runnerId))
              return (
                <div
                  key={r.id}
                  className="card clickable"
                  onClick={() => {
                    setResult(r)
                    setPage('result')
                  }}
                >
                  <div className="row between">
                    <b>🏁 {r.snapshot.config.goal.name}</b>
                    <span className="small muted">{new Date(r.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="small">
                    {r.snapshot.config.entries.map((e) => e.icon).join(' ')} ・ 勝者: {w.length ? w.map((e) => `${e?.icon} ${e?.name}`).join('、') : 'なし'} ・ {r.snapshot.turn}ターン{r.snapshot.jev ? ` ・ ${formatUsd(r.snapshot.jev.costUsd)}` : ''}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
