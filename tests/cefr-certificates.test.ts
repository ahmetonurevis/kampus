import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  CERTIFICATE_TITLE,
  FORBIDDEN_CERTIFICATE_PHRASES,
  VERIFICATION_CODE_BYTES,
  VERIFICATION_CODE_PATTERN,
  canIssueCertificate,
  certificateContentSchema,
  certificateEligibleDecision,
  certificateLevelStatement,
  certificateVerificationView,
  containsForbiddenPhrase,
  formatCertificateNumber,
  formatVerificationCode,
  mebbisEligibleDecisionId,
  nameInitials,
  normalizeVerificationCode,
  planCertificateCancellation,
  planCertificateIssue,
  planMebbisRecord,
  type CertificateRecord,
} from '../packages/school-core/src/cefr/certificates.ts'
import {
  planProgressionDecision,
  type LessonHourAttendance,
  type ProgressionActor,
  type ProgressionDecisionRecord,
} from '../packages/school-core/src/cefr/progression.ts'
import { suggestCefrLevels } from '../packages/school-core/src/cefr/suggestion.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const now = '2026-11-20T09:00:00.000Z'
const SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const

const admin: ProgressionActor = { userId: 'test-u-admin', role: 'yonetici' }
const coordinator: ProgressionActor = {
  userId: 'test-u-coord',
  role: 'ogretmen',
  coordinator: true,
}
const teacher: ProgressionActor = { userId: 'test-u-teacher', role: 'ogretmen' }

const hours = (attended: number, absent: number): LessonHourAttendance[] => [
  ...Array.from({ length: attended }, (_, i) => ({
    lessonHourId: `test-h-a${i}`,
    status: 'present' as const,
  })),
  ...Array.from({ length: absent }, (_, i) => ({
    lessonHourId: `test-h-x${i}`,
    status: 'absent' as const,
  })),
]
const assessment = (point: 'baseline' | 'midterm' | 'final', score: number) => ({
  id: `test-as-${point}`,
  enrollmentId: 'test-enr1',
  point,
  score,
  skills: SKILLS.map((skill, i) => ({ skill, score: score - i, feedback: `${skill} notu` })),
  assessedAt: now,
  assessedByUserId: 'test-u-teacher',
})

/** Core planıyla üretilmiş gerçekçi karar satırı (dayanak kopyası core'dan gelir). */
function decision(over: Partial<ProgressionDecisionRecord> = {}): ProgressionDecisionRecord {
  const outcome = over.outcome ?? 'passed'
  const draft = planProgressionDecision({
    institutionType: 'language_school',
    enrollment: {
      id: 'test-enr1',
      learnerId: 'test-st1',
      courseId: 'test-course-b1',
      level: 'B1',
      totalHours: 40,
      teacherUserIds: ['test-u-teacher'],
    },
    attendance: outcome === 'incomplete_attendance' ? hours(30, 10) : hours(37, 3),
    assessments: [assessment('baseline', 30), assessment('midterm', 70), assessment('final', 82)],
    suggestion: suggestCefrLevels({ candidates: [], now }),
    existingDecisions: [],
    actor: teacher,
    input: { enrollmentId: 'test-enr1', outcome, rationale: 'Kur hedeflerine ulaştı.' },
    now: '2026-11-18T09:00:00.000Z',
  })
  return {
    id: 'test-pd1',
    ...draft,
    status: 'approved',
    reviewedByUserId: 'test-u-coord',
    reviewedAt: '2026-11-19T09:00:00.000Z',
    ...over,
  }
}

const subject = {
  institutionName: 'Kampüs Dil Akademisi',
  learnerName: 'Deniz Yılmaz',
  course: {
    id: 'test-course-b1',
    name: 'Genel İngilizce B1.1',
    level: 'B1' as const,
    totalHours: 40,
  },
}
const issue = (over: Partial<Parameters<typeof planCertificateIssue>[0]> = {}) =>
  planCertificateIssue({
    institutionType: 'language_school',
    enrollment: { id: 'test-enr1', learnerId: 'test-st1', courseId: 'test-course-b1' },
    decisions: [decision()],
    certificates: [],
    subject,
    actor: admin,
    input: { decisionId: 'test-pd1' },
    now,
    ...over,
  })

const stored = (over: Partial<CertificateRecord> = {}): CertificateRecord => ({
  id: 'test-cert1',
  serial: 1,
  number: 'KB-2026-000001',
  verificationCode: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345',
  ...issue(),
  ...over,
})

