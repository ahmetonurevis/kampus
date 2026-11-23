// URL arama parametresi yazıcısı. react-router'ın `setSearchParams` güncelleyicisi çizim anındaki
// parametreleri kullandığından aynı commit'te yazan iki liste (ör. tablo + kart listesi) birbirinin
// parametresini siler. Yazımlar burada sırayla birleştirilir ve tek `replace` gezinmesiyle uygulanır.

type Update = (current: URLSearchParams) => URLSearchParams
type Commit = (search: string) => void

export function createParamsWriter(
  read: () => string,
  schedule: (task: () => void) => void = queueMicrotask,
) {
  let pending: URLSearchParams | null = null
  let commit: Commit | null = null
  return function write(update: Update, apply: Commit) {
    const base = pending ?? new URLSearchParams(read())
    const next = update(new URLSearchParams(base))
    commit = apply
    if (pending) {
      pending = next
      return
    }
    if (next.toString() === base.toString()) return
    pending = next
    schedule(() => {
      const search = pending?.toString() ?? ''
      const run = commit
      pending = null
      commit = null
      if (search !== new URLSearchParams(read()).toString()) run?.(search ? `?${search}` : '')
    })
  }
}
