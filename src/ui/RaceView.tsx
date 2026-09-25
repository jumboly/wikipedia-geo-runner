import { useEffect, useMemo, useState } from 'react'
import type { RaceSnapshot } from '../engine/types'
import { CostChip, GateBanner } from './JevMeter'
import { MapView, RUNNER_COLORS } from './MapView'
import { Reader } from './Reader'
import type { useRace } from './useRace'
import { mapRunnersAt, STEP_MARK } from './view'

type Race = ReturnType<typeof useRace>
type Tab = 'map' | 'reader' | 'log' | 'runners'

export function RaceView({ race }: { race: Race }) {
  const s = race.snapshot
  const humanIds = Object.keys(race.humans)
  const [tab, setTab] = useState<Tab>('log')
  const [humanSel, setHumanSel] = useState<string | null>(null)
  const activeHuman = race.humans[humanSel ?? ''] ?? race.humans[humanIds[0]]

  // Human の入力待ちになったら Reader を前面に出す
  useEffect(() => {
    if (humanIds.length) setTab('reader')
  }, [humanIds.length])

  const mapRunners = useMemo(() => (s ? mapRunnersAt(s) : []), [s])
  if (!s) return <div className="page">⏳ レース準備中（スタート記事を取得しています）…</div>

  const hasHuman = s.config.entries.some((e) => e.kind === 'human')
  const nameOf = (id: string) => s.config.entries.find((e) => e.runnerId === id)!
  const waiting = race.thinking.filter((id) => !race.humans[id])

  return (
    <div className="race">
      <div className="controls">
        <span className="turn">
          ターン {s.turn} / {s.config.settings.maxTurns}
        </span>
        <span className="goal-name">🏁 {s.config.goal.name}</span>
        <CostChip stats={s.jev} />
        {!hasHuman && !s.finished && (
          <>
            <button onClick={race.step} disabled={race.readyTurn == null || race.mode !== 'step'}>
              ⏭ Step
            </button>
            <button className={race.mode === 'auto' ? 'on' : ''} onClick={() => race.setMode(race.mode === 'auto' ? 'step' : 'auto')}>
              {race.mode === 'auto' ? '⏸ Pause' : '▶ Auto'}
            </button>
            <select value={race.intervalMs} onChange={(e) => race.setIntervalMs(Number(e.target.value))} title="再生速度">
              <option value={3000}>0.5x</option>
              <option value={1500}>1x</option>
              <option value={750}>2x</option>
              <option value={300}>4x</option>
            </select>
            <button className={race.mode === 'fast' ? 'on' : ''} onClick={() => race.setMode(race.mode === 'fast' ? 'step' : 'fast')}>
              ⏩ Fast
            </button>
          </>
        )}
        {!s.finished && (
          <button className="danger" onClick={() => confirm('レースを打ち切りますか？（走行中の Runner は DNF）') && race.stop()}>
            打ち切り
          </button>
        )}
      </div>
      <div className="status-line">
        {race.error ? (
          <span className="error">
            ⚠ {race.error.message}{' '}
            {race.error.recoverable && <button onClick={race.retry}>再試行</button>}
          </span>
        ) : race.status && !(race.gate && race.gate.cooldownUntil > Date.now()) ? (
          <span className="status">{race.status}</span>
        ) : waiting.length ? (
          <span className="muted">🤔 思考中: {waiting.map((id) => nameOf(id).name).join('、')}</span>
        ) : humanIds.length ? (
          <span className="status">🧑 Human の入力待ち</span>
        ) : race.readyTurn != null && !hasHuman ? (
          <span className="status">✅ ターン {race.readyTurn} の手が揃いました{race.mode === 'step' ? '（Step で公開）' : ''}</span>
        ) : null}
        {!race.error && <GateBanner gate={race.gate} />}
      </div>

      <div className="tabs mobile-only">
        {(['map', 'reader', 'log', 'runners'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} disabled={t === 'reader' && !activeHuman}>
            {{ map: '地図', reader: 'Reader', log: '実況', runners: 'Runner' }[t]}
          </button>
        ))}
      </div>

      <div className={`split tab-${tab}`}>
        <div className="split-map">
          <MapView goal={s.config.goal} runners={mapRunners} fitKey={s.config.id} />
        </div>
        <div className="split-side">
          <div className="tabs desktop-only">
            {(['reader', 'log', 'runners'] as Tab[]).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} disabled={t === 'reader' && !activeHuman}>
                {{ reader: 'Reader', log: '実況', runners: 'Runner', map: '' }[t]}
              </button>
            ))}
          </div>
          {tab === 'reader' && activeHuman && (
            <>
              {humanIds.length > 1 && (
                <div className="seg">
                  {humanIds.map((id) => (
                    <button key={id} className={activeHuman.runnerId === id ? 'on' : ''} onClick={() => setHumanSel(id)}>
                      {nameOf(id).icon} {nameOf(id).name}
                    </button>
                  ))}
                </div>
              )}
              <Reader
                key={activeHuman.runnerId + activeHuman.turn}
                prompt={activeHuman}
                lang={s.config.settings.lang}
                runnerName={nameOf(activeHuman.runnerId).name}
                onMove={(a) => race.humanMove(activeHuman.runnerId, a)}
              />
            </>
          )}
          {tab === 'reader' && !activeHuman && <p className="muted page">Human の入力待ちはありません。</p>}
          {(tab === 'log' || tab === 'map') && <TurnLog s={s} />}
          {tab === 'runners' && <RunnerBoard s={s} />}
        </div>
      </div>
    </div>
  )
}

