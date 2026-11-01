import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { seededRandom } from '../packages/school-core/src/content/resource.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import {
  APPEAL_BUSINESS_DAYS,
  appealDecisionSchema,
  GRADING_DAYS,
  SECOND_RATING_MIN_PERCENT,
  addBusinessDays,
  appealDeadline,
  assertRubricAssignable,
  assertRubricFitsInstitution,
  assertRubricVersionDeletable,
  bandDisagreements,
  bandMeaning,
  coordinatorCase,
  canManageRubric,
  gradedVersionNumbers,
  gradingDueAt,
  gradingOverdue,
  pickSecondRatingSample,
  planAppeal,
  planAppealDecision,
  planNewRubricVersion,
  planRubricArchive,
  planRubricDraftUpdate,
  planRubricPublish,
  planRubricScore,
  rubricScore,
  rubricVersionInputSchema,
  scoreResolution,
  scoresVisibleToRater,
  secondRatingQuota,
  type AppealRow,
  type RubricScorePlanInput,
  type RubricScoreRow,
  type RubricVersionInput,
  type RubricVersionRow,
} from '../packages/school-core/src/skills/rubric.ts'
import { versionAllowance, type VersionRow } from '../packages/school-core/src/skills/submission.ts'
import { submissionSettingsSchema } from '../packages/school-core/src/skills/submission.ts'
import { isDomainError } from './support/domain-error.ts'

/** `assert.throws` için Zod doğrulama hatası (kök testler `zod`u doğrudan içe aktarmaz). */
const ZodError = { name: 'ZodError' }
const now = '2026-11-04T09:00:00.000Z'
const plusMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
const DAY = 24 * 60 * 60_000

const bands = (prefix: string) =>
  [0, 1, 2, 3, 4, 5].map((band) => ({
    band,
    description: `${prefix} için bant ${band} tanımı`,
    alignment: {
      kind: 'cefr' as const,
      scale: 'Genel yazılı üretim',
      level: 'B1' as const,
      index: band + 1,
    },
  }))
const writingInput = (input: Partial<RubricVersionInput> = {}): RubricVersionInput => ({
  title: 'B1 kısa yazı rubriği',
  kind: 'analytic',
  skill: 'writing',
  criteria: [
    { id: 'task', aspect: 'task_fulfilment', bands: bands('Görev') },
    { id: 'coh', aspect: 'coherence_cohesion', bands: bands('Tutarlılık') },
    { id: 'voc', aspect: 'vocabulary', bands: bands('Sözcük') },
    { id: 'gram', aspect: 'grammatical_accuracy', bands: bands('Dilbilgisi') },
  ],
  ...input,
})
const rubricRow = (
  input: Partial<RubricVersionRow> = {},
  data: RubricVersionInput = writingInput(),
): RubricVersionRow => ({
  ...rubricVersionInputSchema.parse(data),
  id: 'test-rv1',
  rubricId: 'test-r1',
  versionNumber: 1,
  status: 'published',
  createdAt: '2026-09-01T09:00:00.000Z',
  publishedAt: '2026-09-02T09:00:00.000Z',
  archivedAt: null,
  ...input,
})

const versions: VersionRow[] = [
  { id: 'test-v1', number: 1, submittedAt: plusMs(now, -3 * DAY), body: 'Birinci', fileIds: [] },
  { id: 'test-v2', number: 2, submittedAt: plusMs(now, -2 * DAY), body: 'İkinci', fileIds: [] },
]
const goodScore = (bandsByCriterion: Record<string, number> = {}) => ({
  criteria: ['task', 'coh', 'voc', 'gram'].map((criterionId) => {
    const value = bandsByCriterion[criterionId] ?? 3
    return { criterionId, band: value, comment: value < 3 ? 'Geliştirilmeli' : null }
  }),
  overallComment: 'Genel olarak hedef seviyede.',
})
let scoreSeq = 0
const scoreRow = (input: Partial<RubricScoreRow> = {}): RubricScoreRow => ({
  id: `test-sc${(scoreSeq += 1)}`,
  submissionVersionId: 'test-v2',
  rubricVersionId: 'test-rv1',
  raterUserId: 'test-u-t1',
  raterRole: 'first',
  ...goodScore(),
  scoredAt: plusMs(now, -DAY),
  ...input,
})
const firstRater = { userId: 'test-u-t1', coordinator: false }
const secondRater = { userId: 'test-u-t2', coordinator: false }
const coordinator = { userId: 'test-u-k1', coordinator: true }

const scorePlan = (input: Partial<RubricScorePlanInput> = {}) =>
  planRubricScore({
    rubricVersion: rubricRow(),
    assignmentRubricVersionId: 'test-rv1',
    versions,
    submissionVersionId: 'test-v2',
    scores: [],
    rater: firstRater,
    raterRole: 'first',
    secondRatingRequested: false,
    input: goodScore(),
    now,
    ...input,
  })

