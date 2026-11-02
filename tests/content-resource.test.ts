import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  answerKeySchema,
  assertPublishable,
  canReview,
  contentFileRefs,
  learnerView,
  normalizeSearchText,
  planDraftUpdate,
  planNewResource,
  planNewVersion,
  planResourceRemoval,
  planVersionTransition,
  RESOURCE_ACTIONS,
  publicationIssues,
  requiresReview,
  resourceContentSchema,
  resourceLicenseSchema,
  resourceTagsSchema,
  resourceVersionInputSchema,
  searchDocument,
  searchQueryTerms,
  seededRandom,
  wordCount,
  type ItemVersionRef,
  type QuestionBody,
  type ResourceAction,
  type ResourceVersion,
  type ResourceVersionInput,
} from '../packages/school-core/src/content/resource.ts'
import {
  admin,
  author,
  build,
  colleague,
  coordinator,
  frontDesk,
  head,
  languagePassage,
  multipleChoice,
  now,
  outsider,
  schoolText,
  student,
} from './support/content-fixtures.ts'
import type { PrimarySkill } from '../packages/school-core/src/content/taxonomy.ts'
import { isDomainError } from './support/domain-error.ts'

const parse = (input: ResourceVersionInput) => resourceVersionInputSchema.parse(input)
const issuesOf = (
  input: ResourceVersionInput,
  institutionType: 'school' | 'language_school' = 'school',
  at: string = now,
) => publicationIssues({ institutionType, version: parse(input), now: at }).map((i) => i.code)

