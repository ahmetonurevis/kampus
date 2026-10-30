// @ts-nocheck — TODO(ts): tiplenecek (C2)
import { createSeed } from '../data/seed.ts'

// Zengin başlangıç verisini tekrar yazmak yerine yalnızca demo değişikliklerini saklar.
export function createSnapshotWriter(seed) {
  const originals = Object.fromEntries(
    Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]),
  )
  const records = Object.fromEntries(
    Object.entries(seed)
      .filter(([, value]) => Array.isArray(value) && value.every((item) => item.id))
      .map(([key, value]) => [key, new Map(value.map((item) => [item.id, JSON.stringify(item)]))]),
  )
  return (state) => {
    const changes = {}
    for (const [key, value] of Object.entries(state)) {
      if (JSON.stringify(value) === originals[key]) continue
      if (records[key]) {
        const ids = value.map((item) => item.id)
        const present = new Set(ids)
        const upsert = value.filter((item) => JSON.stringify(item) !== records[key].get(item.id))
        const remove = [...records[key].keys()].filter((id) => !present.has(id))
        changes[key] = { kind: 'records', upsert, remove }
        if (ids.join('|') !== [...records[key].keys()].join('|')) changes[key].order = ids
      } else changes[key] = { kind: 'value', value }
    }
    return JSON.stringify({
      format: 'school-delta-v1',
      version: seed.version,
      createdAt: seed.createdAt,
      changes,
    })
  }
}
export function restoreSnapshot(raw) {
  const snapshot = typeof raw === 'string' ? JSON.parse(raw) : raw
  if (
    snapshot?.format !== 'school-delta-v1' ||
    !snapshot.createdAt ||
    Number.isNaN(+new Date(snapshot.createdAt)) ||
    !snapshot.changes ||
    typeof snapshot.changes !== 'object'
  )
    throw new Error('Kayıtlı demo biçimi geçersiz.')
  const state = createSeed(new Date(snapshot.createdAt))
  const moduleDefaults = { ...state.modules }
  if (snapshot.version !== state.version) throw new Error('Demo verisi güncellenmeli.')
  for (const [key, change] of Object.entries(snapshot.changes)) {
    if (!Object.hasOwn(state, key) || ['version', 'createdAt'].includes(key))
      throw new Error('Demo kaydı geçersiz alan içeriyor.')
    if (change.kind === 'value') {
      if (
        Array.isArray(state[key]) !== Array.isArray(change.value) ||
        typeof state[key] !== typeof change.value ||
        change.value == null
      )
        throw new Error('Demo alanının veri türü geçersiz.')
      state[key] = change.value
    } else if (
      change.kind === 'records' &&
      Array.isArray(state[key]) &&
      Array.isArray(change.upsert) &&
      Array.isArray(change.remove)
    ) {
      const entries = new Map(state[key].map((item) => [item.id, item]))
      for (const id of change.remove) entries.delete(id)
      for (const item of change.upsert) {
        if (!item?.id) throw new Error('Demo kaydının kimliği eksik.')
        entries.set(item.id, item)
      }
      state[key] = change.order ? change.order.map((id) => entries.get(id)) : [...entries.values()]
      if (
        state[key].some((item) => !item) ||
        new Set(state[key].map((item) => item.id)).size !== entries.size
      )
        throw new Error('Demo kayıt sırası geçersiz.')
    } else throw new Error('Demo değişikliği okunamadı.')
  }
  state.modules = { ...moduleDefaults, ...state.modules }
  return state
}
