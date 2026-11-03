import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  ABSENCE_NOTICES,
  ASSESSMENT_POINTS,
  EXAM_BARRED_MESSAGE_KEY,
  MIN_ATTENDANCE_PERMILLE,
  PASS_RULES,
  PROGRESSION_OUTCOMES,
  absenceNoticeDue,
  assessmentGaps,
  attendanceSummary,
  canReviewProgression,
  courseAssessmentInputSchema,
  effectiveProgressionDecision,
  evaluateProgression,
  isMinorOn,
  planCourseAssessment,
  planProgressionDecision,
  planProgressionReview,
  progressionBasisSchema,
  progressionNextStep,
  progressionSettingsSchema,
  type CourseAssessmentRow,
  type CourseEnrollment,
  type LessonHourAttendance,
  type ProgressionActor,
  type ProgressionDecisionRecord,
} from '../packages/school-core/src/cefr/progression.ts'
import { suggestCefrLevels } from '../packages/school-core/src/cefr/suggestion.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const now = '2026-11-04T09:00:00.000Z'
const SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const

const enrollment = (over: Partial<CourseEnrollment> = {}): CourseEnrollment => ({
  id: 'test-enr1',
  learnerId: 'test-st1',
  courseId: 'test-course-b1-1',
  level: 'B1',
  totalHours: 40,
  teacherUserIds: ['test-u-teacher'],
  ...over,
})
const teacher: ProgressionActor = { userId: 'test-u-teacher', role: 'ogretmen' }
const coordinator: ProgressionActor = {
  userId: 'test-u-coord',
  role: 'ogretmen',
  coordinator: true,
}
const admin: ProgressionActor = { userId: 'test-u-admin', role: 'yonetici' }

/** `attended` katıldı (ilk `late` tanesi geç), `absent` gelmedi (ilk `excused` tanesi özürlü). */
const hours = (attended: number, absent: number, late = 0, excused = 0): LessonHourAttendance[] => [
  ...Array.from({ length: attended }, (_, i) => ({
    lessonHourId: `test-h-a${i}`,
    status: i < late ? ('late' as const) : ('present' as const),
  })),
  ...Array.from({ length: absent }, (_, i) => ({
    lessonHourId: `test-h-x${i}`,
    status: 'absent' as const,
    excused: i < excused,
  })),
]

const assessment = (
  point: CourseAssessmentRow['point'],
  score = 75,
  skillScores: Partial<Record<(typeof SKILLS)[number], number>> = {},
  over: Partial<CourseAssessmentRow> = {},
): CourseAssessmentRow => ({
  id: `test-as-${point}`,
  enrollmentId: 'test-enr1',
  point,
  score,
  skills: SKILLS.map((skill) => ({
    skill,
    score: skillScores[skill] ?? 70,
    feedback: `${skill} geri bildirimi`,
  })),
  assessedAt: now,
  assessedByUserId: 'test-u-teacher',
  ...over,
})
const fullAssessments = (finalScore = 75, finalSkills = {}) => [
  assessment('baseline', 30, { reading: 10, listening: 10, writing: 10, speaking: 10 }),
  assessment('midterm', 65),
  assessment('final', finalScore, finalSkills),
]

const suggestion = suggestCefrLevels({ candidates: [], now })

const decisionInput = {
  enrollmentId: 'test-enr1',
  outcome: 'passed',
  rationale: 'Dört beceride kur hedeflerine ulaştı.',
}
const propose = (over: Partial<Parameters<typeof planProgressionDecision>[0]> = {}) =>
  planProgressionDecision({
    institutionType: 'language_school',
    enrollment: enrollment(),
    attendance: hours(36, 4),
    assessments: fullAssessments(),
    suggestion,
    existingDecisions: [],
    actor: teacher,
    input: decisionInput,
    now,
    ...over,
  })
const record = (over: Partial<ProgressionDecisionRecord> = {}): ProgressionDecisionRecord => ({
  id: 'test-pd1',
  ...propose(),
  ...over,
})
const review = (over: Partial<Parameters<typeof planProgressionReview>[0]> = {}) =>
  planProgressionReview({
    institutionType: 'language_school',
    enrollment: enrollment(),
    attendance: hours(36, 4),
    assessments: fullAssessments(),
    decision: record(),
    actor: coordinator,
    input: { action: 'approve', decisionId: 'test-pd1' },
    now: '2026-11-05T09:00:00.000Z',
    ...over,
  })

