import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { ageOn } from '../packages/school-core/src/lib/age.ts'
import {
  CONSENT_PURPOSE_KEYS,
  CONSENT_PURPOSES,
} from '../packages/school-core/src/lib/consent-purposes.ts'
import {
  academicYearEndsAt,
  adulthoodStartsAt,
  canGiveConsent,
  hasValidConsent,
  isAdultStudent,
  planConsent,
  planConsentWithdrawal,
  requireConsentAuthority,
  type ConsentActor,
  type ConsentRecord,
  type ConsentStudent,
  type GuardianBond,
} from '../packages/school-core/src/lib/consents.ts'
import {
  latestNotice,
  minimumConsentTextVersion,
  needsNoticeAcknowledgement,
  noticeAudienceForRole,
  planNoticeAcknowledgement,
  planNoticePublication,
  type PrivacyNotice,
} from '../packages/school-core/src/lib/privacy-notices.ts'
import { MODULE_INSTITUTION_TYPES } from '../packages/school-core/src/modules/collection-modules.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const NOW = '2026-10-06T09:00:00.000Z'
const YEAR_END = '2027-06-30T21:00:00.000Z'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const text = (
  n: number,
  fields: Partial<PrivacyNotice> & Pick<PrivacyNotice, 'kind'>,
): PrivacyNotice => ({
  id: uuid(n),
  audience: null,
  purpose: null,
  version: 1,
  title: 'Metin',
  body: 'Gövde',
  requiresReconsent: false,
  publishedAt: '2026-09-01T09:00:00.000Z',
  ...fields,
})
const PHOTO_TEXT = text(1, { kind: 'consent_text', purpose: 'photo_video_sharing' })
const SPEAKING_TEXT = text(2, { kind: 'consent_text', purpose: 'speaking_recording' })
const PROMO_TEXT = text(3, { kind: 'consent_text', purpose: 'promotional_messages' })
const PARENT_NOTICE = text(10, { kind: 'notice', audience: 'veli' })
const STAFF_NOTICE = text(11, { kind: 'notice', audience: 'personel' })
const TEXTS = Object.freeze([PHOTO_TEXT, SPEAKING_TEXT, PROMO_TEXT, PARENT_NOTICE, STAFF_NOTICE])

const MINOR: ConsentStudent = { id: 's1', birthDate: '2010-05-01' }
const ADULT: ConsentStudent = { id: 's2', birthDate: '2007-01-01' }
// 18 yaşını 7 Ekim 2026'da (Europe/Istanbul) doldurur: 6 Ekim 21:00 UTC.
const TURNING: ConsentStudent = { id: 's3', birthDate: '2008-10-07' }
const BEFORE_MIDNIGHT = '2026-10-06T20:59:59.999Z'
const ISTANBUL_MIDNIGHT = '2026-10-06T21:00:00.000Z'

const parent = (...studentIds: string[]): ConsentActor => ({
  role: 'veli',
  userId: 'u-veli',
  links: studentIds.map((recordId) => ({ kind: 'child', recordId })),
})
const studentActor = (studentId: string): ConsentActor => ({
  role: 'ogrenci',
  userId: `u-${studentId}`,
  links: [{ kind: 'student', recordId: studentId }],
})
const custody = (studentId: string, fields: Partial<GuardianBond> = {}): GuardianBond => ({
  studentId,
  verified: true,
  custody: true,
  ...fields,
})

const give = (overrides: Partial<Parameters<typeof planConsent>[0]> = {}) =>
  planConsent({
    actor: parent('s1'),
    student: MINOR,
    guardianBonds: [custody('s1')],
    texts: TEXTS,
    consents: [],
    input: {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: PHOTO_TEXT.id,
      channel: 'web',
    },
    now: NOW,
    academicYearEndsAt: YEAR_END,
    ...overrides,
  })

const record = (n: number, fields: Partial<ConsentRecord> = {}): ConsentRecord => ({
  id: uuid(100 + n),
  ...give().consent,
  ...fields,
})

describe('rıza amaçları', () => {
  test('DOM-YTK-057 zorunlu amaçlar var; her amaç bilinen modülü açar ve veri sahibini söyler', () => {
    for (const purpose of ['photo_video_sharing', 'promotional_messages', 'speaking_recording'])
      assert.ok(CONSENT_PURPOSE_KEYS.includes(purpose as never), purpose)
    for (const [key, rule] of Object.entries(CONSENT_PURPOSES)) {
      assert.ok(Object.hasOwn(MODULE_INSTITUTION_TYPES, rule.module), key)
      assert.ok(rule.opens.length > 0 && rule.label.length > 0, key)
    }
    assert.equal(CONSENT_PURPOSES.promotional_messages.subject, 'user')
    assert.equal(CONSENT_PURPOSES.speaking_recording.subject, 'student')
  })
})