describe('rubrik yapısı (DOM-BEC-020)', () => {
  test('DOM-BEC-020 analitik yazma rubriği kriter × altı bant olarak doğrulanır', () => {
    const rubric = rubricVersionInputSchema.parse(writingInput())
    assert.equal(rubric.criteria.length, 4)
    assert.deepEqual(
      rubric.criteria[0]?.bands.map((b) => b.band),
      [0, 1, 2, 3, 4, 5],
    )
    assert.equal(rubric.criteria[0]?.weight, 1)
  })

  test('DOM-BEC-020 bant anlamı: 0–2 hedefin altında, 3 hedefte, 4–5 üstünde', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 5].map(bandMeaning), [
      'below',
      'below',
      'below',
      'target',
      'above',
      'above',
    ])
  })

  test('DOM-BEC-020 eksik veya tekrarlanan bant, bilinmeyen yön reddedilir', () => {
    const missing = writingInput()
    missing.criteria[0] = { ...missing.criteria[0]!, bands: bands('x').slice(0, 5) }
    assert.throws(() => rubricVersionInputSchema.parse(missing), ZodError)
    const doubled = writingInput()
    doubled.criteria[0] = {
      ...doubled.criteria[0]!,
      bands: [...bands('x').slice(0, 5), { ...bands('x')[0]! }],
    }
    assert.throws(() => rubricVersionInputSchema.parse(doubled), ZodError)
    const wrongSkill = writingInput()
    wrongSkill.criteria[0] = { ...wrongSkill.criteria[0]!, aspect: 'fluency' }
    const result = rubricVersionInputSchema.safeParse(wrongSkill)
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['criteria', 0, 'aspect'])
  })

  test('DOM-BEC-020 aynı yön iki kez kullanılamaz; analitikte en az iki kriter', () => {
    const repeated = writingInput()
    repeated.criteria[1] = { ...repeated.criteria[1]!, aspect: 'task_fulfilment' }
    assert.throws(() => rubricVersionInputSchema.parse(repeated), ZodError)
    assert.throws(
      () =>
        rubricVersionInputSchema.parse(
          writingInput({ criteria: writingInput().criteria.slice(0, 1) }),
        ),
      ZodError,
    )
  })

  test('DOM-BEC-020 bütüncül rubrik ağırlığı 1 olan tek genel kriterdir', () => {
    const holistic = writingInput({
      kind: 'holistic',
      skill: 'speaking',
      criteria: [{ id: 'all', aspect: 'overall', bands: bands('Genel') }],
    })
    assert.equal(rubricVersionInputSchema.parse(holistic).criteria.length, 1)
    assert.throws(
      () =>
        rubricVersionInputSchema.parse({
          ...holistic,
          criteria: [{ id: 'all', aspect: 'overall', weight: 2, bands: bands('Genel') }],
        }),
      ZodError,
    )
    assert.throws(
      () => rubricVersionInputSchema.parse({ ...writingInput(), kind: 'holistic' }),
      ZodError,
    )
  })

  test('DOM-BEC-020 konuşma ve aracılık yönleri kendi becerisinde geçerlidir', () => {
    const speaking = rubricVersionInputSchema.parse({
      title: 'Konuşma',
      kind: 'analytic',
      skill: 'speaking',
      criteria: [
        { id: 'flu', aspect: 'fluency', bands: bands('Akıcılık') },
        { id: 'pho', aspect: 'phonological_control', bands: bands('Sesletim') },
      ],
    })
    assert.equal(speaking.skill, 'speaking')
    const mediation = rubricVersionInputSchema.safeParse({
      title: 'Aracılık',
      kind: 'analytic',
      skill: 'mediation',
      criteria: [
        { id: 'mt', aspect: 'meaning_transfer', bands: bands('Aktarım') },
        { id: 'au', aspect: 'audience_fit', bands: bands('Kitle') },
      ],
    })
    assert.equal(mediation.success, true)
  })

  test('DOM-BEC-004 dil okulunda bant kazanıma bağlanamaz, okulda bağlanabilir', () => {
    const data = writingInput()
    data.criteria[2] = {
      ...data.criteria[2]!,
      bands: bands('Sözcük').map((b) => ({
        ...b,
        alignment: {
          kind: 'outcome' as const,
          outcomeId: 'ENG.8.1',
          outcomeSource: 'platform' as const,
        },
      })),
    }
    const rubric = rubricVersionInputSchema.parse(data)
    assert.doesNotThrow(() => assertRubricFitsInstitution(rubric, 'school'))
    assert.throws(
      () => assertRubricFitsInstitution(rubric, 'language_school'),
      (error: unknown) =>
        isDomainError('rubric_alignment_invalid')(error) &&
        (error as { path: string[] }).path.join('.') === 'criteria.2.bands.0.alignment',
    )
  })
})

