import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKeySchema,
  passageView,
  planResourceRemoval,
  publicationIssues,
  questionBodySchema,
  resourceContentSchema,
  resourceVersionInputSchema,
  searchDocument,
  type AnswerKey,
  type ItemVersionRef,
  type QuestionBody,
  type ResourceVersionInput,
} from '../packages/school-core/src/content/resource.ts'
import { SUBSKILLS, type Subskill } from '../packages/school-core/src/content/taxonomy.ts'
import { scoringItemsFor } from '../packages/school-core/src/skills/assignment.ts'
import {
  scoreAttempt,
  subskillBreakdown,
  type ScoringItem,
} from '../packages/school-core/src/skills/scoring.ts'
import { admin, build, languagePassage, now } from './support/content-fixtures.ts'

/**
 * Okuma-anlama etkinliği (IST-042; DOM-BEC-006, DOM-KYN-002): seviyeli metin, sözlükçe, alt beceri
 * etiketli sorular ve cevaplardan hesaplanan alt beceri dökümü.
 */

const parse = (input: ResourceVersionInput) => resourceVersionInputSchema.parse(input)

const readingQuiz = (passageVersionId: string | null): ResourceVersionInput => ({
  title: 'Istanbul reading',
  content: { type: 'quiz', items: [{ questionVersionId: 'test-q1-v1' }], passageVersionId },
  tags: { cefrLevel: 'B1', primarySkill: 'reading' },
  license: { kind: 'institution_original' },
})

const questionRef: ItemVersionRef = {
  id: 'test-q1-v1',
  status: 'published',
  contentType: 'question',
  tags: parse(languagePassage()).tags,
}

const passageRef = (overrides: Partial<ItemVersionRef> = {}): ItemVersionRef => ({
  id: 'test-p1-v1',
  status: 'published',
  contentType: 'reading_passage',
  tags: parse(languagePassage()).tags,
  ...overrides,
})

const issues = (input: ResourceVersionInput, passageVersion?: ItemVersionRef) =>
  publicationIssues({
    institutionType: 'language_school',
    version: parse(input),
    now,
    itemVersions: new Map([[questionRef.id, questionRef]]),
    passageVersion,
  }).map((issue) => issue.code)

const mc = (id: string, correct: string, subskill: Subskill | null, points = 1): ScoringItem => ({
  questionVersionId: id,
  points,
  locale: 'en',
  subskill,
  question: questionBodySchema.parse({
    questionType: 'multiple_choice',
    stem: `Question ${id}`,
    options: ['a', 'b', 'c', 'd'].map((option) => ({ id: option, text: option.toUpperCase() })),
  }) as QuestionBody,
  answerKey: answerKeySchema.parse({
    questionType: 'multiple_choice',
    correctOptionId: correct,
    explanation: 'Metnin ilk paragrafı.',
  }) as AnswerKey,
})
const pick = (optionId: string) => ({ questionType: 'multiple_choice' as const, optionId })