describe('aydınlatma metni (IST-016, DOM-YTK-056)', () => {
  test('DOM-YTK-056 rol kitlesi: yönetici, ön büro ve öğretmen personeldir', () => {
    assert.equal(noticeAudienceForRole('veli'), 'veli')
    assert.equal(noticeAudienceForRole('ogrenci'), 'ogrenci')
    for (const role of ['yonetici', 'onburo', 'ogretmen'] as const)
      assert.equal(noticeAudienceForRole(role), 'personel')
  })

  test('DOM-YTK-056 yayım sürümü konunun son sürümünün bir fazlası; ilk rıza metni yeniden rıza istemez', () => {
    const notice = planNoticePublication({
      notices: TEXTS,
      publishedByUserId: 'u-admin',
      input: { kind: 'notice', audience: 'veli', title: ' Veli aydınlatma ', body: 'Metin' },
      now: NOW,
    })
    assert.deepEqual(notice, {
      kind: 'notice',
      audience: 'veli',
      purpose: null,
      version: 2,
      title: 'Veli aydınlatma',
      body: 'Metin',
      requiresReconsent: false,
      publishedAt: NOW,
      publishedByUserId: 'u-admin',
    })
    const first = planNoticePublication({
      notices: [],
      publishedByUserId: 'u-admin',
      input: {
        kind: 'consent_text',
        purpose: 'photo_video_website',
        title: 'Web sitesi',
        body: 'Metin',
        requiresReconsent: true,
      },
      now: NOW,
    })
    assert.equal(first.version, 1)
    assert.equal(first.requiresReconsent, false)
    assert.equal(first.audience, null)
    const second = planNoticePublication({
      notices: TEXTS,
      publishedByUserId: 'u-admin',
      input: { kind: 'consent_text', purpose: 'photo_video_sharing', title: 'B', body: 'C' },
      now: NOW,
    })
    assert.deepEqual([second.version, second.requiresReconsent], [2, false])
  })

  test('DOM-YTK-056 yayım doğrulaması: boş metin ve kitlesiz aydınlatma reddedilir, liste değişmez', () => {
    const notices = [...TEXTS]
    for (const input of [
      { kind: 'notice', audience: 'veli', title: 'A', body: '   ' },
      { kind: 'notice', title: 'A', body: 'B' },
      { kind: 'consent_text', purpose: 'bilinmeyen', title: 'A', body: 'B' },
      { kind: 'notice', audience: 'veli', title: 'A', body: 'B', purpose: 'photo_video_sharing' },
    ])
      assert.throws(
        () => planNoticePublication({ notices, publishedByUserId: 'u', input, now: NOW }),
        ZodError,
      )
    assert.deepEqual(notices, [...TEXTS])
  })

  test('DOM-YTK-056 son sürüm gösterilir; görülünce düşer; yeni sürüm yeniden gösterilir', () => {
    const user = { userId: 'u-veli', role: 'veli' as const }
    assert.equal(needsNoticeAcknowledgement([], [], user), null)
    assert.equal(needsNoticeAcknowledgement(TEXTS, [], user)?.id, PARENT_NOTICE.id)
    const seen = [{ userId: 'u-veli', noticeId: PARENT_NOTICE.id }]
    assert.equal(needsNoticeAcknowledgement(TEXTS, seen, user), null)
    // Başka kullanıcının gösterimi sayılmaz.
    assert.equal(
      needsNoticeAcknowledgement(TEXTS, seen, { userId: 'u-baska', role: 'veli' })?.id,
      PARENT_NOTICE.id,
    )
    const v2 = text(12, { kind: 'notice', audience: 'veli', version: 2 })
    assert.equal(needsNoticeAcknowledgement([...TEXTS, v2], seen, user)?.id, v2.id)
    assert.equal(
      needsNoticeAcknowledgement(TEXTS, [], { userId: 'u-t', role: 'ogretmen' })?.id,
      STAFF_NOTICE.id,
    )
    // Öğrenci kitlesine metin yayımlanmamış.
    assert.equal(needsNoticeAcknowledgement(TEXTS, [], { userId: 'u-s', role: 'ogrenci' }), null)
    assert.equal(latestNotice(TEXTS, { kind: 'consent_text', purpose: 'photo_video_print' }), null)
  })

  test('DOM-YTK-056 gösterim kaydı: başarılı yol, eski sürüm, başka kitle, mükerrer, geçersiz girdi', () => {
    const v2 = text(12, { kind: 'notice', audience: 'veli', version: 2 })
    const notices = Object.freeze([...TEXTS, v2])
    const acknowledgements = Object.freeze([{ userId: 'u-veli', noticeId: PARENT_NOTICE.id }])
    const user = { userId: 'u-veli', role: 'veli' as const }
    const plan = (input: unknown) =>
      planNoticeAcknowledgement({ notices, acknowledgements, user, input, now: NOW })
    assert.deepEqual(plan({ noticeId: v2.id, channel: 'mobile' }), {
      noticeId: v2.id,
      userId: 'u-veli',
      channel: 'mobile',
      acknowledgedAt: NOW,
    })
    assert.throws(
      () => plan({ noticeId: PARENT_NOTICE.id, channel: 'web' }),
      isDomainError('notice_outdated', 'conflict'),
    )
    assert.throws(
      () => plan({ noticeId: STAFF_NOTICE.id, channel: 'web' }),
      isDomainError('notice_not_found', 'not_found'),
    )
    assert.throws(
      () => plan({ noticeId: PHOTO_TEXT.id, channel: 'web' }),
      isDomainError('notice_not_found', 'not_found'),
    )
    assert.throws(() => plan({ noticeId: 'x', channel: 'web' }), ZodError)
    assert.throws(() => plan({ noticeId: v2.id, channel: 'faks' }), ZodError)
    assert.throws(
      () =>
        planNoticeAcknowledgement({
          notices,
          acknowledgements: [{ userId: 'u-veli', noticeId: v2.id }],
          user,
          input: { noticeId: v2.id, channel: 'web' },
          now: NOW,
        }),
      isDomainError('notice_already_acknowledged', 'conflict'),
    )
    assert.equal(acknowledgements.length, 1)
  })
})

