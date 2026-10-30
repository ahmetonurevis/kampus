import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKeySchema,
  questionBodySchema,
  type AnswerKey,
  type QuestionBody,
} from '../packages/school-core/src/content/resource.ts'
import type { CefrLevel, PrimarySkill } from '../packages/school-core/src/content/taxonomy.ts'
import { scoreAttempt, type ScoringItem } from '../packages/school-core/src/skills/scoring.ts'
import { bandMeaning } from '../packages/school-core/src/skills/rubric.ts'
import {
  CORE_SKILLS,
  ESTIMATE_LABEL,
  EVIDENCE_WINDOW_DAYS,
  SEPARATE_SKILLS,
  canViewCefrProfile,
  cefrProfileView,
  evidenceSnapshotOf,
  evidenceSnapshotSchema,
  overallSuggestion,
  plusStepOf,
  resultSuccessful,
  selectEvidence,
  suggestCefrLevels,
  suggestSkillLevel,
  type EvidenceCandidate,
  type EvidenceResult,
  type LevelDecisionRow,
  type SkillSuggestion,
} from '../packages/school-core/src/cefr/suggestion.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const now = '2026-11-04T09:00:00.000Z'
const DAY = 24 * 60 * 60_000
const ago = (days: number, ms = 0) => new Date(Date.parse(now) - days * DAY - ms).toISOString()

const auto = (ratio: number, parts = 4): EvidenceResult => ({
  mode: 'auto',
  score: {
    ratio,
    percent: Math.round(ratio * 100),
    items: [
      {
        questionVersionId: 'test-q',
        parts,
        correctParts: Math.round(ratio * parts),
        answered: true,
        points: 1,
        earned: ratio,
      },
    ],
  },
})
const rubric = (bands: number[], weights: number[] = []): EvidenceResult => ({
  mode: 'rubric',
  score: {
    percent: 60,
    criteria: bands.map((band, index) => {
      const weight = weights[index] ?? 1
      return {
        criterionId: `test-c${index}`,
        band,
        weight,
        weighted: band * weight,
        meaning: bandMeaning(band),
      }
    }),
  },
})

let seq = 0
const candidate = (over: Partial<EvidenceCandidate> = {}): EvidenceCandidate => {
  seq += 1
  return {
    id: `test-r${seq}`,
    taskId: `test-t${seq}`,
    title: `Görev ${seq}`,
    source: 'task',
    kind: 'evaluation',
    preliminary: false,
    skill: 'writing',
    targetLevel: 'B1',
    performedAt: ago(1),
    appealPending: false,
    result: rubric([3, 3, 3, 3]),
    ...over,
  }
}

/** `count` kanıt; ilk `successes` tanesi başarılı, ilk iki kanıt farklı günlerde. */
const batch = (
  skill: PrimarySkill,
  level: CefrLevel,
  count: number,
  successes: number,
  over: Partial<EvidenceCandidate> = {},
) =>
  Array.from({ length: count }, (_, index) => {
    const ok = index < successes
    const result =
      skill === 'writing' || skill === 'speaking' || skill === 'mediation'
        ? rubric(ok ? [3, 3, 3, 3] : [2, 2, 2, 2])
        : auto(ok ? 0.8 : 0.5, 4)
    return candidate({ skill, targetLevel: level, performedAt: ago(index + 1), result, ...over })
  })

const suggest = (candidates: EvidenceCandidate[]) => suggestCefrLevels({ candidates, now })
const levelOf = (s: SkillSuggestion) => (s.status === 'suggested' ? s.level : null)