describe('İçerik şemaları', () => {
  test('her içerik türü kendi zorunlu alanlarıyla ayrıştırılır', () => {
    const samples = [
      { type: 'text', body: 'Metin' },
      { type: 'worksheet', fileId: 'test-f1' },
      { type: 'reading_passage', body: 'Parça' },
      { type: 'audio', fileId: 'test-f2', transcript: 'Döküm' },
      {
        type: 'video',
        fileId: 'test-f3',
        captionsVtt: 'WEBVTT\n\n00:00.000 --> 00:01.000\nMerhaba',
      },
      { type: 'file', fileId: 'test-f4' },
      { type: 'link', url: 'https://example.org/video' },
      {
        type: 'book_reference',
        publisher: 'Örnek Yayınları',
        bookTitle: 'English 7',
        pages: '12-14',
      },
      { type: 'quiz', items: [{ questionVersionId: 'test-q1-v1' }] },
      { type: 'exercise_set', items: [{ questionVersionId: 'test-q1-v1', points: 2 }] },
      {
        type: 'homework_template',
        instructions: 'Paragraf yazın.',
        submissionKinds: ['text', 'text'],
        rubricId: 'test-rb1',
      },
    ]
    for (const sample of samples) {
      const parsed = resourceContentSchema.safeParse(sample)
      assert.equal(parsed.success, true, `${sample.type}: ${JSON.stringify(parsed.error?.issues)}`)
    }
    const homework = resourceContentSchema.parse(samples.at(-1))
    assert.ok(homework.type === 'homework_template')
    assert.deepEqual(homework.submissionKinds, ['text'], 'teslim türü tekilleşir')
  })

  test('eksik veya hatalı içerik reddedilir', () => {
    const bad = [
      { type: 'text' },
      { type: 'link', url: 'http://example.org' },
      { type: 'link', url: 'javascript:alert(1)' },
      { type: 'video', fileId: 'test-f3', captionsVtt: '00:00 Merhaba' },
      { type: 'book_reference', publisher: 'Örnek', bookTitle: 'Kitap', pages: '1', isbn: 'abc' },
      { type: 'quiz', items: [] },
      { type: 'quiz', items: [{ questionVersionId: 'q' }, { questionVersionId: 'q' }] },
      { type: 'homework_template', instructions: 'Yazın.', submissionKinds: ['file'] },
      { type: 'homework_template', instructions: 'Yazın.', submissionKinds: [], criteria: 'x' },
      { type: 'unknown' },
    ]
    for (const sample of bad) {
      assert.equal(resourceContentSchema.safeParse(sample).success, false, JSON.stringify(sample))
    }
  })

  test('IST-033 soru türleri ayrıştırılır ve kurallara uymayan soru reddedilir', () => {
    const question = (body: object) =>
      resourceContentSchema.safeParse({ type: 'question', question: body }).success
    const options = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `o${i}`, text: `S${i}` }))
    assert.equal(
      question({ questionType: 'multiple_choice', stem: 'Soru', options: options(4) }),
      true,
    )
    assert.equal(
      question({ questionType: 'multiple_choice', stem: 'Soru', options: options(3) }),
      false,
      'en az üç çeldirici',
    )
    assert.equal(
      question({
        questionType: 'multiple_choice',
        stem: 'Soru',
        options: [...options(3), { id: 'o0', text: 'Aynı' }],
      }),
      false,
      'kimlik tekil',
    )
    assert.equal(question({ questionType: 'true_false', stem: 'Doğru mu?' }), true)
    assert.equal(
      question({
        questionType: 'matching',
        stem: 'Eşle',
        prompts: options(2),
        choices: options(2),
      }),
      false,
      'öncül ve eşleşme kimlikleri çakışamaz',
    )
    assert.equal(
      question({
        questionType: 'matching',
        stem: 'Eşle',
        prompts: options(2),
        choices: [
          { id: 'x', text: 'X' },
          { id: 'y', text: 'Y' },
        ],
      }),
      true,
    )
    assert.equal(
      question({
        questionType: 'gap_fill',
        stem: 'I {{g1}} a {{g2}}.',
        gaps: [{ id: 'g1' }, { id: 'g2' }],
      }),
      true,
    )
    assert.equal(
      question({ questionType: 'gap_fill', stem: 'I {{g1}}.', gaps: [{ id: 'g1' }, { id: 'g2' }] }),
      false,
      'işaret ve boşluk eşleşmeli',
    )
    assert.equal(
      question({ questionType: 'gap_fill', stem: '{{g1}} {{g1}}', gaps: [{ id: 'g1' }] }),
      false,
      'boşluk bir kez kullanılır',
    )
    assert.equal(question({ questionType: 'ordering', stem: 'Sırala', items: options(3) }), true)
    assert.equal(question({ questionType: 'ordering', stem: 'Sırala', items: options(1) }), false)
    assert.equal(question({ questionType: 'short_answer', stem: 'Başkent?' }), true)
    assert.equal(question({ questionType: 'essay', stem: 'Yaz' }), false)
  })

  test('cevap anahtarı içerikten ayrıdır ve soruyla uyuşmalıdır', () => {
    const valid = parse(multipleChoice())
    assert.equal(valid.answerKey?.questionType, 'multiple_choice')
    assert.equal('correctOptionId' in valid.content, false)

    const keyed = (content: object, answerKey: object) =>
      resourceVersionInputSchema.safeParse({ ...multipleChoice(), content, answerKey }).success
    const mc = multipleChoice().content
    const explanation = 'Açıklama'
    assert.equal(
      keyed(mc, { questionType: 'multiple_choice', correctOptionId: 'z', explanation }),
      false,
      'doğru seçenek soruda olmalı',
    )
    assert.equal(keyed(mc, { questionType: 'true_false', answer: 'true', explanation }), false)
    const tf = { type: 'question', question: { questionType: 'true_false', stem: 'Doğru mu?' } }
    assert.equal(keyed(tf, { questionType: 'true_false', answer: 'not_given', explanation }), false)
    assert.equal(keyed(tf, { questionType: 'true_false', answer: 'false', explanation }), true)
    const matching = {
      type: 'question',
      question: {
        questionType: 'matching',
        stem: 'Eşle',
        prompts: [
          { id: 'p1', text: 'cat' },
          { id: 'p2', text: 'dog' },
        ],
        choices: [
          { id: 'c1', text: 'kedi' },
          { id: 'c2', text: 'köpek' },
        ],
      },
    }
    assert.equal(
      keyed(matching, {
        questionType: 'matching',
        pairs: [{ promptId: 'p1', choiceId: 'c1' }],
        explanation,
      }),
      false,
      'her öncül eşlenmeli',
    )
    assert.equal(
      keyed(matching, {
        questionType: 'matching',
        pairs: [
          { promptId: 'p1', choiceId: 'c1' },
          { promptId: 'p2', choiceId: 'c2' },
        ],
        explanation,
      }),
      true,
    )
    const gap = {
      type: 'question',
      question: {
        questionType: 'gap_fill',
        stem: 'She {{g1}} tea.',
        gaps: [{ id: 'g1', options: ['drinks', 'drink'] }],
      },
    }
    assert.equal(
      keyed(gap, {
        questionType: 'gap_fill',
        gaps: [{ gapId: 'g1', accepted: ['drank'] }],
        explanation,
      }),
      false,
      'kapalı listeden',
    )
    assert.equal(
      keyed(gap, {
        questionType: 'gap_fill',
        gaps: [{ gapId: 'g9', accepted: ['drinks'] }],
        explanation,
      }),
      false,
    )
    assert.equal(
      keyed(gap, {
        questionType: 'gap_fill',
        gaps: [{ gapId: 'g1', accepted: ['drinks'] }],
        explanation,
      }),
      true,
    )
    const order = {
      type: 'question',
      question: {
        questionType: 'ordering',
        stem: 'Sırala',
        items: [
          { id: 'i1', text: 'bir' },
          { id: 'i2', text: 'iki' },
        ],
      },
    }
    assert.equal(
      keyed(order, { questionType: 'ordering', order: ['i1', 'i1'], explanation }),
      false,
    )
    assert.equal(keyed(order, { questionType: 'ordering', order: ['i2', 'i1'], explanation }), true)
    const short = {
      type: 'question',
      question: { questionType: 'short_answer', stem: 'Başkent?', maxLength: 6 },
    }
    assert.equal(
      keyed(short, { questionType: 'short_answer', accepted: ['Ankara'], explanation }),
      true,
    )
    assert.equal(
      keyed(short, { questionType: 'short_answer', accepted: ['Ankara şehri'], explanation }),
      false,
    )
    assert.equal(
      keyed(
        { type: 'text', body: 'Metin' },
        { questionType: 'short_answer', accepted: ['a'], explanation },
      ),
      false,
      'soru olmayan içerik anahtar taşımaz',
    )
    assert.equal(
      answerKeySchema.safeParse({ questionType: 'multiple_choice', correctOptionId: 'a' }).success,
      false,
      'çözüm açıklaması zorunlu',
    )
  })

  test('etiketler normalleşir ve beceri kuralları uygulanır', () => {
    const tags = resourceTagsSchema.parse({
      gradeLevels: [8, 7, 8],
      primarySkill: 'reading',
      skills: ['vocabulary', 'reading'],
      outcomes: [
        { outcomeId: 'o1', outcomeSource: 'platform' },
        { outcomeId: 'o1', outcomeSource: 'platform' },
        { outcomeId: 'o1', outcomeSource: 'institution' },
      ],
    })
    assert.deepEqual(tags.gradeLevels, [7, 8])
    assert.deepEqual(tags.skills, ['reading', 'vocabulary'], 'birincil beceri listenin başında')
    assert.equal(tags.outcomes.length, 2, 'kaynakları farklı aynı kimlik iki ayrı kazanımdır')

    assert.equal(resourceTagsSchema.safeParse({ primarySkill: 'mediation' }).success, false)
    assert.equal(
      resourceTagsSchema.safeParse({
        primarySkill: 'mediation',
        mediation: { sourceSkill: 'reading', targetSkill: 'speaking' },
      }).success,
      true,
    )
    assert.equal(
      resourceTagsSchema.safeParse({
        primarySkill: 'reading',
        mediation: { sourceSkill: 'reading', targetSkill: 'speaking' },
      }).success,
      false,
    )
    assert.equal(resourceTagsSchema.safeParse({ interactionChannel: 'spoken' }).success, false)
    assert.equal(
      resourceTagsSchema.safeParse({ activityMode: 'interaction', interactionChannel: 'online' })
        .success,
      true,
    )
    assert.equal(resourceTagsSchema.safeParse({ gradeLevels: [4] }).success, false)
    assert.equal(resourceTagsSchema.safeParse({ cefrLevel: 'C1+' }).success, false)
    assert.equal(resourceTagsSchema.safeParse({ primarySkill: 'grammar' }).success, false)
  })

  test('lisans şeması ticari olmayan açık lisansı ve eksik sözleşmeyi reddeder', () => {
    assert.equal(
      resourceLicenseSchema.safeParse({ kind: 'open_license', license: 'CC-BY-4.0' }).success,
      true,
    )
    assert.equal(
      resourceLicenseSchema.safeParse({ kind: 'open_license', license: 'CC-BY-NC-4.0' }).success,
      false,
    )
    assert.equal(resourceLicenseSchema.safeParse({ kind: 'public_domain' }).success, false)
    assert.equal(
      resourceLicenseSchema.safeParse({ kind: 'licensed_publication', publisher: 'Yayınevi' })
        .success,
      false,
    )
    const licensed = resourceLicenseSchema.parse({
      kind: 'licensed_publication',
      publisher: 'Örnek Yayınları',
      contractNumber: 'S-1',
      coverage: 'Kurumun 7. sınıfları',
      expiryDate: '2027-06-30',
    })
    assert.ok(licensed.kind === 'licensed_publication')
    assert.equal(licensed.allowsAdaptation, false, 'uyarlama izni varsayılan kapalı')
    assert.equal(
      resourceLicenseSchema.safeParse({ ...licensed, expiryDate: '2027-02-30' }).success,
      false,
    )
  })
})