describe('rızayı kim verir (DOM-YTK-057)', () => {
  const authority = (actor: ConsentActor, student: ConsentStudent | null, fields = {}) =>
    requireConsentAuthority({
      actor,
      purpose: 'speaking_recording',
      student,
      guardianBonds: [custody('s1'), custody('s3')],
      now: NOW,
      ...fields,
    })

  test('DOM-YTK-057 18 yaş altında doğrulanmış velayetli veli, 18 ve üstünde öğrencinin kendisi', () => {
    assert.equal(authority(parent('s1'), MINOR), 'guardian')
    assert.equal(authority(studentActor('s2'), ADULT), 'self')
    assert.throws(
      () => authority(studentActor('s1'), MINOR),
      isDomainError('consent_guardian_required', 'forbidden'),
    )
    assert.throws(
      () => authority(parent('s2'), ADULT, { guardianBonds: [custody('s2')] }),
      isDomainError('consent_adult_self', 'forbidden'),
    )
    // Doğum tarihi bilinmeyen öğrenci 18 yaş altı sayılır.
    const unknown = { id: 's1', birthDate: null }
    assert.equal(isAdultStudent(unknown, NOW), false)
    assert.equal(authority(parent('s1'), unknown), 'guardian')
  })

  test('DOM-YTK-057 velayetsiz, doğrulanmamış ya da bağsız ebeveyn reddedilir; kapsam dışı öğrenci bulunamadı', () => {
    for (const bond of [
      custody('s1', { custody: false }),
      custody('s1', { verified: false }),
      custody('s9'),
    ])
      assert.throws(
        () => authority(parent('s1'), MINOR, { guardianBonds: [bond] }),
        isDomainError('consent_custody_required', 'forbidden'),
      )
    assert.throws(
      () => authority(parent('s9'), MINOR),
      isDomainError('consent_student_not_found', 'not_found'),
    )
    assert.throws(
      () => authority(studentActor('s9'), ADULT),
      isDomainError('consent_student_not_found', 'not_found'),
    )
    assert.throws(
      () => authority(parent('s1'), null),
      isDomainError('consent_student_not_found', 'not_found'),
    )
    for (const role of ['yonetici', 'onburo', 'ogretmen'] as const)
      assert.throws(
        () => authority({ role, userId: 'u', links: [] }, MINOR),
        isDomainError('consent_forbidden', 'forbidden'),
      )
    assert.equal(
      canGiveConsent({
        actor: parent('s1'),
        purpose: 'photo_video_sharing',
        student: MINOR,
        guardianBonds: [],
        now: NOW,
      }),
      false,
    )
  })

  test('DOM-YTK-057 17/18 sınırı Europe/Istanbul gece yarısıdır', () => {
    assert.equal(ageOn(TURNING.birthDate!, BEFORE_MIDNIGHT), 17)
    assert.equal(adulthoodStartsAt(TURNING.birthDate!), ISTANBUL_MIDNIGHT)
    assert.equal(authority(parent('s3'), TURNING, { now: BEFORE_MIDNIGHT }), 'guardian')
    assert.throws(
      () => authority(studentActor('s3'), TURNING, { now: BEFORE_MIDNIGHT }),
      isDomainError('consent_guardian_required', 'forbidden'),
    )
    assert.equal(authority(studentActor('s3'), TURNING, { now: ISTANBUL_MIDNIGHT }), 'self')
    assert.throws(
      () => authority(parent('s3'), TURNING, { now: ISTANBUL_MIDNIGHT }),
      isDomainError('consent_adult_self', 'forbidden'),
    )
    // 29 Şubat doğumlu artık olmayan yılda 1 Mart'ta (İstanbul) yaş alır.
    assert.equal(adulthoodStartsAt('2008-02-29'), '2026-02-28T21:00:00.000Z')
    assert.equal(ageOn('2008-02-29', '2026-02-28T20:59:59.999Z'), 17)
    assert.equal(ageOn('2008-02-29', '2026-02-28T21:00:00.000Z'), 18)
  })

  test('DOM-YTK-057 hesap amacında (tanıtım iletisi) yalnız hesap sahibi; 18 yaş altı öğrenciden alınmaz', () => {
    const promo = (actor: ConsentActor, student: ConsentStudent | null) =>
      authority(actor, student, { purpose: 'promotional_messages' })
    assert.equal(promo(parent(), null), 'self')
    assert.equal(promo(studentActor('s2'), ADULT), 'self')
    for (const [actor, student] of [
      [studentActor('s1'), MINOR],
      [studentActor('s1'), null],
      [studentActor('s1'), ADULT],
    ] as const)
      assert.throws(() => promo(actor, student), isDomainError('consent_not_applicable', 'rule'))
    assert.throws(
      () => promo({ role: 'ogretmen', userId: 'u', links: [] }, null),
      isDomainError('consent_forbidden', 'forbidden'),
    )
  })
})