describe('kanıt seçimi (DOM-BEC-031)', () => {
  test('DOM-BEC-031 alıştırma kanıt sayılmaz; üç başarılı alıştırma seviye göstermez', () => {
    const practice = batch('writing', 'B1', 3, 3, { kind: 'practice' })
    const result = suggest(practice)
    assert.equal(result.evidence.length, 0)
    assert.deepEqual(
      result.excluded.map((e) => e.reason),
      ['practice', 'practice', 'practice'],
    )
    assert.equal(result.skills.writing.status, 'insufficient')
  })

  test('DOM-BEC-031 ön tespit (uzaktan seviye tespiti) kanıt değildir', () => {
    const remote = candidate({ source: 'placement', preliminary: true })
    assert.deepEqual(
      selectEvidence([remote], now).excluded.map((e) => e.reason),
      ['preliminary'],
    )
  })

  test('DOM-BEC-031 becerisi, hedef seviyesi, puanı olmayan ve itirazı süren sonuç dışarıda', () => {
    const { evidence, excluded } = selectEvidence(
      [
        candidate({ skill: null }),
        candidate({ targetLevel: null }),
        candidate({ result: null }),
        candidate({ appealPending: true }),
        candidate({ performedAt: '2026-11-04T09:00:00.001Z' }),
        candidate(),
      ],
      now,
    )
    assert.deepEqual(
      excluded.map((e) => e.reason),
      ['no_skill', 'no_target_level', 'unscored', 'appeal_pending', 'not_yet'],
    )
    assert.equal(evidence.length, 1)
  })

  test('DOM-BEC-031 görev kanıtı 120 gün geçerli; tam sınır anında geçersiz', () => {
    const days = EVIDENCE_WINDOW_DAYS.task
    assert.equal(days, 120)
    const inside = candidate({ performedAt: ago(days, -1) })
    const edge = candidate({ performedAt: ago(days) })
    const { evidence, excluded } = selectEvidence([inside, edge], now)
    assert.deepEqual(
      evidence.map((e) => e.id),
      [inside.id],
    )
    assert.equal(evidence[0]!.expiresAt, '2026-11-04T09:00:00.001Z')
    assert.deepEqual(excluded, [
      { id: edge.id, taskId: edge.taskId, title: edge.title, reason: 'expired' },
    ])
  })

  test('DOM-BEC-031 DOM-DIL-012 seviye tespiti kanıtı 90 gün geçerli', () => {
    const inside = candidate({ source: 'placement', performedAt: ago(90, -1) })
    const edge = candidate({ source: 'placement', performedAt: ago(90) })
    const task = candidate({ source: 'task', performedAt: ago(90) })
    const { evidence } = selectEvidence([inside, edge, task], now)
    assert.deepEqual(
      evidence.map((e) => e.id),
      [inside.id, task.id],
    )
  })

  test('DOM-BEC-031 aynı görevin ikinci sonucu reddedilir', () => {
    const first = candidate()
    assert.throws(
      () => selectEvidence([first, { ...first, id: 'test-r-other' }], now),
      isDomainError('duplicate_evidence', 'conflict'),
    )
  })

  test('DOM-BEC-031 otomatik görevde başarı doğru oranı ≥ %70; %69,9 başarısız', () => {
    assert.equal(resultSuccessful(auto(0.7)), true)
    assert.equal(resultSuccessful(auto(0.699)), false)
    // F4a puanlama çıktısıyla: 10 sorunun 7'si doğru.
    const items: ScoringItem[] = Array.from({ length: 10 }, (_, index) => ({
      questionVersionId: `test-q${index}`,
      points: 1,
      locale: 'en',
      question: questionBodySchema.parse({
        questionType: 'true_false',
        stem: `Statement ${index}`,
        allowNotGiven: false,
      }) as QuestionBody,
      answerKey: answerKeySchema.parse({
        questionType: 'true_false',
        answer: 'true',
        explanation: 'Metinde geçer.',
      }) as AnswerKey,
    }))
    const answers = Object.fromEntries(
      items.map((item, index) => [
        item.questionVersionId,
        { questionType: 'true_false' as const, answer: index < 7 ? 'true' : 'false' },
      ]),
    )
    const score = scoreAttempt(items, answers as never)
    assert.equal(resultSuccessful({ mode: 'auto', score }), true)
  })

  test('DOM-BEC-031 rubrikte bant ortalaması ≥ 3 ve hiçbir kriter ≤ 1', () => {
    assert.equal(resultSuccessful(rubric([3, 3, 3, 3])), true)
    assert.equal(resultSuccessful(rubric([5, 5, 2, 2])), true)
    assert.equal(resultSuccessful(rubric([5, 5, 5, 1])), false, 'tek kriter ≤ 1')
    assert.equal(resultSuccessful(rubric([3, 3, 3, 2])), false, 'ortalama 2,75')
    assert.equal(resultSuccessful(rubric([])), false)
  })

  test('DOM-BEC-031 ağırlıklı ortalama da 3 olmalı (muhafazakâr yorum)', () => {
    // Düz ortalama 3, ağırlıklı ortalama (2×3 + 4) / 4 = 2,5.
    assert.equal(resultSuccessful(rubric([2, 4], [3, 1])), false)
    assert.equal(resultSuccessful(rubric([4, 2], [3, 1])), true)
  })

  test('DOM-BEC-031 gün Europe/Istanbul takvimine göre sayılır', () => {
    const late = candidate({ performedAt: '2026-11-03T20:30:00.000Z' })
    const early = candidate({ performedAt: '2026-11-03T21:30:00.000Z' })
    const { evidence } = selectEvidence([late, early], now)
    assert.deepEqual(
      evidence.map((e) => e.day),
      ['2026-11-03', '2026-11-04'],
    )
  })
})