describe('IST-042 okuma-anlama: içerik', () => {
  test('DOM-BEC-006: alt beceri sözlüğü ana fikir, ayrıntı, çıkarım ve kelime bilgisidir', () => {
    assert.deepEqual(Object.keys(SUBSKILLS), ['main_idea', 'detail', 'inference', 'vocabulary'])
    assert.equal(SUBSKILLS.main_idea.label, 'Ana fikir')
  })

  test('DOM-KYN-002: okuma parçası sözlükçe taşır; örnek isteğe bağlıdır, boş örnek null olur', () => {
    const content = resourceContentSchema.parse({
      type: 'reading_passage',
      body: 'Istanbul is a large city.',
      glossary: [
        { term: ' large ', meaning: 'büyük', example: 'A large house.' },
        { term: 'city', meaning: 'şehir', example: '  ' },
      ],
    })
    assert.ok(content.type === 'reading_passage')
    assert.deepEqual(content.glossary, [
      { term: 'large', meaning: 'büyük', example: 'A large house.' },
      { term: 'city', meaning: 'şehir', example: null },
    ])
    const plain = resourceContentSchema.parse({ type: 'reading_passage', body: 'Metin.' })
    assert.ok(plain.type === 'reading_passage')
    assert.deepEqual(plain.glossary, [], 'eski kayıt sözlükçesiz okunur')
  })

  test('DOM-KYN-002: sözlükçede aynı kelime (büyük/küçük harf duyarsız), boş anlam ve 100 üstü reddedilir', () => {
    const glossary = (entries: unknown[]) =>
      resourceContentSchema.safeParse({
        type: 'reading_passage',
        body: 'Metin.',
        glossary: entries,
      })
    const duplicate = glossary([
      { term: 'City', meaning: 'şehir' },
      { term: 'city ', meaning: 'kent' },
    ])
    assert.equal(duplicate.success, false)
    assert.deepEqual(duplicate.error?.issues[0]?.path, ['glossary'])
    assert.equal(glossary([{ term: 'city', meaning: '' }]).success, false)
    assert.equal(
      glossary(Array.from({ length: 101 }, (_, i) => ({ term: `w${i}`, meaning: 'm' }))).success,
      false,
    )
  })

  test('DOM-BEC-006: alt beceri yalnız soruda etiketlenir', () => {
    const tagged = resourceVersionInputSchema.safeParse(
      languagePassage({ tags: { cefrLevel: 'B1', primarySkill: 'reading', subskill: 'detail' } }),
    )
    assert.equal(tagged.success, false)
    assert.deepEqual(tagged.error?.issues[0]?.path, ['tags', 'subskill'])
    assert.equal(parse(languagePassage()).tags.subskill, null)
  })

  test('IST-042: quiz ve alıştırma seti okuma parçasına bağlanabilir; bağ yoksa null', () => {
    const quiz = parse(readingQuiz('test-p1-v1'))
    assert.ok(quiz.content.type === 'quiz')
    assert.equal(quiz.content.passageVersionId, 'test-p1-v1')
    const bare = resourceContentSchema.parse({
      type: 'exercise_set',
      items: [{ questionVersionId: 'test-q1-v1' }],
    })
    assert.ok(bare.type === 'exercise_set')
    assert.equal(bare.passageVersionId, null)
  })

  test('IST-042: bağlı parça bulunmalı, okuma parçası olmalı ve yayında olmalı', () => {
    assert.deepEqual(issues(readingQuiz('test-p1-v1'), passageRef()), [])
    assert.deepEqual(issues(readingQuiz(null)), [])
    assert.deepEqual(issues(readingQuiz('test-p1-v1')), ['passage_missing'])
    assert.deepEqual(issues(readingQuiz('test-p1-v1'), passageRef({ contentType: 'audio' })), [
      'passage_not_reading',
    ])
    assert.deepEqual(issues(readingQuiz('test-p1-v1'), passageRef({ status: 'draft' })), [
      'passage_not_published',
    ])
  })

  test('DOM-KYN-051: kaldırılan okuma parçasına bağlı quiz etkilenen içerik olarak bildirilir', () => {
    const passage = build(languagePassage(), { id: 'test-p1', version: { status: 'published' } })
    const quiz = parse(readingQuiz(passage.version.id))
    const other = parse(readingQuiz(null))
    const plan = planResourceRemoval({
      actor: admin,
      resource: passage.resource,
      versions: [passage.version],
      containers: [
        { id: 'test-quiz-v1', content: quiz.content },
        { id: 'test-quiz2-v1', content: other.content },
      ],
      reason: 'Telif bildirimi doğrulandı.',
      now,
    })
    assert.deepEqual(plan.affectedContainerVersionIds, ['test-quiz-v1'])
  })

  test('DOM-KYN-002: kursiyerin parça görünümü seviye, hesaplanan kelime sayısı ve sözlükçeyi verir', () => {
    const passage = build(
      languagePassage({
        content: {
          type: 'reading_passage',
          body: "Istanbul is a large city. It's well-known.",
          glossary: [{ term: 'large', meaning: 'büyük' }],
        },
        attributions: [{ work: 'City Notes', author: 'A. Writer', source: 'Kurum' }],
      }),
      { id: 'test-p1' },
    )
    assert.deepEqual(passageView(passage.version), {
      versionId: 'test-p1-v1',
      title: 'A day in Istanbul',
      body: "Istanbul is a large city. It's well-known.",
      wordCount: 7,
      cefrLevel: 'B1',
      glossary: [{ term: 'large', meaning: 'büyük', example: null }],
      attributions: [{ work: 'City Notes', author: 'A. Writer', source: 'Kurum', year: null }],
    })
    const text = build(languagePassage({ content: { type: 'text', body: 'Metin' } }))
    assert.equal(passageView(text.version), null, 'okuma parçası değilse görünüm yok')
  })

  test('DOM-KYN-002: sözlükçe kelimeleri aranır, anlamları da', () => {
    const document = searchDocument(
      parse(
        languagePassage({
          content: {
            type: 'reading_passage',
            body: 'Metin.',
            glossary: [{ term: 'ferry', meaning: 'vapur' }],
          },
        }),
      ),
    )
    assert.match(document, /ferry/)
    assert.match(document, /vapur/)
  })
})

