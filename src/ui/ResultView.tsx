import { useEffect, useMemo, useState } from 'react'
import type { RaceRecord } from '../storage/db'
import { CostChip } from './JevMeter'
import { MapView, RUNNER_COLORS } from './MapView'
import { currentTitleAt, mapRunnersAt, STEP_MARK } from './view'

export function ResultView({ record, onBack }: { record: RaceRecord; onBack: () => void }) {
  const s = record.snapshot
  const maxTurn = s.turn
  const [turn, setTurn] = useState(maxTurn)
  const [speed, setSpeed] = useState(0)
  const entry = (id: string) => s.config.entries.find((e) => e.runnerId === id)!
  const idx = (id: string) => s.config.entries.findIndex((e) => e.runnerId === id)

  // Replay: 記録済みの経路をターン単位で再生する（再計算や API 呼び出しはしない）
  useEffect(() => {
    if (!speed) return
    const t = setInterval(() => {
      setTurn((x) => {
        if (x >= maxTurn) {
          setSpeed(0)
          return x
        }
        return x + 1
      })
    }, 1200 / speed)
    return () => clearInterval(t)
  }, [speed, maxTurn])

  const mapRunners = useMemo(() => mapRunnersAt(s, turn), [s, turn])
  const winners = record.results.filter((r) => r.rank === 1).map((r) => r.runnerId)
  const hit = record.prediction ? winners.includes(record.prediction) : null

  return (
    <div className="split">
      <div className="split-map">
        <MapView goal={s.config.goal} runners={mapRunners} fitKey={s.config.id} />
      </div>
      <div className="split-side page">
        <div className="row between">
          <h2>レース結果</h2>
          <button onClick={onBack}>戻る</button>
        </div>
        <p>
          🏁 <b>{s.config.goal.name}</b>（半径 {s.config.goal.radiusM / 1000}km）・ {new Date(record.createdAt).toLocaleString()}
        </p>
        {record.prediction && (
          <p className={hit ? 'hit' : 'miss'}>
            あなたの予想: {entry(record.prediction)?.icon} {entry(record.prediction)?.name} → <b>{hit ? 'HIT 🎯' : 'MISS'}</b>
          </p>
        )}
        <table className="results">
          <thead>
            <tr>
              <th>順位</th>
              <th>Runner</th>
              <th>結果</th>
              <th>ターン</th>
              <th>BACK</th>
            </tr>
          </thead>
          <tbody>
            {record.results.map((r) => {
              const st = s.runners.find((x) => x.runnerId === r.runnerId)!
              return (
                <tr key={r.runnerId}>
                  <td>{r.rank ?? '—'}</td>
                  <td>
                    <span style={{ color: RUNNER_COLORS[idx(r.runnerId) % RUNNER_COLORS.length] }}>●</span> {entry(r.runnerId).icon} {entry(r.runnerId).name}
                  </td>
                  <td>
                    {r.status === 'goal' ? 'GOAL' : 'DNF'}
                    {r.status !== 'goal' && r.distanceM != null && <span className="small muted">（残り約{Math.round(r.distanceM / 1000)}km）</span>}
                  </td>
                  <td>{r.finishTurn ?? '—'}</td>
                  <td>
                    {s.config.settings.backLimit - st.backsLeft}/{s.config.settings.backLimit}
                    {st.route.some((x) => x.kind === 'forced-back') && <span className="small muted"> +救済</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {s.jev && (
          <p className="small">
            JEV 利用: <CostChip stats={s.jev} /> ・ 再試行 {s.jev.retries} 回（再試行は課金されません）
          </p>
        )}

        <section className="card">
          <h3>Replay</h3>
          <div className="row wrap">
            <button onClick={() => setTurn(0)}>⏮</button>
            <button onClick={() => setTurn((t) => Math.max(0, t - 1))}>◀</button>
            <button onClick={() => setTurn((t) => Math.min(maxTurn, t + 1))}>▶ Step</button>
            {[1, 2, 4].map((x) => (
              <button
                key={x}
                className={speed === x ? 'on' : ''}
                onClick={() => {
                  if (turn >= maxTurn) setTurn(0)
                  setSpeed(speed === x ? 0 : x)
                }}
              >
                {x}x
              </button>
            ))}
            <span>
              ターン {turn} / {maxTurn}
            </span>
          </div>
          <input type="range" min={0} max={maxTurn} value={turn} onChange={(e) => setTurn(Number(e.target.value))} style={{ width: '100%' }} />
          <ul className="small">
            {s.runners.map((r) => (
              <li key={r.runnerId}>
                {entry(r.runnerId).icon} {entry(r.runnerId).name}: {currentTitleAt(r.route, turn)}
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h3>Wikipedia ルート</h3>
          {s.runners.map((r) => (
            <div key={r.runnerId} className="route small">
              <b>
                {entry(r.runnerId).icon} {entry(r.runnerId).name}
              </b>
              ：
              {r.route
                .filter((st) => st.turn <= turn)
                .map((st, j) => (
                  <span key={j} className={`step ${st.kind}`}>
                    {j > 0 && ` ${STEP_MARK[st.kind]} `}
                    <a href={`https://${s.config.settings.lang}.wikipedia.org/wiki/${encodeURIComponent(st.title)}`} target="_blank" rel="noreferrer">
                      {st.title}
                    </a>
                    {st.coord ? '📍' : ''}
                    {st.tooLarge && <span className="too-large" title="ゴール圏内だが、ゴール圏より広い場所の記事なので GOAL 対象外">（広域）</span>}
                  </span>
                ))}
            </div>
          ))}
          <p className="small muted">→ 移動 ↩ BACK ⤺ 行き止まり救済 📍 座標あり （広域）ゴール圏内だが広い場所のため GOAL 対象外</p>
        </section>
      </div>
    </div>
  )
}