describe('devam şartı (DOM-DIL-060, 061)', () => {
  test('DOM-DIL-060 tam 4/5 sınavı açar; bir saat eksiği kapatır', () => {
    const exact = attendanceSummary({ totalHours: 40, rows: hours(32, 8) })
    assert.deepEqual(exact, {
      totalHours: 40,
      recordedHours: 40,
      attendedHours: 32,
      absentHours: 8,
      excusedAbsentHours: 0,
      unrecordedHours: 0,
      requiredHours: 32,
      minAttendancePermille: 800,
      status: 'eligible',
    })
    assert.equal(attendanceSummary({ totalHours: 40, rows: hours(31, 9) }).status, 'ineligible')
    // Kayan nokta: 0,8 × 35 = 28,000…04; gereken saat 28'dir.
    assert.equal(attendanceSummary({ totalHours: 35, rows: hours(28, 7) }).requiredHours, 28)
    assert.equal(attendanceSummary({ totalHours: 35, rows: hours(28, 7) }).status, 'eligible')
    assert.equal(attendanceSummary({ totalHours: 35, rows: hours(27, 8) }).status, 'ineligible')
    // Tam bölünmeyen toplamda gereken saat yukarı yuvarlanır: 0,8 × 7 = 5,6 → 6; 0,8 × 3 = 2,4 → 3.
    assert.equal(attendanceSummary({ totalHours: 7, rows: hours(6, 1) }).status, 'eligible')
    assert.equal(attendanceSummary({ totalHours: 7, rows: hours(5, 2) }).status, 'ineligible')
    assert.equal(attendanceSummary({ totalHours: 7, rows: [] }).requiredHours, 6)
    assert.equal(attendanceSummary({ totalHours: 3, rows: hours(2, 1) }).status, 'ineligible')
    assert.equal(attendanceSummary({ totalHours: 3, rows: hours(3, 0) }).status, 'eligible')
  })

  test('DOM-DIL-061 geç katılmış sayılır, gelmedi sayılmaz; özürlü devamsızlık da sayılır', () => {
    const summary = attendanceSummary({ totalHours: 40, rows: hours(32, 8, 10, 8) })
    assert.equal(summary.attendedHours, 32)
    assert.equal(summary.absentHours, 8)
    assert.equal(summary.excusedAbsentHours, 8)
    assert.equal(summary.status, 'eligible')
    const excused = attendanceSummary({ totalHours: 40, rows: hours(31, 9, 0, 9) })
    assert.equal(excused.status, 'ineligible')
  })

  test('DOM-DIL-060 yoklaması alınmamış saat katılmış sayılmaz; sonuç beklemede kalır', () => {
    const pending = attendanceSummary({ totalHours: 40, rows: hours(20, 8) })
    assert.equal(pending.unrecordedHours, 12)
    assert.equal(pending.status, 'pending')
    // 20 + 11 kalan saat = 31 < 32: kalan hepsine katılsa da yetmez.
    assert.equal(attendanceSummary({ totalHours: 40, rows: hours(20, 9) }).status, 'ineligible')
    assert.equal(attendanceSummary({ totalHours: 40, rows: hours(32, 0) }).status, 'eligible')
  })

  test('DOM-DIL-060 kurum oranı yalnız daha sıkı olabilir; gevşek değer reddedilir', () => {
    const strict = attendanceSummary({
      totalHours: 40,
      rows: hours(35, 5),
      minAttendancePermille: 900,
    })
    assert.equal(strict.requiredHours, 36)
    assert.equal(strict.status, 'ineligible')
    // Sıkı oranda da tam sınır geçer, bir saat eksiği geçmez.
    const edge = (attended: number) =>
      attendanceSummary({
        totalHours: 40,
        rows: hours(attended, 40 - attended),
        minAttendancePermille: 900,
      }).status
    assert.equal(edge(36), 'eligible')
    assert.equal(edge(35), 'ineligible')
    assert.equal(
      attendanceSummary({ totalHours: 40, rows: [], minAttendancePermille: 875 }).requiredHours,
      35,
    )
    assert.equal(MIN_ATTENDANCE_PERMILLE, 800)
    for (const minAttendancePermille of [799, 1001, 800.5])
      assert.throws(
        () => attendanceSummary({ totalHours: 40, rows: [], minAttendancePermille }),
        ZodError,
      )
    assert.deepEqual(progressionSettingsSchema.parse({}), {
      minAttendancePermille: 800,
      finalPassScore: 60,
    })
    assert.equal(
      progressionSettingsSchema.parse({ minAttendancePermille: 1000 }).minAttendancePermille,
      1000,
    )
  })

  test('DOM-DIL-061 aynı ders saatine ikinci yoklama ve kur saatini aşan satır reddedilir', () => {
    const rows = hours(2, 0)
    assert.throws(
      () => attendanceSummary({ totalHours: 40, rows: [...rows, rows[0]!] }),
      isDomainError('attendance_duplicate', 'conflict'),
    )
    assert.throws(
      () => attendanceSummary({ totalHours: 3, rows: hours(3, 1) }),
      isDomainError('attendance_exceeds_course', 'conflict'),
    )
    for (const totalHours of [0, 1.5])
      assert.throws(
        () => attendanceSummary({ totalHours, rows: [] }),
        isDomainError('course_hours_invalid'),
      )
    assert.throws(
      () =>
        attendanceSummary({
          totalHours: 40,
          rows: [{ lessonHourId: 'test-h', status: 'excused' as 'absent' }],
        }),
      ZodError,
    )
  })
})

