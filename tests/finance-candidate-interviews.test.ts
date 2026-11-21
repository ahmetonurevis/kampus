import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertCandidateInterviewPlan,
  assertInterviewBeforeOffer,
  averagePercent,
  candidateEvaluationInputSchema,
  candidateEvaluationScore,
  candidateInterviewCreateSchema,
  candidateInterviewSummary,
  candidateInterviewUpdateSchema,
  interviewFormKind,
  interviewTemplateInputSchema,
  interviewTemplateUpdateSchema,
  planCandidateEvaluation,
  planCandidateInterviewCancel,
  planCandidateInterviewComplete,
  planCandidateInterviewUpdate,
  planInterviewTemplate,
  planInterviewTemplateArchive,
  planInterviewTemplateUpdate,
  planInterviewTemplateVersion,
  scoreRange,
  type CandidateInterviewChecks,
  type CandidateInterviewForm,
  type EvaluationChecks,
  type StoredInterviewState,
} from '../packages/school-core/src/lib/finance-candidate-interviews.ts'
import { lessonObservationScore } from '../packages/school-core/src/lib/finance-lesson-observations.ts'

/** Aday değerlendirme ve mülakat kuralları (DOM-FIN-138; ON-178; K-469…K-471). */

const NOW = new Date('2026-10-06T09:00:00.000Z')
const TEMPLATE_ID = '00000000-0000-4000-8000-000000000001'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return 'none'
}
function kindOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    if (error instanceof DomainError) return error.kind
    throw error
  }
  return undefined
}

const INTERVIEW_FORM: CandidateInterviewForm = {
  kind: 'interview',
  scaleMax: 5,
  criteria: [
    { id: 'k1', title: 'Alan bilgisi', description: null, weight: 2 },
    { id: 'k2', title: 'İletişim', description: null, weight: 1 },
  ],
}
const levels = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))
const OBSERVATION_FORM: CandidateInterviewForm = {
  kind: 'observation',
  criteria: [
    { id: 'k1', title: 'Sınıf yönetimi', description: null, weight: 2, levels },
    { id: 'k2', title: 'Öğrenci katılımı', description: null, weight: 1, levels },
  ],
}

const planned: StoredInterviewState = {
  type: 'in_person',
  status: 'planned',
  scheduledAt: '2026-10-05T07:00:00.000Z',
  location: 'Müdür odası',
  meetingUrl: null,
}
const open = { anonymizedAt: null }

describe('DOM-FIN-138: mülakat formu şablonu (K-470)', () => {
  test('ölçek varsayılanı 5, ölçüt kimliği sunucuda; aynı ölçüt adı ve ölçek dışı 400', () => {
    const plan = planInterviewTemplate({
      name: 'Öğretmen mülakat formu',
      criteria: [{ title: 'Alan bilgisi' }, { title: 'İletişim', weight: 3 }],
    })
    assert.equal(plan.scaleMax, 5)
    assert.deepEqual(
      plan.criteria.map((c) => [c.id, c.weight]),
      [
        ['k1', 1],
        ['k2', 3],
      ],
    )
    assert.equal(
      interviewTemplateInputSchema.safeParse({
        name: 'Form',
        criteria: [{ title: 'İletişim' }, { title: 'iletişim' }],
      }).success,
      false,
    )
    assert.equal(
      interviewTemplateInputSchema.safeParse({
        name: 'Form',
        scaleMax: 2,
        criteria: [{ title: 'Aa' }],
      }).success,
      false,
    )
    assert.equal(interviewTemplateUpdateSchema.safeParse({}).success, false)
  })

  test('kullanılmış sürüm ve arşivli form 409; yeni sürüm arşivli forma açılmaz', () => {
    const input = { scaleMax: 10 }
    assert.deepEqual(planInterviewTemplateUpdate({ archived: false, used: false }, input), {
      scaleMax: 10,
    })
    assert.equal(
      code(() => planInterviewTemplateUpdate({ archived: false, used: true }, input)),
      'interview_template_used',
    )
    assert.equal(
      kindOf(() => planInterviewTemplateUpdate({ archived: true, used: false }, input)),
      'conflict',
    )
    const version = { name: 'Form', criteria: [{ title: 'Alan bilgisi' }] }
    assert.equal(planInterviewTemplateVersion({ archived: false }, version).criteria.length, 1)
    assert.equal(
      code(() => planInterviewTemplateVersion({ archived: true }, version)),
      'interview_template_archived',
    )
    assert.equal(
      code(() => planInterviewTemplateArchive({ archived: false })),
      'none',
    )
    assert.equal(
      code(() => planInterviewTemplateArchive({ archived: true })),
      'interview_template_archived',
    )
  })
})