describe('rubrik puanı (DOM-BEC-021)', () => {
  test('DOM-BEC-021 puan bant toplamı / azami toplam × 100, saklanmaz', () => {
    const result = rubricScore(
      rubricRow(),
      goodScore({ task: 4, coh: 3, voc: 3, gram: 3 }).criteria,
    )
    assert.equal(result.total, 13)
    assert.equal(result.max, 20)
    assert.equal(result.percent, 65)
    assert.deepEqual(
      result.criteria.map((c) => c.meaning),
      ['above', 'target', 'target', 'target'],
    )
  })

  test('DOM-BEC-021 tam yarım değer yukarı yuvarlanır (1/40 → 3)', () => {
    const criteria = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, weight: 1 }))
    const scored = criteria.map((c, i) => ({ criterionId: c.id, band: i === 0 ? 1 : 0 }))
    assert.equal(rubricScore({ criteria: criteria as never }, scored).percent, 3)
    assert.equal(
      rubricScore(rubricRow(), goodScore({ task: 0, coh: 0, voc: 0, gram: 0 }).criteria).percent,
      0,
    )
    assert.equal(
      rubricScore(rubricRow(), goodScore({ task: 5, coh: 5, voc: 5, gram: 5 }).criteria).percent,
      100,
    )
  })

  test('DOM-BEC-021 ağırlık toplamı paydadır; eşit ağırlık formülü değiştirmez', () => {
    const weighted = writingInput()
    weighted.criteria[0] = { ...weighted.criteria[0]!, weight: 3 }
    const rubric = rubricRow({}, weighted)
    const result = rubricScore(rubric, goodScore({ task: 5, coh: 1, voc: 1, gram: 1 }).criteria)
    assert.equal(result.max, 5 * (3 + 1 + 1 + 1))
    assert.equal(result.total, 15 + 3)
    assert.equal(result.percent, 60)
    const equal = writingInput()
    equal.criteria = equal.criteria.map((c) => ({ ...c, weight: 2 }))
    assert.equal(
      rubricScore(rubricRow({}, equal), goodScore({ task: 4 }).criteria).percent,
      rubricScore(rubricRow(), goodScore({ task: 4 }).criteria).percent,
    )
    assert.throws(() => {
      const heavy = writingInput()
      heavy.criteria[0] = { ...heavy.criteria[0]!, weight: 11 }
      rubricVersionInputSchema.parse(heavy)
    }, ZodError)
  })

  test('DOM-BEC-021 eksik kriter puan hesabını durdurur', () => {
    assert.throws(
      () => rubricScore(rubricRow(), goodScore().criteria.slice(1)),
      isDomainError('rubric_criterion_missing'),
    )
  })

  test('DOM-BEC-021 genel yorum ve hedefin altındaki bandın yorumu zorunludur', () => {
    assert.throws(() => scorePlan({ input: { ...goodScore(), overallComment: ' ' } }), ZodError)
    const noComment = goodScore({ voc: 2 })
    noComment.criteria[2] = { ...noComment.criteria[2]!, comment: null }
    assert.throws(
      () => scorePlan({ input: noComment }),
      (error: unknown) =>
        isDomainError('criterion_comment_required')(error) &&
        (error as { path: string[] }).path.join('.') === 'criteria.2.comment',
    )
    // Bant 3 yorum istemez.
    assert.equal(scorePlan().criteria[2]?.comment, null)
  })

  test('DOM-BEC-021 kriter satırı katıdır: istemcinin ağırlıklı puanı gibi fazladan alan reddedilir', () => {
    const extra = goodScore()
    extra.criteria[0] = { ...extra.criteria[0]!, weighted: 99 } as never
    assert.throws(() => scorePlan({ input: extra }), ZodError)
    assert.throws(
      () =>
        appealDecisionSchema.parse({
          outcome: 'upheld',
          reason: 'Bant yeniden değerlendirildi.',
          score: extra,
        }),
      ZodError,
    )
  })

  test('DOM-BEC-021 bilinmeyen, tekrarlanan veya eksik kriter reddedilir', () => {
    const unknown = goodScore()
    unknown.criteria[0] = { ...unknown.criteria[0]!, criterionId: 'other' }
    assert.throws(() => scorePlan({ input: unknown }), isDomainError('rubric_criterion_invalid'))
    const repeated = goodScore()
    repeated.criteria[1] = { ...repeated.criteria[0]! }
    assert.throws(() => scorePlan({ input: repeated }), isDomainError('rubric_criterion_invalid'))
    const missing = goodScore()
    missing.criteria.pop()
    assert.throws(() => scorePlan({ input: missing }), isDomainError('rubric_criterion_missing'))
  })

  test('DOM-BEC-040 yalnız son sürüm ve atamanın rubrik sürümüyle puanlanır', () => {
    const plan = scorePlan()
    assert.equal(plan.submissionVersionId, 'test-v2')
    assert.equal(plan.rubricVersionId, 'test-rv1')
    assert.equal(plan.raterRole, 'first')
    assert.equal(plan.scoredAt, now)
    assert.equal('percent' in plan, false)
    assert.throws(
      () => scorePlan({ submissionVersionId: 'test-v1' }),
      isDomainError('version_not_latest', 'conflict'),
    )
    assert.throws(
      () => scorePlan({ assignmentRubricVersionId: 'test-rv2' }),
      isDomainError('rubric_version_mismatch', 'conflict'),
    )
  })

  test('DOM-BEC-022 arşivli sürüm, sabitlendiği atamada puanlamaya devam eder', () => {
    const plan = scorePlan({ rubricVersion: rubricRow({ status: 'archived', archivedAt: now }) })
    assert.equal(plan.rubricVersionId, 'test-rv1')
  })

  test('DOM-BEC-040 puanlanan sürüm numaraları sürüm hakkını kapatır', () => {
    const graded = gradedVersionNumbers(versions, [scoreRow()])
    assert.deepEqual(graded, [2])
    const allowance = versionAllowance({
      settings: submissionSettingsSchema.parse({ submissionKind: 'text' }),
      submission: { id: 'test-sub', learnerId: 'test-s1', resubmissionRequestedForVersion: null },
      versions,
      gradedVersionNumbers: graded,
    })
    assert.equal(allowance.blockedBy, 'graded')
    assert.deepEqual(gradedVersionNumbers(versions, []), [])
  })
})

