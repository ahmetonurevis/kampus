import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  answerKeySchema,
  questionBodySchema,
  type AnswerKey,
  type QuestionBody,
} from '@kampus/school-core/content/resource.ts'
import type { QuestionType } from '@kampus/school-core/content/taxonomy.ts'
import {
  defaultDraft,
  draftFormSchema,
  draftResolver,
  type DraftFormValues,
} from '../src/pages/content/content-pool-model.ts'
import {
  appendGapMarker,
  checkPreviewAnswer,
  coreQuestionFromForm,
  defaultQuestion,
  formIssuePath,
  gapIdsInStem,
  gapKey,
  lines,
  nextRowId,
  previewQuestion,
  QUESTION_TYPE_OPTIONS,
  questionFormFromCore,
  questionSummary,
  type AnswerFormValues,
  type QuestionFormValues,
} from '../src/pages/content/question-form-model.ts'

// Soru yazma formu (OG-068, IST-033; DOM-KYN-002): altı tür formdan core girdisine ve geri
// çevrilir; doğrulama core şemasıdır, hata yolu form alanına iner, önizleme core puanlamasıyla
// denetlenir.

type Pair = { question: QuestionFormValues; answerKey: AnswerFormValues }

function filled(type: QuestionType, edit: (pair: Pair) => void): Pair {
  const pair = structuredClone(defaultQuestion(type, 'Soru kökü'))
  pair.answerKey.explanation = 'Çözüm.'
  edit(pair)
  return pair
}

const SAMPLES: Record<QuestionType, Pair> = {
  multiple_choice: filled('multiple_choice', ({ question, answerKey }) => {
    question.options = question.options.map((o) => ({ ...o, text: `Seçenek ${o.id}` }))
    answerKey.correctOptionId = 'c'
  }),
  true_false: filled('true_false', ({ question, answerKey }) => {
    question.allowNotGiven = true
    answerKey.answer = 'not_given'
  }),
  matching: filled('matching', ({ question }) => {
    question.prompts = [
      { id: 'p1', text: 'cat' },
      { id: 'p2', text: 'dog' },
    ]
    question.choices = [
      { id: 'c1', text: 'kedi' },
      { id: 'c2', text: 'köpek' },
      { id: 'c3', text: 'kuş' },
    ]
  }),
  gap_fill: filled('gap_fill', ({ question }) => {
    question.stem = 'I {{1}} to school every {{2}}.'
    question.gapEntries = {
      [gapKey('1')]: { accepted: 'go\nwalk', options: '' },
      [gapKey('2')]: { accepted: 'day', options: 'day\nnight' },
    }
  }),
  ordering: filled('ordering', ({ question }) => {
    question.items = [
      { id: 'i1', text: 'wake up' },
      { id: 'i2', text: 'have breakfast' },
      { id: 'i3', text: 'go to school' },
    ]
  }),
  short_answer: filled('short_answer', ({ question, answerKey }) => {
    question.maxLength = 40
    answerKey.acceptedText = 'Ankara\n  ankara  \n\n'
  }),
}

function core(pair: Pair): { question: QuestionBody; answerKey: AnswerKey } {
  const raw = coreQuestionFromForm(pair.question, pair.answerKey)
  return {
    question: questionBodySchema.parse(raw.question),
    answerKey: answerKeySchema.parse(raw.answerKey),
  }
}

function draft(pair: Pair): DraftFormValues {
  return {
    ...defaultDraft('question'),
    title: 'Soru',
    content: { type: 'question', question: pair.question },
    answerKey: pair.answerKey,
    license: { kind: 'institution_original' },
  }
}