describe('beceri önerisi (DOM-BEC-032)', () => {
  test('DOM-BEC-032 eşiğin tam sınırı: 3 kanıt, 2 gün, 2/3 başarı seviyeyi gösterir', () => {
    const result = suggest(batch('writing', 'B1', 3, 2))
    const writing = result.skills.writing
    assert.equal(writing.status, 'suggested')
    assert.equal(levelOf(writing), 'B1')
    assert.equal(writing.levels[0]!.missingEvidence, 0)
  })

  test('DOM-BEC-032 eşiğin bir altı: 2 kanıt, 1 gün veya 1/3 başarı yetmez', () => {
    assert.equal(suggest(batch('writing', 'B1', 2, 2)).skills.writing.status, 'insufficient')
    assert.equal(suggest(batch('writing', 'B1', 3, 1)).skills.writing.status, 'insufficient')
    const sameDay = batch('writing', 'B1', 3, 3, { performedAt: ago(1) })
    const oneDay = suggest(sameDay).skills.writing
    assert.equal(oneDay.status, 'insufficient')
    assert.equal(oneDay.status === 'insufficient' && oneDay.missingEvidence, 1)
  })

  test('DOM-BEC-032 okuma ve dinlemede toplam madde en az 10; yazmada madde aranmaz', () => {
    const reading = (parts: number) =>
      batch('reading', 'A2', 3, 3).map((c, index) => ({
        ...c,
        result: auto(0.8, index === 0 ? parts : 3),
      }))
    // 4 + 3 + 3 = 10 madde: tam sınır.
    assert.equal(levelOf(suggest(reading(4)).skills.reading), 'A2')
    const short = suggest(reading(3)).skills.reading
    assert.equal(short.status, 'insufficient')
    assert.equal(short.status === 'insufficient' && short.missingItems, 1)
    assert.equal(short.status === 'insufficient' && short.missingEvidence, 0)
    assert.equal(levelOf(suggest(batch('writing', 'A2', 3, 3)).skills.writing), 'A2')
  })

  test('DOM-BEC-032 öneri gösterilmiş en yüksek seviyedir', () => {
    const result = suggest([
      ...batch('speaking', 'A2', 3, 3),
      ...batch('speaking', 'C1', 3, 3),
      ...batch('speaking', 'B2', 3, 1),
    ])
    assert.equal(levelOf(result.skills.speaking), 'C1')
  })

  test('DOM-BEC-032 B1 gösterilmiş ve B2de 2 başarılı kanıt → B1+', () => {
    const b1 = batch('listening', 'B1', 3, 3)
    const b2 = batch('listening', 'B2', 2, 2)
    const result = suggest([...b1, ...b2]).skills.listening
    assert.equal(result.status, 'suggested')
    assert.equal(levelOf(result), 'B1+')
    assert.equal(result.status === 'suggested' && result.demonstratedLevel, 'B1')
    assert.deepEqual(
      result.evidenceIds,
      [...b1, ...b2].map((c) => c.id),
    )
  })

  test('DOM-BEC-032 bir sonraki ana seviyede tek başarı artı vermez', () => {
    const result = suggest([...batch('listening', 'B1', 3, 3), ...batch('listening', 'B2', 3, 1)])
      .skills.listening
    assert.equal(levelOf(result), 'B1')
  })

  test('DOM-BEC-032 B1+ hedefli kanıt artı için B2 yerine sayılmaz, kendisi gösterilebilir', () => {
    const plusOnly = suggest([...batch('reading', 'B1', 3, 3), ...batch('reading', 'B1+', 2, 2)])
      .skills.reading
    assert.equal(levelOf(plusOnly), 'B1')
    const shown = suggest([...batch('reading', 'B1+', 3, 3)]).skills.reading
    assert.equal(levelOf(shown), 'B1+')
    assert.equal(shown.status === 'suggested' && shown.plus, false)
  })

  test('DOM-BEC-032 C1 ve A1in artısı yoktur', () => {
    assert.equal(plusStepOf('C1'), null)
    assert.equal(plusStepOf('A1'), null)
    assert.deepEqual(plusStepOf('A2'), { plus: 'A2+', nextMain: 'B1' })
    assert.deepEqual(plusStepOf('B2'), { plus: 'B2+', nextMain: 'C1' })
    const result = suggest([...batch('writing', 'C1', 3, 3), ...batch('writing', 'C2', 2, 2)])
    assert.equal(levelOf(result.skills.writing), 'C1')
  })

  test('DOM-BEC-032 Pre-A1 gösterilebilir ve artısı yoktur', () => {
    const result = suggest([...batch('speaking', 'Pre-A1', 3, 2), ...batch('speaking', 'A1', 2, 2)])
    assert.equal(levelOf(result.skills.speaking), 'Pre-A1')
  })

  test('DOM-BEC-032 yetersiz kanıtta seviye uydurulmaz, eksik kanıt sayısı verilir', () => {
    const none = suggest([]).skills.reading
    assert.deepEqual(
      { ...none, levels: none.levels.length },
      {
        status: 'insufficient',
        skill: 'reading',
        missingEvidence: 3,
        missingItems: 10,
        evidenceIds: [],
        levels: 0,
      },
    )
    assert.equal('level' in none, false)
    const two = suggest(batch('writing', 'B2', 2, 1)).skills.writing
    // 2 kanıt, 1 başarı: üçüncü başarılı kanıtla 2/3 olur.
    assert.equal(two.status === 'insufficient' && two.missingEvidence, 1)
    const failing = suggest(batch('writing', 'B2', 3, 0)).skills.writing
    // 3 kanıt, 0 başarı: (0 + k) / (3 + k) ≥ 2/3 için k = 6.
    assert.equal(failing.status === 'insufficient' && failing.missingEvidence, 6)
  })

  test('DOM-BEC-032 suggestSkillLevel yalnız kendi becerisinin kanıtına bakar', () => {
    const { evidence } = selectEvidence(batch('writing', 'B1', 3, 3), now)
    assert.equal(suggestSkillLevel('speaking', evidence).status, 'insufficient')
    assert.equal(suggestSkillLevel('writing', evidence).status, 'suggested')
  })
})

