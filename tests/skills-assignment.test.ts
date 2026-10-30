import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKeySchema,
  questionBodySchema,
  resourceVersionInputSchema,
  type AnswerKey,
  type QuestionBody,
  type ResourceVersionInput,
} from '../packages/school-core/src/content/resource.ts'
import type { AuthorizationSource } from '../packages/school-core/src/lib/authorize.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import {
  LISTENING_PLAYS_DEFAULT,
  RESUBMISSION_MAX_DAYS,
  assertNoOverlappingAssignment,
  assignmentSettingsSchema,
  deadlineForVersion,
  planAssignment,
  planAssignmentChange,
  planRescore,
  planResubmissionRequest,
  previewRescore,
  resolveAssignmentSettings,
  resolveTargets,
  scoringItemsFor,
  type AssignedContent,
  type AssignmentInput,
  type AssignmentSettingsInput,
  type ExistingAssignment,
  type RescoreContext,
  type RescoreLearner,
  type ResubmittableSubmission,
} from '../packages/school-core/src/skills/assignment.ts'
import {
  rubricVersionInputSchema,
  type RubricScoreRow,
  type RubricVersionRow,
} from '../packages/school-core/src/skills/rubric.ts'
import {
  ATTEMPT_LIMITS,
  istanbulLocalToUtc,
  submissionWindow,
  type AnswerLocale,
  type ScoringItem,
} from '../packages/school-core/src/skills/scoring.ts'
import {
  VERSION_LIMITS,
  planSubmissionVersion,
  versionIsLate,
  type VersionRow,
} from '../packages/school-core/src/skills/submission.ts'
import { isDomainError } from './support/domain-error.ts'

/** `assert.throws` için Zod doğrulama hatası (kök testler `zod`u doğrudan içe aktarmaz). */
const ZodError = { name: 'ZodError' }
const now = '2026-11-04T09:00:00.000Z'
const due = '2026-11-12T20:59:00.000Z'
const DAY = 24 * 60 * 60_000
const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()

// --- Kurum kaynağı ------------------------------------------------------------------------

const teacherRow = (id: string, subjectId: string, isActive = true) => ({
  id,
  subjectId,
  branchId: 'test-b1',
  isActive,
  deletedAt: null as string | null,
})
const classRow = (id: string, grade: number, teacherId: string) => ({
  id,
  grade,
  level: `${grade}. Sınıf`,
  branchId: 'test-b1',
  teacherId,
})
/**
 * test-t1 (İngilizce) 7-A, 8-A ve boş 9-Z'de ders verir, 7-B'nin yalnız rehber öğretmenidir.
 * test-t2 (matematik) 7-B'de ders verir. test-t3 pasiftir.
 */
const source: AuthorizationSource = {
  students: [
    { id: 'test-s1', classId: 'test-c7a' },
    { id: 'test-s2', classId: 'test-c7a' },
    { id: 'test-s3', classId: 'test-c7b' },
    { id: 'test-s4', classId: 'test-c8a' },
  ],
  teachers: [
    teacherRow('test-t1', 'english'),
    teacherRow('test-t2', 'math'),
    teacherRow('test-t3', 'english', false),
  ],
  classes: [
    classRow('test-c7a', 7, 'test-t2'),
    classRow('test-c7b', 7, 'test-t1'),
    classRow('test-c8a', 8, 'test-t2'),
    classRow('test-c9z', 9, 'test-t2'),
  ],
  assignments: [
    { classId: 'test-c7a', teacherId: 'test-t1', subjectId: 'english' },
    { classId: 'test-c8a', teacherId: 'test-t1', subjectId: 'english' },
    { classId: 'test-c9z', teacherId: 'test-t1', subjectId: 'english' },
    { classId: 'test-c7b', teacherId: 'test-t2', subjectId: 'math' },
  ],
  clubs: [],
  mockExams: [],
  modules: { learning: true },
}
const teacher: Actor = { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 'test-t1' }] }
const inactiveTeacher: Actor = {
  role: 'ogretmen',
  links: [{ kind: 'teacher', recordId: 'test-t3' }],
}
const admin: Actor = { role: 'yonetici', links: [] }
const frontDesk: Actor = { role: 'onburo', links: [] }
const student: Actor = { role: 'ogrenci', links: [{ kind: 'student', recordId: 'test-s1' }] }
const parent: Actor = { role: 'veli', links: [{ kind: 'child', recordId: 'test-s1' }] }

// --- İçerik -------------------------------------------------------------------------------

const englishTags = { subjectId: 'english', gradeLevels: [7], cefrLevel: 'A2' as const }
const quizInput: ResourceVersionInput = {
  title: 'Past simple quiz',
  content: {
    type: 'quiz',
    items: [{ questionVersionId: 'test-qv1' }, { questionVersionId: 'test-qv2', points: 2 }],
    timeLimitMinutes: 20,
  },
  tags: { ...englishTags, primarySkill: 'language_use' },
}
const homeworkInput = (input: { rubricId?: string | null; skill?: 'writing' | null } = {}) =>
  ({
    title: 'My holiday',
    content: {
      type: 'homework_template',
      instructions: 'Tatilini anlatan 120 sözcüklük bir metin yaz.',
      submissionKinds: ['text', 'file'],
      criteria: input.rubricId === null ? 'Görev, tutarlılık ve dil.' : null,
      rubricId: input.rubricId === undefined ? 'test-r1' : input.rubricId,
    },
    tags: {
      ...englishTags,
      primarySkill: input.skill === undefined ? 'writing' : input.skill,
    },
  }) satisfies ResourceVersionInput