describe('IST-042 okuma-anlama: puan ve alt beceri dökümü', () => {
  const items = [
    mc('q-main', 'a', 'main_idea'),
    mc('q-detail-1', 'b', 'detail'),
    mc('q-detail-2', 'c', 'detail', 3),
    mc('q-inference', 'd', 'inference'),
    mc('q-untagged', 'a', null),
  ]

  test('DOM-BEC-006, DOM-BEC-010: döküm madde puanlarından hesaplanır; sıra sözlük sırasıdır; etiketsiz madde dökülmez', () => {
    const score = scoreAttempt(items, {
      'q-main': pick('a'),
      'q-detail-1': pick('a'),
      'q-detail-2': pick('c'),
      'q-untagged': pick('a'),
    })
    assert.deepEqual(subskillBreakdown(items, score), [
      { subskill: 'main_idea', items: 1, earned: 1, possible: 1, percent: 100 },
      { subskill: 'detail', items: 2, earned: 3, possible: 4, percent: 75 },
      { subskill: 'inference', items: 1, earned: 0, possible: 1, percent: 0 },
    ])
    assert.equal(score.percent, 71, 'toplam puan dökümden bağımsız: 5 / 7')
  })

  test('DOM-BEC-006: cevapsız deneme sıfır döküm verir; hiç etiket yoksa döküm boştur', () => {
    const empty = subskillBreakdown(items, scoreAttempt(items, {}))
    assert.ok(empty.every((row) => row.earned === 0 && row.percent === 0))
    const untagged = [mc('x', 'a', null)]
    assert.deepEqual(subskillBreakdown(untagged, scoreAttempt(untagged, {})), [])
  })

  test('DOM-BEC-006: puanlama maddesi alt beceriyi sorunun etiketinden alır', () => {
    const question = (subskill: Subskill | null) => ({
      id: `q-${subskill ?? 'none'}`,
      tags: { cefrLevel: 'B1' as const, primarySkill: 'reading' as const, skills: [], subskill },
      content: { type: 'question' as const, question: items[0]!.question },
      answerKey: items[0]!.answerKey,
    })
    const refs = new Map(
      [question('inference'), question(null)].map((ref) => [ref.id, ref] as const),
    )
    const scoring = scoringItemsFor({
      parentTags: { cefrLevel: 'B1', primarySkill: 'reading', skills: ['reading'] },
      items: [
        { questionVersionId: 'q-inference', points: 2 },
        { questionVersionId: 'q-none', points: 1 },
      ],
      questions: refs,
    })
    assert.deepEqual(
      scoring.map((item) => item.subskill),
      ['inference', null],
    )
  })
})
