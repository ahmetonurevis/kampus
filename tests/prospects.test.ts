import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import type { Participant } from '../packages/school-core/src/lib/communication.ts'
import { authorize } from '../packages/school-core/src/lib/authorize.ts'
import { enrollProspect } from '../packages/school-core/src/lib/domain.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import * as prospects from '../packages/school-core/src/lib/prospects.ts'
import {
  LANGUAGE_GROUP_CAPACITY_MAX,
  MEETING_DURATION,
  PROSPECT_LOST_REASON_LABELS,
  PROSPECT_LOST_REASONS,
  PROSPECT_NOTE_LIMIT,
  PROSPECT_STAGES,
  TRIAL_PARTICIPANTS_PER_LESSON,
  addProspectNote,
  changeProspectStage,
  createProspect,
  findProspectDuplicate,
  nextProspectStages,
  prospectStageLabel,
  scheduleProspectMeeting,
  scheduleTrialLesson,
} from '../packages/school-core/src/lib/prospects.ts'
import { visibleRecords } from '../packages/school-core/src/lib/scope.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'

// 2026-10-06 salıdır. Seed: pr1 Alara Güven (b1, Yeni aday), pr2 (b2, İletişime geçildi),
// pr3 (b3, Görüşme planlandı, 2026-10-08 11:00), pr4 (b1, Teklif verildi), pr5 (b2, Vazgeçti),
// pr15…pr18 Kayıt oldu. Hafta sonu ders yoktur; b1'de 2026-10-06 10:50'de c1 dersi (t13, oda 101).
const now = '2026-10-06T10:00:00.000Z'
const saturday = '2026-10-10T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
let sequence = 0
const id = (prefix: string) => `${prefix}-prospects-test-${++sequence}`
const language = { institutionType: 'language_school' } as const

const people: Record<Role, Participant> = {
  yonetici: { role: 'yonetici', links: [], userId: 'u-admin' },
  onburo: { role: 'onburo', links: [], userId: 'u-front' },
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }], userId: 'u-t1' },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }], userId: 'u-s1' },
  veli: { role: 'veli', links: [{ kind: 'child', recordId: 's1' }], userId: 'u-ayse' },
}
const front = people.onburo

const input = (overrides: Record<string, unknown> = {}) => ({
  name: 'Test Aday',
  phone: '05559990001',
  email: '',
  branchId: 'b1',
  interest: '7. Sınıf · Ortaokul',
  source: 'Web sitesi',
  guardianName: 'Test Veli',
  privacyNoticeVersion: 'aydinlatma-2026-1',
  ...overrides,
})
const meetingInput = (overrides: Record<string, unknown> = {}) => ({
  date: saturday,
  duration: 45,
  room: 'Görüşme odası',
  ...overrides,
})
const zodError = (error: unknown) => error instanceof Error && error.name === 'ZodError'
/** DomainError kodu, türü ve (verilirse) alan yolu eşleşmeli. */
const fails =
  (code: string, kind = 'rule', path?: readonly string[]) =>
  (error: unknown) =>
    error instanceof DomainError &&
    error.code === code &&
    error.kind === kind &&
    (path === undefined || JSON.stringify(error.path) === JSON.stringify(path))

function unchangedOnFailure(
  state: State,
  action: () => unknown,
  check: (error: unknown) => boolean,
) {
  const watched = () => JSON.stringify([state.prospects, state.students, state.invoices])
  const before = watched()
  assert.throws(action, check)
  assert.equal(watched(), before)
}
const prospectOf = (state: State, prospectId: string) => {
  const found = state.prospects.find((p) => p.id === prospectId)
  assert.ok(found, prospectId)
  return found
}
/** Seed görüşmeleri kaldırılmış durum: çakışma testleri yalnız kendi kurduğu görüşmeyi görür. */
const withoutMeetings = () => {
  const state = seed()
  for (const p of state.prospects) p.trialAt = null
  return state
}
/** Dil okulu adayı (b1, 18 yaş altı, veli adıyla). */
const languageProspect = (state: State, overrides: Record<string, unknown> = {}) =>
  createProspect(
    state,
    front,
    input({ minor: true, interest: 'B1 · Genel İngilizce', ...overrides }),
    id,
    now,
    language,
  )
/** b1'deki ilk gelecek ders (c1, 2026-10-06 10:50, 40 dk). */
const futureLesson = (state: State, classId = 'c1') => {
  const lesson = state.schedule.find(
    (l) => l.classId === classId && Date.parse(l.date) > Date.parse(now),
  )
  assert.ok(lesson)
  return lesson
}

// --- Rol ve modül ---------------------------------------------------------------------------

test('DOM-YTK-001, DOM-YTK-021: aday işlemlerini yalnız yönetici ve ön büro yapar', () => {
  for (const role of ['yonetici', 'onburo'] as const) {
    const state = seed()
    const created = createProspect(state, people[role], input(), id, now)
    assert.equal(created.createdBy?.role, role)
    assert.ok(visibleRecords(state, people[role], 'prospects').some((p) => p.id === created.id))
  }
  for (const role of ['ogretmen', 'ogrenci', 'veli'] as const) {
    const state = seed()
    const by = people[role]
    const denied = fails('permission_denied', 'forbidden')
    unchangedOnFailure(state, () => createProspect(state, by, input(), id, now), denied)
    unchangedOnFailure(
      state,
      () => changeProspectStage(state, by, 'pr1', { stage: 'İletişime geçildi' }, now),
      denied,
    )
    unchangedOnFailure(
      state,
      () => addProspectNote(state, by, 'pr1', { text: 'Aradım.' }, id, now),
      denied,
    )
    unchangedOnFailure(
      state,
      () => scheduleProspectMeeting(state, by, 'pr1', meetingInput(), now),
      denied,
    )
    unchangedOnFailure(
      state,
      () => scheduleTrialLesson(state, by, 'pr1', { lessonId: 'x' }, now, language),
      denied,
    )
    // Okuma kapsamı da aynıdır: öğretmen, öğrenci ve veli aday görmez.
    assert.deepEqual(visibleRecords(state, by, 'prospects'), [])
  }
})

test('DOM-YTK-040: CRM modülü kapalıyken aday işlemleri reddedilir', () => {
  const state = seed()
  state.modules.crm = false
  const disabled = fails('module_disabled', 'forbidden')
  unchangedOnFailure(state, () => createProspect(state, front, input(), id, now), disabled)
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'İletişime geçildi' }, now),
    disabled,
  )
  unchangedOnFailure(
    state,
    () => addProspectNote(state, front, 'pr1', { text: 'Aradım.' }, id, now),
    disabled,
  )
  unchangedOnFailure(
    state,
    () => scheduleProspectMeeting(state, front, 'pr1', meetingInput(), now),
    disabled,
  )
  unchangedOnFailure(
    state,
    () => scheduleTrialLesson(state, front, 'pr1', { lessonId: 'x' }, now, language),
    disabled,
  )
})

test('DOM-YTK-012, DOM-DIL-030: deneme dersi okulda her rol için bulunmaz gibi davranır (404)', () => {
  const state = seed()
  const lessonId = futureLesson(state).id
  // Kurum türü rolden önce denetlenir: yetkisiz rol de 403 değil 404 alır.
  for (const role of Object.keys(people) as Role[])
    unchangedOnFailure(
      state,
      () => scheduleTrialLesson(state, people[role], 'pr1', { lessonId }, now),
      fails('trial_lesson_unavailable', 'not_found'),
    )
  // Dil okulunda yetkisiz rol 403 alır.
  unchangedOnFailure(
    state,
    () => scheduleTrialLesson(state, people.veli, 'pr1', { lessonId }, now, language),
    fails('permission_denied', 'forbidden'),
  )
})