describe('devamsızlık bildirimi (DOM-DIL-062)', () => {
  const due = (absent: number, over: Partial<Parameters<typeof absenceNoticeDue>[0]> = {}) =>
    absenceNoticeDue({
      totalHours: 40,
      rows: hours(10, absent),
      sentNotices: [],
      birthDate: '2000-01-01',
      now,
      ...over,
    })

  test('DOM-DIL-062 %10 eşiğine ulaşıldığı an birinci bildirim; bir saat önce yok', () => {
    assert.equal(due(3), null)
    const first = due(4)
    assert.deepEqual(first, {
      kind: 'first',
      label: 'Birinci devamsızlık bildirimi',
      percent: 10,
      warnsExamBar: false,
      examBarred: false,
      messageKey: 'absence_notice_first',
      message: 'Devamsızlık kur saatinin %10 eşiğine ulaştı.',
      recipients: ['learner'],
      absentHours: 4,
      totalHours: 40,
    })
    // 45 saatte %10 = 4,5: 4 saat ulaşmaz, 5 saat ulaşır.
    assert.equal(due(4, { totalHours: 45 }), null)
    assert.equal(due(5, { totalHours: 45 })?.kind, 'first')
  })

  test('DOM-DIL-062 aynı eşik iki kez önerilmez', () => {
    const sentNotices = [{ kind: 'first' as const }]
    assert.equal(due(4, { sentNotices }), null)
    assert.equal(due(5, { sentNotices }), null)
  })

  test('DOM-DIL-062 %15 eşiğinde ikinci bildirim sınava girememe uyarısını taşır', () => {
    const sentNotices = [{ kind: 'first' as const }]
    assert.equal(due(5, { sentNotices }), null)
    const second = due(6, { sentNotices })
    assert.equal(second?.kind, 'second')
    assert.equal(second?.warnsExamBar, true)
    assert.equal(second?.messageKey, 'absence_notice_second_exam_bar')
    assert.equal(
      second?.message,
      'Devamsızlık kur saatinin %15 eşiğine ulaştı. Devamsızlık %20 sınırını aşarsa kur sonu sınavına girilemez.',
    )
    assert.equal(second?.examBarred, false)
    assert.equal(due(7, { sentNotices: [...sentNotices, { kind: 'second' }] }), null)
    assert.equal(ABSENCE_NOTICES.first.warnsExamBar, false)
  })

  test('DOM-DIL-062 üst eşik gönderildiyse yoklama düzeltmesiyle oran düşse de alttaki önerilmez', () => {
    const sentNotices = [{ kind: 'second' as const }]
    // 4 saat %10'a ulaşır ama %15'lik bildirim zaten gitti.
    assert.equal(due(4, { sentNotices }), null)
    assert.equal(due(5, { sentNotices }), null)
    // Yalnız alt eşik gittiyse üst eşik hâlâ önerilir.
    assert.equal(due(6, { sentNotices: [{ kind: 'first' }] })?.kind, 'second')
  })

  test('DOM-DIL-060 DOM-DIL-062 sınır aşılmışsa bildirim sınava girilemeyeceğini söyler', () => {
    // 40 saatte binde 900: gereken 36, 5 saat devamsızlıkta 35 saate çıkılabilir → sınır aşıldı.
    const barred = due(5, { minAttendancePermille: 900 })
    assert.equal(barred?.kind, 'first')
    assert.equal(barred?.examBarred, true)
    assert.equal(barred?.messageKey, EXAM_BARRED_MESSAGE_KEY)
    assert.equal(
      barred?.message,
      'Devamsızlık kur saatinin %10 eşiğine ulaştı. Devamsızlık %10 sınırını aştı; kur sonu sınavına girilemez.',
    )
    // 4 saatte 36 saate hâlâ çıkılabilir: sınır aşılmamış, birinci bildirim eski metinde.
    const notYet = due(4, { minAttendancePermille: 900 })
    assert.equal(notYet?.examBarred, false)
    assert.equal(notYet?.messageKey, 'absence_notice_first')
    // İkinci bildirim: aşılmış (900) ve aşılmamış (800) durum.
    const sentNotices = [{ kind: 'first' as const }]
    const secondBarred = due(6, { minAttendancePermille: 900, sentNotices })
    assert.equal(secondBarred?.kind, 'second')
    assert.equal(secondBarred?.examBarred, true)
    assert.equal(secondBarred?.messageKey, 'absence_notice_exam_barred')
    assert.match(secondBarred?.message ?? '', /%10 sınırını aştı; kur sonu sınavına girilemez\.$/)
    const secondOpen = due(6, { minAttendancePermille: 800, sentNotices })
    assert.equal(secondOpen?.examBarred, false)
    assert.equal(secondOpen?.messageKey, 'absence_notice_second_exam_bar')
    assert.match(secondOpen?.message ?? '', /%20 sınırını aşarsa/)
    // Varsayılan oranda 8 saat hâlâ sınırda (32 saate çıkılır), 9 saat aşar.
    assert.equal(due(8)?.examBarred, false)
    assert.equal(due(9)?.examBarred, true)
    assert.equal(due(9)?.messageKey, EXAM_BARRED_MESSAGE_KEY)
  })

  test('DOM-DIL-062 iki eşik birlikte aşılırsa yalnız ikinci bildirim önerilir', () => {
    assert.equal(due(8)?.kind, 'second')
  })

  test('DOM-DIL-062 kurum oranı sıkıysa uyarı kurumun sınırını yazar', () => {
    assert.match(due(6, { minAttendancePermille: 900 })?.message ?? '', /%10 sınırını/)
    assert.match(due(6, { minAttendancePermille: 875 })?.message ?? '', /%12,5 sınırını/)
    // 850'de 6 saat henüz aşmaz (34 saate çıkılır): ikinci bildirim uyarı olarak kalır.
    assert.match(due(6, { minAttendancePermille: 850 })?.message ?? '', /%15 sınırını aşarsa/)
  })

  test('DOM-DIL-062 DOM-DIL-091 18 yaş altında veli de alıcıdır; yaş İstanbul gününe göre', () => {
    assert.deepEqual(due(4, { birthDate: '2008-11-05' })?.recipients, ['learner', 'guardian'])
    assert.deepEqual(due(4, { birthDate: '2008-11-04' })?.recipients, ['learner'])
    // 3 Kasım 22.30 UTC İstanbul'da 4 Kasım'dır: 18. doğum günü başlamıştır.
    assert.equal(isMinorOn('2008-11-04', '2026-11-03T22:30:00.000Z'), false)
    assert.equal(isMinorOn('2008-11-04', '2026-11-03T20:00:00.000Z'), true)
    // 29 Şubat doğumlu artık olmayan yılda 1 Mart'ta reşit olur.
    assert.equal(isMinorOn('2008-02-29', '2026-02-28T12:00:00.000Z'), true)
    assert.equal(isMinorOn('2008-02-29', '2026-03-01T12:00:00.000Z'), false)
    assert.throws(() => isMinorOn('04.11.2008', now), isDomainError('birth_date_invalid'))
  })

  test('DOM-DIL-062 doğum tarihi gerçek takvim günü olmalı; geçersiz anda ret', () => {
    for (const birthDate of ['2008-02-30', '2007-02-29', '2008-13-01', '2008-00-10', '2008-04-31'])
      assert.throws(
        () => isMinorOn(birthDate, now),
        (error: unknown) =>
          isDomainError('birth_date_invalid')(error) &&
          JSON.stringify((error as { path: unknown }).path) === '["birthDate"]',
        birthDate,
      )
    assert.throws(() => due(4, { birthDate: '2008-02-30' }), isDomainError('birth_date_invalid'))
    assert.equal(isMinorOn('2008-02-29', now), false)
    for (const bad of ['bozuk', '2026-13-45T00:00:00Z', new Date(Number.NaN)])
      assert.throws(
        () => isMinorOn('2008-01-01', bad),
        (error: unknown) =>
          isDomainError('invalid_now')(error) &&
          JSON.stringify((error as { path: unknown }).path) === '["now"]',
      )
    assert.throws(() => due(4, { now: 'x' }), isDomainError('invalid_now'))
  })
})