const assigned = (
  data: ResourceVersionInput,
  contentType: AssignedContent['resource']['contentType'],
  overrides: Partial<AssignedContent['version']> = {},
): AssignedContent => {
  const version = resourceVersionInputSchema.parse(data)
  return {
    resource: { id: 'test-res1', contentType, currentVersionId: 'test-rv-1' },
    version: {
      id: 'test-rv-1',
      resourceId: 'test-res1',
      status: 'published',
      tags: version.tags,
      content: version.content,
      ...overrides,
    },
  }
}
const quiz = assigned(quizInput, 'quiz')
const homework = assigned(homeworkInput(), 'homework_template')

const bands = [0, 1, 2, 3, 4, 5].map((band) => ({
  band,
  description: `Bant ${band} tanımı`,
  alignment: {
    kind: 'cefr' as const,
    scale: 'Genel yazılı üretim',
    level: 'A2' as const,
    index: 1,
  },
}))
const rubric = (input: Partial<RubricVersionRow> = {}): RubricVersionRow => ({
  ...rubricVersionInputSchema.parse({
    title: 'Kısa yazı',
    kind: 'analytic',
    skill: 'writing',
    criteria: [
      { id: 'task', aspect: 'task_fulfilment', bands },
      { id: 'gram', aspect: 'grammatical_accuracy', bands },
    ],
  }),
  id: 'test-rbv1',
  rubricId: 'test-r1',
  versionNumber: 1,
  status: 'published',
  createdAt: '2026-09-01T09:00:00.000Z',
  publishedAt: '2026-09-01T09:00:00.000Z',
  archivedAt: null,
  ...input,
})

const settings = (input: AssignmentSettingsInput = {}) =>
  assignmentSettingsSchema.parse({ deadline: { dueAt: due }, ...input })
const writingSettings = (input: AssignmentSettingsInput = {}) =>
  settings({ submission: { submissionKind: 'text' }, rubricVersionId: 'test-rbv1', ...input })
const resolve = (
  content: AssignedContent,
  s = settings(),
  rubricVersion: RubricVersionRow | null = null,
) => resolveAssignmentSettings({ ...content, settings: s, rubricVersion, now })

const planInput = (input: Partial<AssignmentInput> = {}): AssignmentInput => ({
  resourceVersionId: 'test-rv-1',
  settings: { deadline: { dueAt: due } },
  targets: [{ kind: 'class', id: 'test-c7a' }],
  ...input,
})
const plan = (
  input: Partial<Parameters<typeof planAssignment>[0]> = {},
  body: Partial<AssignmentInput> = {},
) =>
  planAssignment({
    ...quiz,
    actor: teacher,
    source,
    institutionType: 'school',
    rubricVersion: null,
    existing: [],
    input: planInput(body),
    now,
    ...input,
  })

