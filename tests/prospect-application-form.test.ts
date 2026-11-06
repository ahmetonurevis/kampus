import assert from 'node:assert/strict'
import test from 'node:test'

import { createSeed, type State } from '../packages/school-core/src/data/seed.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  APPLICATION_NOTE_AUTHOR,
  APPLICATION_NOTE_FIELD_MAX,
  APPLICATION_NOTE_LIMIT,
  APPLICATION_NOTE_TOTAL_LIMIT,
  APPLICATION_NOTE_WINDOW_MS,
  applicationFrameAncestors,
  isApplicationFormKey,
  prospectApplicationSchema,
  siteOriginSchema,
  submitProspectApplication,
  updateApplicationFormSchema,
  type ProspectApplicationOptions,
} from '../packages/school-core/src/lib/prospect-application-form.ts'
import {
  hasMarketingConsent,
  hasUnverifiedMarketingConsent,
  PROSPECT_NOTE_LIMIT,
} from '../packages/school-core/src/lib/prospects.ts'

// Seed: pr1 Alara Güven (b1, Yeni aday), pr5 Vazgeçti. Her test kendi State'ini kurar.
const now = '2026-10-06T10:00:00.000Z'
const LATER_SAME_DAY = '2026-10-06T20:00:00.000Z'
const NEXT_DAY = '2026-10-07T10:00:01.000Z'

function fresh(): State {
  return createSeed(new Date(now))
}

const options = (overrides: Partial<ProspectApplicationOptions> = {}) => {
  let counter = 0
  return {
    institutionType: 'school',
    noticeVersion: 3,
    makeId: (prefix: string) => `${prefix}-form-${(counter += 1)}`,
    now,
    ...overrides,
  } satisfies ProspectApplicationOptions
}

const body = (overrides: Record<string, unknown> = {}) => ({
  name: 'Mert Ak',
  phone: '05321110099',
  branchId: 'b1',
  interest: '7. sınıf',
  guardianName: 'Sevgi Ak',
  privacyNoticeVersion: '3',
  ...overrides,
})

function firstProspect(state: State) {
  const prospect = state.prospects[0]
  assert.ok(prospect)
  return prospect
}

function code(error: unknown) {
  assert.ok(error instanceof DomainError)
  return error.code
}

test('DOM-KAY-009: başvuru Yeni aday, Web sitesi kaynaklı açılır, aydınlatma sürümü ve anı saklanır', () => {
  const state = fresh()
  const before = state.prospects.length
  const outcome = submitProspectApplication(state, body(), options())
  assert.equal(outcome.kind, 'created')
  assert.equal(state.prospects.length, before + 1)
  const prospect = firstProspect(state)
  assert.equal(prospect.stage, 'Yeni aday')
  assert.equal(prospect.source, 'Web sitesi')
  assert.equal(prospect.guardianName, 'Sevgi Ak')
  assert.equal(prospect.minor, true)
  assert.deepEqual(prospect.privacyNotice, { version: '3', shownAt: now })
  assert.equal(prospect.createdBy, undefined)
})

test('DOM-KAY-004: ticari ileti onayı varsayılan kapalı, kanal başına verilir', () => {
  const closed = fresh()
  submitProspectApplication(closed, body(), options())
  const consent = firstProspect(closed).marketingConsent
  assert.equal(consent?.sms.granted, false)
  assert.equal(consent?.email.granted, false)
  assert.equal(consent?.call.granted, false)

  const granted = fresh()
  submitProspectApplication(granted, body({ marketingConsent: { sms: true } }), options())
  const chosen = firstProspect(granted).marketingConsent
  assert.equal(chosen?.sms.granted, true)
  assert.equal(chosen?.call.granted, false)
})