describe('rıza verme (IST-017, DOM-YTK-058)', () => {
  test('DOM-YTK-058 velinin fotoğraf rızası metin sürümü, kanal ve eğitim yılı bitişiyle yazılır', () => {
    assert.deepEqual(give(), {
      consent: {
        subjectKind: 'student',
        subjectId: 's1',
        purpose: 'photo_video_sharing',
        decision: 'granted',
        grantedByUserId: 'u-veli',
        grantorRelation: 'guardian',
        textId: PHOTO_TEXT.id,
        textVersion: 1,
        channel: 'web',
        givenAt: NOW,
        expiresAt: YEAR_END,
        withdrawnAt: null,
        withdrawnByUserId: null,
        withdrawalReason: null,
      },
      close: [],
    })
  })

  test('DOM-YTK-061 velinin konuşma kaydı rızası öğrencinin 18. yaş gününde biter; yetişkinin kendi rızası bitmez', () => {
    const speaking = { purpose: 'speaking_recording', textId: SPEAKING_TEXT.id, channel: 'mobile' }
    const guardian = give({
      actor: parent('s3'),
      student: TURNING,
      guardianBonds: [custody('s3')],
      input: { ...speaking, studentId: 's3' },
      now: '2026-01-10T09:00:00.000Z',
    })
    assert.equal(guardian.consent.expiresAt, ISTANBUL_MIDNIGHT)
    // Eğitim yılı amacında erken olan bitiş geçerlidir.
    const photo = give({
      actor: parent('s3'),
      student: TURNING,
      guardianBonds: [custody('s3')],
      input: {
        purpose: 'photo_video_sharing',
        studentId: 's3',
        textId: PHOTO_TEXT.id,
        channel: 'web',
      },
      now: '2026-01-10T09:00:00.000Z',
      academicYearEndsAt: '2026-06-30T21:00:00.000Z',
    })
    assert.equal(photo.consent.expiresAt, '2026-06-30T21:00:00.000Z')
    const self = give({
      actor: studentActor('s2'),
      student: ADULT,
      input: { ...speaking, studentId: 's2' },
    })
    assert.deepEqual(
      [self.consent.grantorRelation, self.consent.expiresAt, self.consent.grantedByUserId],
      ['self', null, 'u-s2'],
    )
  })

  test('DOM-YTK-058 tanıtım iletisi rızasının veri sahibi hesabın kendisidir', () => {
    const { consent } = give({
      actor: parent(),
      student: null,
      input: { purpose: 'promotional_messages', textId: PROMO_TEXT.id, channel: 'web' },
    })
    assert.deepEqual(
      [consent.subjectKind, consent.subjectId, consent.expiresAt],
      ['user', 'u-veli', null],
    )
    assert.throws(
      () =>
        give({
          input: {
            purpose: 'promotional_messages',
            studentId: 's1',
            textId: PROMO_TEXT.id,
            channel: 'web',
          },
        }),
      ZodError,
    )
  })

  test('DOM-YTK-058 doğrulama ya da kural hatasında taslak üretilmez, girdiler değişmez', () => {
    const consents = Object.freeze([record(1)])
    const texts = [...TEXTS]
    const base = {
      purpose: 'photo_video_sharing',
      studentId: 's1',
      textId: PHOTO_TEXT.id,
      channel: 'web',
    }
    assert.throws(() => give({ consents, input: { ...base, studentId: undefined } }), ZodError)
    assert.throws(() => give({ consents, input: { ...base, channel: 'kağıt' } }), ZodError)
    assert.throws(() => give({ consents, input: { ...base, extra: true } }), ZodError)
    assert.throws(
      () => give({ consents, texts, input: { ...base, textId: SPEAKING_TEXT.id } }),
      isDomainError('consent_text_not_found', 'not_found'),
    )
    assert.throws(
      () => give({ academicYearEndsAt: null }),
      isDomainError('academic_year_required', 'rule'),
    )
    assert.throws(
      () => give({ academicYearEndsAt: '2028-09-01T00:00:00.000Z' }),
      isDomainError('academic_year_required', 'rule'),
    )
    assert.throws(
      () => give({ student: { id: 's9', birthDate: null } }),
      isDomainError('consent_student_not_found', 'not_found'),
    )
    assert.deepEqual(consents, [record(1)])
    assert.deepEqual(texts, [...TEXTS])
  })

  test('DOM-YTK-058 aynı veri sahibi + amaç için tek etkin rıza: mükerrer reddedilir, süresi dolan yenilenir', () => {
    assert.throws(
      () => give({ consents: [record(1)] }),
      isDomainError('consent_exists', 'conflict'),
    )
    // Başka amaç ya da başka öğrencinin rızası engellemez; geri çekilmiş satır kapatılmaz.
    assert.deepEqual(
      give({
        consents: [
          record(2, { purpose: 'photo_video_website' }),
          record(3, { subjectId: 's9' }),
          record(4, {
            withdrawnAt: NOW,
            withdrawnByUserId: 'u-veli',
            withdrawalReason: 'withdrawn',
          }),
        ],
      }).close,
      [],
    )
    const expired = record(5, {
      givenAt: '2025-09-01T09:00:00.000Z',
      expiresAt: '2026-06-30T21:00:00.000Z',
    })
    assert.deepEqual(give({ consents: [expired] }).close, [
      {
        id: expired.id,
        withdrawnAt: NOW,
        withdrawnByUserId: 'u-veli',
        withdrawalReason: 'renewed',
      },
    ])
  })

  test('DOM-YTK-060 yeni sürüm: eski metinle rıza alınmaz; yeniden rıza isteyen sürüm eski rızayı geçersiz kılar', () => {
    const v2 = text(4, {
      kind: 'consent_text',
      purpose: 'photo_video_sharing',
      version: 2,
      requiresReconsent: true,
    })
    const texts = [...TEXTS, v2]
    assert.equal(minimumConsentTextVersion(texts, 'photo_video_sharing'), 2)
    assert.equal(minimumConsentTextVersion(texts, 'speaking_recording'), 1)
    assert.throws(() => give({ texts }), isDomainError('consent_text_outdated', 'conflict'))
    const old = record(1)
    const photo = {
      purpose: 'photo_video_sharing',
      subject: { kind: 'student', student: MINOR },
    } as const
    assert.equal(hasValidConsent([old], { ...photo, texts: TEXTS }, NOW), true)
    // Alt sınır çağırandan sayı olarak alınmaz, metin listesinden hesaplanır; unutulamaz.
    assert.equal(hasValidConsent([old], { ...photo, texts }, NOW), false)
    // Metin listesi yüklenmemişse (amacın rıza metni yok) rıza sayılmaz.
    assert.equal(hasValidConsent([old], { ...photo, texts: [] }, NOW), false)
    assert.equal(hasValidConsent([old], { ...photo, texts: [SPEAKING_TEXT] }, NOW), false)
    const renewed = give({
      texts,
      consents: [old],
      input: { purpose: 'photo_video_sharing', studentId: 's1', textId: v2.id, channel: 'web' },
    })
    assert.equal(renewed.consent.textVersion, 2)
    assert.deepEqual(
      renewed.close.map((item) => [item.id, item.withdrawalReason]),
      [[old.id, 'renewed']],
    )
    // Düzeltme sürümü (yeniden rıza istemeyen) eski rızayı geçersiz kılmaz.
    const v3 = text(5, { kind: 'consent_text', purpose: 'photo_video_sharing', version: 3 })
    assert.equal(minimumConsentTextVersion([...texts, v3], 'photo_video_sharing'), 2)
  })
})