describe('atama ayarları (ADR 0004 karar 4)', () => {
  test('DOM-BEC-042 varsayılanlar F4a1 ile aynıdır: değerlendirme, hak 1, ilk deneme, geç kabul kapalı', () => {
    const s = settings()
    assert.deepEqual(s.attempts, {
      kind: 'evaluation',
      maxAttempts: ATTEMPT_LIMITS.default,
      countPolicy: 'first',
    })
    assert.deepEqual(s.deadline, { dueAt: due, lateAcceptanceDays: 0 })
    assert.equal(s.listeningPlays, LISTENING_PLAYS_DEFAULT)
    assert.equal(s.showTranscript, false)
    assert.equal(s.secondRatingPercent, undefined)
    assert.equal(s.timeLimitMinutes, undefined)
    assert.equal(
      writingSettings().submission?.submissionKind === 'text' &&
        writingSettings().submission?.maxVersions,
      VERSION_LIMITS.default,
    )
  })

  test('DOM-BEC-044 değerlendirme son teslim ister; alıştırma son tarihsiz olabilir', () => {
    assert.throws(() => assignmentSettingsSchema.parse({}), ZodError)
    const practice = assignmentSettingsSchema.parse({ attempts: { kind: 'practice' } })
    assert.equal(practice.deadline.dueAt, null)
  })

  test('DOM-BEC-005 değerlendirmede döküm gösterilmez, alıştırmada açılabilir', () => {
    assert.throws(() => settings({ showTranscript: true }), ZodError)
    assert.equal(
      settings({ attempts: { kind: 'practice' }, showTranscript: true }).showTranscript,
      true,
    )
  })

  test('DOM-BEC-024 yüksek sonuçlu yazma görevinde ikinci puanlama en az %10, varsayılan %10', () => {
    const percent = (input: AssignmentSettingsInput) =>
      resolve(homework, writingSettings(input), rubric()).secondRatingPercent
    assert.equal(percent({ highStakes: true }), 10)
    assert.equal(percent({ highStakes: true, secondRatingPercent: 25 }), 25)
    assert.equal(percent({ highStakes: true, secondRatingPercent: 10 }), 10)
    assert.throws(
      () => percent({ highStakes: true, secondRatingPercent: 9 }),
      isDomainError('second_rating_below_minimum'),
    )
    assert.equal(percent({}), 0)
    assert.equal(percent({ secondRatingPercent: 5 }), 5)
    assert.throws(() => settings({ attempts: { kind: 'practice' }, highStakes: true }), ZodError)
  })

  test('DOM-KYN-032 otomatik görev içerik sürümünü, süresini ve dinleme hakkını sabitler', () => {
    const fixed = resolve(quiz)
    assert.equal(fixed.resourceVersionId, 'test-rv-1')
    assert.equal(fixed.scoringVersionId, 'test-rv-1')
    assert.equal(fixed.scoringMode, 'auto')
    assert.equal(fixed.timeLimitMinutes, 20)
    assert.equal(fixed.listeningPlays, null)
    assert.equal(resolve(quiz, settings({ timeLimitMinutes: null })).timeLimitMinutes, null)
    assert.equal(resolve(quiz, settings({ timeLimitMinutes: 30 })).timeLimitMinutes, 30)
    const listening = assigned(
      { ...quizInput, tags: { ...englishTags, primarySkill: 'listening' } },
      'quiz',
    )
    assert.equal(resolve(listening).listeningPlays, 2)
    assert.equal(resolve(listening, settings({ listeningPlays: null })).listeningPlays, null)
    const question = assigned(
      {
        title: 'Tek soru',
        content: {
          type: 'question',
          question: { questionType: 'true_false', stem: 'Tom likes tea.' },
        },
        tags: englishTags,
      },
      'question',
    )
    assert.equal(resolve(question).timeLimitMinutes, null)
  })

  test('DOM-KYN-032 yalnız güncel yayındaki sürüm atanır; görev olmayan içerik atanmaz', () => {
    assert.throws(
      () => resolve(assigned(quizInput, 'quiz', { status: 'archived' })),
      isDomainError('resource_version_not_assignable', 'conflict'),
    )
    assert.throws(
      () => resolve({ ...quiz, resource: { ...quiz.resource, currentVersionId: 'test-rv-2' } }),
      isDomainError('resource_version_not_assignable', 'conflict'),
    )
    assert.throws(
      () => resolve(assigned(quizInput, 'quiz', { resourceId: 'test-res9' })),
      isDomainError('resource_version_not_assignable', 'conflict'),
    )
    const passage = assigned(
      {
        title: 'Okuma',
        content: { type: 'reading_passage', body: 'Istanbul is big.' },
        tags: englishTags,
      },
      'reading_passage',
    )
    assert.throws(() => resolve(passage), isDomainError('resource_not_assignable'))
    assert.throws(
      () => resolve({ ...quiz, resource: { ...quiz.resource, contentType: 'homework_template' } }),
      isDomainError('resource_not_assignable'),
    )
  })

  test('DOM-BEC-044 son teslim ileri bir an olmalıdır', () => {
    assert.throws(
      () => resolve(quiz, settings({ deadline: { dueAt: now } })),
      isDomainError('due_in_past'),
    )
  })

  test('DOM-BEC-023 otomatik görevde teslim, rubrik ve ikinci puanlama olmaz', () => {
    assert.throws(
      () => resolve(quiz, settings({ submission: { submissionKind: 'text' } })),
      isDomainError('submission_not_applicable'),
    )
    assert.throws(
      () => resolve(quiz, settings({ rubricVersionId: 'test-rbv1' })),
      isDomainError('rubric_not_applicable'),
    )
    assert.throws(
      () => resolve(quiz, settings({ secondRatingPercent: 10 })),
      isDomainError('second_rating_not_applicable'),
    )
    // Kur sonu quizi yüksek sonuçludur ama ikinci puanlaması yoktur.
    const courseEnd = resolve(quiz, settings({ highStakes: true }))
    assert.equal(courseEnd.highStakes, true)
    assert.equal(courseEnd.secondRatingPercent, 0)
  })

  test('DOM-BEC-020 yazma görevi rubrik sürümünü sabitler', () => {
    const fixed = resolve(homework, writingSettings(), rubric())
    assert.equal(fixed.scoringMode, 'teacher')
    assert.equal(fixed.rubricVersionId, 'test-rbv1')
    assert.equal(fixed.timeLimitMinutes, null)
    assert.equal(fixed.listeningPlays, null)
    assert.equal(fixed.submission?.submissionKind, 'text')
  })

  test('DOM-BEC-020 yazma görevi rubriksiz atanamaz; rubriksiz şablon ölçütle atanır', () => {
    assert.throws(
      () => resolve(homework, writingSettings({ rubricVersionId: null })),
      isDomainError('rubric_required'),
    )
    const criteriaOnly = assigned(
      homeworkInput({ rubricId: null, skill: null }),
      'homework_template',
    )
    assert.equal(
      resolve(criteriaOnly, writingSettings({ rubricVersionId: null })).rubricVersionId,
      null,
    )
  })

  test('DOM-BEC-022 arşivli veya taslak rubrik sürümü yeni atamaya sabitlenemez', () => {
    assert.throws(
      () => resolve(homework, writingSettings(), rubric({ status: 'archived' })),
      isDomainError('rubric_version_not_assignable', 'conflict'),
    )
    assert.throws(
      () => resolve(homework, writingSettings(), rubric({ status: 'draft' })),
      isDomainError('rubric_version_not_assignable', 'conflict'),
    )
    assert.throws(
      () => resolve(homework, writingSettings(), null),
      isDomainError('rubric_version_not_found', 'not_found'),
    )
  })

  test('DOM-BEC-020 rubrik şablonun rubriğinden ve görevin becerisinden olmalıdır', () => {
    assert.throws(
      () => resolve(homework, writingSettings(), rubric({ rubricId: 'test-r9' })),
      isDomainError('rubric_mismatch', 'conflict'),
    )
    assert.throws(
      () => resolve(homework, writingSettings(), rubric({ skill: 'speaking' })),
      isDomainError('rubric_skill_mismatch'),
    )
  })

  test('DOM-BEC-040 öğretmen puanlı görevde teslim ayarı şablonla uyumludur, deneme hakkı ve süre yok', () => {
    assert.throws(
      () => resolve(homework, writingSettings({ submission: null }), rubric()),
      isDomainError('submission_settings_required'),
    )
    assert.throws(
      () =>
        resolve(
          homework,
          writingSettings({ submission: { submissionKind: 'audio', speakingSeconds: 60 } }),
          rubric(),
        ),
      isDomainError('submission_kind_invalid'),
    )
    assert.throws(
      () =>
        resolve(
          homework,
          writingSettings({ attempts: { kind: 'evaluation', maxAttempts: 2 } }),
          rubric(),
        ),
      isDomainError('attempts_not_applicable'),
    )
    assert.throws(
      () => resolve(homework, writingSettings({ timeLimitMinutes: 30 }), rubric()),
      isDomainError('time_limit_not_applicable'),
    )
    assert.throws(
      () =>
        resolve(
          { ...homework, resource: { ...homework.resource, contentType: 'quiz' } },
          writingSettings(),
          rubric(),
        ),
      isDomainError('submission_not_applicable'),
    )
  })
})

