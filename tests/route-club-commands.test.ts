import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Session } from '../packages/school-core/src/lib/domain.ts'
import { runWorkflow } from '../packages/school-core/src/lib/school-workflows.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import { isDomainError } from './support/domain-error.ts'

// `route` (güzergâh) ve `club` (kulüp) komutları: başarılı yol, doğrulama hatası, rol ve modül denetimi.
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-rc-test-${++sequence}`
const session = (role: Role): Session => ({ role, childId: 's1' })
const run = (
  state: State,
  role: Role,
  command: 'route' | 'club',
  input: unknown,
  recordId?: string,
) => runWorkflow(state, session(role), command, input, id, recordId, now)
// Başarısız işlem State'te (denetim kaydı dahil) hiçbir şeyi değiştirmemelidir.
function rejected(state: State, callback: () => unknown, check: (error: unknown) => boolean) {
  const before = JSON.stringify(state)
  assert.throws(callback, check)
  assert.equal(JSON.stringify(state), before)
}

// Şema hatası (ZodError) ya da bulunamayan kayıt (DomainError): ikisi de Error alt sınıfıdır.
const anyError = (error: unknown) => error instanceof Error

const routeInput = {
  title: 'Kozyatağı hattı',
  branchId: 'b1',
  plate: '34 TEST 01',
  driver: 'Veli Kara',
  phone: '05551234567',
  capacity: 12,
  stops: 'Kozyatağı, Göztepe, Kampüs',
}
// t2 b1 kampüsündedir; oturumun öğretmeni demo kimliği t1'dir.
const clubInput = {
  title: 'Satranç Kulübü',
  branchId: 'b1',
  teacherId: 't2',
  capacity: 10,
  description: 'Haftalık turnuva ve analiz.',
  meeting: 'Salı 16:00 · Kütüphane',
}

test('Güzergâh oluşturulur: aktif kayıt, durak listesi ve denetim kaydı yazılır', () => {
  const state = seed()
  const count = state.transportRoutes.length
  const route = run(state, 'onburo', 'route', routeInput)
  assert.equal(state.transportRoutes.length, count + 1)
  assert.equal(state.transportRoutes.at(-1)?.id, route.id)
  assert.equal(state.transportRoutes.at(-1)?.status, 'Aktif')
  assert.deepEqual(state.transportRoutes.at(-1)?.stops, ['Kozyatağı', 'Göztepe', 'Kampüs'])
  assert.equal(state.transportRoutes.at(-1)?.capacity, 12)
  assert.equal(state.audit[0]?.action, 'route')
  assert.equal(state.audit[0]?.table_name, 'transportRoutes')
  assert.equal(state.audit[0]?.actor, 'onburo')
})

test('Güzergâh güncellenir; yönetici de oluşturabilir', () => {
  const state = seed()
  const count = state.transportRoutes.length
  run(state, 'yonetici', 'route', { ...routeInput, title: 'Yeni ad', capacity: 30 }, 'route-b2')
  assert.equal(state.transportRoutes.length, count)
  const updated = state.transportRoutes.find((r) => r.id === 'route-b2')
  assert.equal(updated?.title, 'Yeni ad')
  assert.equal(updated?.capacity, 30)
  assert.equal(updated?.updatedAt, now)
  run(state, 'yonetici', 'route', { ...routeInput, plate: '34 TEST 02' })
  assert.equal(state.transportRoutes.length, count + 1)
})

test('Güzergâh doğrulama hatasında kayıt değişmez', () => {
  const state = seed()
  const invalid: [Partial<typeof routeInput>, (error: unknown) => boolean][] = [
    [{ title: '' }, anyError],
    [{ phone: '555' }, anyError],
    [{ capacity: 0 }, anyError],
    [{ stops: ' , ' }, anyError],
    [{ branchId: 'yok' }, anyError],
    // Plaka karşılaştırması Türkçe büyük/küçük harfe duyarsızdır; başka aktif güzergâhla çakışır.
    [{ plate: '34 demo 01' }, isDomainError('route_plate_taken', 'conflict')],
  ]
  for (const [change, check] of invalid)
    rejected(state, () => run(state, 'yonetici', 'route', { ...routeInput, ...change }), check)
  rejected(state, () => run(state, 'yonetici', 'route', routeInput, 'route-yok'), anyError)
})

test('Atanmış öğrencisi olan güzergâhın kapasitesi ve durağı kısılamaz', () => {
  const state = seed()
  // route-b1'de s1 (Moda) ve s2 (Bahariye) atanmıştır.
  rejected(
    state,
    () =>
      run(
        state,
        'yonetici',
        'route',
        { ...routeInput, plate: '34 DEMO 01', capacity: 1, stops: 'Moda, Bahariye' },
        'route-b1',
      ),
    isDomainError('route_has_assignments'),
  )
  rejected(
    state,
    () =>
      run(
        state,
        'yonetici',
        'route',
        { ...routeInput, plate: '34 DEMO 01', stops: 'Moda, Kampüs' },
        'route-b1',
      ),
    isDomainError('route_has_assignments'),
  )
})

test('Güzergâh komutu yalnız yönetici ve ön büroya açıktır', () => {
  for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
    const state = seed()
    rejected(
      state,
      () => run(state, role, 'route', routeInput),
      isDomainError('permission_denied', 'forbidden'),
    )
  }
})

test('Ulaşım modülü kapalıyken güzergâh komutu reddedilir', () => {
  const state = seed()
  state.modules.transport = false
  rejected(
    state,
    () => run(state, 'yonetici', 'route', routeInput),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('Kulüp oluşturulur: yönetici herhangi bir sorumlu, öğretmen kendi adına açar', () => {
  const state = seed()
  const count = state.clubs.length
  const club = run(state, 'yonetici', 'club', clubInput)
  assert.equal(state.clubs.length, count + 1)
  assert.equal(state.clubs.at(-1)?.id, club.id)
  assert.equal(state.clubs.at(-1)?.status, 'Aktif')
  assert.equal(state.clubs.at(-1)?.teacherId, 't2')
  assert.equal(state.audit[0]?.action, 'club')
  assert.equal(state.audit[0]?.table_name, 'clubs')
  run(state, 'ogretmen', 'club', { ...clubInput, title: 'Münazara', teacherId: 't1' })
  assert.equal(state.clubs.length, count + 2)
  assert.equal(state.clubs.at(-1)?.teacherId, 't1')
  assert.equal(state.audit[0]?.actor, 'ogretmen')
})

test('Kulüp doğrulama hatasında kayıt değişmez', () => {
  const state = seed()
  const invalid: [Partial<typeof clubInput>, (error: unknown) => boolean][] = [
    [{ title: '' }, anyError],
    [{ capacity: 0 }, anyError],
    [{ capacity: 101 }, anyError],
    [{ meeting: '' }, anyError],
    [{ branchId: 'yok' }, anyError],
    [{ teacherId: 'yok' }, anyError],
  ]
  for (const [change, check] of invalid)
    rejected(state, () => run(state, 'yonetici', 'club', { ...clubInput, ...change }), check)
  // Sorumlu öğretmen başka kampüsten olamaz.
  const other = state.teachers.find((t) => t.branchId !== 'b1')
  assert.ok(other)
  rejected(
    state,
    () => run(state, 'yonetici', 'club', { ...clubInput, teacherId: other.id }),
    isDomainError('club_teacher_invalid'),
  )
  // Öğretmen başka öğretmen adına kulüp açamaz.
  rejected(
    state,
    () => run(state, 'ogretmen', 'club', { ...clubInput, teacherId: 't2' }),
    isDomainError('club_teacher_invalid'),
  )
})

test('Kulüp komutu yalnız yönetici ve öğretmene açıktır', () => {
  for (const role of ['onburo', 'ogrenci', 'veli'] as const) {
    const state = seed()
    rejected(
      state,
      () => run(state, role, 'club', clubInput),
      isDomainError('permission_denied', 'forbidden'),
    )
  }
})

test('Kulüpler modülü kapalıyken kulüp komutu reddedilir', () => {
  const state = seed()
  state.modules.clubs = false
  rejected(
    state,
    () => run(state, 'yonetici', 'club', clubInput),
    isDomainError('module_disabled', 'forbidden'),
  )
})