describe('Soru formu → core (IST-033, DOM-KYN-002)', () => {
  test('IST-033: altı türün hepsi seçilebilir ve core şemasından geçer', () => {
    assert.deepEqual(
      QUESTION_TYPE_OPTIONS.map((option) => option.label),
      ['Çoktan seçmeli', 'Doğru/yanlış', 'Eşleştirme', 'Boşluk doldurma', 'Sıralama', 'Kısa yanıt'],
    )
    for (const [type, pair] of Object.entries(SAMPLES)) {
      const result = draftFormSchema.safeParse(draft(pair))
      assert.equal(result.success, true, `${type}: ${JSON.stringify(result.error?.issues)}`)
      assert.equal(result.data?.answerKey?.questionType, type)
    }
  })

  test('IST-033: seçili türün dışındaki alanlar gövdeye gitmez', () => {
    const { question } = core(SAMPLES.ordering)
    assert.deepEqual(Object.keys(question).sort(), ['items', 'questionType', 'stem'])
  })

  test('IST-033: eşleştirme anahtarı satır hizasından kurulur, fazla eş çeldiricidir', () => {
    const { answerKey } = core(SAMPLES.matching)
    assert.deepEqual(answerKey.questionType === 'matching' && answerKey.pairs, [
      { promptId: 'p1', choiceId: 'c1' },
      { promptId: 'p2', choiceId: 'c2' },
    ])
  })

  test('IST-033: sıralama anahtarı yazılan sıradır', () => {
    const { answerKey } = core(SAMPLES.ordering)
    assert.deepEqual(answerKey.questionType === 'ordering' && answerKey.order, ['i1', 'i2', 'i3'])
  })

  test('IST-033: boşluklar kökteki işaretlerden, cevaplar satır satır gelir', () => {
    const { question, answerKey } = core(SAMPLES.gap_fill)
    assert.deepEqual(question.questionType === 'gap_fill' && question.gaps, [
      { id: '1', options: [] },
      { id: '2', options: ['day', 'night'] },
    ])
    assert.deepEqual(answerKey.questionType === 'gap_fill' && answerKey.gaps, [
      { gapId: '1', accepted: ['go', 'walk'] },
      { gapId: '2', accepted: ['day'] },
    ])
  })

  test('IST-033: kısa yanıtın boş satırları atılır, tekrarlar core ile tekleşir', () => {
    const { answerKey } = core(SAMPLES.short_answer)
    assert.deepEqual(answerKey.questionType === 'short_answer' && answerKey.accepted, [
      'Ankara',
      'ankara',
    ])
  })

  test('DOM-KYN-002: kapalı listeli boşluğun cevabı listede olmalı (core reddi)', () => {
    const pair = structuredClone(SAMPLES.gap_fill)
    pair.question.gapEntries[gapKey('2')] = { accepted: 'week', options: 'day\nnight' }
    const result = draftFormSchema.safeParse(draft(pair))
    assert.equal(result.success, false)
    assert.deepEqual(result.error?.issues[0]?.path, ['answerKey'])
  })

  test('cevap anahtarı olmayan soru kaydedilmez', () => {
    const result = draftFormSchema.safeParse({ ...draft(SAMPLES.true_false), answerKey: null })
    assert.equal(result.success, false)
    assert.equal(result.error?.issues[0]?.message, 'Doğru cevabı belirleyin.')
  })
})