test('Olmayan aday kimliği 404 döner', () => {
  const state = seed()
  const missing = fails('prospect_not_found', 'not_found')
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr-yok', { stage: 'İletişime geçildi' }, now),
    missing,
  )
  unchangedOnFailure(
    state,
    () => addProspectNote(state, front, 'pr-yok', { text: 'Not.' }, id, now),
    missing,
  )
  unchangedOnFailure(
    state,
    () => scheduleProspectMeeting(state, front, 'pr-yok', meetingInput(), now),
    missing,
  )
  unchangedOnFailure(
    state,
    () => scheduleTrialLesson(state, front, 'pr-yok', { lessonId: 'x' }, now, language),
    missing,
  )
})

// --- Aday açma ------------------------------------------------------------------------------

test('DOM-KAY-001, DOM-KAY-003, DOM-KAY-009: aday en az veriyle açılır, öğrenci veya taksit üretmez', () => {
  const state = seed()
  const before = { students: state.students.length, invoices: state.invoices.length }
  const created = createProspect(
    state,
    front,
    input({ email: 'Test.Veli@Kampus.Example', name: '  Test   Aday ' }),
    id,
    now,
  )
  assert.equal(state.prospects[0], created)
  assert.deepEqual(
    {
      name: created.name,
      email: created.email,
      stage: created.stage,
      studentId: created.studentId,
      trialAt: created.trialAt,
      notes: created.notes,
      minor: created.minor,
      guardianName: created.guardianName,
      privacyNotice: created.privacyNotice,
      createdAt: created.createdAt,
    },
    {
      name: 'Test   Aday',
      email: 'test.veli@kampus.example',
      stage: 'Yeni aday',
      studentId: null,
      trialAt: null,
      notes: [],
      minor: true,
      guardianName: 'Test Veli',
      privacyNotice: { version: 'aydinlatma-2026-1', shownAt: now },
      createdAt: now,
    },
  )
  assert.deepEqual({ students: state.students.length, invoices: state.invoices.length }, before)
  // E-posta isteğe bağlıdır; boş metin "yok" sayılır.
  const noEmail = createProspect(
    state,
    front,
    input({ email: '', phone: '05559990002', name: 'İkinci Aday' }),
    id,
    now,
  )
  assert.equal(noEmail.email, '')
  const omitted = createProspect(
    state,
    front,
    input({ email: undefined, phone: '05559990003', name: 'Üçüncü Aday' }),
    id,
    now,
  )
  assert.equal(omitted.email, '')
})

test('DOM-KAY-003, DOM-KAY-009: gövde katıdır; kimlik no, eksik aydınlatma, hatalı telefon reddedilir', () => {
  const state = seed()
  for (const body of [
    input({ nationalId: '12345678901' }),
    input({ birthDate: '2014-01-01' }),
    input({ privacyNoticeVersion: '' }),
    input({ privacyNoticeVersion: undefined }),
    input({ phone: '5551234567' }),
    input({ email: 'gecersiz' }),
    input({ name: 'A' }),
    input({ source: 'Reklam panosu' }),
    input({ interest: '' }),
    input({ marketingConsent: { whatsapp: true } }),
  ])
    unchangedOnFailure(state, () => createProspect(state, front, body, id, now), zodError)
})

test('DOM-KAY-009: okul adayı 18 yaş altıdır; veli adı zorunludur', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input({ minor: false }), id, now),
    fails('prospect_guardian_required', 'rule', ['minor']),
  )
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input({ guardianName: undefined }), id, now),
    fails('prospect_guardian_required', 'rule', ['guardianName']),
  )
})

test('DOM-KAY-009, DOM-KAY-012: dil okulunda yaş seçimi zorunlu; yetişkinde veli verisi saklanmaz', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input(), id, now, language),
    fails('prospect_age_required', 'rule', ['minor']),
  )
  unchangedOnFailure(
    state,
    () =>
      createProspect(
        state,
        front,
        input({ minor: true, guardianName: undefined }),
        id,
        now,
        language,
      ),
    fails('prospect_guardian_required', 'rule', ['guardianName']),
  )
  const adult = createProspect(state, front, input({ minor: false }), id, now, language)
  assert.equal(adult.minor, false)
  assert.equal('guardianName' in adult, false)
  const child = languageProspect(state, { phone: '05559990004', name: 'Çocuk Aday' })
  assert.equal(child.minor, true)
  assert.equal(child.guardianName, 'Test Veli')
})

test('DOM-KAY-009: kampüs aktif olmalıdır', () => {
  const state = seed()
  state.branches[0]!.isActive = false
  for (const branchId of ['b1', 'b-yok'])
    unchangedOnFailure(
      state,
      () => createProspect(state, front, input({ branchId }), id, now),
      fails('branch_unavailable', 'rule', ['branchId']),
    )
})

test('DOM-KAY-007: kaynak sabit listedendir; veli referansında referans veren öğrenci bağlanır', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input({ source: 'Veli referansı' }), id, now),
    fails('referrer_required', 'rule', ['referrerStudentId']),
  )
  unchangedOnFailure(
    state,
    () =>
      createProspect(
        state,
        front,
        input({ source: 'Veli referansı', referrerStudentId: 's-yok' }),
        id,
        now,
      ),
    fails('referrer_not_found', 'rule', ['referrerStudentId']),
  )
  state.students[0]!.isActive = false
  unchangedOnFailure(
    state,
    () =>
      createProspect(
        state,
        front,
        input({ source: 'Veli referansı', referrerStudentId: state.students[0]!.id }),
        id,
        now,
      ),
    fails('referrer_not_found', 'rule', ['referrerStudentId']),
  )
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input({ referrerStudentId: 's2' }), id, now),
    zodError,
  )
  const referred = createProspect(
    state,
    front,
    input({ source: 'Veli referansı', referrerStudentId: 's2' }),
    id,
    now,
  )
  assert.equal(referred.referrerStudentId, 's2')
  assert.equal(referred.source, 'Veli referansı')
})

test('DOM-KAY-004, DOM-ILT-022: ticari ileti onayı kanal bazında, varsayılan onaysız saklanır', () => {
  const state = seed()
  const none = createProspect(state, front, input(), id, now)
  assert.deepEqual(none.marketingConsent, {
    sms: { granted: false, at: now },
    email: { granted: false, at: now },
    call: { granted: false, at: now },
  })
  const some = createProspect(
    state,
    front,
    input({
      phone: '05559990005',
      name: 'Onaylı Aday',
      email: 'onayli@kampus.example',
      marketingConsent: { email: true, sms: true },
    }),
    id,
    now,
  )
  assert.deepEqual(some.marketingConsent, {
    sms: { granted: true, at: now },
    email: { granted: true, at: now },
    call: { granted: false, at: now },
  })
  unchangedOnFailure(
    state,
    () =>
      createProspect(
        state,
        front,
        input({ phone: '05559990006', email: '', marketingConsent: { email: true } }),
        id,
        now,
      ),
    fails('consent_contact_missing', 'rule', ['marketingConsent', 'email']),
  )
})

