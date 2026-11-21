import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

/** Kaçırılmamış `|` sayısı (kod aralığı içinde de GFM hücreyi böler; `\|` kaçışı sayılmaz). */
const cellBreaks = (line: string) => (line.replace(/\\\|/g, '').match(/\|/g) ?? []).length

test('docs/sayfalar.md tablo satırlarının hücre sayısı başlıkla aynıdır (kod içinde `|` yok)', () => {
  const lines = readFileSync(new URL('../../../docs/sayfalar.md', import.meta.url), 'utf8').split(
    '\n',
  )
  let expected = 0
  const broken: number[] = []
  lines.forEach((line, index) => {
    if (!line.startsWith('|')) {
      expected = 0
      return
    }
    if (expected === 0) expected = cellBreaks(line)
    else if (cellBreaks(line) !== expected) broken.push(index + 1)
  })
  assert.deepEqual(broken, [], `Hücre sayısı bozuk satırlar: ${broken.join(', ')}`)
})