describe('Yayım denetimi', () => {
  test('etiketleri ve lisansı tam kurum özgün içerik yayımlanabilir', () => {
    assert.deepEqual(issuesOf(schoolText()), [])
    assert.deepEqual(issuesOf(languagePassage(), 'language_school'), [])
    assert.deepEqual(issuesOf(multipleChoice()), [])
    assert.deepEqual(issuesOf(multipleChoice(), 'language_school'), [])
  })

  test('DOM-KYN-010: okulda ders, düzey ve kazanım; dil okulunda CEFR ve beceri zorunlu', () => {
    assert.deepEqual(issuesOf(schoolText({ tags: {} })), [
      'subject_required',
      'grade_required',
      'outcome_required',
    ])
    assert.deepEqual(issuesOf(schoolText({ tags: {} }), 'language_school'), [
      'cefr_required',
      'skill_required',
    ])
    assert.deepEqual(
      issuesOf(
        schoolText({
          tags: {
            subjectId: 'math',
            gradeLevels: [7],
            outcomes: [{ outcomeId: 'o', outcomeSource: 'platform' }],
            cefrLevel: 'B1',
          },
        }),
      ),
      ['cefr_requires_english', 'skill_required'],
    )
  })

  test('DOM-KYN-012, DOM-BEC-001: dil kullanımı yalnız soru, quiz ve alıştırma setinde birincil beceridir', () => {
    const tagged = (content: ResourceVersionInput['content'], primarySkill: PrimarySkill) =>
      languagePassage({ content, tags: { cefrLevel: 'B1', primarySkill } })
    const text = { type: 'text' as const, body: 'Grammar notes.' }
    const audio = { type: 'audio' as const, fileId: 'f', transcript: 'Döküm' }
    const homework = {
      type: 'homework_template' as const,
      instructions: 'Write an email.',
      submissionKinds: ['text' as const],
      criteria: 'Görev, tutarlılık.',
    }
    for (const content of [
      { type: 'reading_passage' as const, body: 'Text.' },
      audio,
      { type: 'video' as const, fileId: 'f', transcript: 'Döküm' },
      text,
      homework,
    ]) {
      assert.deepEqual(
        issuesOf(tagged(content, 'language_use'), 'language_school'),
        ['language_use_primary_not_allowed'],
        content.type,
      )
    }
    // Soru (fikstür birincil beceri dil kullanımı), iki kurum türünde de geçerlidir.
    assert.deepEqual(issuesOf(multipleChoice(), 'language_school'), [])
    assert.deepEqual(issuesOf(multipleChoice()), [])

    // Okuma parçası, ses ve video dört temel beceriden birini ister; aracılık da yetmez.
    const mediated = languagePassage({
      content: audio,
      tags: {
        cefrLevel: 'B1',
        primarySkill: 'mediation',
        mediation: { sourceSkill: 'listening', targetSkill: 'speaking' },
      },
    })
    assert.deepEqual(issuesOf(mediated, 'language_school'), ['core_skill_required'])
    assert.deepEqual(issuesOf(tagged(audio, 'listening'), 'language_school'), [])
    // Aracılık görevi (ödev şablonu) aracılığı birincil beceri olarak taşıyabilir.
    assert.deepEqual(
      issuesOf(
        languagePassage({
          content: homework,
          tags: {
            cefrLevel: 'B1',
            primarySkill: 'mediation',
            mediation: { sourceSkill: 'reading', targetSkill: 'writing' },
          },
        }),
        'language_school',
      ),
      [],
    )
    assert.deepEqual(issuesOf(tagged(homework, 'writing'), 'language_school'), [])
  })

  test('DOM-KYN-020, 024: lisans ve gereken kaynak gösterimi olmadan yayın yok', () => {
    assert.deepEqual(issuesOf(schoolText({ license: null })), ['license_required'])
    assert.deepEqual(issuesOf(schoolText({ license: { kind: 'contains_quotation' } })), [
      'attribution_required',
    ])
    assert.deepEqual(
      issuesOf(
        schoolText({
          license: { kind: 'contains_quotation' },
          attributions: [{ work: 'Nutuk', author: 'Mustafa Kemal Atatürk', source: 's. 12' }],
        }),
      ),
      [],
    )
    assert.deepEqual(
      issuesOf(schoolText({ license: { kind: 'open_license', license: 'CC-BY-4.0' } })),
      ['attribution_required'],
    )
  })

  test('DOM-KYN-021: lisans bitiş günü İstanbul saatine göre dahildir', () => {
    const licensed = (expiryDate: string) =>
      schoolText({
        license: {
          kind: 'licensed_publication',
          publisher: 'Örnek Yayınları',
          contractNumber: 'S-1',
          coverage: 'Kurum',
          expiryDate,
        },
        attributions: [{ work: 'Matematik 7', author: 'Örnek Yayınları', source: 's. 40' }],
      })
    assert.deepEqual(issuesOf(licensed('2026-10-06')), [])
    assert.deepEqual(issuesOf(licensed('2026-10-05')), ['license_expired'])
    assert.deepEqual(
      issuesOf(licensed('2026-10-05'), 'school', '2026-10-05T22:30:00.000Z'),
      ['license_expired'],
      "UTC 5 Ekim 22.30 İstanbul'da 6 Ekim",
    )
  })

  test('IST-036: yayınevi içeriği yüklenmez, yalnız referans veya bağlantı olur', () => {
    const link = schoolText({ content: { type: 'link', url: 'https://example.org/v' } })
    assert.deepEqual(issuesOf(link), ['external_reference_required'])
    assert.deepEqual(issuesOf({ ...link, license: { kind: 'external_reference' } }), [])
    const book = schoolText({
      content: { type: 'book_reference', publisher: 'Örnek', bookTitle: 'Kitap', pages: '1-2' },
      license: { kind: 'external_reference' },
    })
    assert.deepEqual(issuesOf(book), [])
    assert.deepEqual(issuesOf(schoolText({ license: { kind: 'external_reference' } })), [
      'external_content_not_hosted',
    ])
  })

  test('DOM-KYN-003: ses ve video döküm veya altyazı olmadan yayımlanmaz', () => {
    const audio = schoolText({ content: { type: 'audio', fileId: 'test-f1' } })
    assert.deepEqual(issuesOf(audio), ['transcript_required'])
    assert.deepEqual(
      issuesOf({ ...audio, content: { type: 'audio', fileId: 'test-f1', transcript: 'Döküm' } }),
      [],
    )
    assert.deepEqual(
      issuesOf(
        schoolText({
          content: { type: 'video', fileId: 'test-f1', captionsVtt: 'WEBVTT\n\nMerhaba' },
        }),
      ),
      [],
    )
  })

  test('okuma ve dinleme parçası tek düzeye bağlanır', () => {
    const passage = schoolText({
      content: { type: 'reading_passage', body: 'Parça' },
      tags: {
        subjectId: 'turkish',
        gradeLevels: [7, 8],
        outcomes: [{ outcomeId: 'o', outcomeSource: 'platform' }],
      },
    })
    assert.deepEqual(issuesOf(passage), ['single_level_required'])
    const listening = multipleChoice({
      content: { type: 'audio', fileId: 'test-f1', transcript: 'Döküm' },
      answerKey: null,
      tags: {
        subjectId: 'english',
        gradeLevels: [7, 8],
        cefrLevel: 'A2',
        primarySkill: 'listening',
        outcomes: [{ outcomeId: 'o', outcomeSource: 'platform' }],
      },
    })
    assert.deepEqual(issuesOf(listening), ['single_level_required'])
  })

  test('DOM-KYN-013: soru anahtarsız ve etiketsiz yayımlanmaz', () => {
    assert.deepEqual(issuesOf(multipleChoice({ answerKey: null })), ['answer_key_required'])
    assert.deepEqual(issuesOf(multipleChoice({ tags: {} }), 'language_school'), [
      'cefr_required',
      'skill_required',
      'question_untagged',
    ])
  })

  test('DOM-KYN-013: quiz yalnız yayındaki etiketli soruları içerir', () => {
    const quiz = parse(
      schoolText({
        content: {
          type: 'quiz',
          items: [
            { questionVersionId: 'test-ok' },
            { questionVersionId: 'test-missing' },
            { questionVersionId: 'test-text' },
            { questionVersionId: 'test-draft' },
            { questionVersionId: 'test-untagged' },
          ],
        },
      }),
    )
    const tags = parse(multipleChoice()).tags
    const ref = (id: string, patch: Partial<ItemVersionRef> = {}): [string, ItemVersionRef] => [
      id,
      { id, status: 'published', tags, contentType: 'question', ...patch },
    ]
    const itemVersions = new Map([
      ref('test-ok'),
      ref('test-text', { contentType: 'text' }),
      ref('test-draft', { status: 'draft' }),
      ref('test-untagged', { tags: resourceTagsSchema.parse({}) }),
    ])
    const issues = publicationIssues({
      institutionType: 'school',
      version: quiz,
      now,
      itemVersions,
    })
    assert.deepEqual(
      issues.map((i) => [i.code, i.path.join('.')]),
      [
        ['quiz_item_missing', 'content.items.1'],
        ['quiz_item_not_question', 'content.items.2'],
        ['quiz_item_not_published', 'content.items.3'],
        ['quiz_item_untagged', 'content.items.4'],
      ],
    )
    assert.equal(
      publicationIssues({ institutionType: 'school', version: quiz, now }).length,
      5,
      'soru listesi verilmezse kapalı başarısız',
    )
  })

  test('assertPublishable ilk eksiği alan yoluyla fırlatır', () => {
    assert.doesNotThrow(() =>
      assertPublishable({ institutionType: 'school', version: parse(schoolText()), now }),
    )
    assert.throws(
      () =>
        assertPublishable({
          institutionType: 'school',
          version: parse(schoolText({ license: null })),
          now,
        }),
      (error: unknown) =>
        isDomainError('license_required')(error) &&
        JSON.stringify((error as { path: unknown }).path) === '["license"]',
    )
  })
})