// --- Mükerrer aday --------------------------------------------------------------------------

test('DOM-KAY-002: aynı telefon veya e-posta ve aynı adla açık ikinci aday açılmaz', () => {
  const state = seed()
  const pr1 = prospectOf(state, 'pr1')
  const duplicate = fails('prospect_duplicate', 'conflict', ['phone'])
  // Ad karşılaştırmasında boşluk ve büyük/küçük harf farkı gözetilmez.
  unchangedOnFailure(
    state,
    () =>
      createProspect(state, front, input({ name: ' alara  GÜVEN ', phone: pr1.phone }), id, now),
    duplicate,
  )
  unchangedOnFailure(
    state,
    () =>
      createProspect(
        state,
        front,
        input({ name: pr1.name, email: pr1.email.toUpperCase() }),
        id,
        now,
      ),
    duplicate,
  )
})

test('DOM-KAY-002, DOM-KAY-031: iletişimi paylaşan farklı adlı aday yalnız kardeş olarak açılır', () => {
  const state = seed()
  const pr1 = prospectOf(state, 'pr1')
  unchangedOnFailure(
    state,
    () => createProspect(state, front, input({ name: 'Kardeş Güven', phone: pr1.phone }), id, now),
    fails('prospect_contact_shared', 'conflict', ['siblingOfId']),
  )
  // Kardeş, iletişimi paylaşan açık bir aday olmalıdır.
  for (const siblingOfId of ['pr2', 'pr5', 'pr-yok'])
    unchangedOnFailure(
      state,
      () =>
        createProspect(
          state,
          front,
          input({ name: 'Kardeş Güven', phone: pr1.phone, siblingOfId }),
          id,
          now,
        ),
      fails('sibling_not_found', 'rule', ['siblingOfId']),
    )
  const sibling = createProspect(
    state,
    front,
    input({ name: 'Kardeş Güven', phone: pr1.phone, siblingOfId: 'pr1' }),
    id,
    now,
  )
  assert.equal(sibling.siblingOfId, 'pr1')
  // E-postayı paylaşan kardeş de aynı yolla açılır.
  createProspect(
    state,
    front,
    input({ name: 'Üçüncü Güven', phone: '05559990007', email: pr1.email, siblingOfId: 'pr1' }),
    id,
    now,
  )
  // Kardeş onayı aynı adın mükerrerliğini kaldırmaz.
  unchangedOnFailure(
    state,
    () =>
      createProspect(
        state,
        front,
        input({ name: pr1.name, phone: pr1.phone, siblingOfId: 'pr1' }),
        id,
        now,
      ),
    fails('prospect_duplicate', 'conflict'),
  )
})

test('DOM-KAY-002: kapalı (Kayıt oldu, Vazgeçti) aday tekilliğe sayılmaz', () => {
  const state = seed()
  for (const prospectId of ['pr5', 'pr15']) {
    const closed = prospectOf(state, prospectId)
    const reopened = createProspect(
      state,
      front,
      input({ name: closed.name, phone: closed.phone, email: closed.email }),
      id,
      now,
    )
    assert.equal(reopened.stage, 'Yeni aday')
    // Yeni açılan aday artık açık olduğu için aynı kişi bir kez daha açılamaz.
    unchangedOnFailure(
      state,
      () =>
        createProspect(state, front, input({ name: closed.name, phone: closed.phone }), id, now),
      fails('prospect_duplicate', 'conflict'),
    )
  }
})

test('DOM-KAY-002: findProspectDuplicate aynı adı paylaşılan iletişimden önce bildirir', () => {
  const list = [
    { id: 'a', name: 'Ali Kaya', phone: '05550000001', email: '', stage: 'Yeni aday' },
    { id: 'b', name: 'Ayşe Kaya', phone: '05550000001', email: 'x@y.z', stage: 'Teklif verildi' },
    { id: 'c', name: 'Ali Kaya', phone: '05550000001', email: '', stage: 'İletişime geçildi' },
    { id: 'd', name: 'Ali Kaya', phone: '05550000009', email: '', stage: 'Vazgeçti' },
  ]
  assert.deepEqual(findProspectDuplicate(list, { name: 'ali kaya', phone: '05550000001' }), {
    kind: 'same',
    prospectId: 'a',
  })
  assert.deepEqual(findProspectDuplicate(list, { name: 'Ali Kaya', phone: '05550000001' }, 'a'), {
    kind: 'same',
    prospectId: 'c',
  })
  assert.deepEqual(
    findProspectDuplicate(list, { name: 'Cem Kaya', phone: '05550000002', email: 'X@Y.Z' }),
    { kind: 'shared', prospectId: 'b' },
  )
  assert.equal(findProspectDuplicate(list, { name: 'Ali Kaya', phone: '05550000009' }), null)
  assert.equal(
    findProspectDuplicate(list, { name: 'Ali Kaya', phone: '05550000003', email: '' }),
    null,
  )
})

test('Hata iletileri telefon, e-posta veya başka adayın adını taşımaz', () => {
  const state = seed()
  const pr1 = prospectOf(state, 'pr1')
  for (const body of [
    input({ name: pr1.name, phone: pr1.phone }),
    input({ name: 'Kardeş Güven', phone: pr1.phone }),
  ]) {
    try {
      createProspect(state, front, body, id, now)
      assert.fail('hata bekleniyordu')
    } catch (error) {
      assert.ok(error instanceof DomainError)
      for (const secret of [pr1.phone, pr1.email, pr1.name, 'Güven'])
        assert.ok(!error.message.includes(secret), secret)
    }
  }
})

// --- Aşama ----------------------------------------------------------------------------------

test('DOM-KAY-005, DOM-KAY-030: aşama tablosu ileri geçişe ve yeniden açmaya izin verir', () => {
  assert.deepEqual(nextProspectStages('Yeni aday'), [
    'İletişime geçildi',
    'Teklif verildi',
    'Vazgeçti',
  ])
  assert.deepEqual(nextProspectStages('İletişime geçildi'), ['Teklif verildi', 'Vazgeçti'])
  assert.deepEqual(nextProspectStages('Görüşme planlandı'), ['Teklif verildi', 'Vazgeçti'])
  assert.deepEqual(nextProspectStages('Teklif verildi'), ['Vazgeçti'])
  assert.deepEqual(nextProspectStages('Vazgeçti'), ['İletişime geçildi'])
  assert.deepEqual(nextProspectStages('Kayıt oldu'), [])
  assert.deepEqual(nextProspectStages(undefined), [])
  assert.equal(PROSPECT_STAGES.length, 6)
})

test('DOM-KAY-030: açık aday ileri aşamaya geçer, aşama atlayabilir', () => {
  const state = seed()
  const contacted = changeProspectStage(state, front, 'pr1', { stage: 'İletişime geçildi' }, now)
  assert.equal(contacted.stage, 'İletişime geçildi')
  assert.equal(contacted.updatedAt, now)
  // DOM-KAY-006: görüşme yapılmadan teklif verilebilir.
  changeProspectStage(state, front, 'pr6', { stage: 'Teklif verildi' }, now)
  assert.equal(prospectOf(state, 'pr6').stage, 'Teklif verildi')
})

