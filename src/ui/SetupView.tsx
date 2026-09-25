import { useEffect, useMemo, useRef, useState } from 'react'
import { goalFromArticle, REGIONS } from '../engine/placement'
import type { Goal, RaceConfig } from '../engine/types'
import type { LatLon } from '../lib/geo/geo'
import { WikiClient } from '../lib/wiki/api'
import { getMemory, uid, type RunnerProfile } from '../storage/db'
import { MapView, RUNNER_COLORS } from './MapView'
import type { AppSettings } from './SettingsView'
import { setupApi } from './useRace'

interface Props {
  runners: RunnerProfile[]
  settings: AppSettings
  onStart: (config: RaceConfig, prediction: string | undefined) => void
}

type GoalMode = 'article' | 'map' | 'random'
type StartMode = 'random' | 'same' | 'manual'

export function SetupView({ runners, settings, onStart }: Props) {
  const lang = settings.lang
  const wiki = useMemo(() => new WikiClient(lang), [lang])
  const [goalMode, setGoalMode] = useState<GoalMode>('random')
  const [goal, setGoal] = useState<Goal | null>(null)
  const [radiusKm, setRadiusKm] = useState(settings.radiusKm)
  const [query, setQuery] = useState('')
  const [suggest, setSuggest] = useState<string[]>([])
  const [mapPoint, setMapPoint] = useState<LatLon | null>(null)
  const [mapName, setMapName] = useState('')
  const [regionId, setRegionId] = useState(settings.regionId)
  const [selected, setSelected] = useState<string[]>([])
  const [startMode, setStartMode] = useState<StartMode>('random')
  const [starts, setStarts] = useState<Record<string, string>>({})
  const [startCoords, setStartCoords] = useState<Record<string, LatLon>>({})
  const [manual, setManual] = useState<Record<string, string>>({})
  const [prediction, setPrediction] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // 初期選択は一度だけ。ユーザーが全解除した後に勝手に再選択しないため
  const initialized = useRef(false)
  useEffect(() => {
    if (initialized.current || !runners.length) return
    initialized.current = true
    setSelected(runners.filter((r) => r.kind === 'jev').slice(0, 4).map((r) => r.id))
  }, [runners])

  // 半径変更をゴールに反映
  useEffect(() => {
    setGoal((g) => (g ? { ...g, radiusM: radiusKm * 1000 } : g))
  }, [radiusKm])

  useEffect(() => {
    // 選択確定直後（入力欄がゴール記事名になった時）は候補を出し直さない
    if (goalMode !== 'article' || query.trim().length < 1 || query === goal?.anchorTitle) return setSuggest([])
    const t = setTimeout(() => wiki.searchTitles(query).then(setSuggest).catch(() => setSuggest([])), 250)
    return () => clearTimeout(t)
  }, [query, goalMode, wiki, goal?.anchorTitle])

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setErr(null)
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const changeGoal = (g: Goal) => {
    setGoal(g)
    setStarts({})
    setStartCoords({})
  }

  const pickArticle = (title: string) =>
    run('ゴール記事を確認中', async () => {
      const a = await setupApi.article(lang, title)
      if (!a.coord) throw new Error(`「${a.title}」は座標を持たない記事です`)
      changeGoal(goalFromArticle(a.title, a.coord, radiusKm * 1000))
      setSuggest([])
      setQuery(a.title)
    })

  const onMapClick = (p: LatLon) => {
    if (goalMode !== 'map') return
    setMapPoint(p)
    // JEV が理解できる名前を必ず持たせるため、最寄りの座標付き記事名を初期値として提案する
    wiki
      .geoSearch(p, 10000, 1)
      .then((h) => h[0] && setMapName(`${h[0].title}周辺`))
      .catch(() => {})
  }

  const selectedRunners = runners.filter((r) => selected.includes(r.id))

  const generateStarts = () =>
    run('スタート地点を生成中', async () => {
      if (!goal) throw new Error('先にゴールを設定してください')
      const out: Record<string, string> = {}
      if (startMode === 'manual') {
        for (const r of selectedRunners) {
          const t = manual[r.id]?.trim()
          if (!t) throw new Error(`${r.name} のスタート記事を入力してください`)
          out[r.id] = await setupApi.validateStart(lang, goal, t)
        }
      } else {
        const n = startMode === 'same' ? 1 : selectedRunners.length
        const titles = await setupApi.randomStarts(lang, goal, n, settings.startMinKm, settings.startMaxKm)
        selectedRunners.forEach((r, i) => (out[r.id] = titles[startMode === 'same' ? 0 : i]))
      }
      const coords: Record<string, LatLon> = {}
      for (const t of new Set(Object.values(out))) {
        const a = await setupApi.article(lang, t)
        if (a.coord) coords[t] = a.coord
      }
      setStarts(out)
      setStartCoords(coords)
    })

  const ready = goal && selectedRunners.length > 0 && selectedRunners.every((r) => starts[r.id])

  const start = async () => {
    if (!ready || !goal) return
    const entries = await Promise.all(
      selectedRunners.map(async (r) => ({
        runnerId: r.id,
        name: r.name,
        icon: r.icon,
        kind: r.kind,
        personality: r.personality,
        startTitle: starts[r.id],
        memory: await getMemory(r.id),
      })),
    )
    onStart(
      {
        id: uid(),
        createdAt: Date.now(),
        goal,
        entries,
        settings: {
          lang,
          maxTurns: settings.maxTurns,
          backLimit: settings.backLimit,
          choiceMode: settings.choiceMode,
          flatLimit: settings.flatLimit,
        },
      },
      prediction || undefined,
    )
  }

  const startMarkers = Object.entries(startCoords).map(([title, coord]) => ({ title, coord }))

  return (
    <div className="split">
      <div className="split-map">
        <MapView
          goal={goal ?? (mapPoint ? { name: mapName || '(未命名)', center: mapPoint, radiusM: radiusKm * 1000 } : null)}
          runners={[]}
          starts={startMarkers}
          onClick={onMapClick}
          fitKey={`${goal?.center.lat},${goal?.center.lon},${startMarkers.length}`}
        />
      </div>
      <div className="split-side page">
        <h2>レース作成</h2>
        <section className="card">
          <h3>① ゴール</h3>
          <div className="seg">
            {(['random', 'article', 'map'] as GoalMode[]).map((m) => (
              <button key={m} className={goalMode === m ? 'on' : ''} onClick={() => setGoalMode(m)}>
                {{ random: 'ランダム', article: '記事から', map: '地図から' }[m]}
              </button>
            ))}
          </div>
          {goalMode === 'random' && (
            <div className="row wrap">
              <select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
                {REGIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
              <button onClick={() => run('ランダムゴールを生成中', async () => changeGoal(await setupApi.randomGoal(lang, regionId, radiusKm * 1000)))}>
                🎲 ランダム生成
              </button>
            </div>
          )}
          {goalMode === 'article' && (
            <div className="suggest-wrap">
              <input placeholder="座標を持つ記事名（例: 大阪城）" value={query} onChange={(e) => setQuery(e.target.value)} />
              {suggest.length > 0 && (
                <ul className="suggest">
                  {suggest.map((s) => (
                    <li key={s} onClick={() => pickArticle(s)}>
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {goalMode === 'map' && (
            <div>
              <p className="small muted">地図をクリックして中心を指定し、JEV が理解できるゴール名を付けてください。</p>
              <div className="row wrap">
                <input placeholder="ゴール名（例: 大阪城周辺）" value={mapName} onChange={(e) => setMapName(e.target.value)} />
                <button disabled={!mapPoint || !mapName.trim()} onClick={() => mapPoint && changeGoal({ name: mapName.trim(), center: mapPoint, radiusM: radiusKm * 1000 })}>
                  決定
                </button>
              </div>
            </div>
          )}
          <label className="inline">
            半径
            <input type="number" className="num" min={0.2} max={50} step={0.1} value={radiusKm} onChange={(e) => setRadiusKm(Number(e.target.value))} /> km
          </label>
          {goal && (
            <p>
              🏁 <strong>{goal.name}</strong>（半径 {goal.radiusM / 1000}km）
            </p>
          )}
        </section>

        <section className="card">
          <h3>② 出走 Runner</h3>
          {runners.length === 0 && <p className="muted">Runners タブで Runner を登録してください。</p>}
          <div className="runner-picks">
            {runners.map((r) => (
              <label key={r.id} className="inline pick">
                <input
                  type="checkbox"
                  checked={selected.includes(r.id)}
                  onChange={(e) => {
                    setSelected(e.target.checked ? [...selected, r.id] : selected.filter((x) => x !== r.id))
                    setStarts({})
                  }}
                />
                {r.icon} {r.name} {r.kind === 'human' && <span className="tag">Human</span>}
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>③ スタート</h3>
          <div className="seg">
            {(['random', 'same', 'manual'] as StartMode[]).map((m) => (
              <button
                key={m}
                className={startMode === m ? 'on' : ''}
                onClick={() => {
                  setStartMode(m)
                  setStarts({})
                }}
              >
                {{ random: '各自ランダム', same: '全員同一', manual: '手動' }[m]}
              </button>
            ))}
          </div>
          {startMode === 'manual' &&
            selectedRunners.map((r) => (
              <label key={r.id}>
                {r.icon} {r.name}
                <input value={manual[r.id] ?? ''} placeholder="座標付き記事名" onChange={(e) => setManual({ ...manual, [r.id]: e.target.value })} />
              </label>
            ))}
          <button disabled={!goal || !selectedRunners.length} onClick={generateStarts}>
            {startMode === 'manual' ? 'スタートを確認' : '🎲 スタート生成'}
          </button>
          <ul className="small">
            {selectedRunners.map((r, i) =>
              starts[r.id] ? (
                <li key={r.id}>
                  <span style={{ color: RUNNER_COLORS[i % RUNNER_COLORS.length] }}>●</span> {r.icon} {r.name}: {starts[r.id]}
                </li>
              ) : null,
            )}
          </ul>
        </section>

        <section className="card">
          <h3>④ 勝者予想（任意）</h3>
          <select value={prediction} onChange={(e) => setPrediction(e.target.value)}>
            <option value="">予想しない</option>
            {selectedRunners.map((r) => (
              <option key={r.id} value={r.id}>
                {r.icon} {r.name}
              </option>
            ))}
          </select>
        </section>

        {busy && <p className="status">⏳ {busy}…</p>}
        {err && <p className="error">{err}</p>}
        <button className="primary big" disabled={!ready || !!busy} onClick={start}>
          🏁 レース開始
        </button>
      </div>
    </div>
  )
}
