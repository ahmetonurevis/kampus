import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { NotFoundError, RuleViolationError } from '../src/errors.ts'
import { attemptScoring } from '../src/services/task-attempts.ts'

/**
 * Kaldırılmış içerikte deneme puanlama bağlamı (DOM-KYN-051, DOM-BEC-010; OG-997). Yalnız
 * kaldırmanın beklenen sonucu olan hatalar (okunamayan sürüm, silinmiş anahtar) yutulur ve bağlam
 * `null` döner; kaldırmayla açıklanamayan hata (otomatik puanlanmayan tür) ya da kaldırılmamış
 * içerikteki hata veri bütünlüğü sinyalidir ve fırlar (API'de 404/422/500).
 */

const TAGS = { cefrLevel: 'A2', primarySkill: 'reading', skills: ['reading'], subskill: null }
const QUESTION = {
  type: 'question',
  question: {
    questionType: 'multiple_choice',
    stem: 'Q?',
    options: [
      { id: 'a', text: 'A' },
      { id: 'b', text: 'B' },
    ],
  },
}
const KEY = { questionType: 'multiple_choice', correctOptionId: 'a', explanation: 'x' }

type Overrides = { status?: string; content?: unknown; answerKey?: unknown }
const pair = (id: string, over: Overrides = {}) => ({
  resource: { id: `r-${id}` },
  version: {
    id,
    status: 'published',
    content: QUESTION,
    answerKey: KEY,
    tags: TAGS,
    license: { kind: 'institution_original' },
    ...over,
  },
})
const quiz = (id: string, questionId: string, over: Overrides = {}) =>
  pair(id, {
    content: { type: 'quiz', items: [{ questionVersionId: questionId, points: 1 }] },
    answerKey: null,
    ...over,
  })

const run = (pairs: ReturnType<typeof pair>[], pinned: string, scoring = pinned) =>
  attemptScoring(
    { resourceVersionId: pinned, scoringVersionId: scoring } as never,
    new Map(pairs.map((item) => [item.version.id, item])) as never,
  )

describe('attemptScoring', () => {
  test('DOM-KYN-051: kaldırılmamış içerik bağlamı kurar; removed false', () => {
    const result = run([quiz('q', 's'), pair('s')], 'q')
    assert.equal(result.removed, false)
    assert.equal(result.context?.items.length, 1)
  })

  test('DOM-KYN-051, DOM-BEC-010: kaldırılan quiz (içerik silindi) bağlamsız döner, hata fırlamaz', () => {
    const removed = quiz('q', 's', { status: 'removed', content: null })
    assert.deepEqual(run([removed, pair('s')], 'q'), { context: null, removed: true })
  })

  test('DOM-KYN-051: kaldırılan bağlı soru (okunamaz) bağlamsız döner', () => {
    const removed = pair('s', { status: 'removed', content: null, answerKey: null })
    assert.deepEqual(run([quiz('q', 's'), removed], 'q'), { context: null, removed: true })
  })

  test('DOM-KYN-051: anahtarı silinmiş soru (answer_key_missing) kaldırma sayılır, bağlamsız döner', () => {
    const keyless = pair('s', { status: 'removed', answerKey: null })
    assert.deepEqual(run([quiz('q', 's'), keyless], 'q'), { context: null, removed: true })
  })

  test('DOM-KYN-051: kaldırılmamış içerikte okunamayan soru NotFoundError olarak fırlar', () => {
    assert.throws(() => run([quiz('q', 's')], 'q'), NotFoundError)
  })

  test('DOM-KYN-051: kaldırılmamış içerikte anahtarsız soru RuleViolationError olarak fırlar', () => {
    assert.throws(
      () => run([quiz('q', 's'), pair('s', { answerKey: null })], 'q'),
      (error) => error instanceof RuleViolationError && error.code === 'answer_key_missing',
    )
  })

  test('DOM-KYN-051: kaldırma bulunsa da açıklanamayan hata yutulmaz (otomatik puanlanmayan tür not_auto_scored fırlar)', () => {
    const passage = pair('p', {
      content: { type: 'reading_passage', body: 'Text', glossary: [] },
      answerKey: null,
    })
    const removedPinned = pair('x', { status: 'removed', content: null })
    assert.throws(
      () => run([removedPinned, passage], 'x', 'p'),
      (error) => error instanceof RuleViolationError && error.code === 'not_auto_scored',
    )
  })
})