test('DOM-KAY-030: aday önceki aşamaya geri alınamaz; aynı aşama değişiklik sayılmaz', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr4', { stage: 'İletişime geçildi' }, now),
    fails('prospect_stage_backward', 'rule', ['stage']),
  )
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr2', { stage: 'Yeni aday' }, now),
    fails('prospect_stage_backward', 'rule', ['stage']),
  )
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'Yeni aday' }, now),
    fails('prospect_stage_unchanged', 'conflict', ['stage']),
  )
})

test('DOM-KAY-005, DOM-KAY-030: Kayıt oldu ve Görüşme planlandı elle seçilemez; kayıtlı aday kilitlidir', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'Kayıt oldu' }, now),
    fails('prospect_enroll_required', 'rule', ['stage']),
  )
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'Görüşme planlandı' }, now),
    fails('prospect_meeting_required', 'rule', ['stage']),
  )
  for (const stage of ['Vazgeçti', 'İletişime geçildi'])
    unchangedOnFailure(
      state,
      () =>
        changeProspectStage(
          state,
          front,
          'pr15',
          stage === 'Vazgeçti' ? { stage, lostReason: 'price' } : { stage },
          now,
        ),
      fails('prospect_enrolled', 'conflict'),
    )
  // Öğrenciye bağlanmış ama aşaması tutarsız eski kayıt da kilitlidir (DOM-KAY-011).
  prospectOf(state, 'pr1').studentId = 's1'
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'İletişime geçildi' }, now),
    fails('prospect_enrolled', 'conflict'),
  )
})

test('DOM-KAY-005: Vazgeçti nedenle girilir; neden yalnız Vazgeçti aşamasında verilir', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'Vazgeçti' }, now),
    fails('prospect_lost_reason_required', 'rule', ['lostReason']),
  )
  for (const body of [
    { stage: 'Teklif verildi', lostReason: 'price' },
    { stage: 'Vazgeçti', lostReason: 'pahalı' },
    { stage: 'Bilinmeyen' },
    { stage: 'Vazgeçti', lostReason: 'price', note: 'serbest metin' },
  ])
    unchangedOnFailure(state, () => changeProspectStage(state, front, 'pr1', body, now), zodError)
  const lost = changeProspectStage(
    state,
    front,
    'pr1',
    { stage: 'Vazgeçti', lostReason: 'other_school' },
    now,
  )
  assert.deepEqual([lost.stage, lost.lostReason, lost.lostAt], ['Vazgeçti', 'other_school', now])
  assert.equal(PROSPECT_LOST_REASON_LABELS[PROSPECT_LOST_REASONS[0]], 'Fiyat')
})

test('DOM-KAY-030: Vazgeçti ileri tarihli görüşmeyi ve deneme dersini iptal eder, geçmişi korur', () => {
  const state = seed()
  const child = languageProspect(state)
  scheduleProspectMeeting(state, front, child.id, meetingInput(), now, language)
  scheduleTrialLesson(
    state,
    front,
    child.id,
    { lessonId: futureLesson(state).id, guardianConsent: true },
    now,
    language,
  )
  changeProspectStage(state, front, child.id, { stage: 'Vazgeçti', lostReason: 'price' }, now)
  assert.equal(child.trialAt, null)
  assert.equal(child.meeting, undefined)
  assert.equal(child.trialLesson, undefined)
  // Geçmiş görüşme kayıtta kalır.
  const pr3 = prospectOf(state, 'pr3')
  const later = '2026-10-09T10:00:00.000Z'
  changeProspectStage(state, front, 'pr3', { stage: 'Vazgeçti', lostReason: 'transport' }, later)
  assert.equal(pr3.trialAt, '2026-10-08T11:00:00.000Z')
})

test('DOM-KAY-030: Vazgeçti yalnız İletişime geçildi ile yeniden açılır ve neden temizlenir', () => {
  const state = seed()
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr5', { stage: 'Teklif verildi' }, now),
    fails('prospect_stage_backward', 'rule', ['stage']),
  )
  const pr5 = prospectOf(state, 'pr5')
  pr5.lostReason = 'price'
  pr5.lostAt = '2026-10-01T09:00:00.000Z'
  const reopened = changeProspectStage(state, front, 'pr5', { stage: 'İletişime geçildi' }, now)
  assert.equal(reopened.stage, 'İletişime geçildi')
  assert.equal('lostReason' in reopened, false)
  assert.equal('lostAt' in reopened, false)
})

test('DOM-KAY-002, DOM-KAY-030: yeniden açılan aday açık bir mükerrerle çakışamaz', () => {
  const state = seed()
  const pr5 = prospectOf(state, 'pr5')
  createProspect(state, front, input({ name: pr5.name, phone: pr5.phone }), id, now)
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr5', { stage: 'İletişime geçildi' }, now),
    fails('prospect_duplicate', 'conflict'),
  )
})

test('DOM-KAY-031, DOM-KAY-030: vazgeçen aday iletişimi paylaşan kardeşi seçilerek yeniden açılır', () => {
  // Ali vazgeçer, aynı telefonla kardeşi Ayşe açılır; Ali yeniden açılırken Ayşe'yi kardeş seçer.
  const state = seed()
  const ali = createProspect(state, front, input({ name: 'Ali Deneme' }), id, now)
  changeProspectStage(state, front, ali.id, { stage: 'Vazgeçti', lostReason: 'price' }, now)
  const ayse = createProspect(state, front, input({ name: 'Ayşe Deneme' }), id, now)
  assert.equal(ayse.siblingOfId, undefined)
  const reopen =
    (body: Record<string, unknown> = {}) =>
    () =>
      changeProspectStage(state, front, ali.id, { stage: 'İletişime geçildi', ...body }, now)
  unchangedOnFailure(state, reopen(), fails('prospect_contact_shared', 'conflict', ['siblingOfId']))
  // Kardeş gerçek, başka ve vazgeçmemiş bir aday olmalı; iletişimi paylaşmalı.
  const invalid = fails('sibling_not_found', 'rule', ['siblingOfId'])
  for (const siblingOfId of ['pr-yok', ali.id, 'pr1', 'pr5', 'pr15'])
    unchangedOnFailure(state, reopen({ siblingOfId }), invalid)
  unchangedOnFailure(
    state,
    () =>
      changeProspectStage(state, front, ali.id, { stage: 'Vazgeçti', siblingOfId: ayse.id }, now),
    zodError,
  )
  unchangedOnFailure(
    state,
    () =>
      changeProspectStage(
        state,
        front,
        ayse.id,
        { stage: 'Teklif verildi', siblingOfId: ali.id },
        now,
      ),
    fails('sibling_reopen_only', 'rule', ['siblingOfId']),
  )
  const reopened = reopen({ siblingOfId: ayse.id })()
  assert.equal(reopened.stage, 'İletişime geçildi')
  assert.equal(reopened.siblingOfId, ayse.id)
  // Kayıtlı kardeş de seçilebilir; e-posta paylaşımı da iletişim sayılır.
  const other = seed()
  const enrolled = prospectOf(other, 'pr15')
  const lost = createProspect(
    other,
    front,
    input({ name: 'Mert Deneme', email: enrolled.email.toUpperCase() }),
    id,
    now,
  )
  changeProspectStage(other, front, lost.id, { stage: 'Vazgeçti', lostReason: 'transport' }, now)
  changeProspectStage(
    other,
    front,
    lost.id,
    { stage: 'İletişime geçildi', siblingOfId: enrolled.id },
    now,
  )
  assert.equal(lost.siblingOfId, enrolled.id)
})

