import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
// MapLibre v6 は内部 Worker を別ファイルから読み込む。Worker が共有チャンクを相対 import するため、
// Vite に依存ごと 1 本の Worker としてバンドルさせ、その URL を明示的に渡す（dev の事前バンドルでも壊れない）
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { destination, type LatLon } from '../lib/geo/geo'
import type { Goal } from '../engine/types'

export interface MapRunner {
  id: string
  name: string
  icon: string
  color: string
  /** 座標付き記事間の軌跡（座標を持たない記事は含まない） */
  trail: LatLon[]
  position: LatLon | null
  dimmed?: boolean
}

interface Props {
  goal: Goal | null
  runners: MapRunner[]
  starts?: { title: string; coord: LatLon }[]
  onClick?: (p: LatLon) => void
  /** レース開始時などに全体へフィットし直すためのキー */
  fitKey?: string
}

/** 地理院地図 Vector（最適化ベクトルタイル）の公式「標準地図」スタイル */
const GSI_STYLE_URL = 'https://gsi-cyberjapan.github.io/optimal_bvmap/style/std.json'
/** 公式スタイルは PMTiles 形式を指定しているが、追加ライブラリを避けるため同じデータの XYZ 配信に差し替える */
const GSI_XYZ_TILES = 'https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/{z}/{x}/{y}.pbf'
const GSI_ATTRIBUTION = '<a href="https://maps.gsi.go.jp/vector/" target="_blank" rel="noreferrer">地理院地図Vector</a>'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

let stylePromise: Promise<StyleSpecification> | null = null
function loadStyle(): Promise<StyleSpecification> {
  // 350KB 程度あるので画面遷移ごとに取り直さない
  stylePromise ??= fetch(GSI_STYLE_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`style ${r.status}`)
      return r.json()
    })
    .then((style: StyleSpecification) => {
      for (const src of Object.values(style.sources)) {
        if (src.type === 'vector' && src.tiles?.some((t) => t.startsWith('pmtiles://'))) {
          src.tiles = [GSI_XYZ_TILES]
          src.attribution = GSI_ATTRIBUTION
        }
      }
      return style
    })
    .catch((e) => {
      stylePromise = null
      throw e
    })
  return stylePromise
}

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

function circlePolygon(center: LatLon, radiusM: number): Feature {
  const ring = Array.from({ length: 65 }, (_, i) => {
    const p = destination(center, (i * 360) / 64, radiusM)
    return [p.lon, p.lat]
  })
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }
}

function runnerElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'runner-marker'
  el.appendChild(document.createElement('span'))
  return el
}