describe('hedef kapsamı (ADR 0004 karar 4, DOM-YTK-022)', () => {
  const targets = (
    list: Parameters<typeof resolveTargets>[0]['targets'],
    actor: Actor = teacher,
    institutionType: 'school' | 'language_school' = 'school',
    subjectId: string | null = 'english',
  ) => resolveTargets({ actor, source, institutionType, targets: list, subjectId })

  test('DOM-YTK-022 öğretmen ders verdiği sınıfa ve öğrencisine atar; kursiyerler birleşir', () => {
    assert.deepEqual(
      targets([
        { kind: 'class', id: 'test-c7a' },
        { kind: 'student', id: 'test-s4' },
        { kind: 'student', id: 'test-s1' },
      ]).learnerIds,
      ['test-s1', 'test-s2', 'test-s4'],
    )
  })

  test('DOM-YTK-022 başka sınıfın öğrencisi ve yalnız rehberi olunan sınıf reddedilir', () => {
    assert.throws(
      () => targets([{ kind: 'student', id: 'test-s3' }]),
      (error: unknown) =>
        isDomainError('target_scope_denied', 'forbidden')(error) &&
        (error as { path: string[] }).path.join('.') === 'targets.0',
    )
    assert.throws(
      () =>
        targets([
          { kind: 'class', id: 'test-c7a' },
          { kind: 'class', id: 'test-c7b' },
        ]),
      (error: unknown) =>
        isDomainError('target_scope_denied', 'forbidden')(error) &&
        (error as { path: string[] }).path.join('.') === 'targets.1',
    )
  })

  test('DOM-YTK-022 içeriğin dersi öğretmenin o sınıftaki dersiyle eşleşmelidir', () => {
    assert.throws(
      () => targets([{ kind: 'class', id: 'test-c7a' }], teacher, 'school', 'math'),
      isDomainError('target_scope_denied', 'forbidden'),
    )
    assert.deepEqual(
      targets([{ kind: 'class', id: 'test-c7a' }], teacher, 'school', null).learnerIds,
      ['test-s1', 'test-s2'],
    )
  })

  test('DOM-YTK-001 yönetici kurumun her sınıfına atar; ön büro, öğrenci, veli ve pasif öğretmen atayamaz', () => {
    assert.deepEqual(targets([{ kind: 'class', id: 'test-c7b' }], admin).learnerIds, ['test-s3'])
    for (const actor of [frontDesk, student, parent, inactiveTeacher]) {
      assert.throws(
        () => targets([{ kind: 'class', id: 'test-c7a' }], actor),
        isDomainError('assignment_forbidden', 'forbidden'),
      )
    }
  })

  test('DOM-YTK-012 okulda sınıf, dil okulunda grup hedefi kullanılır', () => {
    assert.throws(
      () => targets([{ kind: 'group', id: 'test-c7a' }]),
      isDomainError('target_kind_invalid'),
    )
    assert.throws(
      () => targets([{ kind: 'class', id: 'test-c7a' }], teacher, 'language_school'),
      isDomainError('target_kind_invalid'),
    )
    assert.deepEqual(
      targets([{ kind: 'group', id: 'test-c7a' }], teacher, 'language_school').learnerIds,
      ['test-s1', 'test-s2'],
    )
  })

  test('IST-034 bulunmayan hedef, boş hedef ve tekrarlanan hedef reddedilir', () => {
    assert.throws(
      () => targets([{ kind: 'class', id: 'test-c-yok' }]),
      isDomainError('target_not_found', 'not_found'),
    )
    assert.throws(
      () => targets([{ kind: 'student', id: 'test-s-yok' }]),
      isDomainError('target_not_found', 'not_found'),
    )
    assert.throws(() => targets([{ kind: 'class', id: 'test-c9z' }]), isDomainError('target_empty'))
    assert.throws(
      () =>
        plan(
          {},
          {
            targets: [
              { kind: 'class', id: 'test-c7a' },
              { kind: 'class', id: 'test-c7a' },
            ],
          },
        ),
      ZodError,
    )
    assert.throws(() => plan({}, { targets: [] }), ZodError)
  })
})