test('Tanınmayan eski aşama değiştirilemez; dil okulu görüşme aşamasını kendi adıyla gösterir', () => {
  const state = seed()
  prospectOf(state, 'pr1').stage = 'Eski aşama'
  unchangedOnFailure(
    state,
    () => changeProspectStage(state, front, 'pr1', { stage: 'Teklif verildi' }, now),
    fails('prospect_stage_unknown', 'conflict'),
  )
  assert.equal(
    prospectStageLabel('Görüşme planlandı', 'language_school'),
    'Seviye tespiti / deneme dersi planlandı',
  )
  assert.equal(prospectStageLabel('Görüşme planlandı'), 'Görüşme planlandı')
  assert.equal(prospectStageLabel('Teklif verildi', 'language_school'), 'Teklif verildi')
  assert.equal(prospectStageLabel(undefined), '')
})

// --- Kesin kayıt ------------------------------------------------------------------------------

const registration = (prospectId: string) => ({
  prospectId,
  classId: 'c1',
  totalCents: 12_000_000,
  count: 3,
  startDate: '2026-11-01',
  // Örnek adaylar üç kampüse dağılır; bu testler aşama kuralını sınar (DOM-KAY-035).
  allowOtherCampus: true,
})

test('DOM-KAY-035: kesin kayıt yetkisi yalnız yönetici ve ön büroda, CRM modülüne bağlı', () => {
  const state = seed()
  const decision = (role: Role) => {
    const result = authorize(people[role], 'prospect.enroll', {}, state)
    return result.allowed ? 'allowed' : result.code
  }
  assert.equal(decision('yonetici'), 'allowed')
  assert.equal(decision('onburo'), 'allowed')
  for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
    assert.equal(decision(role), 'permission_denied')
  state.modules.crm = false
  assert.equal(decision('yonetici'), 'module_disabled')
})

test('DOM-KAY-035: yalnız açık aşamadaki aday kayda alınır; Vazgeçti ve tanınmayan aşama reddedilir', () => {
  const state = seed()
  const closed = fails('prospect_closed', 'conflict')
  unchangedOnFailure(state, () => enrollProspect(state, registration('pr5'), id, now), closed)
  prospectOf(state, 'pr4').stage = 'Eski aşama'
  unchangedOnFailure(state, () => enrollProspect(state, registration('pr4'), id, now), closed)
  unchangedOnFailure(
    state,
    () => enrollProspect(state, registration('pr15'), id, now),
    fails('prospect_already_enrolled', 'conflict'),
  )
  // Her açık aşama kayda alınabilir; vazgeçen aday yeniden açılınca kayda alınır.
  for (const prospectId of ['pr1', 'pr2', 'pr3', 'pr9']) {
    const { student } = enrollProspect(state, registration(prospectId), id, now)
    assert.equal(prospectOf(state, prospectId).stage, 'Kayıt oldu')
    assert.equal(prospectOf(state, prospectId).studentId, student.id)
  }
  changeProspectStage(state, front, 'pr5', { stage: 'İletişime geçildi' }, now)
  enrollProspect(state, registration('pr5'), id, now)
  assert.equal(prospectOf(state, 'pr5').stage, 'Kayıt oldu')
})

// --- Not ------------------------------------------------------------------------------------

test('DOM-KAY-032: not eklenir; önceki notlar değişmez ve en yeni not başta durur', () => {
  const state = seed()
  const pr1 = prospectOf(state, 'pr1')
  const previous = pr1.notes.slice()
  const snapshot = JSON.stringify(previous)
  const note = addProspectNote(
    state,
    front,
    'pr1',
    { text: '  Veli kampüs gezisi istedi.  ' },
    id,
    now,
    { authorName: 'Büşra Aydın' },
  )
  assert.deepEqual(note, {
    id: note.id,
    text: 'Veli kampüs gezisi istedi.',
    date: now,
    author: 'Büşra Aydın',
    by: { role: 'onburo', userId: 'u-front' },
  })
  assert.equal(pr1.notes[0], note)
  assert.equal(pr1.notes.length, previous.length + 1)
  // Önceki not nesneleri aynı kalır (değiştirilmez, yeniden yazılmaz).
  previous.forEach((old, i) => assert.equal(pr1.notes[i + 1], old))
  assert.equal(JSON.stringify(pr1.notes.slice(1)), snapshot)
  assert.equal(pr1.updatedAt, now)
  // Yazar adı verilmezse boş kalır; yazan kişi `by` alanındadır.
  const second = addProspectNote(
    state,
    people.yonetici,
    'pr1',
    { text: 'Teklif hazırlanacak.' },
    id,
    now,
  )
  assert.equal(second.author, '')
  assert.equal(second.by?.role, 'yonetici')
})

test('DOM-KAY-032: not düzenleme ve silme işlemi yoktur; gövde yalnız metni kabul eder', () => {
  const names = Object.keys(prospects)
  for (const name of names) assert.ok(!/^(update|edit|delete|remove).*Note/i.test(name), name)
  const state = seed()
  for (const body of [
    { text: '' },
    { text: 'x' },
    { text: 'a'.repeat(2001) },
    { text: 'Not', id: 'note0' },
    { text: 'Not', date: '2020-01-01T00:00:00.000Z' },
  ])
    unchangedOnFailure(state, () => addProspectNote(state, front, 'pr1', body, id, now), zodError)
})

test('DOM-KAY-032: kapalı adaya not eklenmez; not sayısı sınırlıdır', () => {
  const state = seed()
  for (const prospectId of ['pr5', 'pr15'])
    unchangedOnFailure(
      state,
      () => addProspectNote(state, front, prospectId, { text: 'Yeniden aradım.' }, id, now),
      fails('prospect_closed', 'conflict'),
    )
  const pr1 = prospectOf(state, 'pr1')
  pr1.notes = Array.from({ length: PROSPECT_NOTE_LIMIT }, (_, i) => ({
    id: `note-limit-${i}`,
    text: 'Not',
    date: now,
    author: '',
  }))
  unchangedOnFailure(
    state,
    () => addProspectNote(state, front, 'pr1', { text: 'Bir not daha.' }, id, now),
    fails('prospect_note_limit', 'conflict'),
  )
})

// --- Tanışma görüşmesi ------------------------------------------------------------------------

test('DOM-KAY-006, DOM-KAY-033: görüşme planlanır, aday Görüşme planlandı olur', () => {
  const state = withoutMeetings()
  const planned = scheduleProspectMeeting(state, front, 'pr1', meetingInput(), now)
  assert.equal(planned.stage, 'Görüşme planlandı')
  assert.equal(planned.trialAt, saturday)
  assert.deepEqual(planned.meeting, {
    date: saturday,
    duration: 45,
    room: 'Görüşme odası',
    teacherId: null,
    scheduledAt: now,
    by: { role: 'onburo', userId: 'u-front' },
  })
  // Süre verilmezse varsayılan 30 dakikadır; öğretmen aynı kampüstendir.
  const pr2 = prospectOf(state, 'pr2')
  pr2.branchId = 'b1'
  scheduleProspectMeeting(
    state,
    front,
    'pr2',
    { date: '2026-10-10T12:00:00.000Z', room: 'Müdür odası', teacherId: 't1' },
    now,
  )
  assert.equal(pr2.meeting?.duration, MEETING_DURATION.default)
  assert.equal(pr2.meeting?.teacherId, 't1')
  assert.equal(pr2.stage, 'Görüşme planlandı')
})

