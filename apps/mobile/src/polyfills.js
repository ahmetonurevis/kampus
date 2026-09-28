// Ortak okul verisi yalnızca JSON değerlerinden oluşur; Hermes için aynı kopyalama davranışı.
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (value) => JSON.parse(JSON.stringify(value))
}
