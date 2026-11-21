// Görünüm belleği: liste durumu, açık menü grupları ve kaydırma konumu yalnız bellekte tutulur.
// Kişisel veri içerebileceği için sessionStorage/localStorage'a yazılmaz; sayfa yenilenince sayfa,
// sıralama ve URL filtreleri adresten geri kurulur, arama metni kaybolur (ADR 0009).
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