test('DOM-KAY-004: formda işaretlenen kanal doğrulanmamış yazılır ve onay sayılmaz; işaretlenmeyende işaret yok', () => {
  const state = fresh()
  submitProspectApplication(state, body({ marketingConsent: { sms: true } }), options())
  const prospect = firstProspect(state)
  assert.deepEqual(prospect.marketingConsent?.sms, { granted: true, at: now, verified: false })
  assert.deepEqual(prospect.marketingConsent?.call, { granted: false, at: now })
  assert.equal(hasMarketingConsent(prospect, 'sms'), false)
  assert.equal(hasUnverifiedMarketingConsent(prospect, 'sms'), true)
  assert.equal(hasUnverifiedMarketingConsent(prospect, 'call'), false)
})

test('DOM-KAY-009: kimlik no, doğum tarihi, adres, kaynak, referans ve kardeş alanı alınmaz', () => {
  for (const extra of [
    { identityNumber: '11111111110' },
    { birthDate: '2012-01-01' },
    { address: 'Merkez' },
    { source: 'Telefon' },
    { referrerStudentId: 's1' },
    { siblingOfId: 'pr1' },
    { institutionId: 'kurum-b' },
  ]) {
    assert.equal(prospectApplicationSchema.safeParse(body(extra)).success, false)
    const state = fresh()
    const before = structuredClone(state.prospects)
    assert.throws(() => submitProspectApplication(state, body(extra), options()))
    assert.deepEqual(state.prospects, before)
  }
})

test('DOM-KAY-003: aydınlatma sürümü zorunlu; eski sürüm 409 notice_outdated, kayıt değişmez', () => {
  const state = fresh()
  const before = structuredClone(state.prospects)
  assert.throws(() =>
    submitProspectApplication(state, body({ privacyNoticeVersion: undefined }), options()),
  )
  assert.throws(
    () => submitProspectApplication(state, body({ privacyNoticeVersion: '2' }), options()),
    (error) => {
      assert.equal(code(error), 'notice_outdated')
      return true
    },
  )
  assert.deepEqual(state.prospects, before)
})

test('DOM-KAY-009: okulda velisiz başvuru reddedilir, dil okulunda yaş seçimi zorunlu, yetişkinde veli adı saklanmaz', () => {
  const school = fresh()
  assert.throws(
    () => submitProspectApplication(school, body({ guardianName: undefined }), options()),
    (error) => code(error) === 'prospect_guardian_required',
  )
  const language = fresh()
  assert.throws(
    () =>
      submitProspectApplication(language, body(), options({ institutionType: 'language_school' })),
    (error) => code(error) === 'prospect_age_required',
  )
  submitProspectApplication(
    language,
    body({ minor: false }),
    options({ institutionType: 'language_school' }),
  )
  const adult = firstProspect(language)
  assert.equal(adult.minor, false)
  assert.equal(adult.guardianName, undefined)
})

test('DOM-KAY-009: pasif kampüs ve e-postasız e-posta onayı reddedilir, kayıt değişmez', () => {
  const state = fresh()
  const before = structuredClone(state.prospects)
  assert.throws(
    () => submitProspectApplication(state, body({ branchId: 'yok' }), options()),
    (error) => code(error) === 'branch_unavailable',
  )
  assert.throws(
    () => submitProspectApplication(state, body({ marketingConsent: { email: true } }), options()),
    (error) => code(error) === 'consent_contact_missing',
  )
  assert.deepEqual(state.prospects, before)
})

test('IST-145: gizli alan dolu gönderim hiçbir şey yazmaz ve ret almaz', () => {
  const state = fresh()
  const before = structuredClone(state.prospects)
  const outcome = submitProspectApplication(state, body({ website: 'http://spam' }), options())
  assert.deepEqual(outcome, { kind: 'ignored' })
  assert.deepEqual(state.prospects, before)
})