describe('geçerli rıza ve geri çekme (DOM-YTK-059, DOM-YTK-061)', () => {
  const query = {
    purpose: 'photo_video_sharing',
    subject: { kind: 'student', student: MINOR },
    texts: TEXTS,
  } as const

  test('DOM-YTK-061 geçerli rıza: veri sahibi, amaç, tür, başlangıç ve bitiş', () => {
    const consent = record(1)
    assert.equal(hasValidConsent([consent], query, NOW), true)
    assert.equal(hasValidConsent([], query, NOW), false)
    const other = { kind: 'student', student: { id: 's9', birthDate: null } } as const
    assert.equal(hasValidConsent([consent], { ...query, subject: other }, NOW), false)
    assert.equal(hasValidConsent([consent], { ...query, purpose: 'photo_video_print' }, NOW), false)
    const user = { kind: 'user', userId: 's1' } as const
    assert.equal(hasValidConsent([consent], { ...query, subject: user }, NOW), false)
    assert.equal(
      hasValidConsent([{ ...consent, subjectKind: 'user' }], { ...query, subject: user }, NOW),
      false,
    )
    assert.equal(hasValidConsent([consent], query, '2026-10-06T08:59:59.999Z'), false)
    assert.equal(hasValidConsent([consent], query, '2027-06-30T20:59:59.999Z'), true)
    assert.equal(hasValidConsent([consent], query, YEAR_END), false)
  })

  test('DOM-YTK-061 velinin rızası 18. yaş gününde (İstanbul gece yarısı) düşer', () => {
    const { consent } = give({
      actor: parent('s3'),
      student: TURNING,
      guardianBonds: [custody('s3')],
      input: {
        purpose: 'speaking_recording',
        studentId: 's3',
        textId: SPEAKING_TEXT.id,
        channel: 'web',
      },
      now: '2026-01-10T09:00:00.000Z',
    })
    const rows = [{ id: uuid(200), ...consent }]
    const speaking = {
      purpose: 'speaking_recording',
      subject: { kind: 'student', student: TURNING },
      texts: TEXTS,
    } as const
    assert.equal(hasValidConsent(rows, speaking, BEFORE_MIDNIGHT), true)
    assert.equal(hasValidConsent(rows, speaking, ISTANBUL_MIDNIGHT), false)
  })

  test('DOM-YTK-057 doğum tarihi yokken verilen veli rızası, doğum tarihi girilip öğrencinin 18 yaşını doldurduğu anlaşılınca düşer', () => {
    const unknown: ConsentStudent = { id: 's3', birthDate: null }
    const speaking = {
      purpose: 'speaking_recording',
      studentId: 's3',
      textId: SPEAKING_TEXT.id,
      channel: 'web',
    }
    const { consent } = give({
      actor: parent('s3'),
      student: unknown,
      guardianBonds: [custody('s3')],
      input: speaking,
      now: '2026-01-10T09:00:00.000Z',
    })
    // Doğum tarihi bilinmeyen öğrenci 18 yaş altı sayılır: bitiş yazılamaz, veli rızası geçerlidir.
    assert.deepEqual([consent.grantorRelation, consent.expiresAt], ['guardian', null])
    const rows = [{ id: uuid(210), ...consent }]
    const query = (student: ConsentStudent) =>
      ({
        purpose: 'speaking_recording',
        subject: { kind: 'student', student },
        texts: TEXTS,
      }) as const
    assert.equal(hasValidConsent(rows, query(unknown), NOW), true)
    // Doğum tarihi sonradan girildi: geçerlilik her sorguda güncel yaşla hesaplanır.
    assert.equal(hasValidConsent(rows, query(TURNING), BEFORE_MIDNIGHT), true)
    assert.equal(hasValidConsent(rows, query(TURNING), ISTANBUL_MIDNIGHT), false)
    assert.equal(hasValidConsent(rows, query({ ...ADULT, id: 's3' }), NOW), false)
    // Reşit öğrenci kendi rızasını verirken eski veli rızası mükerrer sayılmaz, yenilenip kapanır.
    const self = give({
      actor: studentActor('s3'),
      student: TURNING,
      consents: rows,
      input: speaking,
      now: '2026-10-08T09:00:00.000Z',
    })
    assert.equal(self.consent.grantorRelation, 'self')
    assert.deepEqual(
      self.close.map((item) => [item.id, item.withdrawalReason]),
      [[rows[0]!.id, 'renewed']],
    )
    // Öğrencinin kendi rızası yalnız reşitken sayılır; doğum tarihi bilinmezse 18 yaş altıdır.
    const own = [{ id: uuid(211), ...self.consent }]
    assert.equal(hasValidConsent(own, query(TURNING), '2026-10-09T09:00:00.000Z'), true)
    assert.equal(hasValidConsent(own, query(unknown), '2026-10-09T09:00:00.000Z'), false)
  })

  const withdraw = (overrides: Partial<Parameters<typeof planConsentWithdrawal>[0]> = {}) =>
    planConsentWithdrawal({
      actor: parent('s1'),
      consent: record(1),
      student: MINOR,
      guardianBonds: [custody('s1')],
      input: { consentId: uuid(101) },
      now: '2026-10-07T10:00:00.000Z',
      ...overrides,
    })

  test('DOM-YTK-059 geri çekme aynı kayda yazılır ve anında etkilidir; ikinci geri çekme mükerrerdir', () => {
    const consent = record(1)
    const closure = withdraw({ consent })
    assert.deepEqual(closure, {
      id: consent.id,
      withdrawnAt: '2026-10-07T10:00:00.000Z',
      withdrawnByUserId: 'u-veli',
      withdrawalReason: 'withdrawn',
    })
    const withdrawn = { ...consent, ...closure }
    assert.equal(hasValidConsent([withdrawn], query, closure.withdrawnAt), false)
    // Geri çekme anından önceki bir anda da sorulsa geri çekilmiş satır rıza saymaz.
    assert.equal(hasValidConsent([withdrawn], query, NOW), false)
    assert.throws(
      () => withdraw({ consent: withdrawn }),
      isDomainError('consent_already_withdrawn', 'conflict'),
    )
    assert.equal(consent.withdrawnAt, null)
  })

  test('DOM-YTK-059 kim geri çeker: veren, diğer velayetli veli, 18 yaşını dolduran öğrenci; diğerleri bulamaz', () => {
    const otherParent: ConsentActor = { ...parent('s1'), userId: 'u-anne' }
    assert.equal(withdraw({ actor: otherParent }).withdrawnByUserId, 'u-anne')
    assert.throws(
      () => withdraw({ actor: otherParent, guardianBonds: [custody('s1', { custody: false })] }),
      isDomainError('consent_not_found', 'not_found'),
    )
    // Veli rızası, öğrenci 18 yaşını doldurunca öğrencinin kendisince geri çekilebilir.
    const turning = record(2, { subjectId: 's3' })
    assert.equal(
      withdraw({
        actor: studentActor('s3'),
        consent: turning,
        student: TURNING,
        input: { consentId: turning.id },
        now: ISTANBUL_MIDNIGHT,
      }).withdrawnByUserId,
      'u-s3',
    )
    for (const actor of [
      studentActor('s1'),
      { role: 'ogretmen', userId: 'u-t', links: [] } satisfies ConsentActor,
      { role: 'yonetici', userId: 'u-y', links: [] } satisfies ConsentActor,
      { ...parent('s9'), userId: 'u-baska' },
    ])
      assert.throws(() => withdraw({ actor }), isDomainError('consent_not_found', 'not_found'))
    assert.throws(
      () => withdraw({ consent: null }),
      isDomainError('consent_not_found', 'not_found'),
    )
    assert.throws(
      () => withdraw({ input: { consentId: uuid(999) } }),
      isDomainError('consent_not_found', 'not_found'),
    )
    assert.throws(() => withdraw({ input: { consentId: 'x' } }), ZodError)
    // Hesap rızasını yalnız hesap sahibi geri çeker.
    const promo = record(3, {
      subjectKind: 'user',
      subjectId: 'u-veli',
      purpose: 'promotional_messages',
      grantedByUserId: 'u-veli',
    })
    assert.equal(withdraw({ consent: promo, input: { consentId: promo.id } }).id, promo.id)
    assert.throws(
      () => withdraw({ actor: otherParent, consent: promo, input: { consentId: promo.id } }),
      isDomainError('consent_not_found', 'not_found'),
    )
  })
})

