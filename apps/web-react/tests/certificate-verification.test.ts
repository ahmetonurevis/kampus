import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { matchRoutes, type RouteObject } from 'react-router'
import { ApiError } from '@kampus/api-client/errors.ts'
import { VERIFICATION_MESSAGES } from '@kampus/react-shared/use-course-certificates.ts'
import {
  certificateVerificationUrl,
  routerBasename,
  VERIFICATION_ROUTE,
  verificationHref,
} from '../src/lib/certificate-verification.ts'
import {
  verificationDateLabel,
  verificationView,
} from '../src/pages/verification/verification-view.ts'

// Kimliksiz belge doğrulama sayfası (OG-088; DOM-DIL-082).

const CODE = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345'

// `routes.tsx`'in üst düzey yolları (aynı sırayla); bileşenler burada gerekmez.
const ROUTES: RouteObject[] = [
  { path: 'giris' },
  { path: VERIFICATION_ROUTE },
  { path: ':role/aday/:prospectId' },
  { path: ':role/ogrenci/:studentId' },
  { path: ':role/:page?' },
  { path: '*' },
]

function resolve(url: string, basename: string) {
  const matches = matchRoutes(ROUTES, new URL(url).pathname, basename)
  return matches?.at(-1)
}

for (const base of ['https://kampus.example/', 'https://kampus.example/app/']) {
  test(`DOM-DIL-082: QR adresi doğrulama rotasına çözülür (${base})`, () => {
    const basename = routerBasename(new URL(base).pathname)
    const match = resolve(certificateVerificationUrl(base, CODE), basename)
    assert.equal(match?.route.path, VERIFICATION_ROUTE)
    assert.equal(match?.params.code, CODE)
  })
}

test('DOM-DIL-082: kodsuz doğrulama adresi de aynı rotadır, rol sayfası sanılmaz', () => {
  const match = resolve(`https://kampus.example${verificationHref()}`, '/')
  assert.equal(match?.route.path, VERIFICATION_ROUTE)
  assert.equal(match?.params.code, undefined)
  assert.equal(verificationHref(CODE), `/belge-dogrula/${CODE}`)
})

test('routes.tsx doğrulama rotasını sabitten alır ve rol rotasından önce tanımlar', () => {
  const source = readFileSync(new URL('../src/routes.tsx', import.meta.url), 'utf8')
  const verification = source.indexOf('path: VERIFICATION_ROUTE')
  assert.ok(verification > 0)
  assert.ok(verification < source.indexOf("path: ':role/aday/:prospectId'"))
  assert.match(source, /basename: routerBasename\(import\.meta\.env\.BASE_URL\)/)
})

test('router basename Vite BASE_URL değerinden kurulur', () => {
  assert.equal(routerBasename('/'), '/')
  assert.equal(routerBasename('/app/'), '/app')
  assert.equal(routerBasename('app/'), '/app')
  assert.equal(routerBasename('/a/b//'), '/a/b')
})

test('DOM-DIL-082: kod yoksa sonuç bölgesi boştur, biçimi bozuk kod istek atmadan reddedilir', () => {
  assert.deepEqual(verificationView(undefined, { data: undefined, error: null }), { kind: 'idle' })
  const invalid = verificationView('kisa', { data: undefined, error: null })
  assert.equal(invalid.kind, 'message')
  assert.equal(invalid.kind === 'message' && invalid.message, VERIFICATION_MESSAGES.invalidCode)
  // Küçük harf ve tiresiz kod kanonik biçime iner.
  const loading = verificationView(CODE.toLowerCase().replaceAll('-', ''), {
    data: undefined,
    error: null,
  })
  assert.deepEqual(loading, { kind: 'loading', code: CODE })
})

test('DOM-DIL-082: geçerli ve iptal edilmiş belge yalnız API alanlarıyla gösterilir', () => {
  const data = {
    status: 'valid' as const,
    learnerInitials: 'D. Y.',
    courseName: 'B1 Genel İngilizce',
    issuedDate: '2026-11-03',
    institutionName: 'Kampüs Dil Akademisi',
  }
  const valid = verificationView(CODE, { data, error: null })
  assert.equal(valid.kind, 'result')
  if (valid.kind !== 'result') return
  assert.equal(valid.title, 'Geçerli')
  assert.equal(valid.tone, 'success')
  assert.deepEqual(
    valid.rows.map((row) => row.value),
    ['D. Y.', 'B1 Genel İngilizce', '3 Kasım 2026', 'Kampüs Dil Akademisi'],
  )
  const cancelled = verificationView(CODE, { data: { ...data, status: 'cancelled' }, error: null })
  assert.equal(cancelled.kind === 'result' && cancelled.title, 'İptal edildi')
  assert.equal(cancelled.kind === 'result' && cancelled.tone, 'warning')
})

test('DOM-DIL-082: 404 bulunamadı, 429 çok fazla deneme metni verir', () => {
  const notFound = verificationView(CODE, {
    data: undefined,
    error: new ApiError({ status: 404, code: 'not_found', message: 'x' }),
  })
  assert.equal(notFound.kind === 'message' && notFound.title, 'Belge bulunamadı')
  assert.equal(notFound.kind === 'message' && notFound.message, VERIFICATION_MESSAGES.notFound)
  const limited = verificationView(CODE, {
    data: undefined,
    error: new ApiError({ status: 429, code: 'rate_limited', message: 'x' }),
  })
  assert.equal(limited.kind === 'message' && limited.title, 'Çok fazla deneme')
  assert.equal(limited.kind === 'message' && limited.message, VERIFICATION_MESSAGES.rateLimited)
})

test('DOM-DIL-082: yeniden doğrulamada eski hata ya da sonuç yerine yükleniyor gösterilir', () => {
  const error = new ApiError({ status: 404, code: 'not_found', message: 'x' })
  assert.deepEqual(verificationView(CODE, { data: undefined, error, isFetching: true }), {
    kind: 'loading',
    code: CODE,
  })
  const data = {
    status: 'valid' as const,
    learnerInitials: 'D. Y.',
    courseName: 'B1',
    issuedDate: '2026-11-03',
    institutionName: 'Kampüs Dil Akademisi',
  }
  assert.equal(verificationView(CODE, { data, error: null, isFetching: true }).kind, 'loading')
  // İstek bitince hata yeniden görünür.
  assert.equal(
    verificationView(CODE, { data: undefined, error, isFetching: false }).kind,
    'message',
  )
})

test('düzenleme günü İstanbul gününde kalır', () => {
  assert.equal(verificationDateLabel('2026-01-01'), '1 Ocak 2026')
  assert.equal(verificationDateLabel('2026-12-31'), '31 Aralık 2026')
})
