// Görünüm belleği: liste durumu, açık menü grupları ve kaydırma konumu yalnız bellekte tutulur.
// Kişisel veri içerebileceği için sessionStorage/localStorage'a yazılmaz; sayfa yenilenince
// liste durumu URL arama parametrelerinden geri kurulur.
const memory = new Map<string, unknown>()

export function readView(key: string): unknown {
  return memory.get(key)
}

export function writeView(key: string, value: unknown) {
  memory.set(key, value)
}

/** Testler ve oturum kapanışı için. */
export function clearViewMemory() {
  memory.clear()
}
