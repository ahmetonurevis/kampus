import type { State } from '@kampus/school-core/data/seed.ts'
import type { Session } from '@kampus/school-core/lib/domain.ts'

export type DraftValue = Record<string, unknown>
// AsyncStorage'ın kullanılan alt kümesi; testlerde bellek içi karşılığı verilir.
export type DraftStorage = {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<unknown>
  removeItem(key: string): Promise<unknown>
}

export function draftKey(
  data: Pick<State, 'createdAt'>,
  session: Session,
  kind: string,
  recordId = '',
) {
  const person =
    session.role === 'veli'
      ? session.childId
      : session.role === 'ogrenci'
        ? 's1'
        : session.role === 'ogretmen'
          ? 't1'
          : session.role
  return (
    'kampus-mobile-draft-v1:' +
    JSON.stringify([data.createdAt, session.role, person, kind, recordId])
  )
}

const isDraftValue = (value: unknown): value is DraftValue =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

// Aynı taslağın yazma/silme işlemleri sıraya girer; geç biten bir yazma silinen taslağı geri getiremez.
export function createDraftRepository(storage: DraftStorage) {
  const pending = new Map<string, Promise<unknown>>()
  function enqueue<T>(key: string, work: () => Promise<T>): Promise<T> {
    // Önceki işlemin hatası bu işlemi engellemez; hata kendi çağırana ulaşır.
    const result = (pending.get(key) || Promise.resolve()).catch(() => {}).then(work)
    pending.set(key, result)
    result
      .finally(() => {
        if (pending.get(key) === result) pending.delete(key)
      })
      .catch(() => {})
    return result
  }
  return {
    read: (key: string, revision = ''): Promise<DraftValue | null> =>
      enqueue(key, async () => {
        const raw = await storage.getItem(key)
        if (!raw) return null
        const saved: unknown = JSON.parse(raw)
        if (
          typeof saved !== 'object' ||
          saved === null ||
          !('version' in saved) ||
          saved.version !== 1 ||
          !('value' in saved) ||
          !isDraftValue(saved.value)
        )
          throw new Error('Taslak biçimi okunamadı.')
        if (!('revision' in saved) || saved.revision !== revision) {
          await storage.removeItem(key)
          return null
        }
        return saved.value
      }),
    write: (key: string, value: DraftValue, revision = '') => {
      const raw = JSON.stringify({
        version: 1,
        revision,
        value,
        updatedAt: new Date().toISOString(),
      })
      return enqueue(key, () => storage.setItem(key, raw))
    },
    clear: (key: string) => enqueue(key, () => storage.removeItem(key)),
  }
}