describe('öğrenci itirazı (DOM-YTK-062)', () => {
  const objection = (overrides: Partial<Parameters<typeof planConsent>[0]> = {}) =>
    give({
      actor: studentActor('s1'),
      input: {
        purpose: 'photo_video_sharing',
        decision: 'objected',
        studentId: 's1',
        textId: PHOTO_TEXT.id,
        channel: 'mobile',
      },
      ...overrides,
    })

  test('DOM-YTK-062 18 yaş altı öğrencinin itirazı velinin rızasını etkisiz kılar; geri çekilince rıza döner', () => {
    const { consent, close } = objection()
    assert.deepEqual(
      [consent.decision, consent.grantorRelation, consent.expiresAt, close],
      // İtiraz da velinin rızası gibi öğrencinin 18. yaş gününde biter.
      ['objected', 'self', adulthoodStartsAt(MINOR.birthDate!), []],
    )
    const granted = record(1)
    const objected = { ...consent, id: uuid(300) }
    const query = {
      purpose: 'photo_video_sharing',
      subject: { kind: 'student', student: MINOR },
      texts: TEXTS,
    } as const
    assert.equal(hasValidConsent([granted, objected], query, NOW), false)
    assert.equal(hasValidConsent([objected, granted], query, NOW), false)
    // Yalnız itiraz rıza değildir.
    assert.equal(hasValidConsent([objected], query, NOW), false)
    const closure = planConsentWithdrawal({
      actor: studentActor('s1'),
      consent: objected,
      student: MINOR,
      guardianBonds: [],
      input: { consentId: objected.id },
      now: NOW,
    })
    assert.equal(hasValidConsent([granted, { ...objected, ...closure }], query, NOW), true)
    // Velinin rızası itirazı geri çekemez.
    assert.throws(
      () =>
        planConsentWithdrawal({
          actor: parent('s1'),
          consent: objected,
          student: MINOR,
          guardianBonds: [custody('s1')],
          input: { consentId: objected.id },
          now: NOW,
        }),
      isDomainError('consent_not_found', 'not_found'),
    )
  })

  test('DOM-YTK-062 17 yaşındaki itiraz velinin rızasına karşıdır; 18 yaşını dolduran öğrencinin kendi rızasını engellemez', () => {
    const photo = {
      purpose: 'photo_video_sharing',
      studentId: 's3',
      textId: PHOTO_TEXT.id,
      channel: 'web',
    }
    const guardian = give({
      actor: parent('s3'),
      student: TURNING,
      guardianBonds: [custody('s3')],
      input: photo,
      now: '2026-01-10T09:00:00.000Z',
      academicYearEndsAt: '2026-06-30T21:00:00.000Z',
    })
    const objected = objection({
      actor: studentActor('s3'),
      student: TURNING,
      input: { ...photo, decision: 'objected' },
      now: '2026-05-01T09:00:00.000Z',
    })
    assert.equal(objected.consent.expiresAt, ISTANBUL_MIDNIGHT)
    const rows = [
      { id: uuid(400), ...guardian.consent },
      { id: uuid(401), ...objected.consent },
    ]
    const query = (student: ConsentStudent) =>
      ({
        purpose: 'photo_video_sharing',
        subject: { kind: 'student', student },
        texts: TEXTS,
      }) as const
    const MAY = '2026-05-02T09:00:00.000Z'
    // 18'e girmeden velinin rızası itiraz nedeniyle geçersiz kalır.
    assert.equal(hasValidConsent(rows.slice(0, 1), query(TURNING), MAY), true)
    assert.equal(hasValidConsent(rows, query(TURNING), MAY), false)
    // 18 yaşında öğrenci rızayı kendisi verir; açık itiraz satırı mükerrer saymaz ve engellemez.
    const self = give({
      actor: studentActor('s3'),
      student: TURNING,
      consents: rows,
      input: photo,
      now: '2026-10-08T09:00:00.000Z',
    })
    assert.equal(self.consent.grantorRelation, 'self')
    const after = [...rows, { id: uuid(402), ...self.consent }]
    assert.equal(hasValidConsent(after, query(TURNING), '2026-10-09T09:00:00.000Z'), true)
    // İtiraz doğum tarihi bilinmezken yazıldıysa (bitişsiz) da etkisi erginlikte biter.
    const undated = after.map((row) => ({ ...row, expiresAt: null }))
    assert.equal(hasValidConsent(undated, query(TURNING), '2026-10-09T09:00:00.000Z'), true)
    assert.equal(hasValidConsent(undated, query(TURNING), MAY), false)
  })

  test('DOM-YTK-062 itiraz yalnız itiraz edilebilir amaçta, 18 yaş altı öğrencinin kendisinden; mükerrer reddedilir', () => {
    assert.throws(
      () =>
        objection({
          input: {
            purpose: 'speaking_recording',
            decision: 'objected',
            studentId: 's1',
            textId: SPEAKING_TEXT.id,
            channel: 'web',
          },
        }),
      isDomainError('objection_not_applicable', 'rule'),
    )
    assert.throws(
      () => objection({ actor: parent('s1') }),
      isDomainError('objection_not_applicable', 'rule'),
    )
    assert.throws(
      () =>
        objection({
          actor: studentActor('s2'),
          student: ADULT,
          input: {
            purpose: 'photo_video_sharing',
            decision: 'objected',
            studentId: 's2',
            textId: PHOTO_TEXT.id,
            channel: 'web',
          },
        }),
      isDomainError('objection_not_applicable', 'rule'),
    )
    assert.throws(
      () => objection({ actor: studentActor('s9') }),
      isDomainError('consent_student_not_found', 'not_found'),
    )
    const existing = { id: uuid(300), ...objection().consent }
    assert.throws(
      () => objection({ consents: [existing] }),
      isDomainError('objection_exists', 'conflict'),
    )
    // Velinin açık rızası öğrencinin itirazını engellemez (karar farklı).
    assert.equal(objection({ consents: [record(1)] }).close.length, 0)
  })
})

test('DOM-YTK-058 eğitim yılı rızası ertesi yılın 1 Eylül Europe/Istanbul gün başında biter', () => {
  assert.equal(academicYearEndsAt(2026), '2027-08-31T21:00:00.000Z')
  assert.equal(academicYearEndsAt(2027), '2028-08-31T21:00:00.000Z')
})