describe('Onaylayıcı', () => {
  test('DOM-KYN-031: yalnız kendi kitlesine paylaşılan kurum özgün içerik onaysızdır', () => {
    const original = { kind: 'institution_original' } as const
    assert.equal(requiresReview(original, 'private'), false)
    assert.equal(requiresReview(original, 'students'), false)
    assert.equal(requiresReview(original, 'classes'), false)
    assert.equal(requiresReview(original, 'department'), true)
    assert.equal(requiresReview(original, 'institution'), true)
    assert.equal(requiresReview({ kind: 'contains_quotation' }, 'classes'), true)
    assert.equal(requiresReview({ kind: 'external_reference' }, 'private'), true)
    assert.equal(requiresReview(null, 'private'), true)
  })

  test('yazar ve sahip onaylayamaz; yönetici, zümre başkanı ve koordinatör kapsamında onaylar', () => {
    const { resource, version } = build(schoolText())
    assert.equal(canReview(author, resource, version, 'school'), false)
    assert.equal(
      canReview(author, resource, { ...version, authorUserId: colleague.userId }, 'school'),
      false,
      'sahip, başkasının açtığı sürümü de onaylayamaz',
    )
    assert.equal(canReview(admin, resource, version, 'school'), true)
    assert.equal(canReview(head, resource, version, 'school'), true)
    assert.equal(canReview(colleague, resource, version, 'school'), false)
    const history = build(schoolText({ tags: { ...schoolText().tags, subjectId: 'history' } }))
    assert.equal(canReview(head, history.resource, history.version, 'school'), false)
    const b1 = build(languagePassage())
    assert.equal(canReview(coordinator, b1.resource, b1.version, 'language_school'), true)
    const a2 = build(languagePassage({ tags: { cefrLevel: 'A2', primarySkill: 'reading' } }))
    assert.equal(canReview(coordinator, a2.resource, a2.version, 'language_school'), false)
    assert.equal(canReview(student, resource, version, 'school'), false)
    assert.equal(canReview(frontDesk, resource, version, 'school'), false)
  })
})

