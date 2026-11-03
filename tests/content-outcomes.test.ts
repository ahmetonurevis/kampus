import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canManageLearningOutcomes,
  canReadLearningOutcomes,
  learningOutcomeInputSchema,
  newOutcomeRefs,
  outcomeKey,
  outcomeSelectionIssues,
  SAMPLE_PROGRAM_VERSION,
  samplePlatformOutcomes,
} from '../packages/school-core/src/content/outcomes.ts'
import { NO_COORDINATOR_SCOPE } from '../packages/school-core/src/lib/coordinator-duties.ts'

// Kazanım kataloğu (DOM-KYN-011; ADR 0004 karar 9; IST-030, 031).

describe('kazanım kodu ve kurum kazanımı şeması (DOM-KYN-011)', () => {
  test('kod kırpılır ve büyük harfe çevrilir; ad, ders ve düzey zorunludur', () => {
    const parsed = learningOutcomeInputSchema.parse({
      code: '  oku.7.1 ',
      name: ' Ana fikri bulur ',
      subjectId: 'turkish',
      gradeLevel: 7,
    })
    assert.deepEqual(parsed, {
      code: 'OKU.7.1',
      name: 'Ana fikri bulur',
      subjectId: 'turkish',
      gradeLevel: 7,
    })
  })

  test('geçersiz kod, boş ad, aralık dışı düzey ve bilinmeyen alan reddedilir', () => {
    for (const code of ['', 'MAT 7', '.MAT', 'Ç.7.1', 'A'.repeat(41)]) {
      const result = learningOutcomeInputSchema.safeParse({
        code,
        name: 'Ad',
        subjectId: 'math',
        gradeLevel: 7,
      })
      assert.equal(result.success, false, code)
    }
    assert.equal(
      learningOutcomeInputSchema.safeParse({ code: 'K1', name: ' ', subjectId: 'm', gradeLevel: 7 })
        .success,
      false,
    )
    assert.equal(
      learningOutcomeInputSchema.safeParse({ code: 'K1', name: 'A', subjectId: 'm', gradeLevel: 4 })
        .success,
      false,
    )
    assert.equal(
      learningOutcomeInputSchema.safeParse({
        code: 'K1',
        name: 'A',
        subjectId: 'm',
        gradeLevel: 7,
        institutionId: 'x',
      }).success,
      false,
    )
  })
})

describe('kazanım kataloğu yetkisi (DOM-KYN-011, DOM-YTK-027)', () => {
  const coordinator = { subjectIds: ['math'], cefrLevels: [] }

  test('yönetici her derste, zümre başkanı yalnız kendi dersinde yönetir', () => {
    assert.equal(
      canManageLearningOutcomes({ role: 'yonetici', coordination: NO_COORDINATOR_SCOPE }),
      true,
    )
    assert.equal(
      canManageLearningOutcomes({ role: 'ogretmen', coordination: coordinator }, 'math'),
      true,
    )
    assert.equal(
      canManageLearningOutcomes({ role: 'ogretmen', coordination: coordinator }, 'science'),
      false,
    )
    assert.equal(canManageLearningOutcomes({ role: 'ogretmen', coordination: coordinator }), true)
  })

  test('görevsiz öğretmen, ön büro, öğrenci ve veli yönetemez; okuma içerik personelinindir', () => {
    assert.equal(
      canManageLearningOutcomes({ role: 'ogretmen', coordination: NO_COORDINATOR_SCOPE }),
      false,
    )
    for (const role of ['onburo', 'ogrenci', 'veli'] as const) {
      assert.equal(canManageLearningOutcomes({ role, coordination: coordinator }, 'math'), false)
      assert.equal(canReadLearningOutcomes(role), false)
    }
    assert.equal(canReadLearningOutcomes('yonetici'), true)
    assert.equal(canReadLearningOutcomes('ogretmen'), true)
  })
})

describe('kazanım seçimi (DOM-KYN-011)', () => {
  const active = { archivedAt: null }
  const archived = { archivedAt: '2026-10-01T00:00:00.000Z' }
  const platform = (outcomeId: string) => ({ outcomeSource: 'platform' as const, outcomeId })
  const own = (outcomeId: string) => ({ outcomeSource: 'institution' as const, outcomeId })

  test('katalogdaki etkin kod seçilir; olmayan ve arşivli kod alan yoluyla reddedilir', () => {
    const catalog = new Map([
      [outcomeKey(platform('MAT.7.1.1')), active],
      [outcomeKey(own('OKU.7.1')), archived],
    ])
    const issues = outcomeSelectionIssues({
      outcomes: [platform('MAT.7.1.1'), own('OKU.7.1'), own('MAT.7.1.1')],
      kept: [],
      catalog,
    })
    assert.deepEqual(
      issues.map((issue) => [issue.path.join('.'), issue.code]),
      [
        ['tags.outcomes.1.outcomeId', 'outcome_archived'],
        ['tags.outcomes.2.outcomeId', 'outcome_not_found'],
      ],
    )
  })

  test('sürümde zaten bulunan arşivli ya da serbest girilmiş kod korunur', () => {
    const kept = [own('OKU.7.1'), platform('SERBEST-1')]
    const outcomes = [own('OKU.7.1'), platform('SERBEST-1'), platform('MAT.7.1.1')]
    assert.deepEqual(newOutcomeRefs(outcomes, kept), [platform('MAT.7.1.1')])
    assert.deepEqual(
      outcomeSelectionIssues({
        outcomes,
        kept,
        catalog: new Map([[outcomeKey(platform('MAT.7.1.1')), active]]),
      }),
      [],
    )
  })
})

describe('örnek platform kataloğu', () => {
  const rows = samplePlatformOutcomes()

  test('kodlar tekil, deterministik ve müfredat ders/düzey aralığında', () => {
    assert.equal(new Set(rows.map((row) => row.code)).size, rows.length)
    assert.deepEqual(samplePlatformOutcomes(), rows)
    assert.ok(rows.every((row) => row.programVersion === SAMPLE_PROGRAM_VERSION))
    assert.ok(rows.every((row) => row.gradeLevel >= 5 && row.gradeLevel <= 12))
    const math7 = rows.find((row) => row.code === 'MAT.7.1.1')
    assert.deepEqual(
      math7 && { name: math7.name, subjectId: math7.subjectId, gradeLevel: math7.gradeLevel },
      { name: 'Sayılar ve işlemler', subjectId: 'math', gradeLevel: 7 },
    )
    assert.deepEqual(
      rows.map((row) => row.position),
      rows.map((_, index) => index + 1),
    )
  })
})