describe('Kayıtlı soru → form (yeni sürümde düzenleme)', () => {
  test('IST-033: altı tür formdan core’a ve geri aynı soruyu verir', () => {
    for (const [type, pair] of Object.entries(SAMPLES)) {
      const saved = core(pair)
      const back = questionFormFromCore(saved.question, saved.answerKey)
      assert.deepEqual(core(back), saved, type)
    }
  })

  test('IST-033: eşleştirmede eşler öncül hizasına dizilir, eşsiz seçenek çeldirici olur', () => {
    const back = questionFormFromCore(
      {
        questionType: 'matching',
        stem: 'Eşleştir',
        prompts: [
          { id: 'p1', text: 'cat' },
          { id: 'p2', text: 'dog' },
        ],
        choices: [
          { id: 'x', text: 'kuş' },
          { id: 'b', text: 'köpek' },
          { id: 'a', text: 'kedi' },
        ],
      },
      {
        questionType: 'matching',
        pairs: [
          { promptId: 'p1', choiceId: 'a' },
          { promptId: 'p2', choiceId: 'b' },
        ],
        explanation: 'Çözüm.',
      },
    )
    assert.deepEqual(
      back.question.choices.map((c) => c.text),
      ['kedi', 'köpek', 'kuş'],
    )
  })

  test('IST-033: iki öncülün paylaştığı eş yeni kimlikli kopya olur', () => {
    const back = questionFormFromCore(
      {
        questionType: 'matching',
        stem: 'Eşleştir',
        prompts: [
          { id: 'p1', text: 'big' },
          { id: 'p2', text: 'large' },
        ],
        choices: [
          { id: 'c1', text: 'büyük' },
          { id: 'c2', text: 'küçük' },
        ],
      },
      {
        questionType: 'matching',
        pairs: [
          { promptId: 'p1', choiceId: 'c1' },
          { promptId: 'p2', choiceId: 'c1' },
        ],
        explanation: 'Eş anlamlı.',
      },
    )
    const ids = back.question.choices.map((c) => c.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.deepEqual(
      back.question.choices.map((c) => c.text),
      ['büyük', 'büyük', 'küçük'],
    )
    assert.equal(draftFormSchema.safeParse(draft(back)).success, true)
  })

  test('IST-033: sıralama öğeleri anahtar sırasıyla gelir', () => {
    const back = questionFormFromCore(
      {
        questionType: 'ordering',
        stem: 'Sırala',
        items: [
          { id: 'i2', text: 'iki' },
          { id: 'i1', text: 'bir' },
        ],
      },
      { questionType: 'ordering', order: ['i1', 'i2'], explanation: 'Sıra.' },
    )
    assert.deepEqual(
      back.question.items.map((i) => i.text),
      ['bir', 'iki'],
    )
  })

  test('kayıtlı görsel yeni sürümde korunur', () => {
    const back = questionFormFromCore(
      { questionType: 'true_false', stem: 'Doğru mu?', allowNotGiven: false, imageFileId: 'f1' },
      null,
    )
    assert.equal(back.question.imageFileId, 'f1')
    assert.equal(back.answerKey.answer, 'true')
  })
})

describe('Hata yolu eşlemesi', () => {
  const values = { content: { question: { stem: 'A {{1}} b {{x}}' } } }

  test('boşluk hataları işaretin cevap alanına, boşluksuz kök köke iner', () => {
    assert.equal(
      formIssuePath(['answerKey', 'gaps', 1, 'accepted'], values),
      `content.question.gapEntries.${gapKey('x')}.accepted`,
    )
    assert.equal(
      formIssuePath(['content', 'question', 'gaps', 0, 'options', 2], values),
      `content.question.gapEntries.${gapKey('1')}.options`,
    )
    assert.equal(formIssuePath(['content', 'question', 'gaps'], values), 'content.question.stem')
    assert.equal(
      formIssuePath(['answerKey', 'gaps', 5, 'accepted'], values),
      'content.question.stem',
    )
  })

  test('türetilen anahtar hatası soru alanının altına, kısa yanıt metin alanına iner', () => {
    assert.equal(formIssuePath(['answerKey'], values), 'answerKey.root')
    assert.equal(formIssuePath(['answerKey', 'pairs', 0], values), 'answerKey.root')
    assert.equal(formIssuePath(['answerKey', 'order'], values), 'answerKey.root')
    assert.equal(formIssuePath(['answerKey', 'accepted', 0], values), 'answerKey.acceptedText')
    assert.equal(formIssuePath(['answerKey', 'explanation'], values), 'answerKey.explanation')
    assert.equal(formIssuePath(['title'], values), 'title')
  })

  test('çözümleyici core hatasını form alanına yazar; geçerli formda hata yok', async () => {
    const pair = structuredClone(SAMPLES.gap_fill)
    pair.question.gapEntries[gapKey('1')] = { accepted: '', options: '' }
    const options = { fields: {}, shouldUseNativeValidation: false } as Parameters<
      typeof draftResolver
    >[2]
    const failed = await draftResolver(draft(pair), undefined, options)
    const gapErrors = (failed.errors as Record<string, unknown>).content as {
      question: { gapEntries: Record<string, { accepted?: { message: string } }> }
    }
    assert.equal(
      gapErrors.question.gapEntries[gapKey('1')]?.accepted?.message,
      'En az bir kabul edilen cevap girin.',
    )
    const ok = await draftResolver(draft(SAMPLES.gap_fill), undefined, options)
    assert.deepEqual(ok.errors, {})
  })
})

describe('Yardımcılar', () => {
  test('boşluk işareti sıradaki boş sayıyı alır, tekrar eden işaret bir kez sayılır', () => {
    assert.deepEqual(gapIdsInStem('{{1}} a {{3}} {{1}}'), ['1', '3'])
    assert.equal(appendGapMarker(''), '{{1}}')
    assert.equal(appendGapMarker('I {{1}} and'), 'I {{1}} and {{2}}')
    assert.equal(appendGapMarker('I {{2}} '), 'I {{2}} {{1}}')
  })

  test('satır kimliği kullanılmayan ilk sayıyı alır; satır listesi boşlukları atar', () => {
    assert.equal(nextRowId('p', ['p1', 'p3']), 'p2')
    assert.deepEqual(lines(' a \n\nb\r\n'), ['a', 'b'])
    assert.deepEqual(lines(undefined), [])
  })
})

describe('Oynatıcı önizlemesi ve denetim (DOM-BEC-010)', () => {
  test('eksik soru önizlenmez, Türkçe nedeni yazılır', () => {
    const preview = previewQuestion(defaultQuestion('ordering').question, null)
    assert.equal(preview.ok, false)
    assert.match(preview.ok ? '' : preview.message, /^Önizleme için soruyu tamamlayın/)
  })

  test('sıralama öğrenciye doğru sırada gösterilmez; anahtar yoksa önizleme yine açılır', () => {
    const preview = previewQuestion(SAMPLES.ordering.question, SAMPLES.ordering.answerKey)
    assert.ok(preview.ok)
    const shown = preview.question.questionType === 'ordering' ? preview.question.items : []
    assert.notDeepEqual(
      shown.map((i) => i.id),
      ['i1', 'i2', 'i3'],
    )
    const keyless = previewQuestion(SAMPLES.ordering.question, null)
    assert.equal(keyless.ok && keyless.answerKey, null)
  })

  test('DOM-BEC-010: cevap anahtarla puanlanır; çok maddeli soruda doğru madde sayısı yazılır', () => {
    const { question, answerKey } = core(SAMPLES.ordering)
    const tags = { cefrLevel: null, primarySkill: null, skills: [] }
    assert.deepEqual(
      checkPreviewAnswer(
        question,
        answerKey,
        { questionType: 'ordering', order: ['i1', 'i2', 'i3'] },
        tags,
      ),
      { correct: true, message: 'Cevap doğru.' },
    )
    assert.equal(
      checkPreviewAnswer(
        question,
        answerKey,
        { questionType: 'ordering', order: ['i1', 'i3', 'i2'] },
        tags,
      ).message,
      'Cevap eksik ya da yanlış: 3 maddeden 1 doğru.',
    )
    assert.equal(
      checkPreviewAnswer(question, answerKey, undefined, tags).message,
      'Önce soruyu cevaplayın.',
    )
  })

  test('DOM-BEC-010: kısa yanıt etiket diline göre büyük/küçük harf katlanır', () => {
    const { question, answerKey } = core(SAMPLES.short_answer)
    const english = { cefrLevel: 'B1' as const, primarySkill: null, skills: [] }
    assert.equal(
      checkPreviewAnswer(
        question,
        answerKey,
        { questionType: 'short_answer', value: ' ANKARA ' },
        english,
      ).correct,
      true,
    )
    const tf = core(SAMPLES.true_false)
    assert.equal(
      checkPreviewAnswer(
        tf.question,
        tf.answerKey,
        { questionType: 'true_false', answer: 'true' },
        english,
      ).message,
      'Cevap yanlış.',
    )
  })
})

describe('Panel özeti', () => {
  test('türüne göre doğru cevap gösterilir', () => {
    const summary = (type: QuestionType) => {
      const { question, answerKey } = core(SAMPLES[type])
      return questionSummary(question, answerKey)
    }
    assert.deepEqual(
      summary('multiple_choice')
        .lines.filter((line) => line.correct)
        .map((line) => line.key),
      ['c'],
    )
    assert.equal(summary('true_false').answer, 'Verilmemiş')
    assert.deepEqual(
      summary('matching').lines.map((line) => line.text),
      ['cat → kedi', 'dog → köpek', 'kuş'],
    )
    assert.equal(summary('gap_fill').stem, 'I ____ to school every ____.')
    assert.deepEqual(
      summary('gap_fill').lines.map((line) => line.text),
      ['go / walk', 'day'],
    )
    assert.deepEqual(
      summary('ordering').lines.map((line) => `${line.marker} ${line.text}`),
      ['1. wake up', '2. have breakfast', '3. go to school'],
    )
    assert.equal(summary('short_answer').answer, 'Ankara / ankara')
    assert.equal(summary('short_answer').typeLabel, 'Kısa yanıt')
    assert.equal(questionSummary(core(SAMPLES.ordering).question, null).explanation, '')
  })
})
