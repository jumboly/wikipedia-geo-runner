import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { RaceResult, RaceSnapshot, RunnerKind } from '../engine/types'

/**
 * ブラウザローカル保存。レース履歴は件数が増え続けるため localStorage ではなく IndexedDB を使う。
 * Profile / Race History / Memory は別ストアに分け、Runner 削除と Memory リセットを独立させる。
 */

export interface RunnerProfile {
  id: string
  name: string
  icon: string
  kind: RunnerKind
  personality: string
  createdAt: number
}

export interface RaceRecord {
  id: string
  createdAt: number
  snapshot: RaceSnapshot
  results: RaceResult[]
  /** 観戦者の単勝予想 */
  prediction?: string
}

export interface MemoryRecord {
  /** Runner / GM の id */
  ownerId: string
  cards: string[]
}

interface GeoRaceDB extends DBSchema {
  runners: { key: string; value: RunnerProfile }
  races: { key: string; value: RaceRecord; indexes: { createdAt: number } }
  memories: { key: string; value: MemoryRecord }
  settings: { key: string; value: unknown }
}

let dbp: Promise<IDBPDatabase<GeoRaceDB>> | null = null

export function db() {
  dbp ??= openDB<GeoRaceDB>('jev-geo-race', 1, {
    upgrade(d) {
      d.createObjectStore('runners', { keyPath: 'id' })
      d.createObjectStore('races', { keyPath: 'id' }).createIndex('createdAt', 'createdAt')
      d.createObjectStore('memories', { keyPath: 'ownerId' })
      d.createObjectStore('settings')
    },
  })
  return dbp
}

export const uid = () => crypto.randomUUID()

export async function listRunners(): Promise<RunnerProfile[]> {
  const all = await (await db()).getAll('runners')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}
export async function saveRunner(r: RunnerProfile) {
  await (await db()).put('runners', r)
}
/** Runner 削除。レース履歴は事実記録なので残す */
export async function deleteRunner(id: string) {
  const d = await db()
  await d.delete('runners', id)
  await d.delete('memories', id)
}

export async function getMemory(ownerId: string): Promise<string[]> {
  return (await (await db()).get('memories', ownerId))?.cards ?? []
}
export async function resetMemory(ownerId: string) {
  await (await db()).delete('memories', ownerId)
}

export async function saveRace(r: RaceRecord) {
  await (await db()).put('races', r)
}
export async function listRaces(): Promise<RaceRecord[]> {
  return (await (await db()).getAllFromIndex('races', 'createdAt')).reverse()
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  return ((await (await db()).get('settings', key)) as T | undefined) ?? fallback
}
export async function putSetting(key: string, value: unknown) {
  await (await db()).put('settings', value, key)
}

/** ブラウザがデータを勝手に消さないよう永続化を要求する（許可されなくても動作は続ける） */
export async function requestPersistence() {
  try {
    await navigator.storage?.persist?.()
  } catch {
    /* 非対応ブラウザは無視 */
  }
}
