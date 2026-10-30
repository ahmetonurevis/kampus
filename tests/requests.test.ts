import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import {
  ABSENCE_EXCUSE_BUSINESS_DAYS,
  ABSENCE_NOTICE_STATUS,
  absenceNotices,
  addBusinessDays,
  excuseBusinessDays,
  notifyAbsence,
  openRequest,
  requestResponse,
  updateRequest,
} from '../packages/school-core/src/lib/requests.ts'
import { visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import { isDomainError } from './support/domain-error.ts'

// 2026-10-06 salıdır. Deniz (s1) 7-A (c1, ortaokul), Ece (s2) 5-A (c2); s5 9-A (c5, lise).
// 7-A'nın sınıf rehber öğretmeni Selin Kaya (t1); Ahmet Yıldırım (t2) 7-A'nın Türkçe öğretmeni.
const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-requests-test-${++sequence}`

const parent: Participant = {
  role: 'veli',
  links: [
    { kind: 'child', recordId: 's1' },
    { kind: 'child', recordId: 's2' },
  ],
  userId: 'u-ayse',
}
const parentOf = (recordId: string): Participant => ({
  role: 'veli',
  links: [{ kind: 'child', recordId }],
  userId: `u-parent-${recordId}`,
})
const people: Record<Exclude<Role, 'veli'>, Participant> = {
  yonetici: { role: 'yonetici', links: [], userId: 'u-admin' },
  onburo: { role: 'onburo', links: [], userId: 'u-front' },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }], userId: 'u-t1' },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }], userId: 'u-s1' },
}
const branchTeacher: Participant = {
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId: 't2' }],
  userId: 'u-t2',
}

const request = (overrides: Record<string, unknown> = {}) => ({
  studentId: 's1',
  category: 'Talep',
  title: 'Servis saati',
  text: 'Akşam servisinin 10 dakika erken kalkmasını rica ediyoruz.',
  ...overrides,
})
const absence = (overrides: Record<string, unknown> = {}) => ({
  studentId: 's1',
  startDate: '2026-10-08',
  endDate: '2026-10-09',
  category: 'Ailevi nedenler',
  reason: 'Aile ziyareti nedeniyle okula gelemeyecek.',
  ...overrides,
})
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'

function unchangedOnFailure(
  state: State,
  keys: readonly ('requests' | 'absences' | 'attendance')[],
  action: () => unknown,
  check: (error: unknown) => boolean,
) {
  const watched = () => JSON.stringify(keys.map((key) => state[key]))
  const before = watched()
  assert.throws(action, check)
  assert.equal(watched(), before)
}

// --- Talep ---------------------------------------------------------------------------------

test('DOM-ILT-080, DOM-YTK-025: veli kendi çocuğu için talep açar; talep ön büroya Yeni olarak düşer', () => {
  const state = seed()
  const created = openRequest(state, parent, request({ studentId: 's2' }), id, now)
  assert.equal(state.requests[0], created)
  assert.deepEqual(
    {
      studentId: created.studentId,
      status: created.status,
      assignedTo: created.assignedTo,
      date: created.date,
      openedBy: created.openedBy,
      replies: created.replies,
    },
    {
      studentId: 's2',
      status: 'Yeni',
      assignedTo: 'Ön büro',
      date: now,
      openedBy: { role: 'veli', userId: 'u-ayse' },
      replies: [],
    },
  )
  // Ön büro kurumun bütün taleplerini, veli yalnız çocuklarınınkini görür.
  assert.ok(visibleRecords(state, people.onburo, 'requests').some((r) => r.id === created.id))
  assert.ok(visibleRecords(state, parent, 'requests').some((r) => r.id === created.id))
  assert.ok(!visibleRecords(state, parentOf('s3'), 'requests').some((r) => r.id === created.id))
  // Dil okulunda da iletişim modülüyle çalışır.
  openRequest(state, parent, request(), id, now, { institutionType: 'language_school' })
})

test('DOM-YTK-025: veli başka velinin çocuğu veya başka kurumun öğrencisi için talep açamaz', () => {
  const state = seed()
  for (const studentId of ['s3', 's-baska-kurum'])
    unchangedOnFailure(
      state,
      ['requests'],
      () => openRequest(state, parent, request({ studentId }), id, now),
      isDomainError('student_scope_denied', 'forbidden'),
    )
})

test('DOM-YTK-001: talebi yalnız veli açar; öğrenci, öğretmen, ön büro ve yönetici açamaz', () => {
  const state = seed()
  for (const by of Object.values(people))
    unchangedOnFailure(
      state,
      ['requests'],
      () => openRequest(state, by, request(), id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

test('DOM-YTK-040: iletişim modülü kapalıyken talep açılmaz ve güncellenmez', () => {
  const state = seed()
  state.modules.communication = false
  unchangedOnFailure(
    state,
    ['requests'],
    () => openRequest(state, parent, request(), id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
  unchangedOnFailure(
    state,
    ['requests'],
    () => updateRequest(state, people.onburo, 'req1', { status: 'Çözüldü' }, id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('DOM-ILT-080, DOM-YTK-025: talep doğrulama hatası ve pasif öğrenci kaydı değiştirmez', () => {
  const state = seed()
  for (const input of [
    request({ title: '' }),
    request({ text: 'x' }),
    request({ category: 'Övgü' }),
    request({ text: 'a'.repeat(2001) }),
    { category: 'Talep' },
  ])
    unchangedOnFailure(
      state,
      ['requests'],
      () => openRequest(state, parent, input, id, now),
      zodError,
    )
  state.students.find((s) => s.id === 's2')!.isActive = false
  unchangedOnFailure(
    state,
    ['requests'],
    () => openRequest(state, parent, request({ studentId: 's2' }), id, now),
    isDomainError('student_inactive'),
  )
})

test('DOM-ILT-080, DOM-ILT-013: ön büro durumu ve birimi değiştirir, yanıt ekler; veli yanıtı görür', () => {
  const state = seed()
  const created = openRequest(state, parent, request(), id, now)
  const later = '2026-10-06T12:00:00.000Z'
  updateRequest(
    state,
    people.onburo,
    created.id,
    {
      status: 'İnceleniyor',
      assignedTo: 'Finans birimi',
      reply: 'Talebiniz finans birimine iletildi.',
    },
    id,
    later,
  )
  const latest = '2026-10-07T09:00:00.000Z'
  updateRequest(
    state,
    people.yonetici,
    created.id,
    { reply: 'Servis firmasıyla görüşüldü.' },
    id,
    latest,
  )
  const seen = visibleRecords(state, parent, 'requests').find((r) => r.id === created.id)!
  assert.equal(seen.status, 'İnceleniyor')
  assert.equal(seen.assignedTo, 'Finans birimi')
  assert.equal(seen.updatedAt, latest)
  assert.deepEqual(
    seen.replies?.map((reply) => [reply.text, reply.at, reply.by]),
    [
      ['Talebiniz finans birimine iletildi.', later, { role: 'onburo', userId: 'u-front' }],
      ['Servis firmasıyla görüşüldü.', latest, { role: 'yonetici', userId: 'u-admin' }],
    ],
  )
  // Yanıt süresi saklanmaz; ilk yanıt saati durdurur.
  assert.deepEqual(requestResponse(seen, '2026-10-09T09:00:00.000Z'), {
    dueAt: '2026-10-07T10:00:00.000Z',
    answeredAt: later,
    overdue: false,
  })
  assert.equal('dueAt' in seen, false)
})

test('DOM-ILT-013: yanıtsız talep bir iş günü sonra gecikir; çözülen talep gecikmez', () => {
  // Cuma 16.00'da açılan talebin hedefi pazartesi 16.00'dır (hafta sonu sayılmaz).
  const friday = { date: '2026-10-09T13:00:00.000Z', status: 'Yeni', replies: [] }
  const due = requestResponse(friday, '2026-10-12T12:00:00.000Z')
  assert.equal(due.dueAt, '2026-10-12T13:00:00.000Z')
  assert.equal(due.overdue, false)
  assert.equal(requestResponse(friday, '2026-10-12T13:00:01.000Z').overdue, true)
  assert.equal(
    requestResponse({ ...friday, status: 'Çözüldü' }, '2026-10-13T13:00:00.000Z').overdue,
    false,
  )
  // Eski kayıt yanıt listesi taşımaz.
  assert.equal(requestResponse({ date: friday.date, status: 'Yeni' }, now).answeredAt, null)
})

test('DOM-ILT-080: talep güncellemesinde değişiklik yok, çözülmüş talep ve Yeni durumuna dönüş reddedilir', () => {
  const state = seed()
  // req1 seed'de "İnceleniyor", req3 "Çözüldü".
  unchangedOnFailure(
    state,
    ['requests'],
    () => updateRequest(state, people.onburo, 'req1', { status: 'İnceleniyor' }, id, now),
    isDomainError('request_unchanged', 'conflict'),
  )
  unchangedOnFailure(
    state,
    ['requests'],
    () => updateRequest(state, people.onburo, 'req1', { status: 'Yeni' }, id, now),
    isDomainError('request_status_invalid'),
  )
  unchangedOnFailure(
    state,
    ['requests'],
    () => updateRequest(state, people.onburo, 'req3', { reply: 'Ek bilgi' }, id, now),
    isDomainError('request_resolved', 'conflict'),
  )
  unchangedOnFailure(
    state,
    ['requests'],
    () => updateRequest(state, people.onburo, 'req-yok', { status: 'Çözüldü' }, id, now),
    isDomainError('request_not_found', 'not_found'),
  )
  unchangedOnFailure(
    state,
    ['requests'],
    () => updateRequest(state, people.onburo, 'req1', {}, id, now),
    zodError,
  )
  // Yeniden incelemeye alınan talep değişir; çözülürken son yanıt yazılabilir.
  updateRequest(state, people.onburo, 'req3', { status: 'İnceleniyor' }, id, now)
  updateRequest(
    state,
    people.onburo,
    'req3',
    { status: 'Çözüldü', reply: 'Kaynak listesi gönderildi.' },
    id,
    now,
  )
  assert.equal(state.requests.find((r) => r.id === 'req3')?.replies?.length, 1)
})

test('DOM-YTK-001: talebi yalnız ön büro ve yönetici günceller', () => {
  const state = seed()
  for (const by of [parent, people.ogretmen, people.ogrenci])
    unchangedOnFailure(
      state,
      ['requests'],
      () => updateRequest(state, by, 'req1', { status: 'Çözüldü' }, id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
})

// --- İzin ve mazeret -------------------------------------------------------------------------

test('DOM-ILT-053: veli ileri tarihli izin bildirir; talep açılmaz, yoklama değişmez', () => {
  const state = seed()
  const requests = state.requests.length
  const attendance = JSON.stringify(state.attendance)
  const notice = notifyAbsence(state, parent, absence(), id, now)
  assert.equal(state.absences[0], notice)
  assert.deepEqual(
    {
      status: notice.status,
      date: notice.date,
      createdAt: notice.createdAt,
      by: notice.notifiedBy,
    },
    {
      status: ABSENCE_NOTICE_STATUS,
      date: now,
      createdAt: now,
      by: { role: 'veli', userId: 'u-ayse' },
    },
  )
  assert.equal(state.requests.length, requests)
  assert.equal(JSON.stringify(state.attendance), attendance)
})

test('DOM-ILT-053: geçmiş tarihli mazeret ortaokulda 3, lisede 5 iş günü içinde kabul edilir', () => {
  const state = seed()
  // 7-A: perşembe biten devamsızlığın son günü salıdır (cuma, pazartesi, salı).
  notifyAbsence(state, parent, absence({ startDate: '2026-10-01', endDate: '2026-10-01' }), id, now)
  unchangedOnFailure(
    state,
    ['absences'],
    () =>
      notifyAbsence(
        state,
        parent,
        absence({ startDate: '2026-09-30', endDate: '2026-09-30' }),
        id,
        now,
      ),
    isDomainError('absence_notice_late'),
  )
  // 9-A (lise): salı biten devamsızlık sonraki salıya kadar bildirilir.
  const high = parentOf('s5')
  notifyAbsence(
    state,
    high,
    absence({ studentId: 's5', startDate: '2026-09-29', endDate: '2026-09-29' }),
    id,
    now,
  )
  unchangedOnFailure(
    state,
    ['absences'],
    () =>
      notifyAbsence(
        state,
        high,
        absence({ studentId: 's5', startDate: '2026-09-28', endDate: '2026-09-28' }),
        id,
        now,
      ),
    isDomainError('absence_notice_late'),
  )
  // Bugünü kapsayan aralık geçmiş sayılmaz.
  notifyAbsence(state, parent, absence({ startDate: '2026-10-05', endDate: '2026-10-06' }), id, now)
})

test('DOM-ILT-053: özür belgesi süresi kademe ve kurum türüne göredir; tatil iş günü sayılmaz', () => {
  const state = seed()
  assert.equal(excuseBusinessDays(state, { classId: 'c1' }), ABSENCE_EXCUSE_BUSINESS_DAYS.middle)
  assert.equal(excuseBusinessDays(state, { classId: 'c5' }), ABSENCE_EXCUSE_BUSINESS_DAYS.high)
  assert.equal(excuseBusinessDays(state, { classId: 'c5' }, 'language_school'), 3)
  assert.equal(excuseBusinessDays(state, { classId: 'yok' }), 3)
  assert.equal(addBusinessDays('2026-10-01', 3), '2026-10-06')
  assert.equal(
    addBusinessDays('2026-10-01', 3, {
      weekdays: [1, 2, 3, 4, 5],
      startMinute: 480,
      endMinute: 1020,
      holidays: ['2026-10-05'],
    }),
    '2026-10-07',
  )
  assert.equal(addBusinessDays('2026-10-01', 0), '2026-10-01')
  assert.throws(
    () =>
      addBusinessDays('2026-10-01', 1, {
        weekdays: [],
        startMinute: 0,
        endMinute: 1,
        holidays: [],
      }),
    isDomainError('working_calendar_invalid'),
  )
})

test('DOM-ILT-053: örtüşen bildirim, belge eki ve geçersiz aralık kaydı değiştirmez', () => {
  const state = seed()
  notifyAbsence(state, parent, absence(), id, now)
  unchangedOnFailure(
    state,
    ['absences'],
    () =>
      notifyAbsence(
        state,
        parent,
        absence({ startDate: '2026-10-09', endDate: '2026-10-12' }),
        id,
        now,
      ),
    isDomainError('absence_overlap', 'conflict'),
  )
  // Kardeşin aynı günlerdeki bildirimi ayrıdır.
  notifyAbsence(state, parent, absence({ studentId: 's2' }), id, now)
  unchangedOnFailure(
    state,
    ['absences'],
    () =>
      notifyAbsence(
        state,
        parent,
        absence({ startDate: '2026-10-20', endDate: '2026-10-20', files: ['rapor.pdf'] }),
        id,
        now,
      ),
    isDomainError('absence_files_unsupported'),
  )
  for (const input of [
    absence({ startDate: '2026-10-12', endDate: '2026-10-11' }),
    absence({ startDate: '2026-02-30', endDate: '2026-03-01' }),
    absence({ reason: '' }),
    absence({ category: 'Tatil' }),
  ])
    unchangedOnFailure(
      state,
      ['absences'],
      () => notifyAbsence(state, parent, input, id, now),
      zodError,
    )
  // Boş belge listesi ek sayılmaz.
  notifyAbsence(
    state,
    parent,
    absence({ startDate: '2026-10-21', endDate: '2026-10-21', files: [] }),
    id,
    now,
  )
})

test('DOM-ILT-053: bildirim yalnız velidedir ve kendi çocuğuyla, açık modülle sınırlıdır', () => {
  const state = seed()
  for (const by of Object.values(people))
    unchangedOnFailure(
      state,
      ['absences'],
      () => notifyAbsence(state, by, absence(), id, now),
      isDomainError('permission_denied', 'forbidden'),
    )
  for (const studentId of ['s3', 's-baska-kurum'])
    unchangedOnFailure(
      state,
      ['absences'],
      () => notifyAbsence(state, parent, absence({ studentId }), id, now),
      isDomainError('student_scope_denied', 'forbidden'),
    )
  state.students.find((s) => s.id === 's1')!.isActive = false
  unchangedOnFailure(
    state,
    ['absences'],
    () => notifyAbsence(state, parent, absence(), id, now),
    isDomainError('student_inactive'),
  )
  state.modules.academic = false
  unchangedOnFailure(
    state,
    ['absences'],
    () => notifyAbsence(state, parent, absence({ studentId: 's2' }), id, now),
    isDomainError('module_disabled', 'forbidden'),
  )
})

test('DOM-ILT-053: mazeret metnini ön büro ve branş öğretmeni görmez; sınıf rehber öğretmeni görür', () => {
  const state = seed()
  const notice = notifyAbsence(state, parent, absence(), id, now)
  const sees = (by: Participant) =>
    visibleRecords(state, by, 'absences').some((a) => a.id === notice.id)
  assert.equal(sees(people.yonetici), true)
  assert.equal(sees(people.ogretmen), true)
  assert.equal(sees(parent), true)
  assert.equal(sees(people.ogrenci), true)
  assert.equal(sees(people.onburo), false)
  assert.equal(sees(branchTeacher), false)
  assert.equal(sees(parentOf('s3')), false)
})

test('DOM-ILT-053: yoklama günü bildirim aralığındaysa bildirim yoklamaya bağlanır', () => {
  const state = seed()
  const notice = notifyAbsence(state, parent, absence(), id, now)
  notifyAbsence(
    state,
    parent,
    absence({ studentId: 's2', startDate: '2026-10-20', endDate: '2026-10-20' }),
    id,
    now,
  )
  const lookup = absenceNotices(state.absences)
  assert.equal(lookup('s1', '2026-10-08')?.id, notice.id)
  // Europe/Istanbul günü: 9 Ekim 23.30 (UTC 20.30) aralıktadır, 10 Ekim 00.30 değildir.
  assert.equal(lookup('s1', '2026-10-09T20:30:00.000Z')?.id, notice.id)
  assert.equal(lookup('s1', '2026-10-09T21:30:00.000Z'), null)
  assert.equal(lookup('s2', '2026-10-08'), null)
  assert.equal(lookup('s9', '2026-10-08'), null)
})