describe('atama işlemi (IST-034)', () => {
  test('IST-034 atama sürümü, ayarları ve kursiyerleri sabitler; puan saklanmaz', () => {
    const result = plan()
    assert.equal(result.assignment.resourceVersionId, 'test-rv-1')
    assert.equal(result.assignment.createdAt, now)
    assert.deepEqual(result.learnerIds, ['test-s1', 'test-s2'])
    assert.deepEqual(result.targets, [{ kind: 'class', id: 'test-c7a' }])
  })

  test('DOM-KYN-032 gövdedeki sürüm yüklenen sürümle aynı olmalıdır', () => {
    assert.throws(
      () => plan({}, { resourceVersionId: 'test-rv-0' }),
      isDomainError('resource_version_mismatch', 'conflict'),
    )
  })

  const existing = (input: Partial<ExistingAssignment> = {}): ExistingAssignment => ({
    id: 'test-a1',
    resourceId: 'test-res1',
    deadline: { dueAt: due, lateAcceptanceDays: 0 },
    learnerIds: ['test-s1', 'test-s2'],
    archivedAt: null,
    ...input,
  })

  test('IST-034 aynı içerik başka sınıfa farklı son tarihle ayrı atama olur', () => {
    const later = plusMs(due, 2 * DAY)
    const result = plan(
      { existing: [existing()] },
      { targets: [{ kind: 'class', id: 'test-c8a' }], settings: { deadline: { dueAt: later } } },
    )
    assert.equal(result.assignment.deadline.dueAt, later)
    assert.deepEqual(result.learnerIds, ['test-s4'])
  })

  test('IST-034 aynı kursiyerlere aynı son tarihle mükerrer atama reddedilir', () => {
    assert.throws(
      () => plan({ existing: [existing()] }),
      isDomainError('assignment_duplicate', 'conflict'),
    )
    assert.throws(
      () =>
        plan({ existing: [existing()] }, { settings: { deadline: { dueAt: plusMs(due, DAY) } } }),
      isDomainError('assignment_overlap', 'conflict'),
    )
  })

  test('IST-034 kapanmış, arşivli veya başka içeriğin ataması çakışma sayılmaz', () => {
    const base = {
      resourceId: 'test-res1',
      deadline: { dueAt: due, lateAcceptanceDays: 0 },
      learnerIds: ['test-s1'],
      now,
    }
    const closed = existing({ deadline: { dueAt: plusMs(now, -DAY), lateAcceptanceDays: 0 } })
    for (const other of [
      closed,
      existing({ archivedAt: now }),
      existing({ resourceId: 'test-res2' }),
      existing({ learnerIds: ['test-s4'] }),
    ]) {
      assert.doesNotThrow(() => assertNoOverlappingAssignment({ ...base, existing: [other] }))
    }
  })

  test('DOM-BEC-020 yazma görevi rubrik sürümüyle atanır', () => {
    const result = plan(
      { ...homework, rubricVersion: rubric() },
      {
        settings: {
          deadline: { dueAt: due },
          submission: { submissionKind: 'text', maxVersions: 2 },
          rubricVersionId: 'test-rbv1',
        },
      },
    )
    assert.equal(result.assignment.rubricVersionId, 'test-rbv1')
    assert.equal(result.assignment.submission?.maxVersions, 2)
  })

  test('DOM-BEC-044 Europe/Istanbul yerel son teslim UTC olarak sabitlenir', () => {
    const local = istanbulLocalToUtc('2026-11-12T23:59')
    const result = plan({}, { settings: { deadline: { dueAt: local } } })
    assert.equal(result.assignment.deadline.dueAt, '2026-11-12T20:59:00.000Z')
  })
})