describe('DOM-FIN-138: mülakat planı (K-469)', () => {
  const body = {
    type: 'in_person',
    scheduledAt: '2026-10-08T10:00:00+03:00',
    location: 'Müdür odası',
    templateId: TEMPLATE_ID,
    evaluatorMembershipIds: ['m1', 'm2'],
  }
  test('yüz yüze ve örnek ders yer, çevrim içi https bağlantı ister; değerlendirici 1–5 ve tekil', () => {
    assert.equal(candidateInterviewCreateSchema.safeParse(body).success, true)
    const issuePath = (input: unknown) =>
      candidateInterviewCreateSchema.safeParse(input).error?.issues[0]?.path.join('.')
    assert.equal(issuePath({ ...body, location: '' }), 'location')
    assert.equal(issuePath({ ...body, type: 'sample_lesson', location: null }), 'location')
    assert.equal(issuePath({ ...body, type: 'online', location: null }), 'meetingUrl')
    assert.equal(
      issuePath({ ...body, type: 'online', meetingUrl: 'http://ornek.com/a' }),
      'meetingUrl',
    )
    assert.equal(
      candidateInterviewCreateSchema.safeParse({
        ...body,
        type: 'pre_screen',
        location: null,
      }).success,
      true,
    )
    assert.equal(issuePath({ ...body, evaluatorMembershipIds: [] }), 'evaluatorMembershipIds')
    assert.equal(
      issuePath({ ...body, evaluatorMembershipIds: ['m1', 'm1'] }),
      'evaluatorMembershipIds',
    )
    assert.equal(issuePath({ ...body, scheduledAt: '2026-10-08' }), 'scheduledAt')
    assert.equal(interviewFormKind('sample_lesson'), 'observation')
    assert.equal(interviewFormKind('online'), 'interview')
  })

  test('yalnız "mülakat" aşamasındaki, anonimleştirilmemiş başvuruya; form ve değerlendirici kurumda', () => {
    const checks: CandidateInterviewChecks = {
      application: { stage: 'interview', anonymizedAt: null },
      template: { archived: false },
      evaluators: [
        { membershipId: 'm1', role: 'yonetici', active: true },
        { membershipId: 'm2', role: 'ogretmen', active: true },
      ],
    }
    assert.equal(
      code(() => assertCandidateInterviewPlan(checks)),
      'none',
    )
    const failing: [Partial<CandidateInterviewChecks>, string][] = [
      [{ application: { stage: 'screening', anonymizedAt: null } }, 'candidate_interview_stage'],
      [{ application: { stage: 'offer', anonymizedAt: null } }, 'candidate_interview_stage'],
      [
        { application: { stage: 'interview', anonymizedAt: NOW.toISOString() } },
        'candidate_interview_application_anonymized',
      ],
      [{ template: null }, 'candidate_interview_template_not_found'],
      [{ template: { archived: true } }, 'candidate_interview_template_archived'],
      [{ evaluators: [null] }, 'candidate_interview_evaluator_not_found'],
      [
        { evaluators: [{ membershipId: 'm3', role: 'onburo', active: true }] },
        'candidate_interview_evaluator_invalid',
      ],
      [
        { evaluators: [{ membershipId: 'm3', role: 'ogretmen', active: false }] },
        'candidate_interview_evaluator_invalid',
      ],
    ]
    for (const [override, expected] of failing)
      assert.equal(
        code(() => assertCandidateInterviewPlan({ ...checks, ...override })),
        expected,
        expected,
      )
  })

  test('düzeltme yalnız planlıda; değişiklik yoksa ve yer silinirse 422; an UTC olarak karşılaştırılır', () => {
    const parse = (input: unknown) => candidateInterviewUpdateSchema.parse(input)
    assert.equal(candidateInterviewUpdateSchema.safeParse({}).success, false)
    const moved = planCandidateInterviewUpdate(
      planned,
      open,
      parse({ scheduledAt: '2026-10-09T13:00:00+03:00' }),
    )
    assert.deepEqual(moved.changed, ['scheduledAt'])
    assert.equal(moved.next.scheduledAt, '2026-10-09T10:00:00.000Z')
    assert.equal(
      code(() =>
        planCandidateInterviewUpdate(
          planned,
          open,
          parse({ scheduledAt: '2026-10-05T10:00:00+03:00' }),
        ),
      ),
      'candidate_interview_unchanged',
    )
    assert.equal(
      code(() => planCandidateInterviewUpdate(planned, open, parse({ location: '' }))),
      'candidate_interview_location_required',
    )
    assert.equal(
      code(() =>
        planCandidateInterviewUpdate(
          { ...planned, type: 'online', location: null, meetingUrl: 'https://ornek.com/a' },
          open,
          parse({ meetingUrl: null }),
        ),
      ),
      'candidate_interview_link_required',
    )
    assert.equal(
      code(() =>
        planCandidateInterviewUpdate(
          { ...planned, status: 'completed' },
          open,
          parse({ location: 'Salon' }),
        ),
      ),
      'candidate_interview_not_planned',
    )
    assert.equal(
      code(() =>
        planCandidateInterviewUpdate(planned, { anonymizedAt: 'x' }, parse({ location: 'Salon' })),
      ),
      'candidate_interview_application_anonymized',
    )
  })

  test('"yapıldı" saat gelince ve planlıda; iptal yalnız planlıda', () => {
    assert.equal(
      code(() => planCandidateInterviewComplete(planned, open, NOW)),
      'none',
    )
    assert.equal(
      code(() =>
        planCandidateInterviewComplete(
          { ...planned, scheduledAt: '2026-10-06T09:00:01.000Z' },
          open,
          NOW,
        ),
      ),
      'candidate_interview_not_started',
    )
    assert.equal(
      code(() => planCandidateInterviewComplete({ ...planned, status: 'cancelled' }, open, NOW)),
      'candidate_interview_not_planned',
    )
    assert.equal(
      code(() => planCandidateInterviewCancel(planned)),
      'none',
    )
    assert.equal(
      code(() => planCandidateInterviewCancel({ status: 'completed' })),
      'candidate_interview_not_planned',
    )
  })

  test('teklif ve işe alındı en az bir yapılmış mülakat ister; ret serbest', () => {
    assert.equal(
      code(() => assertInterviewBeforeOffer('offer', 0)),
      'job_application_interview_required',
    )
    assert.equal(
      code(() => assertInterviewBeforeOffer('hired', 0)),
      'job_application_interview_required',
    )
    assert.equal(
      code(() => assertInterviewBeforeOffer('offer', 1)),
      'none',
    )
    assert.equal(
      code(() => assertInterviewBeforeOffer('rejected', 0)),
      'none',
    )
    assert.equal(
      code(() => assertInterviewBeforeOffer('interview', 0)),
      'none',
    )
  })
})