export function MapView({ goal, runners, starts, onClick, fitKey }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const markers = useRef(new Map<string, maplibregl.Marker>())
  const goalLabel = useRef<maplibregl.Marker | null>(null)
  const [ready, setReady] = useState(false)
  const [styleError, setStyleError] = useState(false)
  const clickRef = useRef(onClick)
  clickRef.current = onClick
  const fitRef = useRef<() => void>(() => {})

  useEffect(() => {
    let disposed = false
    let ro: ResizeObserver | null = null
    loadStyle()
      .then((style) => {
        if (disposed) return
        const m = new maplibregl.Map({
          container: el.current!,
          style,
          center: [137.5, 36.5],
          zoom: 4,
          // 地理院の最適化ベクトルタイルは z4〜16（17 は拡大表示）
          maxZoom: 17,
          attributionControl: { compact: true },
        })
        m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left')
        m.on('click', (e: MapMouseEvent) => clickRef.current?.({ lat: e.lngLat.lat, lon: e.lngLat.lng }))
        m.on('load', () => {
          m.addSource('goal', { type: 'geojson', data: EMPTY })
          m.addSource('trails', { type: 'geojson', data: EMPTY })
          m.addSource('starts', { type: 'geojson', data: EMPTY })
          m.addLayer({ id: 'goal-fill', type: 'fill', source: 'goal', paint: { 'fill-color': '#f5b400', 'fill-opacity': 0.2 } })
          m.addLayer({ id: 'goal-line', type: 'line', source: 'goal', paint: { 'line-color': '#e0a100', 'line-width': 2 } })
          m.addLayer({
            id: 'trails',
            type: 'line',
            source: 'trails',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': ['get', 'color'], 'line-width': 3.5, 'line-opacity': ['get', 'opacity'] },
          })
          m.addLayer({
            id: 'starts',
            type: 'circle',
            source: 'starts',
            paint: { 'circle-radius': 5, 'circle-color': '#888', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 },
          })
          setReady(true)
        })
        map.current = m
        // コンテナのサイズがレイアウト切替（スマホのタブ等）で変わっても追従する。
        // 非表示(0px)中にフィットすると表示範囲が壊れるため、表示された時点でフィットし直す
        let wasHidden = false
        ro = new ResizeObserver(([e]) => {
          const hidden = e.contentRect.width === 0 || e.contentRect.height === 0
          m.resize()
          if (wasHidden && !hidden) fitRef.current()
          wasHidden = hidden
        })
        ro.observe(el.current!)
      })
      .catch(() => !disposed && setStyleError(true))
    return () => {
      disposed = true
      ro?.disconnect()
      markers.current.clear()
      goalLabel.current = null
      map.current?.remove()
      map.current = null
    }
  }, [])

  // ゴール
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource('goal') as GeoJSONSource).setData(goal ? { type: 'FeatureCollection', features: [circlePolygon(goal.center, goal.radiusM)] } : EMPTY)
    goalLabel.current?.remove()
    goalLabel.current = null
    if (goal) {
      const label = document.createElement('div')
      label.className = 'goal-label'
      label.textContent = `🏁 ${goal.name}`
      goalLabel.current = new maplibregl.Marker({ element: label, anchor: 'bottom' }).setLngLat([goal.center.lon, goal.center.lat]).addTo(m)
    }
  }, [ready, goal])

  // Runner の軌跡とマーカー、スタート候補
  useEffect(() => {
    const m = map.current
    if (!ready || !m) return
    ;(m.getSource('trails') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: runners
        .filter((r) => r.trail.length > 1)
        .map((r) => ({
          type: 'Feature',
          properties: { color: r.color, opacity: r.dimmed ? 0.35 : 0.85 },
          geometry: { type: 'LineString', coordinates: r.trail.map((p) => [p.lon, p.lat]) },
        })),
    })
    ;(m.getSource('starts') as GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: (starts ?? []).map((s) => ({
        type: 'Feature',
        properties: { title: s.title },
        geometry: { type: 'Point', coordinates: [s.coord.lon, s.coord.lat] },
      })),
    })
    const alive = new Set<string>()
    for (const r of runners) {
      if (!r.position) continue
      alive.add(r.id)
      let mk = markers.current.get(r.id)
      if (!mk) {
        mk = new maplibregl.Marker({ element: runnerElement() }).setLngLat([r.position.lon, r.position.lat]).addTo(m)
        markers.current.set(r.id, mk)
      }
      mk.setLngLat([r.position.lon, r.position.lat])
      const span = mk.getElement().firstElementChild as HTMLSpanElement
      span.textContent = r.icon
      span.style.borderColor = r.color
      span.style.opacity = r.dimmed ? '0.5' : '1'
      mk.getElement().title = r.name
    }
    for (const [id, mk] of markers.current) {
      if (!alive.has(id)) {
        mk.remove()
        markers.current.delete(id)
      }
    }
  }, [ready, runners, starts])

  fitRef.current = () => {
    const m = map.current
    if (!m) return
    const pts: [number, number][] = []
    if (goal) {
      // ゴール円全体が収まるよう東西南北の端を含める
      for (const b of [0, 90, 180, 270]) {
        const p = destination(goal.center, b, goal.radiusM)
        pts.push([p.lon, p.lat])
      }
    }
    for (const r of runners) if (r.position) pts.push([r.position.lon, r.position.lat])
    for (const s of starts ?? []) pts.push([s.coord.lon, s.coord.lat])
    if (!pts.length) return
    const bounds = pts.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]))
    m.fitBounds(bounds, { padding: 48, maxZoom: 14, duration: 0 })
  }

  // fitKey が変わった時だけ再フィット（毎ターンのズーム変更はユーザー操作を妨げるため）
  useEffect(() => {
    const c = map.current?.getContainer()
    if (ready && c && c.clientWidth > 0) fitRef.current()
  }, [fitKey, ready])

  return (
    <div className="map">
      <div ref={el} className="map-canvas" />
      {styleError && <div className="map-error">地図スタイルを読み込めませんでした（ネットワークを確認してください）</div>}
    </div>
  )
}

export const RUNNER_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324']
