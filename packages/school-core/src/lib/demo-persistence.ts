import { createSeed, type State } from '../data/seed.ts'

// Depodan okunan veri güvenilmezdir; alanlar okunurken unknown'dan daraltılır.
type SnapshotChange =
  | { kind: 'records'; upsert: unknown[]; remove: unknown[]; order?: unknown[] }
  | { kind: 'value'; value: unknown }

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const textOf = (value: unknown) => (typeof value === 'string' ? value : undefined)
const idOf = (item: unknown) => (isObject(item) ? item.id : undefined)
const isRecordList = (value: unknown): value is unknown[] =>
  Array.isArray(value) && value.every((item: unknown) => idOf(item))
function listOf(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new TypeError('Demo kaydı liste değil.')
  return value
}
// Date kurucusu eski sürümde depodaki değeri olduğu gibi alıyordu; aynı dönüşüm korunur.
// TODO(ts): demo kalıcılığı API geçişinde silinince bu tip iddiası da kalkar.
const dateFrom = (value: unknown) => new Date(value as string)

// Zengin başlangıç verisini tekrar yazmak yerine yalnızca demo değişikliklerini saklar.
export function createSnapshotWriter(seed: State) {
  const seedValues: Record<string, unknown> = seed
  const originals = Object.fromEntries(
    Object.entries(seedValues).map(([key, value]) => [key, JSON.stringify(value)]),
  )
  const records = Object.fromEntries(
    Object.entries(seedValues)
      .filter((entry): entry is [string, unknown[]] => isRecordList(entry[1]))
      .map(([key, value]) => [
        key,
        new Map(value.map((item) => [idOf(item), JSON.stringify(item)])),
      ]),
  )
  return (state: State) => {
    const values: Record<string, unknown> = state
    const changes: Record<string, SnapshotChange> = {}
    for (const [key, value] of Object.entries(values)) {
      if (JSON.stringify(value) === originals[key]) continue
      const known = records[key]
      if (known) {
        const list = listOf(value)
        const ids = list.map(idOf)
        const present = new Set(ids)
        const upsert = list.filter((item) => JSON.stringify(item) !== known.get(idOf(item)))
        const remove = [...known.keys()].filter((id) => !present.has(id))
        const change: SnapshotChange = { kind: 'records', upsert, remove }
        if (ids.join('|') !== [...known.keys()].join('|')) change.order = ids
        changes[key] = change
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
export function restoreSnapshot(raw: unknown): State {
  const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
  const snapshot = isObject(parsed) ? parsed : undefined
  if (
    snapshot?.format !== 'school-delta-v1' ||
    !snapshot.createdAt ||
    Number.isNaN(+dateFrom(snapshot.createdAt)) ||
    !isObject(snapshot.changes)
  )
    throw new Error('Kayıtlı demo biçimi geçersiz.')
  const state = createSeed(dateFrom(snapshot.createdAt))
  const target: Record<string, unknown> = state
  const moduleDefaults = { ...state.modules }
  if (snapshot.version !== state.version) throw new Error('Demo verisi güncellenmeli.')
  for (const [key, change] of Object.entries(snapshot.changes)) {
    if (!Object.hasOwn(state, key) || ['version', 'createdAt'].includes(key))
      throw new Error('Demo kaydı geçersiz alan içeriyor.')
    const current = target[key]
    if (isObject(change) && change.kind === 'value') {
      if (
        Array.isArray(current) !== Array.isArray(change.value) ||
        typeof current !== typeof change.value ||
        change.value == null
      )
        throw new Error('Demo alanının veri türü geçersiz.')
      target[key] = change.value
    } else if (
      isObject(change) &&
      change.kind === 'records' &&
      Array.isArray(current) &&
      Array.isArray(change.upsert) &&
      Array.isArray(change.remove)
    ) {
      const list: readonly unknown[] = current
      const entries = new Map(list.map((item) => [idOf(item), item]))
      for (const id of listOf(change.remove)) entries.delete(id)
      for (const item of listOf(change.upsert)) {
        if (!idOf(item)) throw new Error('Demo kaydının kimliği eksik.')
        entries.set(idOf(item), item)
      }
      const next = change.order
        ? listOf(change.order).map((id) => entries.get(id))
        : [...entries.values()]
      target[key] = next
      if (next.some((item) => !item) || new Set(next.map(idOf)).size !== entries.size)
        throw new Error('Demo kayıt sırası geçersiz.')
    } else throw new Error('Demo değişikliği okunamadı.')
  }
  state.modules = { ...moduleDefaults, ...state.modules }
  splitLegacyMessages(state)
  return state
}

/**
 * Eski snapshot'ta (2.7.0 öncesi) mesajlar yazışma kaydının `messages` dizisindeydi; değişen
 * yazışma bütün mesajlarıyla saklanırdı. Yükleme bu diziyi yeni koleksiyona taşır (ADR 0005):
 * o yazışmanın örnek veriden gelen mesajları dizinin kendisiyle değiştirilir (dizi örnek
 * mesajları da içerir), sıra ve kimlik korunur, `messages` alanı kaldırılır. Snapshot sürümü
 * değişmez; dönüşüm her yüklemede aynı sonucu verir ve sonraki yazmada yeni şekil saklanır.
 */
function splitLegacyMessages(state: State): void {
  type Message = State['conversationMessages'][number]
  const moved = new Map<string, Message[]>()
  for (const conversation of state.conversations) {
    const record: Record<string, unknown> = conversation
    const legacy = record.messages
    if (!Array.isArray(legacy)) continue
    delete record.messages
    const messages = legacy.filter(isObject).map((item): Message => {
      const readAt = textOf(item.readAt)
      const senderUserId = textOf(item.senderUserId)
      return {
        id: textOf(item.id) ?? '',
        conversationId: conversation.id,
        studentId: conversation.studentId,
        teacherId: conversation.teacherId,
        audience: conversation.audience,
        ...(conversation.parentUserId === undefined
          ? {}
          : { parentUserId: conversation.parentUserId }),
        text: textOf(item.text) ?? '',
        sender: textOf(item.sender) ?? '',
        ...(senderUserId === undefined ? {} : { senderUserId }),
        date: textOf(item.date) ?? '',
        ...(readAt === undefined ? {} : { readAt }),
      }
    })
    moved.set(conversation.id, messages)
    const last = messages.at(-1)?.date
    if (last) conversation.lastMessageAt = last
  }
  if (moved.size === 0) return
  const kept = state.conversationMessages.filter((message) => !moved.has(message.conversationId))
  const replaced = new Set([...moved.values()].flat().map((message) => message.id))
  state.conversationMessages = [
    ...kept.filter((message) => !replaced.has(message.id)),
    ...[...moved.values()].flat(),
  ]
}