test('DOM-KAY-033: Teklif verildi aşamasındaki aday görüşmeyle geri gitmez; yeniden planlama yer değiştirir', () => {
  const state = withoutMeetings()
  const pr4 = scheduleProspectMeeting(state, front, 'pr4', meetingInput(), now)
  assert.equal(pr4.stage, 'Teklif verildi')
  // Kendi görüşmesi çakışma sayılmaz; yeni saat eskisinin yerini alır.
  scheduleProspectMeeting(
    state,
    front,
    'pr4',
    meetingInput({ date: '2026-10-10T10:15:00.000Z' }),
    now,
  )
  assert.equal(pr4.trialAt, '2026-10-10T10:15:00.000Z')
  assert.equal(pr4.meeting?.date, '2026-10-10T10:15:00.000Z')
})

test('DOM-KAY-006: geçmiş veya şimdiki zamana görüşme planlanamaz', () => {
  const state = withoutMeetings()
  for (const date of [now, '2026-10-06T09:59:00.000Z', '2025-01-01T09:00:00.000Z'])
    unchangedOnFailure(
      state,
      () => scheduleProspectMeeting(state, front, 'pr1', meetingInput({ date }), now),
      fails('meeting_in_past', 'rule', ['date']),
    )
  for (const body of [
    meetingInput({ date: '2026-10-10 10:00' }),
    meetingInput({ date: '2026-10-10T13:00:00+03:00' }),
    meetingInput({ duration: 10 }),
    meetingInput({ duration: 121 }),
    meetingInput({ duration: 30.5 }),
    meetingInput({ room: '' }),
    meetingInput({ branchId: 'b2' }),
  ])
    unchangedOnFailure(
      state,
      () => scheduleProspectMeeting(state, front, 'pr1', body, now),
      zodError,
    )
})

test('DOM-KAY-033: kapalı adaya, pasif kampüste veya başka kampüsün öğretmeniyle görüşme planlanmaz', () => {
  const state = withoutMeetings()
  for (const prospectId of ['pr5', 'pr15'])
    unchangedOnFailure(
      state,
      () => scheduleProspectMeeting(state, front, prospectId, meetingInput(), now),
      fails('prospect_closed', 'conflict'),
    )
  // t17 b2 kampüsündedir; pr1 b1'dedir.
  for (const teacherId of ['t17', 't-yok'])
    unchangedOnFailure(
      state,
      () => scheduleProspectMeeting(state, front, 'pr1', meetingInput({ teacherId }), now),
      fails('meeting_teacher_unavailable', 'rule', ['teacherId']),
    )
  const t1 = state.teachers.find((t) => t.id === 't1')!
  t1.isActive = false
  unchangedOnFailure(
    state,
    () => scheduleProspectMeeting(state, front, 'pr1', meetingInput({ teacherId: 't1' }), now),
    fails('meeting_teacher_unavailable', 'rule', ['teacherId']),
  )
  state.branches[0]!.isActive = false
  unchangedOnFailure(
    state,
    () => scheduleProspectMeeting(state, front, 'pr1', meetingInput(), now),
    fails('branch_unavailable', 'rule', ['branchId']),
  )
})

test('DOM-KAY-006: aynı kampüste aynı oda için süre dikkate alınarak çakışma engellenir', () => {
  const state = withoutMeetings()
  // pr1 10:00–10:45; pr4 de b1'dedir.
  scheduleProspectMeeting(state, front, 'pr1', meetingInput(), now)
  const conflict = fails('meeting_conflict', 'conflict', ['date'])
  // Başlangıç eşit değil ama aralık örtüşür (10:30).
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr4',
        meetingInput({ date: '2026-10-10T10:30:00.000Z' }),
        now,
      ),
    conflict,
  )
  // Önce başlayıp içine taşan görüşme (09:30–10:15).
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr4',
        meetingInput({ date: '2026-10-10T09:30:00.000Z' }),
        now,
      ),
    conflict,
  )
  // Oda adı büyük/küçük harf farkıyla da aynı odadır.
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr4',
        meetingInput({ date: '2026-10-10T10:30:00.000Z', room: 'GÖRÜŞME ODASI' }),
        now,
      ),
    conflict,
  )
  // Bitişik görüşme (10:45) çakışmaz.
  scheduleProspectMeeting(
    state,
    front,
    'pr4',
    meetingInput({ date: '2026-10-10T10:45:00.000Z' }),
    now,
  )
  assert.equal(prospectOf(state, 'pr4').trialAt, '2026-10-10T10:45:00.000Z')
})

test('DOM-KAY-006: aynı görevli öğretmen farklı odada da çakışır; farklı oda ve görevli çakışmaz', () => {
  const state = withoutMeetings()
  scheduleProspectMeeting(state, front, 'pr1', meetingInput({ teacherId: 't1' }), now)
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr4',
        meetingInput({ room: 'Müdür odası', teacherId: 't1' }),
        now,
      ),
    fails('meeting_conflict', 'conflict'),
  )
  scheduleProspectMeeting(
    state,
    front,
    'pr4',
    meetingInput({ room: 'Müdür odası', teacherId: 't2' }),
    now,
  )
  // Başka kampüste aynı oda adı ve saat çakışmaz (pr2 b2).
  scheduleProspectMeeting(state, front, 'pr2', meetingInput(), now)
  assert.equal(prospectOf(state, 'pr2').trialAt, saturday)
})

test('DOM-KAY-033: oda ve görevlisi bilinmeyen eski görüşme kampüsteki örtüşen her görüşmeyi engeller', () => {
  const state = withoutMeetings()
  // Eski kayıt: yalnız `trialAt` (30 dk varsayılır).
  prospectOf(state, 'pr1').trialAt = '2026-10-10T10:20:00.000Z'
  unchangedOnFailure(
    state,
    () => scheduleProspectMeeting(state, front, 'pr4', meetingInput({ room: 'Başka oda' }), now),
    fails('meeting_conflict', 'conflict'),
  )
  scheduleProspectMeeting(
    state,
    front,
    'pr4',
    meetingInput({ date: '2026-10-10T10:50:00.000Z' }),
    now,
  )
})

test('DOM-KAY-033: kayda alınmış veya vazgeçmiş adayın ileri tarihli görüşmesi saati tutmaz', () => {
  // Seed pr18 (b3) kayda alınmış; ileri tarihli, odası bilinmeyen eski görüşmesi kalmıştır.
  const state = seed()
  const enrolled = prospectOf(state, 'pr18')
  assert.equal(enrolled.stage, 'Kayıt oldu')
  assert.ok(enrolled.trialAt && Date.parse(enrolled.trialAt) > Date.parse(now))
  const pr3 = prospectOf(state, 'pr3')
  assert.equal(pr3.branchId, enrolled.branchId)
  const date = enrolled.trialAt
  scheduleProspectMeeting(state, front, 'pr3', meetingInput({ date }), now)
  assert.equal(pr3.trialAt, date)
  // Vazgeçmiş adayın kalmış eski görüşmesi de saymaz; aday yeniden açılınca yine sayılır.
  const other = seed()
  const lost = prospectOf(other, 'pr18')
  lost.stage = 'Vazgeçti'
  lost.studentId = null
  scheduleProspectMeeting(other, front, 'pr3', meetingInput({ date }), now)
  lost.stage = 'İletişime geçildi'
  unchangedOnFailure(
    other,
    () => scheduleProspectMeeting(other, front, 'pr3', meetingInput({ date }), now),
    fails('meeting_conflict', 'conflict'),
  )
})