describe('rubrik sürümü (DOM-BEC-022)', () => {
  test('DOM-BEC-022 taslak kullanılmadıkça düzenlenir; yayındaki veya kullanılmış sürüm değişmez', () => {
    const draft = rubricRow({ status: 'draft', publishedAt: null })
    const usage = { assignmentCount: 0, scoreCount: 0 }
    const updated = planRubricDraftUpdate({
      version: draft,
      usage,
      input: writingInput({ title: 'Yeni başlık' }),
      institutionType: 'school',
    })
    assert.equal(updated.title, 'Yeni başlık')
    assert.throws(
      () =>
        planRubricDraftUpdate({
          version: rubricRow(),
          usage,
          input: writingInput(),
          institutionType: 'school',
        }),
      isDomainError('rubric_version_immutable', 'conflict'),
    )
    assert.throws(
      () =>
        planRubricDraftUpdate({
          version: draft,
          usage: { assignmentCount: 1, scoreCount: 0 },
          input: writingInput(),
          institutionType: 'school',
        }),
      isDomainError('rubric_version_immutable', 'conflict'),
    )
  })

  test('DOM-BEC-022 yeni sürüm numarası artar, rubrik başına tek açık taslak olur', () => {
    const plan = planNewRubricVersion({
      rubricId: 'test-r1',
      versions: [rubricRow(), rubricRow({ id: 'test-rv2', versionNumber: 2, status: 'archived' })],
      input: writingInput(),
      institutionType: 'language_school',
      now,
    })
    assert.equal(plan.versionNumber, 3)
    assert.equal(plan.status, 'draft')
    assert.equal(plan.createdAt, now)
    assert.throws(
      () =>
        planNewRubricVersion({
          rubricId: 'test-r1',
          versions: [rubricRow({ status: 'draft' })],
          input: writingInput(),
          institutionType: 'school',
          now,
        }),
      isDomainError('open_rubric_version_exists', 'conflict'),
    )
  })

  test('DOM-BEC-022 yayım önceki yayındaki sürümü arşivler, eski puanlar eski sürümde kalır', () => {
    const draft = rubricRow({
      id: 'test-rv2',
      versionNumber: 2,
      status: 'draft',
      publishedAt: null,
    })
    const plan = planRubricPublish({ version: draft, versions: [rubricRow(), draft], now })
    assert.deepEqual(plan, { publishedAt: now, archiveVersionIds: ['test-rv1'] })
    assert.throws(
      () => planRubricPublish({ version: rubricRow(), versions: [], now }),
      isDomainError('rubric_version_immutable', 'conflict'),
    )
  })

  test('DOM-BEC-022 kullanılmış sürüm silinmez, yalnız arşivlenir', () => {
    assert.doesNotThrow(() =>
      assertRubricVersionDeletable(rubricRow({ status: 'draft' }), {
        assignmentCount: 0,
        scoreCount: 0,
      }),
    )
    assert.throws(
      () =>
        assertRubricVersionDeletable(rubricRow({ status: 'draft' }), {
          assignmentCount: 0,
          scoreCount: 2,
        }),
      isDomainError('rubric_version_in_use', 'conflict'),
    )
    assert.throws(
      () => assertRubricVersionDeletable(rubricRow(), { assignmentCount: 0, scoreCount: 0 }),
      isDomainError('rubric_version_in_use', 'conflict'),
    )
    assert.deepEqual(planRubricArchive({ version: rubricRow(), now }), { archivedAt: now })
    assert.throws(
      () => planRubricArchive({ version: rubricRow({ status: 'archived' }), now }),
      isDomainError('rubric_version_not_published', 'conflict'),
    )
  })

  test('DOM-BEC-022 arşivli ve taslak sürüm yeni atamaya sabitlenemez', () => {
    assert.doesNotThrow(() => assertRubricAssignable(rubricRow()))
    assert.throws(
      () => assertRubricAssignable(rubricRow({ status: 'archived' })),
      isDomainError('rubric_version_not_assignable', 'conflict'),
    )
    assert.throws(
      () => assertRubricAssignable(rubricRow({ status: 'draft' })),
      isDomainError('rubric_version_not_assignable', 'conflict'),
    )
  })

  test('IST-048 rubriği sahibi ve yönetici yönetir; diğer roller yönetemez', () => {
    const rubric = { id: 'test-r1', ownerUserId: 'test-u-t1' }
    assert.equal(canManageRubric({ role: 'ogretmen', userId: 'test-u-t1' }, rubric), true)
    assert.equal(canManageRubric({ role: 'ogretmen', userId: 'test-u-t2' }, rubric), false)
    assert.equal(canManageRubric({ role: 'yonetici', userId: 'test-u-a1' }, rubric), true)
    for (const role of ['onburo', 'ogrenci', 'veli'] as const) {
      assert.equal(canManageRubric({ role, userId: 'test-u-t1' }, rubric), false)
    }
  })
})

