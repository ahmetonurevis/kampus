import { readFileSync } from 'node:fs'
import test from 'node:test'
import assert from 'node:assert/strict'

// Kesin kayıt belgeleri kaldırılan kuralı (tam lira, 422 amount_not_whole_lira, servisin
// `totalCents / 100` dönüşümü, TODO(core-kurus)) geçerli kural gibi anlatmaz (D16d inceleme
// bulgusu; docs/domain/kayit-ve-crm.md DOM-KAY-011).
const DOCS = ['docs/domain/kayit-ve-crm.md', 'docs/muhendislik/api-tasarimi.md', 'README.md']
const STALE = ['amount_not_whole_lira', 'totalCents / 100', 'TODO(core-kurus)', "100'ün katı"]

test('DOM-KAY-011: kesin kayıt belgeleri kaldırılan tam lira kuralını anlatmaz', () => {
  for (const path of DOCS) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    for (const phrase of STALE) assert.equal(text.includes(phrase), false, `${path}: ${phrase}`)
  }
})

test('DOM-KAY-013: API tasarım belgesi velilerin bütünüyle yüklendiğini yazar', () => {
  const text = readFileSync(new URL('../docs/muhendislik/api-tasarimi.md', import.meta.url), 'utf8')
  assert.equal(text.includes('Veli, taksit ve sözleşme koleksiyonları yüklenmez'), false)
  assert.match(text, /Veliler kurum kilidi altında bütünüyle yüklenir/)
})