describe('yayım sonrası değişiklik (DOM-BEC-041, 042)', () => {
  const fixed = resolve(quiz, settings({ attempts: { kind: 'evaluation', maxAttempts: 2 } }))

  test('DOM-BEC-041 görev türü ve sayım politikası yayımdan sonra değişmez', () => {
    for (const key of ['attempts', 'kind']) {
      assert.throws(
        () => planAssignmentChange({ assignment: fixed, patch: { [key]: { kind: 'practice' } } }),
        (error: unknown) =>
          isDomainError('assignment_setting_frozen', 'conflict')(error) &&
          (error as Error).message.includes('Görev türü'),
      )
    }
    for (const key of [
      'resourceVersionId',
      'rubricVersionId',
      'scoringVersionId',
      'listeningPlays',
    ]) {
      assert.throws(
        () => planAssignmentChange({ assignment: fixed, patch: { [key]: null } }),
        isDomainError('assignment_setting_frozen', 'conflict'),
      )
    }
  })

  test('DOM-BEC-044 son teslim ve geç kabul yalnız uzatılır', () => {
    const later = plusMs(due, DAY)
    assert.deepEqual(
      planAssignmentChange({ assignment: fixed, patch: { deadline: { dueAt: later } } }),
      { deadline: { dueAt: later, lateAcceptanceDays: 0 } },
    )
    assert.equal(
      planAssignmentChange({
        assignment: fixed,
        patch: { deadline: { dueAt: due, lateAcceptanceDays: 2 } },
      }).deadline.lateAcceptanceDays,
      2,
    )
    assert.deepEqual(planAssignmentChange({ assignment: fixed, patch: {} }), {
      deadline: fixed.deadline,
    })
    assert.throws(
      () =>
        planAssignmentChange({
          assignment: fixed,
          patch: { deadline: { dueAt: plusMs(due, -1) } },
        }),
      isDomainError('deadline_shortened'),
    )
    const lenient = { ...fixed, deadline: { dueAt: due, lateAcceptanceDays: 3 } }
    assert.throws(
      () =>
        planAssignmentChange({
          assignment: lenient,
          patch: { deadline: { dueAt: plusMs(due, DAY), lateAcceptanceDays: 1 } },
        }),
      isDomainError('deadline_shortened'),
    )
    assert.throws(
      () => planAssignmentChange({ assignment: fixed, patch: { deadline: { dueAt: null } } }),
      isDomainError('deadline_shortened'),
    )
  })

  test('DOM-BEC-041 alıştırmanın son tarihi kaldırılabilir, sonradan eklenemez', () => {
    const practice = resolve(quiz, settings({ attempts: { kind: 'practice' } }))
    assert.equal(
      planAssignmentChange({ assignment: practice, patch: { deadline: { dueAt: null } } }).deadline
        .dueAt,
      null,
    )
    const open = { ...practice, deadline: { dueAt: null, lateAcceptanceDays: 0 } }
    assert.throws(
      () => planAssignmentChange({ assignment: open, patch: { deadline: { dueAt: due } } }),
      isDomainError('deadline_shortened'),
    )
  })
})

describe('yeniden teslim isteği (DOM-BEC-040)', () => {
  const versions: VersionRow[] = [
    { id: 'test-v1', number: 1, submittedAt: plusMs(now, -2 * DAY), body: 'Bir', fileIds: [] },
    { id: 'test-v2', number: 2, submittedAt: plusMs(now, -DAY), body: 'İki', fileIds: [] },
  ]
  const submission: ResubmittableSubmission = {
    id: 'test-sub1',
    learnerId: 'test-s1',
    resubmissionRequestedForVersion: null,
    resubmissionDueAt: null,
  }
  const score: RubricScoreRow = {
    id: 'test-sc1',
    submissionVersionId: 'test-v2',
    rubricVersionId: 'test-rbv1',
    raterUserId: 'test-u-t1',
    raterRole: 'first',
    criteria: [
      { criterionId: 'task', band: 3, comment: null },
      { criterionId: 'gram', band: 3, comment: null },
    ],
    overallComment: 'İyi.',
    scoredAt: plusMs(now, -1000),
  }
  const request = (input: Partial<Parameters<typeof planResubmissionRequest>[0]> = {}) =>
    planResubmissionRequest({
      submission,
      versions,
      scores: [score],
      secondRatingRequested: false,
      input: { versionNumber: 2, dueAt: plusMs(now, 3 * DAY) },
      now,
      ...input,
    })

  test('DOM-BEC-040 kesinleşen son sürüm için kendi son tarihiyle istenir', () => {
    assert.deepEqual(request(), {
      resubmissionRequestedForVersion: 2,
      resubmissionDueAt: plusMs(now, 3 * DAY),
    })
  })

  test('DOM-BEC-040 eski sürüm, kesinleşmemiş puan ve mükerrer istek reddedilir', () => {
    assert.throws(
      () => request({ input: { versionNumber: 1, dueAt: plusMs(now, DAY) } }),
      isDomainError('version_not_latest', 'conflict'),
    )
    assert.throws(
      () => request({ scores: [] }),
      isDomainError('resubmission_not_graded', 'conflict'),
    )
    assert.throws(
      () => request({ secondRatingRequested: true }),
      isDomainError('resubmission_not_graded', 'conflict'),
    )
    assert.throws(() => request({ versions: [] }), isDomainError('version_not_latest', 'conflict'))
    assert.throws(
      () =>
        request({
          submission: {
            ...submission,
            resubmissionRequestedForVersion: 2,
            resubmissionDueAt: plusMs(now, DAY),
          },
        }),
      isDomainError('resubmission_exists', 'conflict'),
    )
  })

  test('DOM-BEC-040 yeniden teslim tarihi ileri ve en çok 14 gün sonradır', () => {
    assert.throws(
      () => request({ input: { versionNumber: 2, dueAt: now } }),
      isDomainError('resubmission_due_invalid'),
    )
    assert.doesNotThrow(() =>
      request({ input: { versionNumber: 2, dueAt: plusMs(now, RESUBMISSION_MAX_DAYS * DAY) } }),
    )
    assert.throws(
      () =>
        request({
          input: { versionNumber: 2, dueAt: plusMs(now, RESUBMISSION_MAX_DAYS * DAY + 1) },
        }),
      isDomainError('resubmission_due_invalid'),
    )
    assert.throws(() => request({ input: { versionNumber: 2, dueAt: 'yarın' } }), ZodError)
  })

  test('DOM-BEC-044 yeniden teslim sürümü isteğin son tarihine bağlıdır, atama kapanmış olsa da', () => {
    const assignmentDeadline = { dueAt: plusMs(now, -3 * DAY), lateAcceptanceDays: 0 }
    const requested = {
      ...submission,
      resubmissionRequestedForVersion: 2,
      resubmissionDueAt: plusMs(now, 2 * DAY),
    }
    const next = deadlineForVersion(assignmentDeadline, requested, 3)
    assert.deepEqual(next, { dueAt: plusMs(now, 2 * DAY), lateAcceptanceDays: 0 })
    assert.equal(deadlineForVersion(assignmentDeadline, requested, 2), assignmentDeadline)
    assert.equal(deadlineForVersion(assignmentDeadline, null, 1), assignmentDeadline)
    const planned = planSubmissionVersion({
      settings: writingSettings().submission!,
      deadline: next,
      submission: requested,
      versions,
      gradedVersionNumbers: [2],
      input: { submissionKind: 'text', body: 'Düzeltilmiş metin.' },
      files: [],
      now,
    })
    assert.equal(planned.version.number, 3)
    assert.equal(versionIsLate({ submittedAt: plusMs(now, 2 * DAY + 1) }, next), true)
    assert.equal(submissionWindow(next).closesAt, plusMs(now, 2 * DAY))
  })
})

