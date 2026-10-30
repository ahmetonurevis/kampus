// Ortak okul verisi yalnızca JSON değerlerinden oluşur; Hermes için aynı kopyalama davranışı.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value))
}