describe('Sürüm durum geçişleri', () => {
  const transition = (
    action: ResourceAction,
    actor = author,
    built = build(schoolText()),
    extra: { reason?: string; institutionType?: 'school' | 'language_school' } = {},
  ) =>
    planVersionTransition({
      action,
      actor,
      institutionType: extra.institutionType ?? 'school',
      resource: built.resource,
      version: built.version,
      now,
      reason: extra.reason,
    })

  test('yazar taslağı onaya gönderir; eksikli taslak gönderilemez ve kayıt değişmez', () => {
    const result = transition('submit')
    assert.equal(result.status, 'in_review')
    assert.equal(result.versionChanges.submittedAt, now)
    assert.deepEqual(result.resourceChanges, {})

    const incomplete = build(schoolText({ license: null }))
    const before = structuredClone(incomplete)
    assert.throws(() => transition('submit', author, incomplete), isDomainError('license_required'))
    assert.deepEqual(incomplete, before)
    assert.throws(
      () => transition('submit', colleague),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
  })

  test('onaysız yayın yalnız istisnada; diğerleri onaya yönlenir', () => {
    const result = transition('publish')
    assert.equal(result.status, 'published')
    assert.equal(result.versionChanges.publishedAt, now)
    assert.deepEqual(result.resourceChanges, { currentVersionId: 'test-r1-v1' })
    assert.equal(result.supersededVersionId, null)

    const quoted = build(
      schoolText({
        license: { kind: 'contains_quotation' },
        attributions: [{ work: 'Eser', author: 'Yazar', source: 's. 1' }],
      }),
    )
    assert.throws(
      () => transition('publish', author, quoted),
      isDomainError('review_required', 'forbidden'),
    )
    const wide = build(schoolText(), { resource: { shareScope: 'department' } })
    assert.throws(
      () => transition('publish', author, wide),
      isDomainError('review_required', 'forbidden'),
    )
  })

  test('onay yeni sürümü yayına alır ve önceki yayını arşive bırakır', () => {
    const inReview = build(schoolText(), {
      version: { id: 'test-r1-v2', versionNumber: 2, status: 'in_review' },
      resource: { currentVersionId: 'test-r1-v1' },
    })
    const result = transition('approve', head, inReview)
    assert.equal(result.status, 'published')
    assert.equal(result.versionChanges.reviewedByUserId, head.userId)
    assert.deepEqual(result.resourceChanges, { currentVersionId: 'test-r1-v2' })
    assert.equal(result.supersededVersionId, 'test-r1-v1')

    assert.throws(
      () => transition('approve', author, inReview),
      (error: unknown) =>
        isDomainError('resource_action_forbidden', 'forbidden')(error) &&
        (error as Error).message === 'Kendi içeriğinizi onaylayamazsınız.',
    )
    assert.throws(
      () => transition('approve', colleague, inReview),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
  })

  test('ret gerekçe ister ve reddedilen sürüm taslağa döner', () => {
    const inReview = build(schoolText(), { version: { status: 'in_review' } })
    assert.throws(() => transition('reject', head, inReview), isDomainError('reason_required'))
    assert.throws(
      () => transition('reject', head, inReview, { reason: 'kısa' }),
      isDomainError('reason_required'),
    )
    const rejected = transition('reject', head, inReview, { reason: 'Kazanım yanlış seçilmiş.' })
    assert.equal(rejected.status, 'rejected')
    assert.equal(rejected.versionChanges.rejectionReason, 'Kazanım yanlış seçilmiş.')
    const reopened = transition(
      'reopen',
      author,
      build(schoolText(), { version: { status: 'rejected' } }),
    )
    assert.equal(reopened.status, 'draft')
    const withdrawn = transition('withdraw', author, inReview)
    assert.equal(withdrawn.status, 'draft')
    assert.equal(withdrawn.versionChanges.submittedAt, null)
  })

  test('izinsiz geçiş çakışma döner', () => {
    assert.throws(
      () => transition('approve', head),
      isDomainError('resource_transition_invalid', 'conflict'),
    )
    const published = build(schoolText(), { version: { status: 'published' } })
    assert.throws(
      () => transition('submit', author, published),
      isDomainError('resource_transition_invalid', 'conflict'),
    )
  })

  test('DOM-KYN-025, 030: incelemedeki sürüm arşivlenmez; bildirilen içerik yeniden yayına veya kaldırmaya gider', () => {
    const inReview = build(schoolText(), { version: { status: 'in_review' } })
    const reported = build(schoolText(), {
      version: { status: 'in_review', publishedAt: '2026-09-01T08:00:00.000Z' },
      resource: { currentVersionId: 'test-r1-v1' },
    })
    for (const built of [inReview, reported]) {
      for (const actor of [author, admin]) {
        assert.throws(
          () => transition('archive', actor, built),
          isDomainError('resource_transition_invalid', 'conflict'),
        )
      }
    }
  })

  test('arşivi sahip, zümre başkanı ve yönetici yapar', () => {
    const published = build(schoolText(), { version: { status: 'published' } })
    assert.equal(transition('archive', author, published).status, 'archived')
    assert.equal(transition('archive', head, published).status, 'archived')
    assert.equal(transition('archive', admin, published).versionChanges.archivedAt, now)
    assert.throws(
      () => transition('archive', colleague, published),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.throws(
      () => transition('archive', outsider, published),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
  })

  test('telif bildirimi yayını incelemeye alır; yeniden onay ilk yayın anını korur', () => {
    const published = build(schoolText(), {
      version: { status: 'published', publishedAt: '2026-09-01T08:00:00.000Z' },
      resource: { shareScope: 'institution' },
    })
    assert.throws(
      () => transition('report', colleague, published),
      isDomainError('reason_required'),
    )
    const reported = transition('report', colleague, published, {
      reason: 'Yayınevi sayfası taranmış.',
    })
    assert.equal(reported.status, 'in_review')
    const inReview = build(schoolText(), {
      version: { status: 'in_review', publishedAt: '2026-09-01T08:00:00.000Z' },
      resource: { currentVersionId: 'test-r1-v1' },
    })
    for (const action of ['withdraw', 'reject'] as const) {
      assert.throws(
        () =>
          transition(action, action === 'reject' ? admin : author, inReview, {
            reason: 'İhlal var.',
          }),
        isDomainError('version_immutable', 'conflict'),
        'yayımlanmış sürüm taslağa dönemez',
      )
    }
    assert.throws(
      () =>
        planDraftUpdate({
          actor: author,
          resource: inReview.resource,
          version: { ...inReview.version, status: 'rejected' },
          input: schoolText(),
        }),
      isDomainError('version_immutable', 'conflict'),
    )
    const approved = transition('approve', admin, inReview)
    assert.equal(approved.versionChanges.publishedAt, '2026-09-01T08:00:00.000Z')
    assert.equal(approved.supersededVersionId, null, 'aynı sürüm yeniden yayında')
  })

  test('DOM-KYN-025: telif bildirimiyle incelenen içeriği zümre başkanı değil yalnız yönetici yeniden yayına alır', () => {
    const reported = build(schoolText(), {
      version: {
        status: 'in_review',
        publishedAt: '2026-09-01T08:00:00.000Z',
        submittedAt: now,
      },
      resource: { currentVersionId: 'test-r1-v1', shareScope: 'institution' },
    })
    assert.throws(
      () => transition('approve', head, reported),
      (error: unknown) =>
        isDomainError('resource_action_forbidden', 'forbidden')(error) &&
        /yalnız yönetici/.test((error as Error).message),
    )
    assert.equal(transition('approve', admin, reported).status, 'published')
    // İlk yayından önceki olağan onayda zümre başkanı yetkisi sürer.
    const fresh = build(schoolText(), { version: { status: 'in_review' } })
    assert.equal(transition('approve', head, fresh).status, 'published')
  })

  test('DOM-KYN-025: kaynağı göremeyen kişi telif bildirimi yapamaz; varlığı sızmaz', () => {
    const reason = { reason: 'Telif ihlali var.' }
    const privatePublished = build(schoolText(), { version: { status: 'published' } })
    for (const actor of [colleague, outsider, head]) {
      assert.throws(
        () => transition('report', actor, privatePublished, reason),
        isDomainError('resource_not_found', 'not_found'),
      )
    }
    // Taslağı göremeyen kişi durum çakışması değil "bulunamadı" alır.
    assert.throws(
      () => transition('report', outsider, build(schoolText()), reason),
      isDomainError('resource_not_found', 'not_found'),
    )
    assert.equal(transition('report', author, privatePublished, reason).status, 'in_review')
    assert.equal(transition('report', admin, privatePublished, reason).status, 'in_review')
    const department = build(schoolText(), {
      version: { status: 'published' },
      resource: { shareScope: 'department' },
    })
    assert.equal(transition('report', colleague, department, reason).status, 'in_review')
    assert.throws(
      () => transition('report', outsider, department, reason),
      isDomainError('resource_not_found', 'not_found'),
    )
  })

  test('DOM-KYN-051: kaldırma kaynak düzeyindedir; bütün sürümler, dosyalar ve kopyalar döner', () => {
    const audio = (
      id: string,
      versionNumber: number,
      status: ResourceVersion['status'],
      fileId: string,
    ) => ({
      ...build(schoolText({ content: { type: 'audio', fileId, transcript: 'Döküm' } })).version,
      id,
      versionNumber,
      status,
    })
    const { resource } = build(
      schoolText({ content: { type: 'audio', fileId: 'f1', transcript: 'Döküm' } }),
      { resource: { currentVersionId: 'test-r1-v2' } },
    )
    const versions = [
      audio('test-r1-v1', 1, 'archived', 'f1'),
      audio('test-r1-v2', 2, 'published', 'f2'),
      audio('test-r1-v3', 3, 'draft', 'f2'),
      { ...audio('test-r9-v1', 1, 'published', 'f9'), resourceId: 'test-r9' },
    ]
    const before = structuredClone(versions)
    const plan = planResourceRemoval({
      actor: admin,
      resource,
      versions,
      copies: [
        { id: 'test-copy-a', derivedFromVersionId: 'test-r1-v1' },
        { id: 'test-copy-b', derivedFromVersionId: 'test-r1-v2' },
        { id: 'test-copy-x', derivedFromVersionId: 'test-r9-v1' },
      ],
      containers: [
        {
          id: 'test-quiz-v1',
          content: {
            type: 'quiz',
            items: [{ questionVersionId: 'test-r1-v1', points: 1 }],
            timeLimitMinutes: null,
            shuffleItems: false,
            passageVersionId: null,
          },
        },
        {
          id: 'test-quiz-v2',
          content: {
            type: 'exercise_set',
            items: [{ questionVersionId: 'test-q-other', points: 1 }],
            timeLimitMinutes: null,
            shuffleItems: false,
            passageVersionId: null,
          },
        },
        { id: 'test-text-v1', content: { type: 'text', body: 'x', fileId: null } },
      ],
      reason: '  Telif ihlali bildirimi  ',
      now,
    })
    assert.deepEqual(
      plan.versionIds,
      ['test-r1-v1', 'test-r1-v2', 'test-r1-v3'],
      'arşivliler dahil',
    )
    assert.deepEqual(plan.versionChanges, {
      status: 'removed',
      removedAt: now,
      removalReason: 'Telif ihlali bildirimi',
    })
    assert.deepEqual(plan.fileIds, ['f1', 'f2'])
    assert.deepEqual(plan.affectedCopyIds, ['test-copy-a', 'test-copy-b'])
    assert.deepEqual(plan.affectedContainerVersionIds, ['test-quiz-v1'])
    assert.equal(plan.clearContent, true)
    assert.deepEqual(versions, before, 'saf: girdi değişmez')

    const removal = (patch: Partial<Parameters<typeof planResourceRemoval>[0]>) =>
      planResourceRemoval({
        actor: admin,
        resource,
        versions,
        reason: 'Telif ihlali',
        now,
        ...patch,
      })
    assert.deepEqual(removal({}).affectedCopyIds, [], 'kopya listesi verilmezse boş')
    for (const actor of [author, head, frontDesk, student]) {
      assert.throws(
        () => removal({ actor }),
        isDomainError('resource_action_forbidden', 'forbidden'),
        actor.role,
      )
    }
    assert.throws(() => removal({ reason: 'kısa' }), isDomainError('reason_required'))
    assert.throws(
      () => removal({ versions: versions.slice(3) }),
      isDomainError('resource_version_not_found', 'not_found'),
    )
    assert.throws(
      () => removal({ versions: versions.map((v) => ({ ...v, status: 'removed' as const })) }),
      isDomainError('resource_removed', 'conflict'),
      'mükerrer kaldırma',
    )
    assert.equal('remove' in RESOURCE_ACTIONS, false, 'tek sürüm kaldırılamaz')
  })

  test('öğrenci ve ön büro içerik işlemi yapamaz; başka kaynağın sürümü bulunamaz', () => {
    assert.throws(
      () => transition('submit', student),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.throws(
      () =>
        transition('report', frontDesk, build(schoolText(), { version: { status: 'published' } }), {
          reason: 'Telif bildirimi',
        }),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    const built = build(schoolText())
    assert.throws(
      () =>
        planVersionTransition({
          action: 'submit',
          actor: author,
          institutionType: 'school',
          resource: { ...built.resource, id: 'test-r2' },
          version: built.version,
          now,
        }),
      isDomainError('resource_version_not_found', 'not_found'),
    )
  })

  test('quiz onayında soru listesi denetlenir', () => {
    const quiz = build(
      schoolText({ content: { type: 'quiz', items: [{ questionVersionId: 'test-q-v1' }] } }),
      { version: { status: 'in_review' } },
    )
    assert.throws(() => transition('approve', head, quiz), isDomainError('quiz_item_missing'))
    const tags = parse(multipleChoice()).tags
    const result = planVersionTransition({
      action: 'approve',
      actor: head,
      institutionType: 'school',
      resource: quiz.resource,
      version: quiz.version,
      now,
      itemVersions: new Map([
        ['test-q-v1', { id: 'test-q-v1', status: 'published', tags, contentType: 'question' }],
      ]),
    })
    assert.equal(result.status, 'published')
  })
})

describe('Taslak düzenleme ve yeni sürüm', () => {
  test('yazar taslağı ve reddedilen sürümü düzenler', () => {
    const { resource, version } = build(schoolText())
    const updated = planDraftUpdate({
      actor: author,
      resource,
      version,
      input: schoolText({ title: 'Kesirlerle çıkarma' }),
    })
    assert.equal(updated.data.title, 'Kesirlerle çıkarma')
    const rejected = build(schoolText(), { version: { status: 'rejected' } })
    assert.equal(
      planDraftUpdate({ actor: author, ...rejected, input: schoolText() }).status,
      'draft',
    )
  })

  test('DOM-KYN-032: yayımlanmış, incelemedeki ve arşivdeki sürüm değişmez', () => {
    for (const status of ['published', 'in_review', 'archived', 'removed'] as const) {
      const built = build(schoolText(), { version: { status } })
      const before = structuredClone(built)
      assert.throws(
        () => planDraftUpdate({ actor: author, ...built, input: schoolText({ title: 'Yeni' }) }),
        isDomainError('version_immutable', 'conflict'),
        status,
      )
      assert.deepEqual(built, before)
    }
  })

  test('başkası taslağı düzenleyemez, içerik türü değişmez', () => {
    const built = build(schoolText())
    assert.throws(
      () => planDraftUpdate({ actor: head, ...built, input: schoolText() }),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.throws(
      () =>
        planDraftUpdate({
          actor: author,
          ...built,
          input: schoolText({ content: { type: 'reading_passage', body: 'Parça' } }),
        }),
      isDomainError('content_type_immutable'),
    )
  })

  test('DOM-KYN-024, 050: türetilmiş içerikte miras menşe ve kaynak gösterimi korunur', () => {
    const attribution = { work: 'Eser', author: 'Yazar', source: 's. 3', year: null }
    const lineage = {
      license: { kind: 'contains_quotation' as const },
      attributions: [attribution],
    }
    const built = build(schoolText({ license: lineage.license, attributions: [attribution] }))
    const keep = schoolText({
      license: lineage.license,
      attributions: [attribution, { work: 'Ek', author: 'Başka', source: 's. 9' }],
    })
    assert.doesNotThrow(() => planDraftUpdate({ actor: author, ...built, input: keep, lineage }))
    assert.throws(
      () =>
        planDraftUpdate({
          actor: author,
          ...built,
          input: schoolText({ license: lineage.license, attributions: [] }),
          lineage,
        }),
      isDomainError('attribution_inherited'),
    )
    assert.throws(
      () =>
        planDraftUpdate({
          actor: author,
          ...built,
          input: schoolText({ attributions: [attribution] }),
          lineage,
        }),
      isDomainError('license_inherited'),
    )
  })

  test('düzenleme yayındaki sürümden yeni taslak açar', () => {
    const published = build(schoolText(), {
      version: { status: 'published', publishedAt: now },
    })
    const next = planNewVersion({
      actor: head,
      institutionType: 'school',
      resource: published.resource,
      versions: [published.version],
      versionId: 'test-r1-v2',
      now,
    })
    assert.equal(next.versionNumber, 2)
    assert.equal(next.status, 'draft')
    assert.equal(next.authorUserId, head.userId)
    assert.equal(next.publishedAt, null)
    assert.equal(next.title, published.version.title)
    assert.deepEqual(next.content, published.version.content)
  })

  test('açık sürüm varken veya kaldırılmış kaynakta yeni sürüm açılmaz; yetkisiz açamaz', () => {
    const published = build(schoolText(), { version: { status: 'published' } })
    const open = {
      ...published.version,
      id: 'test-r1-v2',
      versionNumber: 2,
      status: 'in_review' as const,
    }
    const args = {
      actor: author,
      institutionType: 'school' as const,
      resource: published.resource,
      versionId: 'test-r1-v3',
      now,
    }
    assert.throws(
      () => planNewVersion({ ...args, versions: [published.version, open] }),
      isDomainError('open_version_exists', 'conflict'),
    )
    assert.throws(
      () => planNewVersion({ ...args, versions: [{ ...published.version, status: 'removed' }] }),
      isDomainError('resource_removed', 'conflict'),
    )
    assert.throws(
      () => planNewVersion({ ...args, actor: colleague, versions: [published.version] }),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.throws(
      () => planNewVersion({ ...args, versions: [] }),
      isDomainError('resource_version_not_found', 'not_found'),
    )
  })

  test('yeni kaynağı yalnız içerik personeli oluşturur; kapsam varsayılan olarak yalnız ben', () => {
    const created = build(schoolText())
    assert.equal(created.resource.shareScope, 'private')
    assert.equal(created.resource.contentType, 'text')
    assert.equal(created.version.status, 'draft')
    assert.equal(created.version.versionNumber, 1)
    for (const actor of [student, frontDesk]) {
      assert.throws(
        () =>
          planNewResource({
            actor,
            input: schoolText(),
            ids: { resourceId: 'x', versionId: 'y' },
            now,
          }),
        isDomainError('resource_action_forbidden', 'forbidden'),
      )
    }
  })
})

describe('Dosya, görünüm ve arama', () => {
  test('içerik dosyaları amaçlarıyla listelenir', () => {
    assert.deepEqual(contentFileRefs(parse(schoolText()).content), [])
    assert.deepEqual(
      contentFileRefs({ type: 'audio', fileId: 'f', transcript: null, captionsVtt: null }),
      [{ fileId: 'f', purposes: ['listening_audio', 'material'] }],
    )
    const withImage = parse(multipleChoice())
    assert.ok(withImage.content.type === 'question')
    assert.deepEqual(contentFileRefs(withImage.content), [])
    assert.deepEqual(
      contentFileRefs({
        type: 'question',
        question: { ...withImage.content.question, imageFileId: 'img' } as never,
      }),
      [{ fileId: 'img', purposes: ['question_image'] }],
    )
    assert.deepEqual(contentFileRefs({ type: 'worksheet', body: null, fileId: 'w' }), [
      { fileId: 'w', purposes: ['material'] },
    ])
  })

  test('öğrenci görünümü cevap anahtarını ve sözleşme ayrıntısını ayıklar', () => {
    const { version } = build(
      multipleChoice({
        license: {
          kind: 'licensed_publication',
          publisher: 'Örnek',
          contractNumber: 'GİZLİ-1',
          coverage: 'Kurum',
          expiryDate: '2027-01-01',
        },
        attributions: [{ work: 'English 7', author: 'Örnek', source: 's. 4' }],
      }),
    )
    const view = learnerView(version, { random: seededRandom('test') })
    assert.equal('answerKey' in view, false)
    assert.equal('license' in view, false)
    assert.equal(view.licenseKind, 'licensed_publication')
    assert.doesNotMatch(JSON.stringify(view), /GİZLİ|Geçmiş zaman|correctOptionId/)
    assert.equal(view.attributions.length, 1, 'kaynak gösterimi korunur')
  })

  describe('öğrenci görünümünde karıştırma (rastgelelik dışarıdan)', () => {
    const question = (body: QuestionBody, answerKey: ResourceVersionInput['answerKey']) =>
      build({
        ...multipleChoice(),
        content: { type: 'question', question: body },
        answerKey,
      }).version
    const ordering = (ids: string[], order: string[]) =>
      question(
        { questionType: 'ordering', stem: 'Sırala', items: ids.map((id) => ({ id, text: id })) },
        { questionType: 'ordering', order, explanation: 'Doğru sıra.' },
      )
    const shown = (version: ResourceVersion, random: () => number) => {
      const content = learnerView(version, { random }).content
      assert.ok(content.type === 'question')
      return content.question
    }
    const orderOf = (version: ResourceVersion, random: () => number) => {
      const q = shown(version, random)
      assert.ok(q.questionType === 'ordering')
      return q.items.map((i) => i.id).join()
    }

    test('iki öğeli sıralama hiçbir tohumda doğru sırada görünmez', () => {
      for (let i = 0; i < 200; i += 1) {
        assert.equal(orderOf(ordering(['a', 'b'], ['a', 'b']), seededRandom(`s${i}`)), 'b,a')
        // Yazar ters sırada girse de gösterilen sıra doğru sıra olmaz.
        assert.equal(orderOf(ordering(['b', 'a'], ['a', 'b']), seededRandom(`s${i}`)), 'b,a')
      }
    })

    test('karışım doğru sırayla aynı çıkarsa döndürülür', () => {
      // 0.999… Fisher–Yates'te her adımda yerinde bırakır: kimlik sırası (a,b,c) doğru sıradır.
      const stay = () => 0.999_999
      assert.equal(orderOf(ordering(['c', 'a', 'b'], ['a', 'b', 'c']), stay), 'b,c,a')
      assert.equal(orderOf(ordering(['c', 'a', 'b'], ['c', 'b', 'a']), stay), 'a,b,c')
    })

    test('girilen sıra sızmaz; aynı tohum aynı sırayı verir', () => {
      const ids = ['i1', 'i2', 'i3', 'i4', 'i5']
      const forward = orderOf(ordering(ids, ids), seededRandom('deneme-1'))
      const reversed = orderOf(ordering([...ids].reverse(), ids), seededRandom('deneme-1'))
      assert.equal(forward, reversed)
      assert.equal(orderOf(ordering(ids, ids), seededRandom('deneme-1')), forward)
      assert.deepEqual(forward.split(',').sort(), ids)
      const seen = new Set(
        Array.from({ length: 30 }, (_, i) => orderOf(ordering(ids, ids), seededRandom(`t${i}`))),
      )
      assert.ok(seen.size > 10, 'tohum değişince sıra değişir')
    })

    test('çoktan seçmeli seçenekleri ve kapalı boşluk listesi karışır', () => {
      const mc = build(multipleChoice()).version
      const positions = new Set<number>()
      for (let i = 0; i < 100; i += 1) {
        const q = shown(mc, seededRandom(`m${i}`))
        assert.ok(q.questionType === 'multiple_choice')
        assert.deepEqual(q.options.map((o) => o.id).sort(), ['a', 'b', 'c', 'd'])
        positions.add(q.options.findIndex((o) => o.id === 'b'))
      }
      assert.deepEqual([...positions].sort(), [0, 1, 2, 3], 'doğru seçenek her konuma düşer')

      const gap = question(
        {
          questionType: 'gap_fill',
          stem: 'I {{g1}} to school and {{g2}} home.',
          gaps: [
            { id: 'g1', options: ['go', 'goes', 'going', 'gone'] },
            { id: 'g2', options: [] },
          ],
        },
        {
          questionType: 'gap_fill',
          gaps: [
            { gapId: 'g1', accepted: ['go'] },
            { gapId: 'g2', accepted: ['walk'] },
          ],
          explanation: 'Geniş zaman.',
        },
      )
      const firsts = new Set<string>()
      for (let i = 0; i < 100; i += 1) {
        const q = shown(gap, seededRandom(`g${i}`))
        assert.ok(q.questionType === 'gap_fill')
        assert.deepEqual([...(q.gaps[0]?.options ?? [])].sort(), ['go', 'goes', 'going', 'gone'])
        assert.deepEqual(q.gaps[1]?.options, [], 'açık boşluk açık kalır')
        firsts.add(q.gaps[0]?.options[0] ?? '')
      }
      assert.equal(firsts.size, 4)
    })

    test('eşleştirmede seçenekler hiçbir zaman öncül sırasıyla hizalı görünmez', () => {
      const matching = question(
        {
          questionType: 'matching',
          stem: 'Eşleştir',
          prompts: [
            { id: 'p1', text: 'dog' },
            { id: 'p2', text: 'cat' },
          ],
          choices: [
            { id: 'c1', text: 'köpek' },
            { id: 'c2', text: 'kedi' },
          ],
        },
        {
          questionType: 'matching',
          pairs: [
            { promptId: 'p1', choiceId: 'c1' },
            { promptId: 'p2', choiceId: 'c2' },
          ],
          explanation: 'Hayvanlar.',
        },
      )
      for (let i = 0; i < 100; i += 1) {
        const q = shown(matching, seededRandom(`e${i}`))
        assert.ok(q.questionType === 'matching')
        assert.deepEqual(
          q.prompts.map((p) => p.id),
          ['p1', 'p2'],
        )
        assert.equal(q.choices.map((c) => c.id).join(), 'c2,c1')
      }
    })
  })

  test('DOM-KYN-003, DOM-BEC-005: dinleme dökümü varsayılan gizli, açık seçenekle gösterilir', () => {
    const random = seededRandom('test')
    const vtt = 'WEBVTT\n\n00:00.000 --> 00:02.000\nMerhaba'
    const listening = build(
      languagePassage({
        content: { type: 'audio', fileId: 'f', transcript: 'Döküm metni', captionsVtt: vtt },
        tags: { cefrLevel: 'B1', primarySkill: 'listening' },
      }),
    ).version
    const hidden = learnerView(listening, { random }).content
    assert.ok(hidden.type === 'audio')
    assert.equal(hidden.transcript, null)
    assert.equal(hidden.captionsVtt, null)
    assert.doesNotMatch(JSON.stringify(learnerView(listening, { random })), /Döküm metni|Merhaba/)
    const shown = learnerView(listening, { random, showTranscript: true }).content
    assert.ok(shown.type === 'audio')
    assert.equal(shown.transcript, 'Döküm metni')
    assert.equal(shown.captionsVtt, vtt)

    // Dinleme görevi olmayan ses ve videoda döküm erişilebilirlik içindir, hep görünür.
    const lesson = build(
      schoolText({ content: { type: 'video', fileId: 'f', transcript: 'Ders dökümü' } }),
    ).version
    const visible = learnerView(lesson, { random }).content
    assert.ok(visible.type === 'video')
    assert.equal(visible.transcript, 'Ders dökümü')
  })

  test('arama normalleştirmesi Türkçe ve İngilizce harfleri aynı terime indirir', () => {
    assert.equal(normalizeSearchText('IŞIK Işık ışık isik'), 'isik isik isik isik')
    assert.equal(normalizeSearchText('İstanbul ISTANBUL istanbul'), 'istanbul istanbul istanbul')
    assert.equal(normalizeSearchText('Island ISLAND'), 'island island')
    assert.equal(normalizeSearchText('  Çağ—ğüşöç, ÇĞÜŞÖ!  '), 'cag gusoc cguso')
    assert.equal(normalizeSearchText('café naïve'), 'cafe naive')
    // NFKD: uyumluluk biçimleri (bağlı harf, tam genişlik) sade harfe iner.
    assert.equal(normalizeSearchText('ﬁle ﬂow'), 'file flow')
    assert.equal(normalizeSearchText('Ａ１ ＫＥＳİＲ'), 'a1 kesir')
    assert.equal(normalizeSearchText('İ ı Ş ş ℌ'), 'i i s s h')
    assert.deepEqual(searchQueryTerms('ﬁle'), searchQueryTerms('FILE'))
    assert.deepEqual(searchQueryTerms('Kesir kesir KESİR & toplama | !'), ['kesir', 'toplama'])
    assert.equal(searchQueryTerms('a b c d e f g h i j').length, 8)
    assert.deepEqual(searchQueryTerms('  ...  '), [])
  })

  test('aranabilir metin cevap anahtarını ve dökümü içermez', () => {
    const question = searchDocument(parse(multipleChoice()))
    assert.match(question, /past simple yesterday i to school go went gone going/)
    assert.doesNotMatch(question, /gecmis zaman/)
    const audio = searchDocument(
      parse(schoolText({ content: { type: 'audio', fileId: 'f', transcript: 'Gizli döküm' } })),
    )
    assert.doesNotMatch(audio, /gizli/)
    const book = searchDocument(
      parse(
        schoolText({
          content: {
            type: 'book_reference',
            publisher: 'Örnek Yayınları',
            bookTitle: 'Kitap',
            pages: '12',
          },
          attributions: [{ work: 'Şiir', author: 'Ozan', source: 's. 1' }],
        }),
      ),
    )
    assert.match(book, /ornek yayinlari kitap 12 siir ozan/)
    const gap = searchDocument(
      parse({
        ...multipleChoice({ answerKey: null }),
        content: {
          type: 'question',
          question: { questionType: 'gap_fill', stem: 'She {{g1}} tea.', gaps: [{ id: 'g1' }] },
        },
      }),
    )
    assert.doesNotMatch(gap, /g1/)
  })

  test('sözcük sayısı kesme ve tireli sözcükleri tek sayar', () => {
    assert.equal(wordCount("Ankara'da well-known bir şehir."), 4)
    assert.equal(wordCount('   '), 0)
  })
})
