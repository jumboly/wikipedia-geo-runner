import { useEffect, useState } from 'react'
import type { JevStats } from '../engine/types'
import type { GateState } from '@jumboly/jev-client'

/** 少額なので有効数字で表示する（$0.000123 のような値が普通に出る） */
export function formatUsd(v: number): string {
  if (v === 0) return '$0'
  if (v >= 1) return `$${v.toFixed(2)}`
  return `$${v.toPrecision(3)}`
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

export function CostChip({ stats }: { stats: JevStats | undefined }) {
  if (!stats) return null
  return (
    <span className="cost-chip" title={`${stats.provider === 'typesafe' ? 'TypeSafe 直接（コストは公表単価からの概算）' : 'AI Gateway 経由（定価ベース）'} / JEV 呼び出し ${stats.calls} 回 / 入力 ${stats.inputTokens} トークン / 再試行 ${stats.retries} 回（再試行は課金されません）`}>
      💰 {formatUsd(stats.costUsd)}
      <span className="muted small">
        {' '}
        {stats.calls}回・{formatTokens(stats.inputTokens)}tok
      </span>
    </span>
  )
}

/** 全 Runner 共有の待機中ならカウントダウン、同時実行数を絞っているならその旨を出す */
export function GateBanner({ gate }: { gate: GateState | null }) {
  const [now, setNow] = useState(Date.now())
  const cooling = !!gate && gate.cooldownUntil > now
  const rateWaiting = !!gate && gate.rateWaitUntil > now
  useEffect(() => {
    if (!gate || Math.max(gate.cooldownUntil, gate.rateWaitUntil) <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [gate])
  if (!gate) return null
  if (cooling)
    return (
      <span className="gate cooling">
        ⏳ JEV 混雑（{gate.lastStatus}）のため全 Runner 待機中… 残り {Math.ceil((gate.cooldownUntil - now) / 1000)} 秒 ・ 同時実行 {gate.concurrency}/{gate.maxConcurrency}
      </span>
    )
  if (rateWaiting)
    return (
      <span className="gate rate muted">
        ⏱ JEV 呼び出しを {gate.ratePerMin} 回/分{gate.rateMode === 'auto' ? '（429 から自動推定・徐々に解除）' : ''}に抑えて待機中… 残り{' '}
        {Math.ceil((gate.rateWaitUntil - now) / 1000)} 秒
      </span>
    )
  if (gate.concurrency < gate.maxConcurrency)
    return (
      <span className="gate throttled muted small">
        JEV 混雑後のため同時実行を {gate.concurrency}/{gate.maxConcurrency} に制限中（成功が続くと自動で戻ります）
      </span>
    )
  return null
}