describe('genel öneri (DOM-BEC-033)', () => {
  const profile = (levels: Record<'reading' | 'listening' | 'writing' | 'speaking', CefrLevel>) =>
    Object.entries(levels).flatMap(([skill, level]) => batch(skill as PrimarySkill, level, 3, 3))

  test('DOM-BEC-033 dört öneri sıralanır, ikinci en düşük genel öneridir', () => {
    const result = suggest(
      profile({ reading: 'B2', listening: 'B1', writing: 'A2', speaking: 'C1' }),
    )
    assert.deepEqual(result.overall, { status: 'suggested', level: 'B1' })
    const equal = suggest(
      profile({ reading: 'B1', listening: 'B1', writing: 'B1', speaking: 'B1' }),
    )
    assert.deepEqual(equal.overall, { status: 'suggested', level: 'B1' })
  })

  test('DOM-BEC-033 tek beceride kanıt yoksa genel öneri yoktur', () => {
    const result = suggest(
      profile({ reading: 'B2', listening: 'B1', writing: 'A2', speaking: 'C1' }).filter(
        (c) => c.skill !== 'speaking',
      ),
    )
    assert.deepEqual(result.overall, { status: 'insufficient', missingSkills: ['speaking'] })
    assert.equal(result.skills.reading.status, 'suggested')
  })

  test('DOM-BEC-033 aracılık ve dil kullanımı genel öneriye girmez', () => {
    assert.deepEqual([...CORE_SKILLS], ['reading', 'listening', 'writing', 'speaking'])
    assert.deepEqual([...SEPARATE_SKILLS], ['mediation', 'language_use'])
    const result = suggest([
      ...profile({ reading: 'A2', listening: 'A2', writing: 'A2', speaking: 'A2' }),
      ...batch('mediation', 'C1', 3, 3),
      ...batch('language_use', 'C1', 3, 3),
    ])
    assert.deepEqual(result.overall, { status: 'suggested', level: 'A2' })
    assert.equal(levelOf(result.skills.mediation), 'C1')
    assert.equal(levelOf(result.skills.language_use), 'C1')
    const noCore = suggest(batch('mediation', 'C1', 3, 3))
    assert.deepEqual(overallSuggestion(noCore.skills), {
      status: 'insufficient',
      missingSkills: ['reading', 'listening', 'writing', 'speaking'],
    })
  })
})

