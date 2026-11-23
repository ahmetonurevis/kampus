import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import openapiTS, { astToString } from 'openapi-typescript'

// Betik: `pnpm --filter @kampus/api-client generate` tipleri yazar, `generate:check` güncelliği
// denetler. Kaynak `apps/api/openapi.json`'dır (`pnpm --filter @kampus/api openapi` üretir);
// çıktı elle düzenlenmez ve biçimlendirici/lint dışındadır.
const SOURCE = new URL('../../../apps/api/openapi.json', import.meta.url)
const OUTPUT = fileURLToPath(new URL('../src/schema.d.ts', import.meta.url))

const HEADER = `/**
 * Bu dosya apps/api/openapi.json'dan üretilir; elle düzenlemeyin.
 * Üretim: pnpm --filter @kampus/api-client generate
 */

`

const ast = await openapiTS(SOURCE)
const output = `${HEADER}${astToString(ast)}`

if (process.argv.includes('--check')) {
  const current = await readFile(OUTPUT, 'utf8').catch(() => '')
  if (current !== output) {
    console.error('schema.d.ts güncel değil: pnpm --filter @kampus/api-client generate')
    process.exit(1)
  }
  console.log('schema.d.ts güncel.')
} else {
  await writeFile(OUTPUT, output)
  console.log('schema.d.ts yazıldı.')
}