describe('ikinci puanlayıcı (DOM-BEC-024)', () => {
  test('DOM-BEC-024 örneklem en az %10 ve en az bir teslimdir', () => {
    assert.equal(SECOND_RATING_MIN_PERCENT, 10)
    assert.equal(secondRatingQuota(0, 10), 0)
    assert.equal(secondRatingQuota(3, 10), 1)
    assert.equal(secondRatingQuota(10, 10), 1)
    assert.equal(secondRatingQuota(11, 10), 2)
    assert.equal(secondRatingQuota(5, 0), 0)
    assert.equal(secondRatingQuota(4, 100), 4)
  })

  test('DOM-BEC-024 örneklem verilen rastgelelikle deterministiktir', () => {
    const ids = Array.from({ length: 25 }, (_, i) => `sub-${String(i).padStart(2, '0')}`)
    const a = pickSecondRatingSample(ids, 10, seededRandom('atama-1'))
    const b = pickSecondRatingSample([...ids].reverse(), 10, seededRandom('atama-1'))
    assert.equal(a.length, 3)
    assert.deepEqual(a, b)
    assert.equal(new Set(a).size, 3)
    assert.ok(a.every((id) => ids.includes(id)))
    assert.deepEqual(pickSecondRatingSample(ids, 0, seededRandom('x')), [])
  })

  test('DOM-BEC-024 birden fazla bant fark uyuşmazlıktır; tam eşikte (1 bant) değildir', () => {
    const first = scoreRow()
    assert.deepEqual(bandDisagreements(first, scoreRow({ ...goodScore({ task: 4 }) })), [])
    assert.deepEqual(bandDisagreements(first, scoreRow({ ...goodScore({ task: 5, voc: 1 }) })), [
      'task',
      'voc',
    ])
  })

  test('DOM-BEC-024 eşit puanlar uyuşur, ilk puan geçerli olur ve iki puanın sonunda kesinleşir', () => {
    const first = scoreRow({ scoredAt: plusMs(now, -2 * DAY) })
    const second = scoreRow({
      raterRole: 'second',
      raterUserId: 'test-u-t2',
      scoredAt: plusMs(now, -DAY),
    })
    const resolution = scoreResolution({ scores: [first, second], secondRatingRequested: true })
    assert.equal(resolution.status, 'settled')
    assert.equal(resolution.status === 'settled' && resolution.score.id, first.id)
    assert.equal(resolution.status === 'settled' && resolution.settledAt, second.scoredAt)
  })

  test('DOM-BEC-024 istenen ikinci puan gelmeden puan kesinleşmez', () => {
    assert.deepEqual(scoreResolution({ scores: [], secondRatingRequested: true }), {
      status: 'unscored',
    })
    assert.deepEqual(scoreResolution({ scores: [scoreRow()], secondRatingRequested: true }), {
      status: 'pending',
      missing: 'second',
    })
    assert.deepEqual(
      scoreResolution({
        scores: [scoreRow({ raterRole: 'second', raterUserId: 'test-u-t2' })],
        secondRatingRequested: true,
      }),
      { status: 'pending', missing: 'first' },
    )
    const only = scoreResolution({ scores: [scoreRow()], secondRatingRequested: false })
    assert.equal(only.status === 'settled' && only.source, 'first')
  })

  test('DOM-BEC-024 uyuşmazlıkta koordinatör son puanı verir, son puan önceliklidir', () => {
    const first = scoreRow()
    const second = scoreRow({
      raterRole: 'second',
      raterUserId: 'test-u-t2',
      ...goodScore({ gram: 1 }),
    })
    const disagreement = scoreResolution({ scores: [first, second], secondRatingRequested: true })
    assert.equal(disagreement.status, 'disagreement')
    assert.deepEqual(disagreement.status === 'disagreement' && disagreement.criterionIds, ['gram'])
    const final = scorePlan({
      scores: [first, second],
      rater: coordinator,
      raterRole: 'final',
      secondRatingRequested: true,
      input: goodScore({ gram: 2 }),
    })
    assert.equal(final.raterRole, 'final')
    const settled = scoreResolution({
      scores: [first, second, { ...final, id: 'test-final' }],
      secondRatingRequested: true,
    })
    assert.equal(settled.status === 'settled' && settled.source, 'final')
    assert.equal(settled.status === 'settled' && settled.settledAt, now)
  })

  test('DOM-BEC-024 son puan yalnız uyuşmazlıkta, bağımsız koordinatörce verilir', () => {
    const first = scoreRow()
    const agreeing = scoreRow({ raterRole: 'second', raterUserId: 'test-u-t2' })
    assert.throws(
      () =>
        scorePlan({
          scores: [first, agreeing],
          rater: coordinator,
          raterRole: 'final',
          secondRatingRequested: true,
        }),
      isDomainError('final_score_not_needed', 'conflict'),
    )
    const disagreeing = scoreRow({
      raterRole: 'second',
      raterUserId: 'test-u-t2',
      ...goodScore({ task: 0 }),
    })
    const base = {
      scores: [first, disagreeing],
      raterRole: 'final' as const,
      secondRatingRequested: true,
    }
    assert.throws(
      () => scorePlan({ ...base, rater: secondRater }),
      isDomainError('coordinator_required', 'forbidden'),
    )
    assert.throws(
      () => scorePlan({ ...base, rater: { userId: 'test-u-t1', coordinator: true } }),
      isDomainError('rater_not_independent', 'conflict'),
    )
  })

  test('DOM-BEC-024 ikinci puan yalnız istenince ve başka öğretmence verilir; mükerrer puan yok', () => {
    const first = scoreRow()
    assert.throws(
      () => scorePlan({ scores: [first], rater: secondRater, raterRole: 'second' }),
      isDomainError('second_rating_not_requested', 'conflict'),
    )
    assert.throws(
      () =>
        scorePlan({
          scores: [first],
          rater: firstRater,
          raterRole: 'second',
          secondRatingRequested: true,
        }),
      isDomainError('rater_not_independent', 'conflict'),
    )
    const second = scorePlan({
      scores: [first],
      rater: secondRater,
      raterRole: 'second',
      secondRatingRequested: true,
    })
    assert.equal(second.raterUserId, 'test-u-t2')
    assert.throws(
      () => scorePlan({ scores: [first] }),
      isDomainError('rubric_score_exists', 'conflict'),
    )
    const secondRow = scoreRow({ raterRole: 'second', raterUserId: 'test-u-t2' })
    assert.throws(
      () =>
        scorePlan({
          scores: [first, secondRow],
          rater: { userId: 'test-u-t3', coordinator: false },
          raterRole: 'second',
          secondRatingRequested: true,
        }),
      isDomainError('rubric_score_exists', 'conflict'),
    )
    assert.throws(
      () => scorePlan({ scores: [secondRow], rater: secondRater, secondRatingRequested: true }),
      isDomainError('rater_not_independent', 'conflict'),
    )
    // Eski sürümün puanı yeni sürümün puanlanmasını engellemez.
    assert.doesNotThrow(() => scorePlan({ scores: [scoreRow({ submissionVersionId: 'test-v1' })] }))
  })

  test('DOM-BEC-024, DOM-YTK-027 ikinci puanlayıcı ilk puanı görmez; koordinatör iki puan verilince hepsini görür, puanlayıcıysa kör kalır', () => {
    const first = scoreRow()
    const scores = [first]
    assert.deepEqual(
      scoresVisibleToRater({ scores, viewer: secondRater, secondRatingRequested: true }),
      [],
    )
    assert.deepEqual(
      scoresVisibleToRater({ scores, viewer: firstRater, secondRatingRequested: true }),
      [first],
    )
    // DOM-BEC-024: ikinci puan beklenirken koordinatör de kördür; ikinci puanı kendisi verebilir.
    assert.deepEqual(
      scoresVisibleToRater({ scores, viewer: coordinator, secondRatingRequested: true }),
      [],
    )
    const awaited = scoreRow({ raterRole: 'second', raterUserId: 'test-u-t2' })
    assert.deepEqual(
      scoresVisibleToRater({
        scores: [first, { ...awaited, criteria: goodScore({ task: 1 }).criteria }],
        viewer: coordinator,
        secondRatingRequested: true,
      }).map((s) => s.raterRole),
      ['first', 'second'],
    )
    // DOM-YTK-027: koordinatör o sürümün puanlayıcısıysa kör puanlama ona da uygulanır.
    const ratingCoordinator = { userId: 'test-u-t1', coordinator: true }
    const blindSecond = scoreRow({
      raterRole: 'second',
      raterUserId: 'test-u-k1',
      criteria: goodScore({ task: 1 }).criteria,
    })
    assert.deepEqual(
      scoresVisibleToRater({
        scores: [first, blindSecond],
        viewer: { userId: 'test-u-k1', coordinator: true },
        secondRatingRequested: true,
      }).map((s) => s.id),
      [blindSecond.id],
    )
    assert.deepEqual(
      scoresVisibleToRater({ scores, viewer: ratingCoordinator, secondRatingRequested: true }),
      [first],
    )
    // Başka sürümün puanlayıcısı olmak bu sürümde koordinatörü kör yapmaz.
    const otherVersion = scoreRow({ submissionVersionId: 'test-v1', raterUserId: 'test-u-k1' })
    assert.deepEqual(
      scoresVisibleToRater({
        scores: [otherVersion, first, awaited],
        viewer: coordinator,
        secondRatingRequested: true,
      }).map((s) => s.id),
      [otherVersion.id, first.id, awaited.id],
    )
    // Kesinleşen puan puanlayıcılara açılır.
    const second = scoreRow({ raterRole: 'second', raterUserId: 'test-u-t2' })
    assert.deepEqual(
      scoresVisibleToRater({
        scores: [first, second],
        viewer: secondRater,
        secondRatingRequested: true,
      }),
      [first, second],
    )
  })
})