describe('hesap ve karar kopyası (DOM-BEC-030)', () => {
  test('DOM-BEC-030 öneri saftır: aynı girdi aynı sonuç, girdi değişmez', () => {
    const input = [...batch('writing', 'B1', 3, 3), candidate({ kind: 'practice' })]
    const copy = structuredClone(input)
    const first = suggest(input)
    assert.deepEqual(suggest(input), first)
    assert.deepEqual(input, copy)
    assert.equal(first.computedAt, now)
    assert.equal(suggestCefrLevels({ candidates: input, now: new Date(now) }).computedAt, now)
  })

  test('DOM-BEC-030 evidence_snapshot şemaya uyar ve yalnız kullanılan kanıtı taşır', () => {
    const result = suggest([...batch('writing', 'B1', 3, 3), candidate({ kind: 'practice' })])
    const snapshot = evidenceSnapshotOf(result)
    assert.equal(snapshot.schemaVersion, 2)
    assert.equal(snapshot.context, 'general')
    assert.equal(snapshot.evidence.length, 3)
    assert.deepEqual(
      snapshot.skills.find((s) => s.skill === 'writing'),
      {
        skill: 'writing',
        status: 'suggested',
        level: 'B1',
        plus: false,
        missingEvidence: 0,
        evidenceIds: result.skills.writing.evidenceIds,
        demonstratedBy: 'general',
      },
    )
    assert.deepEqual(evidenceSnapshotSchema.parse(structuredClone(snapshot)), snapshot)
  })

  test('DOM-BEC-030 bozuk kopya reddedilir', () => {
    const snapshot = evidenceSnapshotOf(suggest([]))
    // Sürüm 1 hiç kalıcı yazılmadı; okunmaz.
    assert.throws(() => evidenceSnapshotSchema.parse({ ...snapshot, schemaVersion: 1 }), ZodError)
    const { context: _context, ...withoutContext } = snapshot
    assert.throws(() => evidenceSnapshotSchema.parse(withoutContext), ZodError)
    assert.throws(
      () => evidenceSnapshotSchema.parse({ ...snapshot, context: 'bilinmeyen' }),
      ZodError,
    )
    assert.throws(
      () =>
        evidenceSnapshotSchema.parse({
          ...snapshot,
          skills: snapshot.skills.map(({ demonstratedBy: _d, ...rest }) => rest),
        }),
      ZodError,
    )
    assert.throws(
      () =>
        evidenceSnapshotSchema.parse({
          ...snapshot,
          skills: [...snapshot.skills, snapshot.skills[0]],
        }),
      ZodError,
    )
    assert.throws(
      () =>
        evidenceSnapshotSchema.parse({
          ...snapshot,
          overall: { status: 'suggested', level: 'C1+' },
        }),
      ZodError,
    )
  })
})