test('DOM-KAY-002: aynı kişinin yeniden başvurusu yeni aday açmaz, mevcut karta not düşer', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const before = state.prospects.length
  const consentBefore = structuredClone(existing.marketingConsent)
  const outcome = submitProspectApplication(
    state,
    body({ name: existing.name, phone: existing.phone, marketingConsent: { sms: true } }),
    options(),
  )
  assert.deepEqual(outcome, { kind: 'noted', prospectId: existing.id })
  assert.equal(state.prospects.length, before)
  const note = existing.notes[0]
  assert.equal(note?.author, APPLICATION_NOTE_AUTHOR)
  assert.equal(note?.text, 'Web sitesi formundan yeniden başvuru alındı.')
  assert.equal(note?.date, now)
  assert.equal(existing.updatedAt, now)
  // Doğrulanmamış gönderim başkasının onayını açamaz (DOM-KAY-004).
  assert.deepEqual(existing.marketingConsent, consentBefore)
})

test('DOM-KAY-002: iletişimi paylaşan başka adın başvurusu yeni aday açmaz, not ad ve ilgi taşır', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const before = state.prospects.length
  const outcome = submitProspectApplication(
    state,
    body({ phone: existing.phone, name: 'Kardeş Aday', interest: '5. sınıf' }),
    options(),
  )
  assert.equal(outcome.kind, 'noted')
  assert.equal(state.prospects.length, before)
  assert.match(existing.notes[0]?.text ?? '', /Kardeş Aday · 5\. sınıf/)
})

test('DOM-KAY-002: aynı form notu 24 saat içinde yinelenmez, sonra yeniden yazılır', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const repeat = body({ name: existing.name, phone: existing.phone })
  submitProspectApplication(state, repeat, options())
  const count = existing.notes.length
  assert.deepEqual(submitProspectApplication(state, repeat, options({ now: LATER_SAME_DAY })), {
    kind: 'ignored',
  })
  assert.equal(existing.notes.length, count)
  assert.equal(submitProspectApplication(state, repeat, options({ now: NEXT_DAY })).kind, 'noted')
  assert.equal(existing.notes.length, count + 1)
})

test('DOM-KAY-002: 24 saat denetimi metinden bağımsızdır; aynı telefonla 20 farklı ad tek not düşer', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const count = existing.notes.length
  const outcomes = Array.from({ length: 20 }, (_, index) =>
    submitProspectApplication(
      state,
      body({ phone: existing.phone, name: `Sahte Aday ${index}`, interest: `İlgi ${index}` }),
      options({ now: LATER_SAME_DAY }),
    ),
  )
  assert.equal(outcomes[0]?.kind, 'noted')
  assert.ok(outcomes.slice(1).every((outcome) => outcome.kind === 'ignored'))
  assert.equal(existing.notes.length, count + 1)
})

const formNotes = (length: number, date: string) =>
  Array.from({ length }, (_, index) => ({
    id: `n${index}`,
    text: `eski ${index}`,
    date,
    author: APPLICATION_NOTE_AUTHOR,
  }))

test('DOM-KAY-002: form notu sınırı pencere içinde sayılır; eski notlar gerçek başvuruyu susturmaz', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const repeat = body({ name: existing.name, phone: existing.phone })
  const inWindow = new Date(Date.parse(now) - APPLICATION_NOTE_WINDOW_MS + 86_400_000).toISOString()
  existing.notes = formNotes(APPLICATION_NOTE_LIMIT, inWindow)
  assert.equal(submitProspectApplication(state, repeat, options()).kind, 'ignored')
  assert.equal(existing.notes.length, APPLICATION_NOTE_LIMIT)

  const outOfWindow = new Date(Date.parse(now) - APPLICATION_NOTE_WINDOW_MS - 1).toISOString()
  existing.notes = formNotes(APPLICATION_NOTE_LIMIT, outOfWindow)
  assert.equal(submitProspectApplication(state, repeat, options()).kind, 'noted')
  assert.equal(existing.notes.length, APPLICATION_NOTE_LIMIT + 1)
})