describe('koordinatörün işi (DOM-BEC-024, DOM-YTK-027)', () => {
  test('DOM-BEC-024 coordinatorCase: iki puan bir kriterde birden fazla bant ayrışınca; son puan verilse de koordinatörün işi kalır', () => {
    const first = scoreRow()
    const far = scoreRow({
      raterRole: 'second',
      raterUserId: 'test-u-t2',
      criteria: goodScore({ task: 1 }).criteria,
    })
    const near = scoreRow({ raterRole: 'second', raterUserId: 'test-u-t2' })
    assert.equal(coordinatorCase([first]), false)
    assert.equal(coordinatorCase([first, near]), false)
    assert.equal(coordinatorCase([first, far]), true)
    const final = scoreRow({ raterRole: 'final', raterUserId: 'test-u-k1' })
    assert.equal(coordinatorCase([first, far, final]), true)
  })

  test('DOM-BEC-024 son puanı puanlayıcı olmayan koordinatör verir; puanlayıcı koordinatör 409, koordinatör olmayan 403, uyuşmazlık yoksa 409', () => {
    const first = scoreRow()
    const far = scoreRow({
      raterRole: 'second',
      raterUserId: 'test-u-t2',
      criteria: goodScore({ task: 1 }).criteria,
    })
    const finalPlan = (rater: { userId: string; coordinator: boolean }, scores = [first, far]) =>
      scorePlan({ scores, rater, raterRole: 'final', secondRatingRequested: true })
    assert.equal(finalPlan(coordinator).raterRole, 'final')
    assert.throws(
      () => finalPlan({ userId: 'test-u-t1', coordinator: true }),
      isDomainError('rater_not_independent', 'conflict'),
    )
    assert.throws(
      () => finalPlan({ userId: 'test-u-t2', coordinator: true }),
      isDomainError('rater_not_independent', 'conflict'),
    )
    assert.throws(() => finalPlan(secondRater), isDomainError('coordinator_required', 'forbidden'))
    assert.throws(
      () => finalPlan(coordinator, [first]),
      isDomainError('final_score_not_needed', 'conflict'),
    )
    const settled = scoreRow({ raterRole: 'final', raterUserId: 'test-u-k1' })
    assert.throws(
      () => finalPlan(coordinator, [first, far, settled]),
      isDomainError('final_score_not_needed', 'conflict'),
    )
  })
})

