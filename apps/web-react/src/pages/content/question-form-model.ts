// Soru yazma formunun saf modeli (OG-068, IST-033; DOM-KYN-002): altı soru türünün form değeri,
// core girdisine çevrimi, kayıtlı sürümden geri dönüşü, hata yolu eşlemesi ve oynatıcı önizlemesi.
// Kural core `content/resource.ts` (`questionBodySchema`, `answerKeySchema`) ve
// `skills/scoring.ts` (`scoreItem`) içindedir; burada yalnız form biçimi vardır.
import {
  answerKeySchema,
  questionBodySchema,
  seededRandom,
  shuffleQuestion,
  type AnswerKey,
  type QuestionBody,
  type ResourceTags,
} from '@kampus/school-core/content/resource.ts'
import { QUESTION_TYPES, type QuestionType } from '@kampus/school-core/content/taxonomy.ts'
import {
  answerLocaleForTags,
  scoreItem,
  type TaskResponse,
} from '@kampus/school-core/skills/scoring.ts'

export type ItemRow = { id: string; text: string }

/** Boşluğun cevapları: her satıra bir kabul edilen cevap; seçenek listesi boşsa öğrenci yazar. */
export type GapEntry = { accepted: string; options: string }

/**
 * Formdaki soru: altı türün alanları bir arada (düz tip, `register` yolları tipli kalsın). Core
 * girdisine `coreQuestionFromForm` yalnız seçili türün alanlarını taşır.
 *
 * - Eşleştirmede `choices` dizisinin ilk `prompts.length` öğesi sırayla öncüllerin doğru eşidir,
 *   kalanı çeldiricidir; cevap anahtarı bu hizadan kurulur (öğrenci karışık görür).
 * - Sıralamada `items` doğru sıradır.
 * - Boşluk doldurmada boşluklar kökteki `{{1}}` işaretlerinden okunur; cevaplar `gapEntries`
 *   altında işaret kimliğiyle (`gapKey`) tutulur.
 */
export type QuestionFormValues = {
  questionType: QuestionType
  stem: string
  options: ItemRow[]
  allowNotGiven: boolean
  prompts: ItemRow[]
  choices: ItemRow[]
  gapEntries: Record<string, GapEntry>
  items: ItemRow[]
  maxLength: number
  /** Görsel bu formda eklenmez; kayıtlı sürümdeki görsel yeni sürümde korunur. */
  imageFileId: string | null
}

export type TrueFalseAnswer = 'true' | 'false' | 'not_given'

export type AnswerFormValues = {
  correctOptionId: string
  answer: TrueFalseAnswer
  /** Kısa yanıtın kabul edilen cevapları, her satıra bir tane. */
  acceptedText: string
  explanation: string
}

export const QUESTION_TYPE_OPTIONS = (Object.keys(QUESTION_TYPES) as QuestionType[]).map(
  (value) => ({ value, label: QUESTION_TYPES[value].label }),
)

export const TRUE_FALSE_OPTIONS: { value: TrueFalseAnswer; label: string }[] = [
  { value: 'true', label: 'Doğru' },
  { value: 'false', label: 'Yanlış' },
  { value: 'not_given', label: 'Verilmemiş' },
]

/** Tür başına satır sınırları (core şemasıyla aynı). */
export const ROW_LIMITS = {
  options: { min: 4, max: 8 },
  prompts: { min: 2, max: 20 },
  choices: { max: 26 },
  items: { min: 2, max: 20 },
  gaps: { max: 20 },
} as const