test('DOM-KAY-002: form notları kartın ön büro payını dolduramaz', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const repeat = body({ name: existing.name, phone: existing.phone })
  existing.notes = formNotes(APPLICATION_NOTE_TOTAL_LIMIT, '2026-01-01T00:00:00.000Z')
  assert.equal(submitProspectApplication(state, repeat, options()).kind, 'ignored')
  assert.equal(existing.notes.length, APPLICATION_NOTE_TOTAL_LIMIT)
  assert.ok(APPLICATION_NOTE_TOTAL_LIMIT < PROSPECT_NOTE_LIMIT)
})

test('DOM-KAY-002: nottaki ad ve ilgi uzunluğu sınırlıdır', () => {
  const state = fresh()
  const existing = firstProspect(state)
  submitProspectApplication(
    state,
    body({ phone: existing.phone, name: 'Ş'.repeat(80), interest: 'İ'.repeat(120) }),
    options(),
  )
  const text = existing.notes[0]?.text ?? ''
  assert.ok(text.includes(`${'Ş'.repeat(APPLICATION_NOTE_FIELD_MAX)}…`))
  assert.equal(text.includes('Ş'.repeat(APPLICATION_NOTE_FIELD_MAX + 1)), false)
  assert.equal(text.includes('İ'.repeat(APPLICATION_NOTE_FIELD_MAX + 1)), false)
})

test('DOM-KAY-002: ön büro notları sınırı doldurduysa form notu yazılmaz', () => {
  const state = fresh()
  const existing = firstProspect(state)
  const repeat = body({ name: existing.name, phone: existing.phone })
  existing.notes = Array.from({ length: PROSPECT_NOTE_LIMIT }, (_, index) => ({
    id: `s${index}`,
    text: `ön büro ${index}`,
    date: '2026-01-01T00:00:00.000Z',
    author: 'Ön Büro',
  }))
  assert.equal(submitProspectApplication(state, repeat, options()).kind, 'ignored')
  assert.equal(existing.notes.length, PROSPECT_NOTE_LIMIT)
})

test('DOM-KAY-002: kapalı adayın iletişimiyle başvuru yeni aday açar', () => {
  const state = fresh()
  const closed = state.prospects.find((item) => item.stage === 'Vazgeçti')
  assert.ok(closed)
  const outcome = submitProspectApplication(state, body({ phone: closed.phone }), options())
  assert.equal(outcome.kind, 'created')
})

test('ON-133: site adresi yalnız https kök adresidir, başlığı bölecek değer geçmez', () => {
  assert.equal(siteOriginSchema.parse('https://Okul.Example/'), 'https://okul.example')
  assert.equal(siteOriginSchema.parse(' https://okul.example:8443 '), 'https://okul.example:8443')
  for (const value of [
    'http://okul.example',
    'https://okul.example/basvuru',
    'https://okul.example?x=1',
    'https://okul.example#a',
    'https://*.okul.example',
    "https://okul.example; script-src 'unsafe-inline'",
    'https://kisi:parola@okul.example',
    'okul.example',
    '',
  ])
    assert.equal(siteOriginSchema.safeParse(value).success, false, value)
  assert.equal(applicationFrameAncestors('https://okul.example'), 'https://okul.example')
  assert.equal(applicationFrameAncestors(null), "'none'")
})

test('ON-133: form ayarı en az bir alan ister, site adresi kaldırılabilir; anahtar biçimi sabittir', () => {
  assert.equal(updateApplicationFormSchema.safeParse({}).success, false)
  assert.equal(updateApplicationFormSchema.safeParse({ enabled: true, x: 1 }).success, false)
  assert.deepEqual(updateApplicationFormSchema.parse({ siteOrigin: null }), { siteOrigin: null })
  assert.equal(isApplicationFormKey('a'.repeat(32)), true)
  assert.equal(isApplicationFormKey('a'.repeat(31)), false)
  assert.equal(isApplicationFormKey(`${'a'.repeat(31)}/`), false)
})