describe('puanlama maddeleri ve yeniden puanlama (DOM-BEC-010, 011, DOM-KYN-033)', () => {
  const mcQuestion = (id: string) =>
    questionBodySchema.parse({
      questionType: 'multiple_choice',
      stem: `Question ${id}`,
      options: ['a', 'b', 'c', 'd'].map((o) => ({ id: o, text: `Seçenek ${o}` })),
    }) as QuestionBody
  const key = (correct: string) =>
    answerKeySchema.parse({
      questionType: 'multiple_choice',
      correctOptionId: correct,
      explanation: 'Açıklama.',
    }) as AnswerKey
  const item = (
    id: string,
    correct: string,
    points = 1,
    locale: AnswerLocale = 'en',
  ): ScoringItem => ({
    questionVersionId: id,
    points,
    question: mcQuestion(id),
    answerKey: key(correct),
    locale,
  })
  const shortAnswer = {
    questionType: 'short_answer',
    stem: 'Write the capital.',
  } as const
  const questionRef = (
    id: string,
    tags: { cefrLevel?: 'A2' | null; primarySkill?: null } = {},
  ) => ({
    id,
    tags: { cefrLevel: tags.cefrLevel ?? null, primarySkill: null, skills: [] },
    content: { type: 'question' as const, question: questionBodySchema.parse(shortAnswer) },
    answerKey: answerKeySchema.parse({
      questionType: 'short_answer',
      accepted: ['Ankara'],
      explanation: 'Başkent.',
    }) as AnswerKey,
  })

  test('DOM-BEC-010 maddelerin karşılaştırma dili quizin veya sorunun etiketinden çıkar', () => {
    const items = [{ questionVersionId: 'test-qv1', points: 1 }]
    const untagged = { cefrLevel: null, primarySkill: null, skills: [] }
    const questions = new Map([['test-qv1', questionRef('test-qv1')]])
    assert.equal(scoringItemsFor({ parentTags: untagged, items, questions })[0]?.locale, 'tr')
    assert.equal(
      scoringItemsFor({ parentTags: { ...untagged, cefrLevel: 'A2' }, items, questions })[0]
        ?.locale,
      'en',
    )
    const tagged = new Map([['test-qv1', questionRef('test-qv1', { cefrLevel: 'A2' })]])
    const result = scoringItemsFor({ parentTags: untagged, items, questions: tagged })
    assert.equal(result[0]?.locale, 'en')
    assert.equal(result[0]?.points, 1)
  })

  test('DOM-BEC-010 bulunmayan veya anahtarsız soru reddedilir', () => {
    const parentTags = { cefrLevel: null, primarySkill: null, skills: [] }
    const items = [{ questionVersionId: 'test-qv1', points: 1 }]
    assert.throws(
      () => scoringItemsFor({ parentTags, items, questions: new Map() }),
      isDomainError('question_version_not_found', 'not_found'),
    )
    const noKey = new Map([['test-qv1', { ...questionRef('test-qv1'), answerKey: null }]])
    assert.throws(
      () => scoringItemsFor({ parentTags, items, questions: noKey }),
      isDomainError('answer_key_missing'),
    )
    const notQuestion = new Map([
      [
        'test-qv1',
        { ...questionRef('test-qv1'), content: { type: 'text' as const, body: 'x', fileId: null } },
      ],
    ])
    assert.throws(
      () => scoringItemsFor({ parentTags, items, questions: notQuestion }),
      isDomainError('question_version_not_found', 'not_found'),
    )
  })

  const answers = (q1: string, q2 = 'a') => ({
    'test-qv1': { questionType: 'multiple_choice' as const, optionId: q1 },
    'test-qv2': { questionType: 'multiple_choice' as const, optionId: q2 },
  })
  const learner = (id: string, q1: string, locked = false): RescoreLearner => ({
    learnerId: id,
    attempts: [{ id: `att-${id}`, completedAt: plusMs(now, -DAY), answers: answers(q1) }],
    locked,
  })
  const context = (input: Partial<RescoreContext> = {}): RescoreContext => ({
    assignment: {
      resourceId: 'test-res1',
      scoringVersionId: 'test-rv-1',
      scoringMode: 'auto',
      attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
    },
    nextVersion: { id: 'test-rv-2', resourceId: 'test-res1', status: 'published' },
    before: [item('test-qv1', 'b'), item('test-qv2', 'a', 2)],
    after: [item('test-qv1', 'c'), item('test-qv2', 'a', 2)],
    learners: [
      learner('test-s2', 'c'),
      learner('test-s1', 'b'),
      learner('test-s3', 'a'),
      learner('test-s4', 'b', true),
    ],
    ...input,
  })

  test('DOM-BEC-011 önizleme etkilenen kursiyer sayısını ve puan farkını verir', () => {
    const preview = previewRescore(context())
    assert.equal(preview.affectedCount, 3)
    assert.equal(preview.unchangedCount, 1)
    assert.equal(preview.lockedCount, 1)
    assert.deepEqual(
      preview.changes.map((c) => [c.learnerId, c.beforePercent, c.afterPercent, c.delta, c.locked]),
      [
        ['test-s1', 100, 67, -33, false],
        ['test-s2', 67, 100, 33, false],
        ['test-s4', 100, 67, -33, true],
      ],
    )
    assert.equal(preview.changes[0]?.beforeEarned, 3)
    assert.equal(preview.changes[0]?.afterEarned, 2)
  })

  test('DOM-BEC-011 eşit puanda kursiyer etkilenmiş sayılmaz; alıştırma önizlemeye girmez', () => {
    const same = previewRescore(context({ after: context().before }))
    assert.equal(same.affectedCount, 0)
    assert.equal(same.unchangedCount, 4)
    const practice = previewRescore(
      context({
        assignment: { ...context().assignment, attempts: { kind: 'practice' } },
      }),
    )
    assert.deepEqual(practice, { affectedCount: 0, lockedCount: 0, unchangedCount: 0, changes: [] })
  })

  test('DOM-BEC-042 "en yüksek" politikasında sayılan deneme yeni anahtarla değişebilir', () => {
    const twoAttempts: RescoreLearner = {
      learnerId: 'test-s1',
      attempts: [
        { id: 'a1', completedAt: plusMs(now, -2 * DAY), answers: answers('b', 'b') },
        { id: 'a2', completedAt: plusMs(now, -DAY), answers: answers('c', 'a') },
      ],
      locked: false,
    }
    const preview = previewRescore(
      context({
        assignment: {
          ...context().assignment,
          attempts: { kind: 'evaluation', maxAttempts: 2, countPolicy: 'highest' },
        },
        learners: [twoAttempts],
      }),
    )
    // Önce a2 (2/3), sonra a2 (3/3) sayılır.
    assert.deepEqual(
      preview.changes.map((c) => [c.beforePercent, c.afterPercent]),
      [[67, 100]],
    )
  })

  test('DOM-KYN-033 yeniden puanlama gerekçeli ayrı işlemdir ve önizlemeyi yeniden hesaplar', () => {
    const result = planRescore({
      ...context(),
      input: { scoringVersionId: 'test-rv-2', reason: 'Birinci sorunun anahtarı düzeltildi.' },
      now,
    })
    assert.equal(result.scoringVersionId, 'test-rv-2')
    assert.equal(result.previousScoringVersionId, 'test-rv-1')
    assert.equal(result.rescoredAt, now)
    assert.equal(result.preview.affectedCount, 3)
    assert.throws(
      () =>
        planRescore({
          ...context(),
          input: { scoringVersionId: 'test-rv-2', reason: 'kısa' },
          now,
        }),
      ZodError,
    )
    assert.throws(
      () =>
        planRescore({
          ...context(),
          input: { scoringVersionId: 'test-rv-3', reason: 'Birinci sorunun anahtarı düzeltildi.' },
          now,
        }),
      isDomainError('rescore_version_invalid', 'conflict'),
    )
  })

  test('DOM-KYN-033 öğretmen puanlı görev, başka içerik, aynı sürüm ve uyumsuz sorular reddedilir', () => {
    assert.throws(
      () =>
        previewRescore(
          context({ assignment: { ...context().assignment, scoringMode: 'teacher' } }),
        ),
      isDomainError('rescore_not_applicable'),
    )
    for (const nextVersion of [
      { id: 'test-rv-2', resourceId: 'test-res9', status: 'published' as const },
      { id: 'test-rv-1', resourceId: 'test-res1', status: 'published' as const },
      { id: 'test-rv-2', resourceId: 'test-res1', status: 'draft' as const },
    ]) {
      assert.throws(
        () => previewRescore(context({ nextVersion })),
        isDomainError('rescore_version_invalid', 'conflict'),
      )
    }
    assert.throws(
      () => previewRescore(context({ after: [item('test-qv1', 'c')] })),
      isDomainError('rescore_incompatible'),
    )
  })
})
