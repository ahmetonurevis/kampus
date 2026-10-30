import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { bandMeaning } from '../packages/school-core/src/skills/rubric.ts'
import type { PrimarySkill } from '../packages/school-core/src/content/taxonomy.ts'
import {
  PLACEMENT_ATTEMPTS_PER_TERM,
  PLACEMENT_AUTO_SECTIONS,
  PLACEMENT_VALIDITY_DAYS,
  placementDecisionInputSchema,
  placementEvidence,
  placementRequired,
  placementSectionResults,
  placementSummary,
  placementValidity,
  planPlacementDecision,
  planPlacementSession,
  type PlacementSessionRow,
  type PlacementSectionRow,
} from '../packages/school-core/src/cefr/placement.ts'
import {
  TARGET_UNDEFINED_LABEL,
  cefrTargetFor,
  planCefrTargets,
} from '../packages/school-core/src/cefr/targets.ts'
import {
  suggestCefrLevels,
  type EvidenceCandidate,
  type EvidenceResult,
} from '../packages/school-core/src/cefr/suggestion.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const now = '2026-11-04T09:00:00.000Z'
const DAY = 24 * 60 * 60_000
const ago = (days: number, ms = 0) => new Date(Date.parse(now) - days * DAY - ms).toISOString()

const auto = (ratio: number, parts = 10): EvidenceResult => ({
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
const rubric = (band: number): EvidenceResult => ({
  mode: 'rubric',
  score: {
    percent: band * 20,
    criteria: ['a', 'b'].map((id) => ({
      criterionId: `test-c-${id}`,
      band,
      weight: 1,
      weighted: band,
      meaning: bandMeaning(band),
    })),
  },
})

const session = (over: Partial<PlacementSessionRow> = {}): PlacementSessionRow => ({
  id: 'test-ps1',
  learnerKind: 'prospect',
  learnerId: 'test-lead1',
  formId: 'test-form-a',
  formVersionId: 'test-form-a-v1',
  mode: 'in_person',
  startedAt: ago(1, 3_600_000),
  completedAt: ago(1),
  ...over,
})
const sections = (over: Partial<Record<string, Partial<PlacementSectionRow>>> = {}) =>
  (
    [
      { section: 'language_use', resultId: 'test-res-lu', targetLevel: 'B1', result: auto(0.8) },
      { section: 'reading', resultId: 'test-res-r', targetLevel: 'B1', result: auto(0.75) },
      { section: 'listening', resultId: 'test-res-l', targetLevel: 'B1', result: auto(0.6) },
      { section: 'writing', resultId: 'test-res-w', targetLevel: 'B1', result: rubric(3) },
      { section: 'speaking', resultId: 'test-res-s', targetLevel: 'B1', result: rubric(4) },
    ] satisfies PlacementSectionRow[]
  ).map((row) => ({ ...row, ...over[row.section] }) as PlacementSectionRow)

const decisionInput = {
  sessionId: 'test-ps1',
  level: 'B1',
  skillLevels: [{ skill: 'speaking', level: 'B1+' }],
  rationale: 'Konuşma görüşmesi akıcı; yazma B1 hedefinde.',
}
const decide = (over: Partial<Parameters<typeof planPlacementDecision>[0]> = {}) =>
  planPlacementDecision({
    institutionType: 'language_school',
    session: session(),
    sections: sections(),
    existingDecisions: [],
    decider: { userId: 'test-u-teacher', role: 'ogretmen' },
    input: decisionInput,
    now,
    ...over,
  })

describe('tespit oturumu (DOM-DIL-010, 012)', () => {
  const open = (termSessions: PlacementSessionRow[], input: object = {}) =>
    planPlacementSession({
      institutionType: 'language_school',
      termSessions,
      input: {
        learnerKind: 'prospect',
        learnerId: 'test-lead1',
        formId: 'test-form-b',
        formVersionId: 'test-form-b-v1',
        mode: 'in_person',
        ...input,
      },
      now,
    })

  test('DOM-DIL-010 aday ve öğrenci için oturum açılır; bitiş anı boştur', () => {
    assert.deepEqual(open([]), {
      learnerKind: 'prospect',
      learnerId: 'test-lead1',
      formId: 'test-form-b',
      formVersionId: 'test-form-b-v1',
      mode: 'in_person',
      startedAt: now,
      completedAt: null,
    })
    assert.equal(open([], { learnerKind: 'student', learnerId: 's1' }).learnerKind, 'student')
    assert.throws(() => open([], { learnerKind: 'guest' }), ZodError)
    assert.throws(() => open([], { mode: 'online' }), ZodError)
  })

  test('DOM-DIL-010 DOM-YTK-012 okulda seviye tespiti bulunmaz', () => {
    assert.throws(
      () => planPlacementSession({ institutionType: 'school', termSessions: [], input: {}, now }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })

  test('DOM-DIL-012 ikinci tespit farklı formla; dönemde en fazla iki, ön tespit de sayılır', () => {
    assert.equal(PLACEMENT_ATTEMPTS_PER_TERM, 2)
    const first = session({ mode: 'remote' })
    assert.equal(open([first]).formId, 'test-form-b')
    assert.throws(
      () => open([first], { formId: 'test-form-a', formVersionId: 'test-form-a-v2' }),
      isDomainError('placement_form_repeated'),
    )
    const second = session({ id: 'test-ps2', formId: 'test-form-b' })
    assert.throws(
      () => open([first, second], { formId: 'test-form-c' }),
      isDomainError('placement_limit_reached', 'conflict'),
    )
  })

  test('DOM-DIL-012 süren oturum varken yenisi açılmaz; başka kişinin oturumu sayılmaz', () => {
    assert.throws(
      () => open([session({ completedAt: null })]),
      isDomainError('placement_in_progress', 'conflict'),
    )
    const others = [
      session({ learnerId: 'test-lead2' }),
      session({ id: 'test-ps2', learnerId: 'test-lead2', formId: 'test-form-b' }),
      session({ id: 'test-ps3', learnerKind: 'student', completedAt: null }),
    ]
    assert.equal(open(others).learnerId, 'test-lead1')
  })
})

describe('geçerlilik ve ön tespit (DOM-DIL-011, 012)', () => {
  test('DOM-DIL-012 sonuç bitiş anından 90 gün geçerli; 90. günün son anı hariç', () => {
    assert.equal(PLACEMENT_VALIDITY_DAYS, 90)
    const completedAt = ago(90)
    const edge = placementValidity(session({ completedAt }), now)
    assert.deepEqual(edge, {
      status: 'expired',
      preliminary: false,
      completedAt,
      validUntil: now,
    })
    const inside = placementValidity(session({ completedAt: ago(90, -1) }), now)
    assert.equal(inside.status, 'valid')
    assert.equal(
      placementValidity(session({ completedAt }), new Date(Date.parse(now) - 1)).status,
      'valid',
    )
    assert.deepEqual(placementValidity(session({ completedAt: null }), now), {
      status: 'in_progress',
      preliminary: false,
    })
  })

  test('DOM-DIL-011 uzaktan tespit ön tespittir; kayıt için kurumda tespit gerekir', () => {
    const remote = session({ mode: 'remote' })
    assert.equal(placementValidity(remote, now).preliminary, true)
    assert.equal(placementRequired([remote], now), true)
    assert.equal(placementRequired([remote, session()], now), false)
    assert.equal(placementRequired([session({ completedAt: ago(90) })], now), true)
    assert.equal(placementRequired([session({ completedAt: null })], now), true)
    assert.equal(placementRequired([], now), true)
  })
})

describe('bölüm sonuçları ve öneri (DOM-DIL-010)', () => {
  test('DOM-DIL-010 beş bölüm sabit sırayla; otomatik ve rubrikli ayrımı', () => {
    const results = placementSectionResults(
      sections({ speaking: { result: null } }).filter((row) => row.section !== 'listening'),
    )
    assert.deepEqual(
      results.map((r) => [r.section, r.label, r.scoring, r.status, r.percent]),
      [
        ['language_use', 'Dil kullanımı', 'auto', 'scored', 80],
        ['reading', 'Okuma', 'auto', 'scored', 75],
        ['listening', 'Dinleme', 'auto', 'missing', null],
        ['writing', 'Yazma', 'rubric', 'scored', 60],
        ['speaking', 'Konuşma', 'rubric', 'pending', null],
      ],
    )
  })

  test('DOM-DIL-010 bölümün puanlama türü uymazsa veya bölüm tekrarlanırsa reddedilir', () => {
    assert.throws(
      () => placementSectionResults(sections({ writing: { result: auto(0.9) } })),
      isDomainError('placement_section_mismatch'),
    )
    assert.throws(
      () => placementSectionResults([...sections(), ...sections().slice(0, 1)]),
      isDomainError('placement_section_duplicate', 'conflict'),
    )
  })

  test('DOM-DIL-010 bölümler bitiş anlı tespit kanıtı olur; bitmemiş oturum kanıt üretmez', () => {
    const candidates = placementEvidence(session(), sections({ listening: { resultId: null } }))
    assert.equal(candidates.length, 5)
    assert.deepEqual(
      { ...candidates[2], result: undefined },
      {
        id: 'test-ps1:listening',
        taskId: 'test-ps1:listening',
        title: 'Seviye tespiti · Dinleme',
        source: 'placement',
        kind: 'evaluation',
        preliminary: false,
        skill: 'listening',
        targetLevel: 'B1',
        performedAt: ago(1),
        appealPending: false,
        result: undefined,
      },
    )
    assert.deepEqual(placementEvidence(session({ completedAt: null }), sections()), [])
  })

  const levelOf = (summary: ReturnType<typeof placementSummary>, skill: PrimarySkill) => {
    const s = summary.suggestion.skills[skill]
    return s.status === 'suggested' ? s.level : null
  }
  const passing = () => sections({ listening: { result: auto(0.8) } })

  test('DOM-DIL-010 tespit eşiği: her tamamlanmış bölüm bir kanıt, farklı gün aranmaz', () => {
    const summary = placementSummary({ session: session(), sections: passing(), now })
    assert.equal(summary.preliminary, false)
    assert.equal(summary.validity.status, 'valid')
    assert.equal(summary.suggestion.context, 'placement')
    assert.equal(summary.suggestion.evidence.length, 5)
    for (const skill of ['language_use', 'reading', 'listening', 'writing', 'speaking'] as const)
      assert.equal(levelOf(summary, skill), 'B1')
    const writing = summary.suggestion.skills.writing
    assert.equal(writing.levels[0]?.demonstratedBy, 'placement')
    assert.equal(writing.levels[0]?.days, 1)
    assert.deepEqual(summary.suggestion.overall, { status: 'suggested', level: 'B1' })
    assert.deepEqual([...PLACEMENT_AUTO_SECTIONS], ['language_use', 'reading', 'listening'])
  })

  test('DOM-DIL-010 başarısız bölüm o beceriyi gösterir saymaz; genel öneri çıkmaz', () => {
    // Dinleme %60: tek bölümde başarı payı 2/3 değil.
    const summary = placementSummary({ session: session(), sections: sections(), now })
    assert.equal(levelOf(summary, 'reading'), 'B1')
    const listening = summary.suggestion.skills.listening
    assert.equal(listening.status, 'insufficient')
    assert.equal(listening.levels[0]?.demonstratedBy, null)
    // Eksik kanıt genel eşiğe göredir; yeni kanıt görevden gelir.
    assert.equal(listening.status === 'insufficient' && listening.missingEvidence, 2)
    assert.deepEqual(summary.suggestion.overall, {
      status: 'insufficient',
      missingSkills: ['listening'],
    })
  })

  test('DOM-DIL-010 otomatik bölüm tamamlanmamışsa genel öneri çıkmaz, beceri önerileri çıkar', () => {
    const cases = [
      passing().filter((row) => row.section !== 'language_use'),
      sections({ listening: { result: auto(0.8) }, language_use: { result: null } }),
      sections({ listening: { result: auto(0.8) }, language_use: { appealPending: true } }),
      sections({ listening: { result: auto(0.8) }, language_use: { targetLevel: null } }),
    ]
    for (const rows of cases) {
      const summary = placementSummary({ session: session(), sections: rows, now })
      assert.deepEqual(summary.suggestion.overall, {
        status: 'insufficient',
        missingSkills: ['language_use'],
      })
      assert.equal(levelOf(summary, 'reading'), 'B1')
      assert.equal(levelOf(summary, 'speaking'), 'B1')
    }
    const noReading = placementSummary({
      session: session(),
      sections: passing().filter((row) => row.section !== 'reading'),
      now,
    })
    assert.deepEqual(noReading.suggestion.overall, {
      status: 'insufficient',
      missingSkills: ['reading'],
    })
  })

  test('DOM-DIL-010 yazma veya konuşma puanlanmamışsa yalnız o becerinin önerisi çıkmaz', () => {
    const summary = placementSummary({
      session: session(),
      sections: sections({ listening: { result: auto(0.8) }, writing: { result: null } }),
      now,
    })
    assert.equal(summary.suggestion.skills.writing.status, 'insufficient')
    for (const skill of ['language_use', 'reading', 'listening', 'speaking'] as const)
      assert.equal(levelOf(summary, skill), 'B1')
    // Genel öneri DOM-BEC-033 gereği dört beceriyi ister.
    assert.deepEqual(summary.suggestion.overall, {
      status: 'insufficient',
      missingSkills: ['writing'],
    })
  })

  test('DOM-DIL-010 DOM-BEC-032 tespitte de okuma ve dinlemede en az 10 madde gerekir', () => {
    const summary = placementSummary({
      session: session(),
      sections: sections({ listening: { result: auto(0.8) }, reading: { result: auto(0.8, 9) } }),
      now,
    })
    const reading = summary.suggestion.skills.reading
    assert.equal(reading.status === 'insufficient' && reading.missingItems, 1)
    assert.equal(levelOf(summary, 'listening'), 'B1')
  })

  test('DOM-DIL-010 tespit eşiği yalnız tespit bağlamında; genel öneri değişmez', () => {
    const candidates = placementEvidence(session(), passing())
    const general = suggestCefrLevels({ candidates, now })
    assert.equal(general.context, 'general')
    assert.equal(general.skills.writing.status, 'insufficient')
    assert.deepEqual(general.overall, {
      status: 'insufficient',
      missingSkills: ['reading', 'listening', 'writing', 'speaking'],
    })
  })

  test('DOM-DIL-010 tespit oturumu kanıtı yalnız tespit kaynaklı olabilir', () => {
    const [first] = placementEvidence(session(), passing())
    assert.throws(
      () =>
        suggestCefrLevels({
          candidates: [{ ...first!, source: 'task' }],
          now,
          context: {
            kind: 'placement',
            sessionTaskIds: [first!.taskId],
            requiredSkills: PLACEMENT_AUTO_SECTIONS,
          },
        }),
      isDomainError('placement_evidence_mismatch', 'conflict'),
    )
  })

  test('DOM-DIL-011 DOM-BEC-031 uzaktan tespitin bölümleri kanıt sayılmaz', () => {
    const summary = placementSummary({
      session: session({ mode: 'remote' }),
      sections: sections(),
      now,
    })
    assert.equal(summary.preliminary, true)
    assert.equal(summary.suggestion.evidence.length, 0)
    assert.deepEqual(
      [...new Set(summary.suggestion.excluded.map((e) => e.reason))],
      ['preliminary'],
    )
    assert.deepEqual(summary.suggestion.overall, {
      status: 'insufficient',
      missingSkills: ['reading', 'listening', 'writing', 'speaking', 'language_use'],
    })
  })

  test('DOM-DIL-010 öğrencide tespit ve görev kanıtı birlikte öneri verir', () => {
    const task = (days: number): EvidenceCandidate => ({
      id: `test-task-${days}`,
      taskId: `test-task-${days}`,
      title: 'Yazma görevi',
      source: 'task',
      kind: 'evaluation',
      preliminary: false,
      skill: 'writing',
      targetLevel: 'B1',
      performedAt: ago(days),
      appealPending: false,
      result: rubric(3),
    })
    const summary = placementSummary({
      session: session({ learnerKind: 'student', learnerId: 's1' }),
      sections: sections(),
      otherEvidence: [task(10), task(20)],
      now,
    })
    const writing = summary.suggestion.skills.writing
    assert.equal(writing.status === 'suggested' && writing.level, 'B1')
    // Üç kanıt, üç gün: genel eşik karşılanır, tespit eşiğine gerek kalmaz.
    assert.equal(writing.levels[0]?.demonstratedBy, 'general')
  })

  test('DOM-DIL-010 başarısız görev kanıtı aynı seviyede tespit yolunu kapatır', () => {
    const failedTask = (days: number): EvidenceCandidate => ({
      id: `test-task-f${days}`,
      taskId: `test-task-f${days}`,
      title: 'Yazma görevi',
      source: 'task',
      kind: 'evaluation',
      preliminary: false,
      skill: 'writing',
      targetLevel: 'B1',
      performedAt: ago(days),
      appealPending: false,
      result: rubric(2),
    })
    const summarize = (otherEvidence: EvidenceCandidate[]) =>
      placementSummary({
        session: session({ learnerKind: 'student', learnerId: 's1' }),
        sections: passing(),
        otherEvidence,
        now,
      })
    // 1 başarılı bölüm + 1 başarısız görev: 1/2 < 2/3.
    assert.equal(summarize([failedTask(10)]).suggestion.skills.writing.status, 'insufficient')
    // Başka seviyedeki görev tespit yolunu etkilemez.
    const other = summarize([{ ...failedTask(10), targetLevel: 'B2' }])
    assert.equal(levelOf(other, 'writing'), 'B1')
  })
})

describe('yerleştirme kararı (DOM-DIL-010, 011, 012)', () => {
  test('DOM-DIL-010 öğretmen gerekçeyle seviye seçer; genel ve beceri kararları kopya taşır', () => {
    const plan = decide()
    assert.equal(plan.decisions.length, 2)
    const [general, speaking] = plan.decisions
    assert.deepEqual(
      { ...general, evidenceSnapshot: undefined },
      {
        kind: 'placement',
        learnerKind: 'prospect',
        learnerId: 'test-lead1',
        placementSessionId: 'test-ps1',
        skill: null,
        level: 'B1',
        rationale: decisionInput.rationale,
        decidedByUserId: 'test-u-teacher',
        decidedAt: now,
        evidenceSnapshot: undefined,
      },
    )
    assert.equal(speaking?.skill, 'speaking')
    assert.equal(speaking?.level, 'B1+')
    assert.equal(general?.evidenceSnapshot, plan.snapshot)
    assert.equal(plan.snapshot.evidence.length, 5)
    // Karar kopyası önerinin bağlamını ve her becerinin gösterim dayanağını taşır.
    assert.equal(plan.snapshot.schemaVersion, 2)
    assert.equal(plan.snapshot.context, 'placement')
    const shown = plan.snapshot.skills.filter((s) => s.status === 'suggested')
    assert.ok(shown.length > 0)
    assert.ok(shown.every((s) => s.demonstratedBy === 'placement'))
    assert.equal(plan.differsFromSuggestion, true)
    const coordinator = decide({ decider: { userId: 'test-u-coord', role: 'yonetici' } })
    assert.equal(coordinator.decisions[0]?.decidedByUserId, 'test-u-coord')
  })

  test('DOM-DIL-010 öneriyle aynı seviye seçilse de gerekçe zorunlu', () => {
    assert.throws(() => decide({ input: { ...decisionInput, rationale: '  ' } }), ZodError)
    assert.throws(
      () =>
        decide({
          input: {
            ...decisionInput,
            skillLevels: [
              { skill: 'reading', level: 'B1' },
              { skill: 'reading', level: 'B2' },
            ],
          },
        }),
      ZodError,
    )
    assert.throws(() => decide({ input: { ...decisionInput, level: 'C1+' } }), ZodError)
    assert.deepEqual(
      placementDecisionInputSchema.parse({ ...decisionInput, skillLevels: undefined }).skillLevels,
      [],
    )
  })

  test('DOM-DIL-010 kararı yalnız öğretmen veya koordinatör verir; okulda tespit yok', () => {
    for (const role of ['onburo', 'ogrenci', 'veli'] as const) {
      assert.throws(
        () => decide({ decider: { userId: 'test-u', role } }),
        isDomainError('permission_denied', 'forbidden'),
      )
    }
    assert.throws(
      () => decide({ institutionType: 'school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
    assert.throws(
      () => decide({ input: { ...decisionInput, sessionId: 'test-ps-other' } }),
      isDomainError('placement_not_found', 'not_found'),
    )
  })

  test('DOM-DIL-011 uzaktan ön tespite dayanarak kesin yerleştirme yapılmaz', () => {
    assert.throws(
      () => decide({ session: session({ mode: 'remote' }) }),
      isDomainError('placement_preliminary'),
    )
  })

  test('DOM-DIL-012 90 günü dolan tespitle karar verilmez; 90. günün son anı geçerli', () => {
    assert.throws(
      () => decide({ session: session({ completedAt: ago(90) }) }),
      isDomainError('placement_expired'),
    )
    assert.equal(decide({ session: session({ completedAt: ago(90, -1) }) }).decisions.length, 2)
  })

  test('DOM-DIL-011 yazma ve konuşma puanlanmadan veya oturum bitmeden karar verilmez', () => {
    assert.throws(
      () => decide({ session: session({ completedAt: null }) }),
      isDomainError('placement_incomplete', 'conflict'),
    )
    assert.throws(
      () => decide({ sections: sections({ speaking: { result: null } }) }),
      isDomainError('placement_production_missing'),
    )
    assert.throws(
      () => decide({ sections: sections().filter((row) => row.section !== 'writing') }),
      isDomainError('placement_production_missing'),
    )
    // Otomatik bölüm eksikliği kararı engellemez.
    assert.equal(
      decide({ sections: sections().filter((row) => row.section !== 'listening') }).decisions
        .length,
      2,
    )
  })

  test('DOM-DIL-010 oturum başına bir karar; ret girdiyi değiştirmez', () => {
    const rows = sections()
    const before = structuredClone(rows)
    assert.throws(
      () => decide({ sections: rows, existingDecisions: [{ placementSessionId: 'test-ps1' }] }),
      isDomainError('placement_already_decided', 'conflict'),
    )
    assert.deepEqual(rows, before)
    assert.equal(
      decide({ existingDecisions: [{ placementSessionId: 'test-ps-old' }] }).decisions.length,
      2,
    )
  })

  test('DOM-DIL-010 adayda tespit önerisi kopyaya girer; aynı seviye fark bayrağını düşürür', () => {
    const plan = decide({ sections: sections({ listening: { result: auto(0.8) } }) })
    assert.deepEqual(plan.snapshot.overall, { status: 'suggested', level: 'B1' })
    assert.equal(plan.snapshot.skills.find((s) => s.skill === 'writing')?.level, 'B1')
    assert.equal(plan.differsFromSuggestion, false)
  })

  test('DOM-DIL-010 öneri ile aynı seviye seçilince fark bayrağı düşer', () => {
    const task = (skill: 'reading' | 'listening' | 'writing' | 'speaking', days: number) =>
      ({
        id: `test-${skill}-${days}`,
        taskId: `test-${skill}-${days}`,
        title: 'Görev',
        source: 'task',
        kind: 'evaluation',
        preliminary: false,
        skill,
        targetLevel: 'B1',
        performedAt: ago(days),
        appealPending: false,
        result: skill === 'writing' || skill === 'speaking' ? rubric(4) : auto(0.9),
      }) satisfies EvidenceCandidate
    const otherEvidence = (['reading', 'listening', 'writing', 'speaking'] as const).flatMap(
      (skill) => [task(skill, 10), task(skill, 20)],
    )
    const plan = decide({
      session: session({ learnerKind: 'student', learnerId: 's1' }),
      otherEvidence,
    })
    assert.deepEqual(plan.snapshot.overall, { status: 'suggested', level: 'B1' })
    assert.equal(plan.differsFromSuggestion, false)
  })
})

describe('sınıf düzeyi CEFR hedefi (DOM-BEC-063)', () => {
  const plan = (over: Partial<Parameters<typeof planCefrTargets>[0]> = {}) =>
    planCefrTargets({
      institutionType: 'school',
      currentAcademicYear: 2026,
      existing: [],
      userId: 'test-u-head',
      input: {
        academicYear: 2026,
        targets: [
          { gradeLevel: 8, level: 'A2+' },
          { gradeLevel: 5, level: 'A1' },
        ],
      },
      now,
      ...over,
    })

  test('DOM-BEC-063 zümre güncel yıl için hedef girer; kayıt anında kilitlenir', () => {
    assert.deepEqual(plan(), {
      academicYear: 2026,
      targets: [
        { gradeLevel: 5, level: 'A1' },
        { gradeLevel: 8, level: 'A2+' },
      ],
      lockedAt: now,
      lockedByUserId: 'test-u-head',
    })
  })

  test('DOM-BEC-063 o yılın eşlemesi kilitlidir; ikinci kayıt reddedilir', () => {
    assert.throws(
      () => plan({ existing: [{ academicYear: 2026 }] }),
      isDomainError('cefr_targets_locked', 'conflict'),
    )
    assert.equal(plan({ existing: [{ academicYear: 2025 }] }).academicYear, 2026)
  })

  test('DOM-BEC-063 geçmiş veya gelecek yıl, tekrar eden ya da aralık dışı düzey reddedilir', () => {
    assert.throws(
      () => plan({ input: { academicYear: 2027, targets: [{ gradeLevel: 5, level: 'A1' }] } }),
      isDomainError('cefr_targets_year_invalid'),
    )
    const targets = (list: object[]) => plan({ input: { academicYear: 2026, targets: list } })
    assert.throws(
      () =>
        targets([
          { gradeLevel: 5, level: 'A1' },
          { gradeLevel: 5, level: 'A2' },
        ]),
      ZodError,
    )
    assert.throws(() => targets([{ gradeLevel: 4, level: 'A1' }]), ZodError)
    assert.throws(() => targets([{ gradeLevel: 13, level: 'A1' }]), ZodError)
    assert.throws(() => targets([]), ZodError)
    assert.throws(() => targets([{ gradeLevel: 6, level: 'C1+' }]), ZodError)
  })

  test('DOM-BEC-063 DOM-YTK-012 dil okulunda düzey hedefi yoktur', () => {
    assert.throws(
      () => plan({ institutionType: 'language_school' }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
  })

  test('DOM-BEC-063 eşleme yoksa "hedef tanımlı değil"; varsayılan eşleme yok', () => {
    const records = [{ ...plan(), id: 'test-ct1' }]
    assert.deepEqual(cefrTargetFor(records, 2026, 8), { status: 'defined', level: 'A2+' })
    assert.deepEqual(cefrTargetFor(records, 2026, 7), {
      status: 'undefined',
      label: TARGET_UNDEFINED_LABEL,
    })
    assert.deepEqual(cefrTargetFor(records, 2025, 8), {
      status: 'undefined',
      label: 'Hedef tanımlı değil',
    })
    assert.deepEqual(cefrTargetFor([], 2026, 5).status, 'undefined')
  })
})