describe('kurum başarı belgesi içeriği (DOM-DIL-081)', () => {
  test('DOM-DIL-081 seviye ifadesi tam olarak "kurum değerlendirmesine göre CEFR B1 düzeyinde"', () => {
    assert.equal(certificateLevelStatement('B1'), 'kurum değerlendirmesine göre CEFR B1 düzeyinde')
    assert.equal(
      certificateLevelStatement('A2+'),
      'kurum değerlendirmesine göre CEFR A2+ düzeyinde',
    )
    const draft = issue()
    assert.equal(draft.content.levelStatement, 'kurum değerlendirmesine göre CEFR B1 düzeyinde')
    assert.equal(draft.content.title, 'Kurum başarı belgesi')
    assert.equal(CERTIFICATE_TITLE, 'Kurum başarı belgesi')
  })

  test('DOM-DIL-081 belge içeriğinde "CEFR sertifikası" ve "Avrupa Konseyi" ifadeleri yok', () => {
    const text = JSON.stringify(issue().content).toLocaleLowerCase('tr')
    for (const phrase of ['cefr sertifikası', 'avrupa konseyi', 'sertifika', 'council of europe'])
      assert.equal(text.includes(phrase), false, phrase)
    assert.equal(containsForbiddenPhrase(JSON.stringify(issue().content)), false)
    assert.equal(containsForbiddenPhrase('Kampüs CEFR  Sertifikası Programı'), true)
    assert.equal(containsForbiddenPhrase('AVRUPA KONSEYİ onaylı'), true)
    assert.ok(FORBIDDEN_CERTIFICATE_PHRASES.includes('avrupa konseyi'))
  })

  test('DOM-DIL-081 kur ya da kurum adı yasak ifade taşıyorsa belge düzenlenmez (422)', () => {
    assert.throws(
      () =>
        issue({
          subject: { ...subject, course: { ...subject.course, name: 'CEFR Sertifikası B1' } },
        }),
      isDomainError('certificate_wording_forbidden'),
    )
    assert.throws(
      () => issue({ subject: { ...subject, institutionName: 'Avrupa Konseyi Onaylı Dil Okulu' } }),
      isDomainError('certificate_wording_forbidden'),
    )
  })

  test('DOM-DIL-081 içerik karar kopyasındaki kur, saat, devam ve beceri puanlarını taşır', () => {
    const draft = issue()
    assert.deepEqual(draft.content, {
      schemaVersion: 1,
      title: 'Kurum başarı belgesi',
      institutionName: 'Kampüs Dil Akademisi',
      learnerName: 'Deniz Yılmaz',
      courseId: 'test-course-b1',
      courseName: 'Genel İngilizce B1.1',
      level: 'B1',
      levelStatement: 'kurum değerlendirmesine göre CEFR B1 düzeyinde',
      totalHours: 40,
      attendance: { attendedHours: 37, totalHours: 40, permille: 925 },
      finalScore: 82,
      skills: SKILLS.map((skill, i) => ({ skill, score: 82 - i })),
      decisionId: 'test-pd1',
      approvedAt: '2026-11-19T09:00:00.000Z',
    })
    assert.deepEqual(certificateContentSchema.parse(draft.content), draft.content)
    assert.equal(draft.status, 'valid')
    assert.equal(draft.issuedByUserId, admin.userId)
    assert.equal(draft.issuedAt, now)
    assert.equal(draft.replacesCertificateId, null)
  })

  test('DOM-DIL-081 adı kayıtlı olmayan kursiyere belge düzenlenmez', () => {
    assert.throws(
      () => issue({ subject: { ...subject, learnerName: '  ' } }),
      isDomainError('certificate_learner_name_missing'),
    )
  })
})