test('DOM-KAY-006: görüşme öğretmenin dersi ve dersliğin kullanımıyla çakışamaz (tutor-conflicts)', () => {
  const state = withoutMeetings()
  // c1 dersi: 2026-10-06 10:50–11:30, t13, derslik 101 (b1).
  const lessonTime = '2026-10-06T11:00:00.000Z'
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr1',
        meetingInput({ date: lessonTime, room: '101' }),
        now,
      ),
    (error) =>
      fails('meeting_conflict', 'conflict')(error) &&
      (error as Error).message === 'Derslik bu saatte kullanımda.',
  )
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr1',
        meetingInput({ date: lessonTime, teacherId: 't13' }),
        now,
      ),
    (error) =>
      fails('meeting_conflict', 'conflict')(error) &&
      (error as Error).message === 'Öğretmenin bu saatte dersi var.',
  )
  // Öğretmenin onaylanmış randevusu (t1, 2026-10-09 13:00).
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        'pr1',
        meetingInput({ date: '2026-10-09T13:10:00.000Z', teacherId: 't1' }),
        now,
      ),
    fails('meeting_conflict', 'conflict'),
  )
})

// --- Deneme dersi -----------------------------------------------------------------------------

test('DOM-DIL-030, DOM-KAY-034: deneme dersi veli onayıyla planlanır, yoklamaya yazılmaz', () => {
  const state = seed()
  const child = languageProspect(state)
  const lesson = futureLesson(state)
  const attendance = JSON.stringify(state.attendance)
  const planned = scheduleTrialLesson(
    state,
    front,
    child.id,
    { lessonId: lesson.id, guardianConsent: true },
    now,
    language,
  )
  assert.deepEqual(planned.trialLesson, {
    lessonId: lesson.id,
    classId: 'c1',
    date: lesson.date,
    duration: lesson.duration,
    guardianConsentAt: now,
    scheduledAt: now,
    by: { role: 'onburo', userId: 'u-front' },
  })
  assert.equal(planned.stage, 'Görüşme planlandı')
  assert.equal(JSON.stringify(state.attendance), attendance)
  // Yetişkin aday için veli onayı istenmez.
  const adult = createProspect(
    state,
    front,
    input({ minor: false, phone: '05559990010', name: 'Yetişkin Aday' }),
    id,
    now,
    language,
  )
  changeProspectStage(state, front, adult.id, { stage: 'Teklif verildi' }, now, language)
  scheduleTrialLesson(state, front, adult.id, { lessonId: lesson.id }, now, language)
  assert.equal(adult.trialLesson?.guardianConsentAt, null)
  assert.equal(adult.stage, 'Teklif verildi')
})

test('DOM-DIL-030: 18 yaş altı adayda veli onayı ve veli iletişim bilgisi zorunludur', () => {
  const state = seed()
  const child = languageProspect(state)
  const lessonId = futureLesson(state).id
  for (const guardianConsent of [undefined, false])
    unchangedOnFailure(
      state,
      () =>
        scheduleTrialLesson(state, front, child.id, { lessonId, guardianConsent }, now, language),
      fails('trial_guardian_consent_required', 'rule', ['guardianConsent']),
    )
  // Yaşı ve veli adı bilinmeyen eski aday 18 yaş altı sayılır.
  unchangedOnFailure(
    state,
    () =>
      scheduleTrialLesson(state, front, 'pr1', { lessonId, guardianConsent: true }, now, language),
    fails('trial_guardian_contact_required', 'rule', ['guardianName']),
  )
  child.phone = ''
  unchangedOnFailure(
    state,
    () =>
      scheduleTrialLesson(
        state,
        front,
        child.id,
        { lessonId, guardianConsent: true },
        now,
        language,
      ),
    fails('trial_guardian_contact_required', 'rule', ['guardianName']),
  )
})

test('DOM-DIL-030: deneme dersi gelecek, iptal edilmemiş, adayın kampüsündeki açık grubun dersidir', () => {
  const state = seed()
  const child = languageProspect(state)
  const consent = { guardianConsent: true }
  const attempt = (lessonId: string) => () =>
    scheduleTrialLesson(state, front, child.id, { lessonId, ...consent }, now, language)
  unchangedOnFailure(
    state,
    attempt('lesson-yok'),
    fails('lesson_not_found', 'not_found', ['lessonId']),
  )
  const past = state.schedule.find(
    (l) => l.classId === 'c1' && Date.parse(l.date) <= Date.parse(now),
  )!
  unchangedOnFailure(state, attempt(past.id), fails('trial_in_past', 'rule', ['lessonId']))
  const cancelled = state.schedule.filter(
    (l) => l.classId === 'c1' && Date.parse(l.date) > Date.parse(now),
  )[1]!
  cancelled.cancelledAt = now
  unchangedOnFailure(state, attempt(cancelled.id), fails('lesson_cancelled', 'rule', ['lessonId']))
  // c9 b2 kampüsündedir.
  unchangedOnFailure(
    state,
    attempt(futureLesson(state, 'c9').id),
    fails('trial_group_unavailable', 'rule', ['lessonId']),
  )
  const group = state.classes.find((c) => c.id === 'c2')!
  group.isActive = false
  unchangedOnFailure(
    state,
    attempt(futureLesson(state, 'c2').id),
    fails('trial_group_unavailable', 'rule', ['lessonId']),
  )
  state.classes.splice(state.classes.indexOf(group), 1)
  unchangedOnFailure(
    state,
    attempt(futureLesson(state, 'c2').id),
    fails('trial_group_unavailable', 'rule', ['lessonId']),
  )
  for (const body of [{}, { lessonId: '' }, { lessonId: 'x', classId: 'c1' }])
    unchangedOnFailure(
      state,
      () => scheduleTrialLesson(state, front, child.id, body, now, language),
      zodError,
    )
})

test('DOM-DIL-030: bir derse en fazla iki deneme katılımcısı alınır', () => {
  const state = seed()
  const lessonId = futureLesson(state).id
  const plan = (n: number) => {
    const p = languageProspect(state, { phone: `0555999100${n}`, name: `Deneme Aday ${n}` })
    return () =>
      scheduleTrialLesson(state, front, p.id, { lessonId, guardianConsent: true }, now, language)
  }
  plan(1)()
  plan(2)()
  unchangedOnFailure(state, plan(3), fails('trial_lesson_full', 'conflict', ['lessonId']))
  assert.equal(TRIAL_PARTICIPANTS_PER_LESSON, 2)
})