describe('puanlama süresi ve itiraz (DOM-BEC-025)', () => {
  const due = '2026-11-05T20:59:00.000Z'
  test('DOM-BEC-025 puanlama son teslimden sonra 7 gün içindedir; son an dahil', () => {
    assert.equal(GRADING_DAYS, 7)
    const onTime = { submittedAt: plusMs(due, -DAY) }
    assert.equal(gradingDueAt({ dueAt: due }, onTime), plusMs(due, 7 * DAY))
    const late = { submittedAt: plusMs(due, 2 * DAY) }
    assert.equal(gradingDueAt({ dueAt: due }, late), plusMs(due, 9 * DAY))
    assert.equal(gradingDueAt({ dueAt: null }, onTime), plusMs(onTime.submittedAt, 7 * DAY))
    const base = {
      deadline: { dueAt: due },
      version: onTime,
      resolution: { status: 'unscored' as const },
    }
    assert.equal(gradingOverdue({ ...base, now: plusMs(due, 7 * DAY) }), false)
    assert.equal(gradingOverdue({ ...base, now: plusMs(due, 7 * DAY + 1) }), true)
    const settled = scoreResolution({ scores: [scoreRow()], secondRatingRequested: false })
    assert.equal(
      gradingOverdue({ ...base, resolution: settled, now: plusMs(due, 30 * DAY) }),
      false,
    )
  })

  test('DOM-BEC-025 itiraz süresi ertesi günden başlayan 5 iş günüdür (hafta sonu ve tatil sayılmaz)', () => {
    assert.equal(APPEAL_BUSINESS_DAYS, 5)
    // Çarşamba 10.00 (İstanbul) duyuru → sonraki çarşamba.
    assert.equal(addBusinessDays('2026-11-04T07:00:00.000Z', 5), '2026-11-11')
    assert.equal(addBusinessDays('2026-11-04T07:00:00.000Z', 5, ['2026-11-10']), '2026-11-12')
    // 29 Ekim tatil.
    assert.equal(addBusinessDays('2026-10-27T07:00:00.000Z', 5, ['2026-10-29']), '2026-11-04')
    // UTC 22.30 İstanbul'da ertesi gündür (perşembe 01.30).
    assert.equal(addBusinessDays('2026-11-04T22:30:00.000Z', 5), '2026-11-12')
    assert.equal(appealDeadline('2026-11-04T07:00:00.000Z'), '2026-11-11T20:59:59.999Z')
  })

  const student: Actor = {
    role: 'ogrenci',
    links: [{ kind: 'student', recordId: 'test-s1' }],
    userId: 'test-u-s1',
  }
  const parent: Actor = {
    role: 'veli',
    links: [{ kind: 'child', recordId: 'test-s1' }],
    userId: 'test-u-p1',
  }
  const announced = '2026-11-04T07:00:00.000Z'
  const settled = scoreResolution({
    scores: [scoreRow({ scoredAt: announced })],
    secondRatingRequested: false,
  })
  const appealInput = (input: Partial<Parameters<typeof planAppeal>[0]> = {}) =>
    planAppeal({
      actor: student,
      learnerId: 'test-s1',
      kind: 'evaluation',
      submissionVersionId: 'test-v2',
      resolution: settled,
      appeals: [],
      input: { reason: 'Sözcük dağarcığı bandı metinle uyuşmuyor.' },
      now: plusMs(announced, DAY),
      ...input,
    })

  test('DOM-BEC-025 kursiyer ve velisi süre içinde gerekçeli itiraz eder', () => {
    const appeal = appealInput()
    assert.equal(appeal.filedByUserId, 'test-u-s1')
    assert.equal(appeal.learnerId, 'test-s1')
    assert.equal(appealInput({ actor: parent }).filedByUserId, 'test-u-p1')
    assert.doesNotThrow(() => appealInput({ now: '2026-11-11T20:59:59.999Z' }))
    assert.throws(
      () => appealInput({ now: '2026-11-11T21:00:00.000Z' }),
      isDomainError('appeal_window_closed'),
    )
    assert.throws(() => appealInput({ input: { reason: 'kısa' } }), ZodError)
  })

  test('DOM-BEC-025 başkasının sonucuna, öğretmen veya yöneticiyle itiraz edilmez', () => {
    const other: Actor = {
      role: 'ogrenci',
      links: [{ kind: 'student', recordId: 'test-s2' }],
      userId: 'u2',
    }
    for (const actor of [
      other,
      {
        role: 'ogretmen',
        links: [{ kind: 'teacher', recordId: 'test-t1' }],
        userId: 'u3',
      } as Actor,
      { role: 'yonetici', links: [], userId: 'u4' } as Actor,
      { role: 'onburo', links: [], userId: 'u5' } as Actor,
      { ...student, userId: undefined },
    ]) {
      assert.throws(() => appealInput({ actor }), isDomainError('appeal_forbidden', 'forbidden'))
    }
  })

  test('DOM-BEC-025 duyurulmamış sonuca, alıştırmaya ve ikinci kez itiraz edilmez', () => {
    assert.throws(
      () => appealInput({ resolution: { status: 'pending', missing: 'second' } }),
      isDomainError('appeal_not_open', 'conflict'),
    )
    assert.throws(
      () => appealInput({ now: plusMs(announced, -1) }),
      isDomainError('appeal_not_open', 'conflict'),
    )
    assert.throws(
      () => appealInput({ submissionVersionId: 'test-v1' }),
      isDomainError('appeal_not_open', 'conflict'),
    )
    assert.throws(() => appealInput({ kind: 'practice' }), isDomainError('appeal_not_available'))
    assert.throws(
      () => appealInput({ appeals: [{ submissionVersionId: 'test-v2' }] }),
      isDomainError('appeal_exists', 'conflict'),
    )
  })

  const appealRow: AppealRow = {
    id: 'test-ap1',
    submissionVersionId: 'test-v2',
    learnerId: 'test-s1',
    filedByUserId: 'test-u-s1',
    reason: 'Sözcük dağarcığı bandı metinle uyuşmuyor.',
    filedAt: plusMs(announced, DAY),
    decidedByUserId: null,
    decidedAt: null,
    outcome: null,
    decisionReason: null,
  }
  const reviewer = { userId: 'test-u-t9', coordinator: false }
  const decide = (input: Partial<Parameters<typeof planAppealDecision>[0]> = {}) =>
    planAppealDecision({
      appeal: appealRow,
      reviewer,
      rubricVersion: rubricRow(),
      scores: [scoreRow()],
      input: { outcome: 'rejected', reason: 'Bantlar metinle tutarlı.' },
      now,
      ...input,
    })

  test('DOM-BEC-025 itirazı ilk puanlayıcı dışında bir öğretmen gerekçeyle sonuçlandırır', () => {
    const rejected = decide()
    assert.equal(rejected.score, null)
    assert.equal(rejected.appeal.outcome, 'rejected')
    assert.equal(rejected.appeal.decisionReason, 'Bantlar metinle tutarlı.')
    assert.throws(
      () => decide({ reviewer: firstRater }),
      isDomainError('rater_not_independent', 'conflict'),
    )
    assert.throws(
      () => decide({ appeal: { ...appealRow, outcome: 'upheld' } }),
      isDomainError('appeal_decided', 'conflict'),
    )
    assert.throws(() => decide({ input: { outcome: 'rejected', reason: '' } }), ZodError)
  })

  test('DOM-BEC-025 kabul edilen itiraz yeni son puan ekler; ilk puan geçmişte kalır', () => {
    const first = scoreRow({ scoredAt: announced })
    const upheld = decide({
      scores: [first],
      input: {
        outcome: 'upheld',
        reason: 'Sözcük bandı yükseltildi.',
        score: goodScore({ voc: 4 }),
      },
    })
    assert.equal(upheld.score?.raterRole, 'final')
    assert.equal(upheld.score?.raterUserId, 'test-u-t9')
    const resolution = scoreResolution({
      scores: [first, { ...upheld.score!, id: 'test-ap-final' }],
      secondRatingRequested: false,
    })
    assert.equal(resolution.status === 'settled' && resolution.score.id, 'test-ap-final')
    const uncommented = goodScore({ voc: 1 })
    uncommented.criteria[2] = { ...uncommented.criteria[2]!, comment: null }
    assert.throws(
      () => decide({ input: { outcome: 'upheld', reason: 'Bant değişti.', score: uncommented } }),
      isDomainError('criterion_comment_required'),
    )
  })
})
