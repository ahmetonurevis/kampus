import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

// OG-203: nginx CSP'si satır içi betikleri sha256 ile izinler. Betik değişirse hash sessizce
// eskir ve tarayıcı betiği engeller (ör. koyu tema ilk boyamada uygulanmaz). Bu test eşleşmeyi korur.

const root = new URL('../', import.meta.url)
const INDEX_FILES = ['apps/web-react/index.html', 'apps/web/index.html']

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = []
  for (const match of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(match[1] ?? '')) continue
    hashes.push(
      `sha256-${createHash('sha256')
        .update(match[2] ?? '')
        .digest('base64')}`,
    )
  }
  return hashes
}

function cspScriptHashes(conf: string): string[] {
  const csp = conf.match(/add_header Content-Security-Policy "([^"]+)"/)?.[1]
  assert.ok(csp, 'deploy/site.conf içinde Content-Security-Policy başlığı bulunamadı.')
  const scriptSrc = csp.split(';').find((directive) => directive.trim().startsWith('script-src'))
  assert.ok(scriptSrc, 'CSP içinde script-src yok.')
  assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src 'unsafe-inline' içermemeli.")
  return [...scriptSrc.matchAll(/'(sha256-[A-Za-z0-9+/=]+)'/g)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  )
}

test("nginx CSP script-src hash'leri kaynak index.html satır içi betikleriyle eşleşir (OG-203)", () => {
  const allowed = cspScriptHashes(readFileSync(new URL('deploy/site.conf', root), 'utf8'))
  const found = new Map<string, string>()
  for (const file of INDEX_FILES) {
    if (!existsSync(new URL(file, root))) continue
    for (const hash of inlineScriptHashes(readFileSync(new URL(file, root), 'utf8')))
      found.set(hash, file)
  }
  assert.ok(
    found.size > 0,
    "Hiçbir index.html satır içi betik içermiyor; CSP hash'i gereksiz kaldı.",
  )

  const missing = [...found].filter(([hash]) => !allowed.includes(hash))
  assert.deepEqual(
    missing,
    [],
    `Satır içi betik değişti, CSP hash'i eski. deploy/site.conf içindeki script-src hash'ini şuna çevirin: ${missing
      .map(([hash, file]) => `'${hash}' (${file})`)
      .join(', ')}`,
  )
  const stale = allowed.filter((hash) => !found.has(hash))
  assert.deepEqual(
    stale,
    [],
    `deploy/site.conf içinde hiçbir index.html betiğine uymayan eski hash var: ${stale.join(', ')}. Silin ya da şu hash'lerle değiştirin: ${[...found.keys()].join(', ')}`,
  )
})