/** Kullanılmayan ilk kimlik: `p1`, `p2`, … (core kimlik kuralına uyar). */
export function nextRowId(prefix: string, used: readonly string[]): string {
  const taken = new Set(used)
  let index = 1
  while (taken.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

const rows = (prefix: string, count: number): ItemRow[] =>
  Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index + 1}`, text: '' }))

const OPTION_LETTERS = ['a', 'b', 'c', 'd'] as const

/** Türün boş sorusu; kök ve açıklama tür değişince korunsun diye dışarıdan verilebilir. */
export function defaultQuestion(
  questionType: QuestionType,
  stem = '',
): { question: QuestionFormValues; answerKey: AnswerFormValues } {
  return {
    question: {
      questionType,
      stem,
      options: OPTION_LETTERS.map((id) => ({ id, text: '' })),
      allowNotGiven: false,
      prompts: rows('p', 2),
      choices: rows('c', 2),
      gapEntries: {},
      items: rows('i', 3),
      maxLength: 100,
      imageFileId: null,
    },
    answerKey: { correctOptionId: 'a', answer: 'true', acceptedText: '', explanation: '' },
  }
}

// --- Boşluk işaretleri --------------------------------------------------------------------

const GAP_MARKER = /\{\{([A-Za-z0-9_-]{1,40})\}\}/g

/** Kökteki boşluk kimlikleri, ilk görünüş sırasıyla ve tekil. */
export function gapIdsInStem(stem: string): string[] {
  return [...new Set([...stem.matchAll(GAP_MARKER)].map((match) => match[1] ?? ''))]
}

/**
 * Boşluk cevabının form anahtarı. Sayısal anahtar (`gapEntries.1`) react-hook-form'da dizi
 * konumu sayılır; önek nesne anahtarı kalmasını sağlar.
 */
export const gapKey = (gapId: string) => `gap_${gapId}`

/** Sıradaki boşluk işareti: kullanılmayan ilk sayı (`{{3}}`). */
export function nextGapMarker(stem: string): string {
  const used = new Set(gapIdsInStem(stem))
  let index = 1
  while (used.has(String(index))) index += 1
  return `{{${index}}}`
}

/** "Boşluk ekle": işaret kökün sonuna bir boşlukla eklenir. */
export function appendGapMarker(stem: string): string {
  const marker = nextGapMarker(stem)
  return stem === '' || /\s$/.test(stem) ? `${stem}${marker}` : `${stem} ${marker}`
}

/** Çok satırlı metinden liste: boş satırlar atılır. */
export const lines = (value: string | undefined): string[] =>
  (value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')

// --- Form → core --------------------------------------------------------------------------

type Loose<T> = { [K in keyof T]?: T[K] | undefined }
const textRows = (list: readonly ItemRow[] | undefined) =>
  (list ?? []).map(({ id, text }) => ({ id, text }))

/**
 * Form değerinden core girdisi (`content.question` ve `answerKey`). Seçili türün dışındaki alanlar
 * atılır; eşleştirme ve sıralama anahtarı yazarın dizdiği hizadan, boşluklar kökteki işaretlerden
 * kurulur. Biçim doğrulaması core şemasındadır; eksik değer olduğu gibi geçer ki core Türkçe
 * iletisiyle reddetsin.
 */
export function coreQuestionFromForm(
  question: Loose<QuestionFormValues>,
  answer: Loose<AnswerFormValues> | null,
): { question: unknown; answerKey: unknown } {
  const stem = question.stem ?? ''
  const explanation = answer?.explanation ?? ''
  const imageFileId = question.imageFileId ?? null
  const type = question.questionType ?? 'multiple_choice'
  const withKey = (key: Record<string, unknown>) =>
    answer === null ? null : { questionType: type, ...key, explanation }
  switch (type) {
    case 'multiple_choice':
      return {
        question: { questionType: type, stem, options: textRows(question.options), imageFileId },
        answerKey: withKey({ correctOptionId: answer?.correctOptionId ?? '' }),
      }
    case 'true_false':
      return {
        question: {
          questionType: type,
          stem,
          allowNotGiven: question.allowNotGiven ?? false,
          imageFileId,
        },
        answerKey: withKey({ answer: answer?.answer ?? 'true' }),
      }
    case 'matching': {
      const prompts = textRows(question.prompts)
      const choices = textRows(question.choices)
      return {
        question: { questionType: type, stem, prompts, choices },
        answerKey: withKey({
          pairs: prompts.map((prompt, index) => ({
            promptId: prompt.id,
            choiceId: choices[index]?.id ?? '',
          })),
        }),
      }
    }
    case 'gap_fill': {
      const ids = gapIdsInStem(stem)
      const entry = (id: string) => question.gapEntries?.[gapKey(id)]
      return {
        question: {
          questionType: type,
          stem,
          gaps: ids.map((id) => ({ id, options: lines(entry(id)?.options) })),
        },
        answerKey: withKey({
          gaps: ids.map((id) => ({ gapId: id, accepted: lines(entry(id)?.accepted) })),
        }),
      }
    }
    case 'ordering': {
      const items = textRows(question.items)
      return {
        question: { questionType: type, stem, items },
        answerKey: withKey({ order: items.map((item) => item.id) }),
      }
    }
    case 'short_answer':
      return {
        question: { questionType: type, stem, maxLength: question.maxLength ?? 100, imageFileId },
        answerKey: withKey({ accepted: lines(answer?.acceptedText) }),
      }
    default:
      return type satisfies never
  }
}

// --- Core → form --------------------------------------------------------------------------

/**
 * Kayıtlı sorudan form değeri (düzenleme ve yeni sürüm). Eşleştirmede her öncülün eşi hizasına
 * dizilir, eşi olmayan seçenekler çeldirici olur; iki öncülün paylaştığı eş yeni kimlikli kopya
 * olur (form her çifte ayrı eş yazar). Sıralama öğeleri anahtar sırasıyla gelir.
 */
export function questionFormFromCore(
  question: QuestionBody,
  key: AnswerKey | null,
): { question: QuestionFormValues; answerKey: AnswerFormValues } {
  const base = defaultQuestion(question.questionType, question.stem)
  const explanation = key?.explanation ?? ''
  const answerKey = { ...base.answerKey, explanation }
  switch (question.questionType) {
    case 'multiple_choice': {
      const correct = key?.questionType === 'multiple_choice' ? key.correctOptionId : null
      return {
        question: {
          ...base.question,
          options: textRows(question.options),
          imageFileId: question.imageFileId,
        },
        answerKey: { ...answerKey, correctOptionId: correct ?? question.options[0]?.id ?? 'a' },
      }
    }
    case 'true_false':
      return {
        question: {
          ...base.question,
          allowNotGiven: question.allowNotGiven,
          imageFileId: question.imageFileId,
        },
        answerKey: {
          ...answerKey,
          answer: key?.questionType === 'true_false' ? key.answer : 'true',
        },
      }
    case 'matching': {
      const pairs = key?.questionType === 'matching' ? key.pairs : []
      const byId = new Map(question.choices.map((choice) => [choice.id, choice]))
      const usedIds = [...question.prompts, ...question.choices].map((row) => row.id)
      const aligned: ItemRow[] = []
      const taken = new Set<string>()
      for (const prompt of question.prompts) {
        const choiceId = pairs.find((pair) => pair.promptId === prompt.id)?.choiceId
        const choice = choiceId === undefined ? undefined : byId.get(choiceId)
        if (choice && !taken.has(choice.id)) {
          aligned.push({ id: choice.id, text: choice.text })
          taken.add(choice.id)
        } else if (choice) {
          const id = nextRowId('c', usedIds)
          usedIds.push(id)
          aligned.push({ id, text: choice.text })
        } else {
          // Anahtarsız eski taslak: eşi boş bir satır; yazar doldurur.
          const id = nextRowId('c', usedIds)
          usedIds.push(id)
          aligned.push({ id, text: '' })
        }
      }
      const distractors = question.choices
        .filter((choice) => !taken.has(choice.id))
        .map(({ id, text }) => ({ id, text }))
      return {
        question: {
          ...base.question,
          prompts: textRows(question.prompts),
          choices: [...aligned, ...distractors],
        },
        answerKey,
      }
    }
    case 'gap_fill': {
      const accepted = new Map(
        key?.questionType === 'gap_fill' ? key.gaps.map((gap) => [gap.gapId, gap.accepted]) : [],
      )
      return {
        question: {
          ...base.question,
          gapEntries: Object.fromEntries(
            question.gaps.map((gap) => [
              gapKey(gap.id),
              {
                accepted: (accepted.get(gap.id) ?? []).join('\n'),
                options: gap.options.join('\n'),
              },
            ]),
          ),
        },
        answerKey,
      }
    }
    case 'ordering': {
      const order = key?.questionType === 'ordering' ? key.order : []
      const byId = new Map(question.items.map((item) => [item.id, item]))
      const sorted = order.flatMap((id) => {
        const item = byId.get(id)
        return item ? [{ id: item.id, text: item.text }] : []
      })
      return {
        question: {
          ...base.question,
          items: sorted.length === question.items.length ? sorted : textRows(question.items),
        },
        answerKey,
      }
    }
    case 'short_answer':
      return {
        question: {
          ...base.question,
          maxLength: question.maxLength,
          imageFileId: question.imageFileId,
        },
        answerKey: {
          ...answerKey,
          acceptedText: key?.questionType === 'short_answer' ? key.accepted.join('\n') : '',
        },
      }
    default:
      return question satisfies never
  }
}

// --- Hata yolu eşlemesi -------------------------------------------------------------------

type PathValues = { content?: { question?: { stem?: string } } }

/**
 * Core (istemci ya da sunucu) hata yolundan form alanı. Formda karşılığı aynı olan yollar
 * değişmez; türetilen alanların hatası onları üreten alana gider:
 * - boşluk listesi ve boşluk cevapları → `content.question.gapEntries.<anahtar>.<alan>`;
 *   boşluksuz ya da tekrarlı işaret → soru kökü;
 * - kısa yanıt cevapları → `answerKey.acceptedText`;
 * - eşleştirme/sıralama anahtarı ve anahtarın tür uyumu → `answerKey.root` (soru alanının altında).
 */
export function formIssuePath(path: readonly PropertyKey[], values: unknown): string {
  const parts = path.map(String)
  const [head, second, third, index, field] = parts
  const stem = (values as PathValues | null)?.content?.question?.stem ?? ''
  const gapAt = (position: string | undefined) => {
    const id = position === undefined ? undefined : gapIdsInStem(stem)[Number(position)]
    return id === undefined ? null : `content.question.gapEntries.${gapKey(id)}`
  }
  if (head === 'content' && second === 'question' && third === 'gaps') {
    if (index === undefined) return 'content.question.stem'
    const gap = gapAt(index)
    return gap ? `${gap}.${field === 'options' ? 'options' : 'accepted'}` : 'content.question.stem'
  }
  if (head === 'answerKey') {
    if (second === 'gaps') {
      const gap = gapAt(third)
      return gap ? `${gap}.accepted` : 'content.question.stem'
    }
    if (second === 'accepted') return 'answerKey.acceptedText'
    if (second === undefined || second === 'pairs' || second === 'order') return 'answerKey.root'
  }
  return parts.join('.')
}

// --- Önizleme ve denetim ------------------------------------------------------------------

export type QuestionPreview =
  { ok: true; question: QuestionBody; answerKey: AnswerKey | null } | { ok: false; message: string }

/**
 * Oynatıcı önizlemesi: soru core şemasından geçerse öğrencinin göreceği karışık dizide döner
 * (`shuffleQuestion`; tohum kökten, böylece yazarken sıra her harfte değişmez). Anahtar geçersizse
 * önizleme yine açılır ama cevap denetlenmez.
 */
export function previewQuestion(
  question: Loose<QuestionFormValues>,
  answer: Loose<AnswerFormValues> | null,
): QuestionPreview {
  const core = coreQuestionFromForm(question, answer)
  const body = questionBodySchema.safeParse(core.question)
  if (!body.success)
    return {
      ok: false,
      message: `Önizleme için soruyu tamamlayın: ${body.error.issues[0]?.message ?? ''}`.trim(),
    }
  const key = answerKeySchema.safeParse(core.answerKey)
  const answerKey = key.success ? key.data : null
  return {
    ok: true,
    question: shuffleQuestion(body.data, answerKey, seededRandom(body.data.stem)),
    answerKey,
  }
}

export type AnswerCheck = { correct: boolean; message: string }

type CheckTags = {
  cefrLevel?: ResourceTags['cefrLevel'] | undefined
  primarySkill?: ResourceTags['primarySkill'] | undefined
  skills?: readonly unknown[] | undefined
}

/**
 * Önizlemede verilen cevabı anahtarla puanlar (DOM-BEC-010, core `scoreItem`): çok maddeli
 * sorularda doğru madde sayısı yazılır. Kısa yanıt karşılaştırma dili etiketlerden gelir.
 */
export function checkPreviewAnswer(
  question: QuestionBody,
  answerKey: AnswerKey,
  response: TaskResponse | undefined,
  tags: CheckTags,
): AnswerCheck {
  const score = scoreItem(
    {
      questionVersionId: 'onizleme',
      points: 1,
      question,
      answerKey,
      locale: answerLocaleForTags({
        cefrLevel: tags.cefrLevel ?? null,
        primarySkill: tags.primarySkill ?? null,
        skills: tags.skills ?? [],
      }),
    },
    response,
  )
  if (!score.answered) return { correct: false, message: 'Önce soruyu cevaplayın.' }
  if (score.correctParts === score.parts) return { correct: true, message: 'Cevap doğru.' }
  return {
    correct: false,
    message:
      score.parts > 1
        ? `Cevap eksik ya da yanlış: ${score.parts} maddeden ${score.correctParts} doğru.`
        : 'Cevap yanlış.',
  }
}

// --- Panel özeti --------------------------------------------------------------------------

export type AnswerSummaryLine = { key: string; marker: string; text: string; correct: boolean }

export type QuestionSummary = {
  typeLabel: string
  stem: string
  lines: AnswerSummaryLine[]
  /** Satırla gösterilmeyen doğru cevap (doğru/yanlış, kısa yanıt). */
  answer: string | null
  explanation: string
}

const GAP_BLANK = '____'

/** Kayıtlı sorunun panel özeti: kök, tür, doğru cevap işaretli satırlar ve çözüm. */
export function questionSummary(question: QuestionBody, key: AnswerKey | null): QuestionSummary {
  const typeLabel = QUESTION_TYPES[question.questionType].label
  const explanation = key?.explanation ?? ''
  const base = { typeLabel, stem: question.stem, lines: [], answer: null, explanation }
  switch (question.questionType) {
    case 'multiple_choice': {
      const correct = key?.questionType === 'multiple_choice' ? key.correctOptionId : null
      return {
        ...base,
        lines: question.options.map((option) => ({
          key: option.id,
          marker: `${option.id}.`,
          text: option.text,
          correct: option.id === correct,
        })),
      }
    }
    case 'true_false': {
      const answer = key?.questionType === 'true_false' ? key.answer : null
      const label = TRUE_FALSE_OPTIONS.find((option) => option.value === answer)?.label ?? null
      return { ...base, answer: label }
    }
    case 'matching': {
      const pairs = key?.questionType === 'matching' ? key.pairs : []
      const choiceText = new Map(question.choices.map((choice) => [choice.id, choice.text]))
      const paired = new Set(pairs.map((pair) => pair.choiceId))
      return {
        ...base,
        lines: [
          ...question.prompts.map((prompt, index) => {
            const choiceId = pairs.find((pair) => pair.promptId === prompt.id)?.choiceId
            const match = choiceId === undefined ? '—' : (choiceText.get(choiceId) ?? '—')
            return {
              key: prompt.id,
              marker: `${index + 1}.`,
              text: `${prompt.text} → ${match}`,
              correct: false,
            }
          }),
          ...question.choices
            .filter((choice) => !paired.has(choice.id))
            .map((choice) => ({
              key: choice.id,
              marker: 'Çeldirici:',
              text: choice.text,
              correct: false,
            })),
        ],
      }
    }
    case 'gap_fill': {
      const accepted = new Map(
        key?.questionType === 'gap_fill' ? key.gaps.map((gap) => [gap.gapId, gap.accepted]) : [],
      )
      return {
        ...base,
        stem: question.stem.replace(GAP_MARKER, GAP_BLANK),
        lines: question.gaps.map((gap, index) => ({
          key: gap.id,
          marker: `${index + 1}. boşluk:`,
          text: (accepted.get(gap.id) ?? []).join(' / ') || '—',
          correct: false,
        })),
      }
    }
    case 'ordering': {
      const order = key?.questionType === 'ordering' ? key.order : question.items.map((i) => i.id)
      const text = new Map(question.items.map((item) => [item.id, item.text]))
      return {
        ...base,
        lines: order.map((id, index) => ({
          key: id,
          marker: `${index + 1}.`,
          text: text.get(id) ?? '—',
          correct: false,
        })),
      }
    }
    case 'short_answer':
      return {
        ...base,
        answer: key?.questionType === 'short_answer' ? key.accepted.join(' / ') : null,
      }
    default:
      return question satisfies never
  }
}