describe('gösterim (DOM-BEC-034)', () => {
  const decision = (over: Partial<LevelDecisionRow>): LevelDecisionRow => ({
    id: 'test-d1',
    kind: 'placement',
    skill: null,
    level: 'A2',
    rationale: 'Konuşma görüşmesi A2 düzeyinde.',
    decidedByUserId: 'test-u-teacher',
    decidedAt: ago(30),
    evidenceSnapshot: evidenceSnapshotOf(suggest([])),
    ...over,
  })

  test('DOM-BEC-034 öneri "Tahmini seviye" olarak kararlardan ayrı gösterilir', () => {
    const suggestion = suggest(batch('writing', 'B1', 3, 3))
    const view = cefrProfileView({
      institutionType: 'language_school',
      suggestion,
      decisions: [
        decision({ id: 'test-d1', decidedAt: ago(30) }),
        decision({ id: 'test-d2', kind: 'correction', level: 'B1', decidedAt: ago(10) }),
        decision({ id: 'test-d3', skill: 'writing', level: 'A2+', decidedAt: ago(20) }),
      ],
    })
    assert.equal(view.title, 'CEFR profili')
    assert.equal(view.estimate.label, ESTIMATE_LABEL)
    assert.equal(ESTIMATE_LABEL, 'Tahmini seviye')
    assert.equal(levelOf(view.estimate.skills.find((s) => s.skill === 'writing')!.suggestion), 'B1')
    assert.deepEqual(
      view.decisions?.current.map((c) => [c.skill, c.decision.id]),
      [
        [null, 'test-d2'],
        ['writing', 'test-d3'],
      ],
    )
    assert.deepEqual(
      view.decisions?.history.map((d) => d.id),
      ['test-d2', 'test-d3', 'test-d1'],
    )
    assert.equal(view.estimate.evidence.length, 3)
  })

  test('DOM-BEC-034 DOM-BEC-060 okulda "Kurum içi beceri profili", seviye kararı yok', () => {
    const view = cefrProfileView({
      institutionType: 'school',
      suggestion: suggest(batch('reading', 'A2', 3, 3)),
      decisions: [decision({})],
    })
    assert.equal(view.title, 'Kurum içi beceri profili')
    assert.equal(view.decisions, null)
    assert.equal(levelOf(view.estimate.skills.find((s) => s.skill === 'reading')!.suggestion), 'A2')
    assert.deepEqual(
      view.estimate.skills.filter((s) => s.core).map((s) => s.skill),
      ['reading', 'listening', 'writing', 'speaking'],
    )
  })

  test('DOM-BEC-034 aynı anda verilen kararlarda sıra kimlikle sabittir', () => {
    const view = cefrProfileView({
      institutionType: 'language_school',
      suggestion: suggest([]),
      decisions: [
        decision({ id: 'test-a' }),
        decision({ id: 'test-b' }),
        decision({ id: 'test-a' }),
      ],
    })
    assert.deepEqual(
      view.decisions?.history.map((d) => d.id),
      ['test-b', 'test-a', 'test-a'],
    )
  })

  test('DOM-BEC-034 öğrenci ve veli yalnız kendi kapsamını görür, ön büro görmez', () => {
    const student = {
      role: 'ogrenci' as const,
      links: [{ kind: 'student' as const, recordId: 's1' }],
    }
    const parent = { role: 'veli' as const, links: [{ kind: 'child' as const, recordId: 's1' }] }
    assert.equal(canViewCefrProfile(student, 's1'), true)
    assert.equal(canViewCefrProfile(student, 's2'), false)
    assert.equal(canViewCefrProfile(parent, 's1'), true)
    assert.equal(canViewCefrProfile(parent, 's2'), false)
    assert.equal(canViewCefrProfile({ role: 'onburo', links: [] }, 's1'), false)
    assert.equal(canViewCefrProfile({ role: 'ogretmen', links: [] }, 's1'), true)
    assert.equal(canViewCefrProfile({ role: 'yonetici', links: [] }, 's1'), true)
  })
})