describe('kur içi ölçmeler (DOM-DIL-013)', () => {
  const body = (over: object = {}) => ({
    enrollmentId: 'test-enr1',
    point: 'midterm',
    score: 72.5,
    skills: [...SKILLS].reverse().map((skill) => ({
      skill,
      score: 70,
      feedback: `${skill} için öneriler`,
    })),
    ...over,
  })
  const record = (over: Partial<Parameters<typeof planCourseAssessment>[0]> = {}) =>
    planCourseAssessment({
      institutionType: 'language_school',
      enrollment: enrollment(),
      existing: [],
      actor: teacher,
      input: body(),
      now,
      ...over,
    })

  test('DOM-DIL-013 grubun öğretmeni ölçmeyi beceri puanı ve geri bildirimle girer', () => {
    const draft = record()
    assert.equal(draft.point, 'midterm')
    assert.equal(draft.score, 72.5)
    assert.deepEqual(
      draft.skills.map((s) => s.skill),
      [...SKILLS],
    )
    assert.equal(draft.assessedAt, now)
    assert.equal(draft.assessedByUserId, 'test-u-teacher')
    assert.deepEqual(Object.keys(ASSESSMENT_POINTS), ['baseline', 'midterm', 'final'])
    assert.equal(ASSESSMENT_POINTS.baseline.countsForProgression, false)
  })

  test('DOM-DIL-013 geri bildirimi boş ölçme kaydedilmez; hata alan yolunu gösterir', () => {
    const skills = body().skills.map((s, i) => (i === 2 ? { ...s, feedback: '   ' } : s))
    const result = courseAssessmentInputSchema.safeParse(body({ skills }))
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['skills', 2, 'feedback'])
    assert.throws(() => record({ input: body({ skills }) }), ZodError)
    assert.throws(() => record({ input: body({ skills: body().skills.slice(1) }) }), ZodError)
    const repeated = body().skills.map((s) => ({ ...s, skill: 'reading' }))
    assert.throws(() => record({ input: body({ skills: repeated }) }), ZodError)
    assert.throws(() => record({ input: body({ score: 101 }) }), ZodError)
    assert.throws(() => record({ input: body({ point: 'quiz' }) }), ZodError)
  })

  test('DOM-DIL-013 ölçmeyi yalnız grubun öğretmeni girer; nokta kayıt başına bir kez', () => {
    for (const actor of [admin, { userId: 'test-u-other', role: 'ogretmen' as const }]) {
      assert.throws(() => record({ actor }), isDomainError('permission_denied', 'forbidden'))
    }
    assert.throws(
      () => record({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
    assert.throws(
      () => record({ input: body({ enrollmentId: 'test-enr-other' }) }),
      isDomainError('enrollment_not_found', 'not_found'),
    )
    const existing = [{ enrollmentId: 'test-enr1', point: 'midterm' as const }]
    const before = structuredClone(existing)
    assert.throws(
      () => record({ existing }),
      isDomainError('assessment_already_recorded', 'conflict'),
    )
    assert.deepEqual(existing, before)
    assert.equal(
      record({ existing: [{ enrollmentId: 'test-enr2', point: 'midterm' }] }).point,
      'midterm',
    )
  })

  test('DOM-DIL-013 eksik nokta, eksik beceri ve boş geri bildirim tamamlanmamış sayılır', () => {
    assert.deepEqual(assessmentGaps(fullAssessments()), [])
    assert.deepEqual(assessmentGaps([assessment('midterm')]), [
      { point: 'baseline', reason: 'missing' },
      { point: 'final', reason: 'missing' },
    ])
    const partial = assessment(
      'final',
      80,
      {},
      {
        skills: [
          { skill: 'reading', score: 80, feedback: 'İyi' },
          { skill: 'listening', score: 80, feedback: null },
          { skill: 'writing', score: 80, feedback: '  ' },
        ],
      },
    )
    assert.deepEqual(assessmentGaps([assessment('baseline'), assessment('midterm'), partial]), [
      { point: 'final', reason: 'feedback_missing', skill: 'listening' },
      { point: 'final', reason: 'feedback_missing', skill: 'writing' },
      { point: 'final', reason: 'skill_missing', skill: 'speaking' },
    ])
    assert.throws(
      () => assessmentGaps([assessment('final'), assessment('final')]),
      isDomainError('assessment_duplicate', 'conflict'),
    )
  })
})

describe('kur geçme koşulları (DOM-DIL-070, 013)', () => {
  const evaluate = (over: Partial<Parameters<typeof evaluateProgression>[0]> = {}) =>
    evaluateProgression({
      enrollment: enrollment(),
      attendance: hours(36, 4),
      assessments: fullAssessments(),
      ...over,
    })

  test('DOM-DIL-070 üç koşul sağlanınca geçti veya tekrar verilebilir; eşiğin tam sınırı geçer', () => {
    const exact = evaluate({
      attendance: hours(32, 8),
      assessments: fullAssessments(60, { reading: 50, listening: 50, writing: 50, speaking: 50 }),
    })
    assert.deepEqual(exact.conditions, { attendance: true, finalScore: true, skills: true })
    assert.deepEqual(exact.allowedOutcomes, ['passed', 'repeat'])
    assert.equal(exact.blocker, null)
    assert.deepEqual(PASS_RULES, { finalScore: 60, skillScore: 50 })
    assert.deepEqual(Object.keys(PROGRESSION_OUTCOMES), [
      'passed',
      'repeat',
      'incomplete_attendance',
    ])
  })

  test('DOM-DIL-070 kur sonu puanı veya tek beceri eşiğin altındaysa yalnız tekrar', () => {
    const low = evaluate({ assessments: fullAssessments(59.9) })
    assert.equal(low.conditions.finalScore, false)
    assert.deepEqual(low.allowedOutcomes, ['repeat'])
    const weakSkill = evaluate({ assessments: fullAssessments(90, { speaking: 49.9 }) })
    assert.equal(weakSkill.conditions.skills, false)
    assert.deepEqual(weakSkill.failingSkills, ['speaking'])
    assert.deepEqual(weakSkill.allowedOutcomes, ['repeat'])
  })

  test('DOM-DIL-070 kurum eşiği yükseltilebilir, 60 altına inemez (TODO cefr-meb-esigi)', () => {
    const strict = evaluate({ settings: { finalPassScore: 80 } })
    assert.deepEqual(strict.allowedOutcomes, ['repeat'])
    assert.equal(strict.basis.finalPassScore, 80)
    assert.throws(() => evaluate({ settings: { finalPassScore: 59 } }), ZodError)
    assert.throws(() => evaluate({ settings: { minAttendancePermille: 750 } }), ZodError)
  })

  test('DOM-DIL-013 başlangıç ölçmesi hesaba ve kopyaya girmez', () => {
    const result = evaluate()
    // Başlangıçta bütün beceriler 10 puan; karar yine geçtiye izin verir.
    assert.deepEqual(result.allowedOutcomes, ['passed', 'repeat'])
    assert.deepEqual(
      result.basis.assessments.map((a) => a.point),
      ['midterm', 'final'],
    )
    assert.equal(progressionBasisSchema.safeParse(result.basis).success, true)
    // Başlangıç kur sonuysa kalmış gibi davranmaz: kur sonu olmadan karar yok.
    const noFinal = evaluate({ assessments: fullAssessments().slice(0, 2) })
    assert.deepEqual(noFinal.allowedOutcomes, [])
    assert.deepEqual(noFinal.blocker, {
      reason: 'assessments_incomplete',
      gaps: [{ point: 'final', reason: 'missing' }],
    })
    assert.equal(noFinal.conditions.skills, false)
  })

  test('DOM-DIL-013 eksik başlangıç ölçmesi de kur sonu kararını engeller', () => {
    const result = evaluate({ assessments: fullAssessments().slice(1) })
    assert.equal(result.blocker?.reason, 'assessments_incomplete')
    assert.deepEqual(result.allowedOutcomes, [])
  })

  test('DOM-DIL-060 DOM-DIL-070 devam şartı yoksa yalnız devamsızlıktan tamamlamadı', () => {
    const absent = evaluate({ attendance: hours(31, 9), assessments: [] })
    assert.deepEqual(absent.allowedOutcomes, ['incomplete_attendance'])
    assert.equal(absent.blocker, null)
    assert.equal(absent.basis.attendance.met, false)
    // Başka kaydın ölçmesi sayılmaz.
    const foreign = evaluate({
      assessments: fullAssessments().map((a) => ({ ...a, enrollmentId: 'test-enr2' })),
    })
    assert.equal(foreign.blocker?.reason, 'assessments_incomplete')
  })

  test('DOM-DIL-060 devam henüz belli değilse karar verilemez', () => {
    const pending = evaluate({ attendance: hours(30, 2) })
    assert.deepEqual(pending.blocker, { reason: 'attendance_pending' })
    assert.deepEqual(pending.allowedOutcomes, [])
  })
})

describe('kur geçme kararı (DOM-DIL-070)', () => {
  test('DOM-DIL-070 öğretmen kararı önerir; onay bekler, dayanak ve öneri kopyası taşır', () => {
    const inputs = { attendance: hours(36, 4), assessments: fullAssessments() }
    const before = structuredClone(inputs)
    const draft = propose(inputs)
    assert.deepEqual(inputs, before)
    assert.equal(draft.status, 'pending')
    assert.equal(draft.outcome, 'passed')
    assert.equal(draft.learnerId, 'test-st1')
    assert.equal(draft.courseId, 'test-course-b1-1')
    assert.equal(draft.decidedByUserId, 'test-u-teacher')
    assert.equal(draft.decidedAt, now)
    assert.equal(draft.correctsDecisionId, null)
    assert.equal(draft.reviewedByUserId, null)
    assert.equal(draft.basis.attendance.attendedHours, 36)
    // DOM-BEC-030: öneri gerekçedir; yetersiz kanıt olsa da kararı engellemez.
    assert.deepEqual(draft.evidenceSnapshot.overall.status, 'insufficient')
    assert.equal(propose({ input: { ...decisionInput, outcome: 'repeat' } }).outcome, 'repeat')
  })

  test('DOM-DIL-070 öğretmen koşulları sağlamayana geçti veremez', () => {
    assert.throws(
      () => propose({ assessments: fullAssessments(55) }),
      (error: unknown) =>
        isDomainError('pass_conditions_not_met')(error) &&
        JSON.stringify((error as { path: unknown }).path) === '["outcome"]',
    )
    assert.throws(
      () => propose({ assessments: fullAssessments(90, { writing: 40 }) }),
      isDomainError('pass_conditions_not_met'),
    )
  })

  test('DOM-DIL-060 DOM-DIL-070 devam şartı yoksa karar yalnız devamsızlıktan tamamlamadı', () => {
    const attendance = hours(31, 9)
    for (const outcome of ['passed', 'repeat'])
      assert.throws(
        () => propose({ attendance, input: { ...decisionInput, outcome } }),
        isDomainError('attendance_not_met'),
      )
    const draft = propose({
      attendance,
      assessments: [],
      input: { ...decisionInput, outcome: 'incomplete_attendance' },
    })
    assert.equal(draft.outcome, 'incomplete_attendance')
    assert.throws(
      () => propose({ input: { ...decisionInput, outcome: 'incomplete_attendance' } }),
      isDomainError('attendance_met'),
    )
  })

  test('DOM-DIL-013 DOM-DIL-060 eksik ölçme veya belirsiz devamla karar verilemez', () => {
    assert.throws(
      () => propose({ attendance: hours(30, 2) }),
      isDomainError('attendance_pending', 'conflict'),
    )
    const noFeedback = assessment(
      'final',
      80,
      {},
      {
        skills: SKILLS.map((skill) => ({
          skill,
          score: 80,
          feedback: skill === 'writing' ? '' : 'İyi',
        })),
      },
    )
    assert.throws(
      () => propose({ assessments: [...fullAssessments().slice(0, 2), noFeedback] }),
      (error: unknown) =>
        isDomainError('assessments_incomplete')(error) &&
        JSON.stringify((error as { path: unknown }).path) ===
          '["assessments","final","skills","writing","feedback"]',
    )
    assert.throws(
      () => propose({ assessments: fullAssessments().slice(1) }),
      (error: unknown) =>
        JSON.stringify((error as { path: unknown }).path) === '["assessments","baseline"]',
    )
    const noSkill = assessment(
      'final',
      80,
      {},
      {
        skills: [{ skill: 'reading', score: 80, feedback: 'İyi' }],
      },
    )
    assert.throws(
      () => propose({ assessments: [...fullAssessments().slice(0, 2), noSkill] }),
      (error: unknown) =>
        JSON.stringify((error as { path: unknown }).path) ===
        '["assessments","final","skills","listening"]',
    )
  })

  test('DOM-DIL-070 kararı yalnız grubun öğretmeni verir; okulda kur geçişi yok', () => {
    for (const actor of [admin, coordinator, { userId: 'test-u-s', role: 'ogrenci' as const }])
      assert.throws(() => propose({ actor }), isDomainError('permission_denied', 'forbidden'))
    assert.throws(
      () => propose({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
    assert.throws(
      () => propose({ input: { ...decisionInput, enrollmentId: 'test-enr-x' } }),
      isDomainError('enrollment_not_found', 'not_found'),
    )
    assert.throws(() => propose({ input: { ...decisionInput, rationale: ' ' } }), ZodError)
    assert.throws(() => propose({ input: { ...decisionInput, outcome: 'gecti' } }), ZodError)
  })

  test('DOM-DIL-070 açık veya onaylı karar varken yeni karar açılmaz; reddedilen engellemez', () => {
    assert.throws(
      () => propose({ existingDecisions: [record()] }),
      isDomainError('progression_pending', 'conflict'),
    )
    assert.throws(
      () => propose({ existingDecisions: [record({ status: 'approved' })] }),
      isDomainError('progression_already_decided', 'conflict'),
    )
    const rejected = record({ status: 'rejected', rejectionReason: 'Yazma puanı kontrol edilsin.' })
    assert.equal(propose({ existingDecisions: [rejected] }).status, 'pending')
    // Başka kaydın kararı sayılmaz.
    const other = record({ status: 'approved', enrollmentId: 'test-enr2' })
    assert.equal(propose({ existingDecisions: [other] }).status, 'pending')
  })
})

describe('onay ve düzeltme (DOM-DIL-070)', () => {
  test('DOM-DIL-070 akademik koordinatör onaylar; karar onaylı olur', () => {
    const approved = review()
    assert.equal(approved.status, 'approved')
    assert.equal(approved.reviewedByUserId, 'test-u-coord')
    assert.equal(approved.reviewedAt, '2026-11-05T09:00:00.000Z')
    assert.equal(approved.rejectionReason, null)
  })

  test('DOM-DIL-070 DOM-YTK-027 onayı yalnız koordinatör verir; yönetici yerine geçmez', () => {
    for (const actor of [
      admin,
      teacher,
      { ...coordinator, coordinator: false },
      { userId: 'test-u-ob', role: 'onburo' as const },
      { userId: 'test-u-v', role: 'veli' as const },
    ])
      assert.throws(() => review({ actor }), isDomainError('permission_denied', 'forbidden'))
    assert.throws(
      () =>
        review({
          actor: admin,
          input: { action: 'reject', decisionId: 'test-pd1', reason: 'Gerekçe' },
        }),
      isDomainError('permission_denied', 'forbidden'),
    )
    assert.equal(canReviewProgression(coordinator), true)
    assert.equal(canReviewProgression(admin), false)
    assert.equal(canReviewProgression(teacher), false)
    assert.throws(
      () => review({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })

  test('DOM-DIL-070 iki kişi kuralı: kararı veren kendi kararını onaylayamaz', () => {
    // Koordinatör aynı zamanda grubun öğretmeniyse de kendi önerisini onaylayamaz.
    const coordinatorTeacher: ProgressionActor = { ...coordinator, userId: 'test-u-teacher' }
    assert.throws(
      () => review({ actor: coordinatorTeacher }),
      isDomainError('progression_self_review', 'forbidden'),
    )
  })

  test('DOM-DIL-070 ret gerekçe ister; sonuçlanmış karar değişmez', () => {
    assert.throws(
      () => review({ input: { action: 'reject', decisionId: 'test-pd1', reason: '' } }),
      ZodError,
    )
    const rejected = review({
      input: {
        action: 'reject',
        decisionId: 'test-pd1',
        reason: 'Konuşma puanı yeniden girilsin.',
      },
    })
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.rejectionReason, 'Konuşma puanı yeniden girilsin.')
    for (const status of ['approved', 'rejected'] as const) {
      const decision = record({ status })
      const before = structuredClone(decision)
      assert.throws(
        () => review({ decision }),
        isDomainError('progression_already_reviewed', 'conflict'),
      )
      assert.deepEqual(decision, before)
    }
    assert.throws(
      () => review({ input: { action: 'approve', decisionId: 'test-pd-x' } }),
      isDomainError('progression_not_found', 'not_found'),
    )
    assert.throws(
      () => review({ enrollment: enrollment({ id: 'test-enr2' }) }),
      isDomainError('progression_not_found', 'not_found'),
    )
  })

  test('DOM-DIL-070 onay anında dayanak değişmişse onay reddedilir, öğretmen yeniden önerir', () => {
    const rejectsBasis = (over: Parameters<typeof review>[0]) =>
      assert.throws(
        () => review(over),
        (error: unknown) =>
          isDomainError('progression_basis_changed', 'conflict')(error) &&
          JSON.stringify((error as { path: unknown }).path) === '["basis"]',
      )
    // Kur sonu puanı düzeltildi (artık geçti de izinli değil): önce dayanak değişimi yakalanır.
    rejectsBasis({ assessments: fullAssessments(50) })
    // Geçmeye izin veren bir değişiklik de (puan 75 → 80) onaylanmış sayılmaz.
    rejectsBasis({ assessments: fullAssessments(80) })
    // Devam verisi değişti.
    rejectsBasis({ attendance: hours(37, 3) })
    // Kurum eşiği değişti.
    rejectsBasis({ settings: { finalPassScore: 70 } })
    // Reddetmek dayanağa bakmaz; öğretmen yeniden önereceği için gerekçe yeter.
    assert.equal(
      review({
        assessments: fullAssessments(50),
        input: { action: 'reject', decisionId: 'test-pd1', reason: 'Puan değişti.' },
      }).status,
      'rejected',
    )
  })

  test('DOM-DIL-070 dayanak aynı kalıp geri bildirim silinmişse onay assessments_incomplete verir', () => {
    // Geri bildirim dayanağa girmez: basis aynı, ama koşullar artık hesaplanamaz.
    const noFeedback = fullAssessments().map((row) =>
      row.point === 'final'
        ? {
            ...row,
            skills: row.skills.map((s) => (s.skill === 'writing' ? { ...s, feedback: '' } : s)),
          }
        : row,
    )
    assert.throws(
      () => review({ assessments: noFeedback }),
      (error: unknown) =>
        isDomainError('assessments_incomplete')(error) &&
        JSON.stringify((error as { path: unknown }).path) ===
          '["assessments","final","skills","writing","feedback"]',
    )
  })

  test('DOM-DIL-070 jsonb anahtar sırasını değiştirse de dayanak aynıysa onay geçer', () => {
    const reverse = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reverse)
      if (value !== null && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value)
            .reverse()
            .map(([k, v]) => [k, reverse(v)]),
        )
      return value
    }
    const original = record()
    const shuffled = { ...original, basis: reverse(original.basis) as typeof original.basis }
    assert.notDeepEqual(Object.keys(shuffled.basis), Object.keys(original.basis))
    assert.equal(review({ decision: shuffled }).status, 'approved')
  })

  test('DOM-DIL-070 düzeltme gerekçeli yeni karardır, geçerli karara referans verir', () => {
    const d1 = record({ id: 'test-pd1', status: 'approved', outcome: 'repeat' })
    const correction = propose({
      existingDecisions: [d1],
      input: {
        ...decisionInput,
        correctsDecisionId: 'test-pd1',
        rationale: 'Kur sonu puanı hatalı girilmişti; düzeltilmiş puanla geçti.',
      },
    })
    assert.equal(correction.correctsDecisionId, 'test-pd1')
    assert.equal(correction.status, 'pending')
    assert.equal(d1.status, 'approved')
    assert.throws(
      () =>
        propose({
          existingDecisions: [d1],
          input: { ...decisionInput, correctsDecisionId: 'test-pd1', rationale: '' },
        }),
      ZodError,
    )
    const d2 = record({ ...correction, id: 'test-pd2', status: 'approved' })
    assert.equal(effectiveProgressionDecision([d1, d2])?.id, 'test-pd2')
    assert.equal(effectiveProgressionDecision([d2, d1])?.id, 'test-pd2')
    // Zincir: yeni düzeltme yalnız geçerli karara (d2) yapılır.
    assert.throws(
      () =>
        propose({
          existingDecisions: [d1, d2],
          input: { ...decisionInput, correctsDecisionId: 'test-pd1' },
        }),
      isDomainError('progression_correction_target_invalid'),
    )
    assert.equal(
      propose({
        existingDecisions: [d1, d2],
        input: { ...decisionInput, correctsDecisionId: 'test-pd2' },
      }).correctsDecisionId,
      'test-pd2',
    )
    // Onaylı karar yokken düzeltme açılmaz.
    assert.throws(
      () => propose({ input: { ...decisionInput, correctsDecisionId: 'test-pd1' } }),
      isDomainError('progression_correction_target_invalid'),
    )
    assert.equal(effectiveProgressionDecision([record()]), null)
    // Onaylanmamış düzeltme öncekinin yerine geçmez.
    const pendingFix = record({ ...correction, id: 'test-pd3' })
    assert.equal(effectiveProgressionDecision([d1, pendingFix])?.id, 'test-pd1')
  })
})

describe('karardan sonraki adım (DOM-DIL-070, DOM-DIL-007; IST-062)', () => {
  const course = { id: 'test-course-b1-1', level: 'B1' as const, nextCourseId: null }

  test('DOM-DIL-070 IST-062 onaylı geçti kararı sonraki seviyeyi ve karar kimliğini taşır', () => {
    const approved = record({ status: 'approved' })
    assert.deepEqual(progressionNextStep({ decisions: [approved], course }), {
      decisionId: 'test-pd1',
      enrollmentId: 'test-enr1',
      learnerId: 'test-st1',
      fromCourseId: 'test-course-b1-1',
      fromLevel: 'B1',
      nextCourseId: null,
      nextLevel: 'B1+',
    })
    // DOM-DIL-007: zincirli kurda sonraki kur ve onun seviyesi (aynı seviye olabilir).
    const chained = progressionNextStep({
      decisions: [approved],
      course: { ...course, nextCourseId: 'test-course-b1-2' },
      nextCourse: { id: 'test-course-b1-2', level: 'B1' },
    })
    assert.equal(chained?.nextCourseId, 'test-course-b1-2')
    assert.equal(chained?.nextLevel, 'B1')
    // Sonraki kur okunamadıysa seviye uydurulmaz.
    const unread = progressionNextStep({
      decisions: [approved],
      course: { ...course, nextCourseId: 'test-course-b1-2' },
    })
    assert.equal(unread?.nextLevel, null)
    // En üst seviyede bir üst seviye yoktur.
    assert.equal(
      progressionNextStep({ decisions: [approved], course: { ...course, level: 'C2' } })?.nextLevel,
      null,
    )
  })

  test('DOM-DIL-070 bekleyen, reddedilen, tekrar ve düzeltilmiş geçti kararı üst kur açmaz', () => {
    assert.equal(progressionNextStep({ decisions: [record()], course }), null)
    assert.equal(progressionNextStep({ decisions: [record({ status: 'rejected' })], course }), null)
    assert.equal(
      progressionNextStep({
        decisions: [record({ status: 'approved', outcome: 'repeat' })],
        course,
      }),
      null,
    )
    const passed = record({ status: 'approved' })
    const fix = record({
      id: 'test-pd2',
      status: 'approved',
      outcome: 'repeat',
      correctsDecisionId: 'test-pd1',
    })
    assert.equal(progressionNextStep({ decisions: [passed, fix], course }), null)
    assert.throws(
      () =>
        progressionNextStep({
          decisions: [passed],
          course: { ...course, id: 'test-course-other' },
        }),
      isDomainError('progression_course_mismatch'),
    )
  })
})
