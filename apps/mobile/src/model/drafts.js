export function draftKey(data, session, kind, recordId = '') {
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

// Aynı taslağın yazma/silme işlemleri sıraya girer; geç biten bir yazma silinen taslağı geri getiremez.
export function createDraftRepository(storage) {
  const pending = new Map()
  function enqueue(key, work) {
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
    read: (key, revision = '') =>
      enqueue(key, async () => {
        const raw = await storage.getItem(key)
        if (!raw) return null
        const saved = JSON.parse(raw)
        if (
          saved.version !== 1 ||
          !saved.value ||
          typeof saved.value !== 'object' ||
          Array.isArray(saved.value)
        )
          throw new Error('Taslak biçimi okunamadı.')
        if (saved.revision !== revision) {
          await storage.removeItem(key)
          return null
        }
        return saved.value
      }),
    write: (key, value, revision = '') => {
      const raw = JSON.stringify({
        version: 1,
        revision,
        value,
        updatedAt: new Date().toISOString(),
      })
      return enqueue(key, () => storage.setItem(key, raw))
    },
    clear: (key) => enqueue(key, () => storage.removeItem(key)),
  }
}
