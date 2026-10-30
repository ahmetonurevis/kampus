import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import { authStateFrom } from '../src/auth/auth-state.ts'
import {
  academicYearLabel,
  childNamesPending,
  defaultModules,
  mergeModules,
  toSession,
} from '../src/auth/session-mapping.ts'
import { moduleKeys } from '../src/lib/navigation.ts'
import { meFixture } from './fixtures/me.ts'

test('/me oturumu rol, kurum, üyelik ve modülleri taşır', () => {
  const session = toSession(meFixture('ogretmen'))
  assert.ok(session)
  assert.equal(session.role, 'ogretmen')
  assert.equal(session.roleSubtitle, 'Öğretmen')
  assert.equal(session.membershipId, 'test-member-a')
  assert.deepEqual(session.institution, {
    id: 'test-inst-a',
    name: 'Test Okulu',
    slug: 'test-okulu',
    type: 'school',
    academicYear: null,
  })
  assert.equal(session.memberships.length, 1)
})

test('dönem /me akademik yılından gelir; kurum ayarı yoksa boş kalır', () => {
  const base = meFixture().activeInstitution!
  const session = toSession(
    meFixture('veli', { activeInstitution: { ...base, academicYear: 2026 } }),
  )
  assert.equal(session?.institution.academicYear, 2026)
  assert.equal(academicYearLabel(2026), '2026–2027 Eğitim Dönemi')
  // Uydurma dönem yazılmaz.
  assert.equal(academicYearLabel(null), null)
})

test('veli bağlantıları çocuk listesi olur; ad gelene kadar seçici yükleniyor durumundadır', () => {
  const veli = toSession(meFixture('veli'))
  assert.deepEqual(veli?.children, [{ id: 's1' }, { id: 's2' }])
  assert.equal(childNamesPending(veli?.children ?? []), true)
  assert.equal(childNamesPending([{ id: 's1', name: 'Ad' }]), false)
  // Öğrencinin kendi kaydı ve öğretmen kaydı çocuk değildir.
  assert.deepEqual(toSession(meFixture('ogrenci'))?.children, [])
  assert.deepEqual(toSession(meFixture('ogretmen'))?.children, [])
})

test('etkin kurum veya üyelik yoksa oturum eşlenmez', () => {
  assert.equal(toSession(meFixture('veli', { activeInstitution: null })), null)
  assert.equal(toSession(meFixture('veli', { activeMembership: null })), null)
})

test('modül varsayılanları açıktır; kurum ayarı üzerine yazılır', () => {
  const defaults = defaultModules()
  assert.deepEqual(Object.keys(defaults).sort(), moduleKeys().sort())
  assert.ok(Object.values(defaults).every(Boolean))

  const merged = mergeModules({ finance: false, optical: false, gelecek: true })
  assert.equal(merged.finance, false)
  assert.equal(merged.optical, false)
  assert.equal(merged.crm, true)
  // Navigasyonda olmayan sunucu anahtarı korunur.
  assert.equal(merged.gelecek, true)
  assert.deepEqual(mergeModules({}), defaults)

  const session = toSession(
    meFixture('yonetici', {
      activeInstitution: { ...meFixture().activeInstitution!, enabledModules: { finance: false } },
    }),
  )
  assert.equal(session?.modules.finance, false)
  assert.equal(session?.modules.academic, true)
})

test('oturum durumu: Better Auth ve /me birlikte', () => {
  const me = meFixture('veli')
  assert.equal(authStateFrom('loading', { data: me, error: null }).status, 'loading')
  assert.equal(authStateFrom('unauthenticated', { data: me, error: null }).status, 'signed-out')
  assert.equal(authStateFrom('authenticated', { data: undefined, error: null }).status, 'loading')
  const signedIn = authStateFrom('authenticated', { data: me, error: null })
  assert.equal(signedIn.status, 'signed-in')
  assert.equal(signedIn.session?.role, 'veli')
  assert.equal(
    authStateFrom('authenticated', {
      data: meFixture('veli', { activeMembership: null }),
      error: null,
    }).status,
    'no-membership',
  )
  const unauthorized = new ApiError({ status: 401, code: 'unauthenticated', message: 'x' })
  assert.equal(
    authStateFrom('authenticated', { data: me, error: unauthorized }).status,
    'signed-out',
  )
  const failure = new ApiError({ status: 500, code: 'internal_error', message: 'x' })
  assert.equal(authStateFrom('authenticated', { data: undefined, error: failure }).status, 'error')
  // Yenileme hatasında son geçerli /me korunur.
  assert.equal(authStateFrom('authenticated', { data: me, error: failure }).status, 'signed-in')
})