function TurnLog({ s }: { s: RaceSnapshot }) {
  const e = (id: string) => s.config.entries.find((x) => x.runnerId === id)!
  const idx = (id: string) => s.config.entries.findIndex((x) => x.runnerId === id)
  return (
    <div className="log page">
      {[...s.turns].reverse().map((t) => (
        <div key={t.turn} className="log-turn">
          <div className="log-head">ターン {t.turn}</div>
          {t.moves.map((m) => (
            <div key={m.runnerId} className="log-move">
              <span style={{ color: RUNNER_COLORS[idx(m.runnerId) % RUNNER_COLORS.length] }}>●</span> {e(m.runnerId).icon} <b>{e(m.runnerId).name}</b>{' '}
              {m.forcedBacks.length > 0 && <span className="muted">⤺ 行き止まり救済: {m.forcedBacks.join(' ⤺ ')} ／ </span>}
              {m.action.type === 'back' ? `↩ BACK → ${m.to}` : `→ ${m.to}`}
              {t.goals.includes(m.runnerId) && <span className="goal-badge"> 🏁 GOAL!</span>}
              {m.probs && Object.keys(m.probs).length > 0 && (
                <div className="probs small muted">
                  {Object.entries(m.probs)
                    .map(([k, p]) => `${k} ${Math.round(p * 100)}%`)
                    .join(' ／ ')}
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
      {s.turns.length === 0 && <p className="muted">スタート: {s.runners.map((r) => `${e(r.runnerId).icon} ${r.current}`).join('、')}</p>}
    </div>
  )
}

export function RunnerBoard({ s }: { s: RaceSnapshot }) {
  return (
    <div className="page">
      {s.config.entries.map((e, i) => {
        const r = s.runners.find((x) => x.runnerId === e.runnerId)!
        return (
          <div key={e.runnerId} className="card">
            <div className="row between">
              <div>
                <span style={{ color: RUNNER_COLORS[i % RUNNER_COLORS.length] }}>●</span> {e.icon} <b>{e.name}</b>{' '}
                <span className="tag">{e.kind === 'human' ? 'Human' : 'JEV'}</span>
              </div>
              <span className={`tag ${r.status}`}>
                {r.status === 'goal' ? `🏁 GOAL (T${r.finishTurn})` : r.status === 'dnf' ? 'DNF' : `BACK残 ${r.backsLeft}`}
              </span>
            </div>
            <div className="route small">
              {r.route.map((st, j) => (
                <span key={j} className={`step ${st.kind}`} title={st.coord ? '座標あり' : '座標なし'}>
                  {j > 0 && ` ${STEP_MARK[st.kind]} `}
                  {st.title}
                  {st.coord ? '📍' : ''}
                  {st.tooLarge && <span className="too-large" title="ゴール圏内だが、ゴール圏より広い場所の記事なので GOAL 対象外">（広域）</span>}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