describe('DOM-FIN-138: değerlendirme ve puan (K-470, K-471)', () => {
  const checks = (overrides: Partial<EvaluationChecks> = {}): EvaluationChecks => ({
    interview: { status: 'completed' },
    application: open,
    evaluation: { submittedAt: null },
    form: INTERVIEW_FORM,
    ...overrides,
  })
  const input = (ratings: unknown[], generalNote = 'Güçlü aday.') =>
    candidateEvaluationInputSchema.parse({ ratings, generalNote })

  test('mülakat formu puanı ağırlıklı, sunucuda hesaplanır; sıra formun ölçüt sırasıdır', () => {
    const plan = planCandidateEvaluation(
      checks(),
      input([
        { criterionId: 'k2', score: 3 },
        { criterionId: 'k1', score: 5, note: 'Çok iyi' },
      ]),
    )
    assert.deepEqual(
      plan.ratings.map((r) => r.criterionId),
      ['k1', 'k2'],
    )
    assert.deepEqual(plan.score, { total: 13, max: 15, percent: 87 })
    assert.equal(scoreRange(INTERVIEW_FORM).min, 1)
  })

  test('değerlendirici değil 422, gönderilmiş 409, yapılmamış ve anonim 422; ölçüt ve aralık 422', () => {
    const full = input([
      { criterionId: 'k1', score: 4 },
      { criterionId: 'k2', score: 4 },
    ])
    assert.equal(
      code(() => planCandidateEvaluation(checks({ evaluation: null }), full)),
      'candidate_interview_not_evaluator',
    )
    const submitted = () =>
      planCandidateEvaluation(checks({ evaluation: { submittedAt: NOW.toISOString() } }), full)
    assert.equal(code(submitted), 'candidate_evaluation_submitted')
    assert.equal(kindOf(submitted), 'conflict')
    assert.equal(
      code(() => planCandidateEvaluation(checks({ interview: { status: 'planned' } }), full)),
      'candidate_interview_not_completed',
    )
    assert.equal(
      code(() => planCandidateEvaluation(checks({ application: { anonymizedAt: 'x' } }), full)),
      'candidate_interview_application_anonymized',
    )
    assert.equal(
      code(() =>
        planCandidateEvaluation(
          checks(),
          input([
            { criterionId: 'k1', score: 4 },
            { criterionId: 'k1', score: 4 },
          ]),
        ),
      ),
      'candidate_evaluation_criterion_invalid',
    )
    assert.equal(
      code(() =>
        planCandidateEvaluation(
          checks(),
          input([
            { criterionId: 'k1', score: 0 },
            { criterionId: 'k2', score: 4 },
          ]),
        ),
      ),
      'candidate_evaluation_score_range',
    )
    assert.equal(
      code(() => planCandidateEvaluation(checks(), input([{ criterionId: 'k1', score: 4 }]))),
      'candidate_evaluation_unrated',
    )
    assert.equal(
      candidateEvaluationInputSchema.safeParse({ ratings: [{ criterionId: 'k1', score: 1 }] })
        .success,
      false,
    )
  })

  test('örnek ders gözlem formuyla 0–5, gözlem puanıyla aynı; hedef altı seviye not ister', () => {
    const sample = checks({ form: OBSERVATION_FORM })
    const plan = planCandidateEvaluation(
      sample,
      input([
        { criterionId: 'k1', score: 4 },
        { criterionId: 'k2', score: 3 },
      ]),
    )
    assert.ok(OBSERVATION_FORM.kind === 'observation')
    assert.deepEqual(
      plan.score,
      lessonObservationScore(OBSERVATION_FORM.criteria, [
        { criterionId: 'k1', level: 4, note: null },
        { criterionId: 'k2', level: 3, note: null },
      ]),
    )
    assert.equal(
      code(() =>
        planCandidateEvaluation(
          sample,
          input([
            { criterionId: 'k1', score: 2 },
            { criterionId: 'k2', score: 3 },
          ]),
        ),
      ),
      'candidate_evaluation_note_required',
    )
    assert.equal(
      code(() =>
        planCandidateEvaluation(
          sample,
          input([
            { criterionId: 'k1', score: 6 },
            { criterionId: 'k2', score: 3 },
          ]),
        ),
      ),
      'candidate_evaluation_score_range',
    )
    assert.equal(candidateEvaluationScore(OBSERVATION_FORM, []), null)
    assert.equal(
      candidateEvaluationScore(INTERVIEW_FORM, [{ criterionId: 'k1', score: 3, note: null }]),
      null,
    )
  })

  test('özet: durum sayıları, değerlendirici ortalaması, örnek ders ayrı; iptal ve plan ortalamaya girmez', () => {
    assert.equal(averagePercent([]), null)
    assert.equal(averagePercent([80, 85]), 83)
    const summary = candidateInterviewSummary([
      { type: 'in_person', status: 'completed', submittedPercents: [80, 90] },
      { type: 'online', status: 'completed', submittedPercents: [] },
      { type: 'pre_screen', status: 'completed', submittedPercents: [60] },
      { type: 'sample_lesson', status: 'completed', submittedPercents: [70] },
      { type: 'in_person', status: 'planned', submittedPercents: [] },
      { type: 'in_person', status: 'cancelled', submittedPercents: [10] },
    ])
    assert.deepEqual(summary, {
      plannedCount: 1,
      completedCount: 4,
      cancelledCount: 1,
      submittedCount: 4,
      interviewAveragePercent: 73,
      sampleLessonAveragePercent: 70,
    })
    assert.equal(candidateInterviewSummary([]).interviewAveragePercent, null)
  })
})