describe('belgeye hak (DOM-DIL-080, 081)', () => {
  test('DOM-DIL-080 onaylı geçti kararı belgeye hak verir', () => {
    assert.equal(certificateEligibleDecision([decision()]).id, 'test-pd1')
  })

  test('DOM-DIL-080 onay bekleyen, tekrar, devamsızlık ve kararsız kayıtta belge yok (422)', () => {
    const pending = decision({ status: 'pending', reviewedAt: null, reviewedByUserId: null })
    for (const [decisions, code] of [
      [[pending], 'certificate_decision_pending'],
      [[decision({ outcome: 'repeat' })], 'certificate_not_eligible'],
      [[decision({ outcome: 'incomplete_attendance' })], 'certificate_not_eligible'],
      [[], 'certificate_no_decision'],
      [[decision({ status: 'rejected', rejectionReason: 'Eksik.' })], 'certificate_no_decision'],
    ] as const) {
      assert.throws(() => certificateEligibleDecision(decisions), isDomainError(code))
      if (decisions.length > 0)
        assert.throws(() => issue({ decisions: [...decisions] }), isDomainError(code))
    }
  })

  test('DOM-DIL-080 devamsızlık kararının mesajı Türkçedir ve belge düzenlenmeyeceğini söyler', () => {
    assert.throws(
      () => certificateEligibleDecision([decision({ outcome: 'incomplete_attendance' })]),
      (error: Error) => /Devam şartı sağlanmadı/.test(error.message),
    )
  })

  test('DOM-DIL-080 düzeltilmiş karar belgeye hak vermez; geçerli karar verir', () => {
    const corrected = decision()
    const correction = decision({ id: 'test-pd2', correctsDecisionId: 'test-pd1' })
    assert.throws(
      () => issue({ decisions: [corrected, correction] }),
      isDomainError('certificate_decision_superseded'),
    )
    assert.equal(
      issue({ decisions: [corrected, correction], input: { decisionId: 'test-pd2' } }).decisionId,
      'test-pd2',
    )
    assert.throws(
      () => issue({ input: { decisionId: 'test-pd-yok' } }),
      isDomainError('progression_not_found', 'not_found'),
    )
  })

  test('DOM-DIL-081 yalnız yönetici ve kurun akademik koordinatörü düzenler; okulda 404', () => {
    assert.equal(canIssueCertificate(admin), true)
    assert.equal(canIssueCertificate(coordinator), true)
    assert.equal(canIssueCertificate(teacher), false)
    assert.equal(canIssueCertificate({ userId: 'x', role: 'onburo', coordinator: true }), false)
    for (const actor of [
      teacher,
      { userId: 'test-u-st', role: 'ogrenci' as const },
      { userId: 'test-u-p', role: 'veli' as const },
    ])
      assert.throws(() => issue({ actor }), isDomainError('permission_denied', 'forbidden'))
    assert.equal(issue({ actor: coordinator }).issuedByUserId, coordinator.userId)
    assert.throws(
      () => issue({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })

  test('DOM-DIL-081 geçersiz gövde Zod hatasıdır', () => {
    for (const input of [{}, { decisionId: '' }, { decisionId: 1 }])
      assert.throws(() => issue({ input }), ZodError)
  })
})

describe('belge numarası, iptal ve yeniden düzenleme (DOM-DIL-082)', () => {
  test('DOM-DIL-082 numara önek, İstanbul yılı ve altı haneli sıra numarasıdır', () => {
    assert.equal(formatCertificateNumber(1, now), 'KB-2026-000001')
    assert.equal(formatCertificateNumber(1234567, now), 'KB-2026-1234567')
    // 31 Aralık 23:30 UTC İstanbul'da yeni yıldır.
    assert.equal(formatCertificateNumber(7, '2026-12-31T23:30:00.000Z'), 'KB-2027-000007')
    for (const serial of [0, -1, 1.5]) {
      assert.throws(
        () => formatCertificateNumber(serial, now),
        isDomainError('certificate_serial_invalid'),
      )
    }
  })

  test('DOM-DIL-082 Sabah kararı 86 kayıt başına tek geçerli belge: aynı ya da önceki karardan geçerli belge varsa 409', () => {
    assert.throws(
      () => issue({ certificates: [stored()] }),
      isDomainError('certificate_already_issued', 'conflict'),
    )
    // Kararı düzeltilen kayıt: önceki kararın (test-pd1) geçerli belgesi düzeltmenin (test-pd2)
    // belgesini de engeller.
    const d2 = decision({ id: 'test-pd2', correctsDecisionId: 'test-pd1' })
    assert.throws(
      () =>
        issue({
          decisions: [decision(), d2],
          certificates: [stored()],
          input: { decisionId: 'test-pd2' },
        }),
      isDomainError('certificate_already_issued', 'conflict'),
    )
    // Başka kaydın belgesi sayılmaz.
    assert.equal(
      issue({ certificates: [stored({ enrollmentId: 'test-enr-baska' })] }).status,
      'valid',
    )
  })

  test('DOM-DIL-082 iptal gerekçe ister, yalnız geçerli belgede ve bir kez', () => {
    const cancel = (over: Partial<Parameters<typeof planCertificateCancellation>[0]> = {}) =>
      planCertificateCancellation({
        institutionType: 'language_school',
        certificate: stored(),
        actor: coordinator,
        input: { reason: 'Kur adı yanlış yazıldı.' },
        now: '2026-11-21T09:00:00.000Z',
        ...over,
      })
    assert.deepEqual(cancel(), {
      status: 'cancelled',
      cancelledByUserId: coordinator.userId,
      cancelledAt: '2026-11-21T09:00:00.000Z',
      cancellationReason: 'Kur adı yanlış yazıldı.',
    })
    for (const input of [{}, { reason: '  ' }, { reason: 'x'.repeat(501) }])
      assert.throws(() => cancel({ input }), ZodError)
    assert.throws(
      () => cancel({ certificate: stored({ status: 'cancelled' }) }),
      isDomainError('certificate_already_cancelled', 'conflict'),
    )
    assert.throws(() => cancel({ actor: teacher }), isDomainError('permission_denied', 'forbidden'))
    assert.throws(() => cancel({ now: '2026-11-01T00:00:00.000Z' }), isDomainError('invalid_now'))
    assert.throws(
      () => cancel({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })

  test('DOM-DIL-082 iptal edilen belgenin yerine yeni belge düzenlenir; geçerlinin ya da iki kez yerine değil', () => {
    const cancelled = stored({ status: 'cancelled' })
    const replacement = issue({
      certificates: [cancelled],
      input: { decisionId: 'test-pd1', replacesCertificateId: 'test-cert1' },
    })
    assert.equal(replacement.replacesCertificateId, 'test-cert1')
    assert.equal(replacement.status, 'valid')
    assert.throws(
      () =>
        issue({
          certificates: [stored({ decisionId: 'test-pd0' })],
          input: { decisionId: 'test-pd1', replacesCertificateId: 'test-cert1' },
        }),
      isDomainError('certificate_replace_not_cancelled'),
    )
    assert.throws(
      () =>
        issue({
          certificates: [
            cancelled,
            stored({ id: 'test-cert2', status: 'cancelled', replacesCertificateId: 'test-cert1' }),
          ],
          input: { decisionId: 'test-pd1', replacesCertificateId: 'test-cert1' },
        }),
      isDomainError('certificate_already_replaced', 'conflict'),
    )
    assert.throws(
      () => issue({ input: { decisionId: 'test-pd1', replacesCertificateId: 'test-cert-yok' } }),
      isDomainError('certificate_not_found', 'not_found'),
    )
  })
})

describe('doğrulama kodu ve yanıtı (DOM-DIL-082)', () => {
  const bytes = (fill: (i: number) => number) =>
    Uint8Array.from({ length: VERIFICATION_CODE_BYTES }, (_, i) => fill(i))

  test('DOM-DIL-082 kod 140 bit Crockford base32, yedi dörtlü grup; bayt sayısı denetlenir', () => {
    const code = formatVerificationCode(bytes((i) => (i * 37 + 11) % 256))
    assert.match(code, VERIFICATION_CODE_PATTERN)
    assert.equal(code.replaceAll('-', '').length * 5 >= 128, true)
    assert.equal(formatVerificationCode(bytes(() => 0)), '0000-0000-0000-0000-0000-0000-0000')
    assert.equal(formatVerificationCode(bytes(() => 255)), 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ')
    assert.notEqual(formatVerificationCode(bytes(() => 1)), formatVerificationCode(bytes(() => 2)))
    assert.throws(
      () => formatVerificationCode(new Uint8Array(16)),
      isDomainError('verification_code_entropy'),
    )
  })

  test('DOM-DIL-082 normalleştirme harf, boşluk ve karışan harfleri gözetmez; bozuk kod null', () => {
    const code = formatVerificationCode(bytes((i) => (i * 53 + 7) % 256))
    assert.equal(normalizeVerificationCode(code.toLowerCase()), code)
    assert.equal(normalizeVerificationCode(code.replaceAll('-', ' ')), code)
    assert.equal(normalizeVerificationCode(code.replaceAll('-', '')), code)
    assert.equal(
      normalizeVerificationCode('oooo-iiii-llll-0000-0000-0000-0000'),
      '0000-1111-1111-0000-0000-0000-0000',
    )
    for (const bad of [
      '',
      'abc',
      `${code}-AAAA`,
      code.replace(/^./, 'U'),
      'x'.repeat(100),
      '!!!!-0000-0000-0000-0000-0000-0000',
    ])
      assert.equal(normalizeVerificationCode(bad), null, bad)
  })

  test('DOM-DIL-082 baş harfler Türkçe büyük harfle', () => {
    assert.equal(nameInitials('Deniz Yılmaz'), 'D. Y.')
    assert.equal(nameInitials(' ipek  nur  ışık '), 'İ. N. I.')
    assert.equal(nameInitials('Ayşe-Nur Kaya'), 'A. N. K.')
  })

  test('DOM-DIL-082 doğrulama yanıtı yalnız baş harf, kur, gün, durum ve kurum adını taşır', () => {
    const valid = certificateVerificationView(stored())
    assert.deepEqual(valid, {
      status: 'valid',
      learnerInitials: 'D. Y.',
      courseName: 'Genel İngilizce B1.1',
      issuedDate: '2026-11-20',
      institutionName: 'Kampüs Dil Akademisi',
    })
    const cancelled = certificateVerificationView(stored({ status: 'cancelled' }))
    assert.equal(cancelled.status, 'cancelled')
    const text = JSON.stringify(cancelled)
    for (const hidden of ['Deniz', 'Yılmaz', 'test-st1', 'KB-2026', 'test-enr1', '82'])
      assert.equal(text.includes(hidden), false, hidden)
  })
})

describe('MEBBİS Kurs Bitirme Belgesi izi (DOM-DIL-080)', () => {
  const record = (over: Partial<Parameters<typeof planMebbisRecord>[0]> = {}) =>
    planMebbisRecord({
      institutionType: 'language_school',
      enrollment: { id: 'test-enr1', learnerId: 'test-st1' },
      decisions: [decision()],
      decisionId: 'test-pd1',
      existing: [],
      actor: admin,
      input: { certificateNumber: ' 2026-34-000123 ', issuedDate: '2026-11-20' },
      now,
      ...over,
    })

  test('DOM-DIL-080 belgeye hak kazanan kaydın MEBBİS belgesi no, tarih ve işleyenle işaretlenir', () => {
    assert.deepEqual(record(), {
      enrollmentId: 'test-enr1',
      learnerId: 'test-st1',
      decisionId: 'test-pd1',
      certificateNumber: '2026-34-000123',
      issuedDate: '2026-11-20',
      recordedByUserId: admin.userId,
      recordedAt: now,
    })
    assert.equal(mebbisEligibleDecisionId([decision()]), 'test-pd1')
  })

  test('DOM-DIL-080 devamsızlık, tekrar ve onaysız karar listeye girmez ve işaretlenmez', () => {
    for (const over of [
      { outcome: 'incomplete_attendance' as const },
      { outcome: 'repeat' as const },
      { status: 'pending' as const, reviewedAt: null, reviewedByUserId: null },
    ]) {
      assert.equal(mebbisEligibleDecisionId([decision(over)]), null)
      assert.throws(
        () => record({ decisions: [decision(over)] }),
        (error: Error) => error.name === 'DomainError',
      )
    }
    assert.equal(mebbisEligibleDecisionId([]), null)
  })

  test('DOM-DIL-080 karar başına bir iz 409; ileri tarih 422; geçersiz gövde; yetki ve kurum türü', () => {
    assert.throws(
      () => record({ existing: [{ decisionId: 'test-pd1' }] }),
      isDomainError('mebbis_already_recorded', 'conflict'),
    )
    assert.throws(
      () => record({ input: { certificateNumber: 'A1', issuedDate: '2026-11-21' } }),
      isDomainError('mebbis_date_in_future'),
    )
    for (const input of [
      {},
      { certificateNumber: ' ', issuedDate: '2026-11-20' },
      { certificateNumber: 'A', issuedDate: '20.11.2026' },
    ])
      assert.throws(() => record({ input }), ZodError)
    assert.throws(() => record({ actor: teacher }), isDomainError('permission_denied', 'forbidden'))
    assert.throws(
      () => record({ decisionId: 'test-pd-yok' }),
      isDomainError('progression_not_found', 'not_found'),
    )
    assert.throws(
      () =>
        record({
          decisions: [decision(), decision({ id: 'test-pd2', correctsDecisionId: 'test-pd1' })],
        }),
      isDomainError('certificate_decision_superseded'),
    )
    assert.throws(
      () => record({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })
})
