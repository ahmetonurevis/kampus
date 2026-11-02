import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

import { PLATFORM_LATE_ROUTES, PLATFORM_ROUTES } from '../src/routes/platform-routes.ts'

// Rota kaydı iki kaynaktan gelir (IST-004): platform uçları `routes/platform-routes.ts`, kayıt ve
// finans uçları `app.ts`'teki `// Onur: kayıt ve finans` bloğu. Aynı kayıt fonksiyonu iki kaynakta
// çağrılırsa ya da hiçbirinde çağrılmazsa bu test yakalar.
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const appSource = source('../src/app.ts')
const buildApp = appSource.slice(appSource.indexOf('export async function buildApp'))
const ONUR_START = '// Onur: kayıt ve finans\n'
const ONUR_END = '// Onur: kayıt ve finans sonu'
const calls = (text: string) => [...text.matchAll(/\b(register\w+Routes)\(app\b/g)].map((m) => m[1])

const onurBlock = buildApp.slice(
  buildApp.indexOf(ONUR_START) + ONUR_START.length,
  buildApp.indexOf(ONUR_END),
)
const onurRoutes = calls(onurBlock)
// Dosya uçları depoyu da aldığı için listede değil, `registerPlatformLateRoutes` sonunda çağrılır.
const platformRoutes = [
  ...[...PLATFORM_ROUTES, ...PLATFORM_LATE_ROUTES].map((register) => register.name),
  'registerFileRoutes',
]

test('Rota kayıt fonksiyonu iki kaynakta (platform ve Onur bloğu) birden bulunmaz (IST-004)', () => {
  assert.ok(onurRoutes.length > 0, 'app.ts Onur bloğu bulunamadı')
  const shared = platformRoutes.filter((name) => onurRoutes.includes(name))
  assert.deepEqual(shared, [], `rota kaydı iki kaynakta: ${shared.join(', ')}`)
  const all = [...platformRoutes, ...onurRoutes]
  assert.equal(new Set(all).size, all.length, 'aynı kaynakta yinelenen rota kaydı')
})

test('Her rota dosyasının kayıt fonksiyonu tam bir kaynakta çağrılır (IST-004)', () => {
  const exported = readdirSync(new URL('../src/routes/', import.meta.url))
    .filter((file) => file.endsWith('.ts') && file !== 'platform-routes.ts')
    .flatMap((file) =>
      [...source(`../src/routes/${file}`).matchAll(/export function (register\w+Routes)\(/g)].map(
        (m) => m[1],
      ),
    )
  assert.deepEqual([...platformRoutes, ...onurRoutes].sort(), exported.sort())
})

test('buildApp Onur bloğu dışında rota dosyasını doğrudan kaydetmez (IST-004)', () => {
  const outside = buildApp.replace(onurBlock, '')
  assert.deepEqual(calls(outside), ['registerPlatformRoutes', 'registerPlatformLateRoutes'])
})