test('DOM-DIL-030, DOM-DIL-040: aktif kursiyer + deneme katılımcısı grup kapasitesini (en fazla 18) aşamaz', () => {
  const state = seed()
  const lessonId = futureLesson(state).id
  const group = state.classes.find((c) => c.id === 'c1')!
  const enrolled = state.students.filter((s) => s.classId === 'c1' && s.isActive).length
  const first = languageProspect(state, { phone: '05559992001', name: 'Birinci Aday' })
  const second = languageProspect(state, { phone: '05559992002', name: 'İkinci Aday' })
  group.capacity = enrolled + 1
  scheduleTrialLesson(state, front, first.id, { lessonId, guardianConsent: true }, now, language)
  unchangedOnFailure(
    state,
    () =>
      scheduleTrialLesson(
        state,
        front,
        second.id,
        { lessonId, guardianConsent: true },
        now,
        language,
      ),
    fails('trial_capacity_full', 'conflict', ['lessonId']),
  )
  // Kurumdaki kapasite 18'i aşsa da dil okulu tavanı 18'dir.
  const other = seed()
  const otherLesson = futureLesson(other).id
  other.classes.find((c) => c.id === 'c1')!.capacity = 40
  // 17 kursiyer + 1 deneme katılımcısı tam 18'dir ve kabul edilir; 19. kişi reddedilir.
  const extra = LANGUAGE_GROUP_CAPACITY_MAX - 1 - enrolled
  other.students
    .filter((s) => s.classId !== 'c1' && s.isActive)
    .slice(0, extra)
    .forEach((s) => (s.classId = 'c1'))
  const atLimit = languageProspect(other)
  scheduleTrialLesson(
    other,
    front,
    atLimit.id,
    { lessonId: otherLesson, guardianConsent: true },
    now,
    language,
  )
  assert.equal(atLimit.trialLesson?.lessonId, otherLesson)
  const late = languageProspect(other, { phone: '05559992003', name: 'Geç Aday' })
  unchangedOnFailure(
    other,
    () =>
      scheduleTrialLesson(
        other,
        front,
        late.id,
        { lessonId: otherLesson, guardianConsent: true },
        now,
        language,
      ),
    fails('trial_capacity_full', 'conflict'),
  )
})

test('DOM-DIL-030, DOM-DIL-040: kayda alınan veya vazgeçen adayın denemesi kapasitede ve katılımcı sınırında sayılmaz', () => {
  const state = seed()
  const lessonId = futureLesson(state).id
  const plan = (p: { id: string }) =>
    scheduleTrialLesson(state, front, p.id, { lessonId, guardianConsent: true }, now, language)
  const first = languageProspect(state, { phone: '05559994001', name: 'Kayıtlı Aday' })
  const second = languageProspect(state, { phone: '05559994002', name: 'Vazgeçen Aday' })
  plan(first)
  plan(second)
  // Birinci aday c1'e kayıt olur (kursiyer sayılır), ikinci vazgeçmiş eski kayıttır.
  const student = state.students.find((s) => s.classId !== 'c1' && s.isActive)!
  student.classId = 'c1'
  first.stage = 'Kayıt oldu'
  first.studentId = student.id
  second.stage = 'Vazgeçti'
  const enrolled = state.students.filter((s) => s.classId === 'c1' && s.isActive).length
  state.classes.find((c) => c.id === 'c1')!.capacity = enrolled + 1
  const third = languageProspect(state, { phone: '05559994003', name: 'Üçüncü Aday' })
  plan(third)
  assert.equal(third.trialLesson?.lessonId, lessonId)
})

test('DOM-DIL-030: deneme dersi bir kez; gerçekleşmişse tekrar planlanmaz, ileri tarihli değiştirilebilir', () => {
  const state = seed()
  const child = languageProspect(state)
  const [first, second] = state.schedule.filter(
    (l) => l.classId === 'c1' && Date.parse(l.date) > Date.parse(now),
  )
  assert.ok(first && second)
  scheduleTrialLesson(
    state,
    front,
    child.id,
    { lessonId: first.id, guardianConsent: true },
    now,
    language,
  )
  // Kendi ileri tarihli deneme dersi katılımcı sayısına girmez; yeni ders eskisinin yerini alır.
  state.classes.find((c) => c.id === 'c1')!.capacity =
    state.students.filter((s) => s.classId === 'c1' && s.isActive).length + 1
  scheduleTrialLesson(
    state,
    front,
    child.id,
    { lessonId: first.id, guardianConsent: true },
    now,
    language,
  )
  scheduleTrialLesson(
    state,
    front,
    child.id,
    { lessonId: second.id, guardianConsent: true },
    now,
    language,
  )
  assert.equal(child.trialLesson?.lessonId, second.id)
  const afterLesson = new Date(Date.parse(second.date) + 60 * 60000).toISOString()
  const later = state.schedule.find(
    (l) => l.classId === 'c1' && Date.parse(l.date) > Date.parse(afterLesson),
  )!
  unchangedOnFailure(
    state,
    () =>
      scheduleTrialLesson(
        state,
        front,
        child.id,
        { lessonId: later.id, guardianConsent: true },
        afterLesson,
        language,
      ),
    fails('trial_already_used', 'conflict'),
  )
})

test('DOM-DIL-030, DOM-KAY-034: iptal edilen veya programdan kalkan derse bağlı deneme kullanılmış sayılmaz', () => {
  const state = seed()
  const child = languageProspect(state)
  const hourAfter = (date: string) => new Date(Date.parse(date) + 60 * 60000).toISOString()
  const nextLesson = (after: string) => {
    const lesson = state.schedule.find(
      (l) => l.classId === 'c1' && Date.parse(l.date) > Date.parse(after),
    )
    assert.ok(lesson)
    return lesson
  }
  const first = nextLesson(now)
  const second = nextLesson(hourAfter(first.date))
  const third = nextLesson(hourAfter(second.date))
  const plan = (lessonId: string, at: string) =>
    scheduleTrialLesson(state, front, child.id, { lessonId, guardianConsent: true }, at, language)
  plan(first.id, now)
  // Ders iptal edilir; tarihi geçtikten sonra deneme yeniden planlanabilir.
  first.cancelledAt = now
  plan(second.id, hourAfter(first.date))
  assert.equal(child.trialLesson?.lessonId, second.id)
  // Ders programdan kalkarsa da deneme yapılmamış sayılır.
  state.schedule.splice(state.schedule.indexOf(second), 1)
  plan(third.id, hourAfter(second.date))
  assert.equal(child.trialLesson?.lessonId, third.id)
})

test('DOM-KAY-034: adayın görüşmesi ve deneme dersi çakışamaz; kapalı adaya deneme dersi planlanmaz', () => {
  const state = seed()
  const child = languageProspect(state)
  const lesson = futureLesson(state)
  scheduleProspectMeeting(
    state,
    front,
    child.id,
    meetingInput({ date: lesson.date, room: 'Görüşme odası' }),
    now,
    language,
  )
  unchangedOnFailure(
    state,
    () =>
      scheduleTrialLesson(
        state,
        front,
        child.id,
        { lessonId: lesson.id, guardianConsent: true },
        now,
        language,
      ),
    fails('prospect_schedule_conflict', 'conflict'),
  )
  // Ters yön: deneme dersi varken örtüşen görüşme planlanmaz.
  const other = languageProspect(state, { phone: '05559993001', name: 'Diğer Aday' })
  scheduleTrialLesson(
    state,
    front,
    other.id,
    { lessonId: lesson.id, guardianConsent: true },
    now,
    language,
  )
  unchangedOnFailure(
    state,
    () =>
      scheduleProspectMeeting(
        state,
        front,
        other.id,
        meetingInput({ date: lesson.date, room: 'Başka oda' }),
        now,
        language,
      ),
    fails('prospect_schedule_conflict', 'conflict'),
  )
  for (const prospectId of ['pr5', 'pr15'])
    unchangedOnFailure(
      state,
      () =>
        scheduleTrialLesson(
          state,
          front,
          prospectId,
          { lessonId: lesson.id, guardianConsent: true },
          now,
          language,
        ),
      fails('prospect_closed', 'conflict'),
    )
})
