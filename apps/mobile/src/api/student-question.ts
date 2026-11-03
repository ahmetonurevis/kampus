// Öğrenci "Öğretmenime Sor" ekranının saf modeli (IST-124; DOM-ILT-090, DOM-ILT-091, DOM-ILT-093).
// Liste satırı, durum sekmeleri, soru formu doğrulaması ve hata metinleri burada; ekran
// (`screens/StudentQuestions.tsx`, `screens/question-sheet.tsx`) yalnız çizer. Satır, ders/öğretmen
// seçeneği ve gövde hesapları web ile ortaktır (`@kampus/react-shared/question-model.ts`). Durum
// saklanmaz, kayıttan hesaplanır. Soru fotoğrafı (DOM-ILT-094) telefonda yoktur: soruya fotoğraf
// eklenmişse yalnız bilgi notu gösterilir.
import type { ApiError } from '@kampus/api-client/errors.ts'
import {
  askQuestionBody,
  orderQuestions,
  questionLookups,
  questionRow,
  type AskOption,
  type AskValues,
  type QuestionLookups,
  type QuestionRow,
} from '@kampus/react-shared/question-model.ts'
import type { CollectionRow } from '@kampus/react-shared/collections.ts'
import type { State } from '@kampus/school-core/data/seed.ts'
import {
  QUESTION_STATUS_LABELS,
  askQuestionSchema,
  type AskQuestionInput,
  type QuestionStatus,
} from '@kampus/school-core/lib/questions.ts'
import { QUESTION_MESSAGES } from '@kampus/react-shared/use-question-commands.ts'
import { commandFailure, type CommandFailure, type FieldErrors } from './command-failure.ts'
import { matchesSearch } from './presentation.ts'

export { questionLookups }
export type { QuestionLookups, QuestionRow }

type QuestionItem = CollectionRow<State['questions'][number]>

// --- Liste ---------------------------------------------------------------------------------

/** Süzgeç değeri: boş metin "tümü" demektir (`list-state.ts`). */
export const QUESTION_GROUP_OPTIONS = [
  { value: '', label: 'Tümü' },
  { value: 'pending', label: QUESTION_STATUS_LABELS.pending },
  { value: 'answered', label: QUESTION_STATUS_LABELS.answered },
  { value: 'withdrawn', label: QUESTION_STATUS_LABELS.withdrawn },
] as const satisfies readonly { value: '' | QuestionStatus; label: string }[]

export const isQuestionGroup = (value: string): value is QuestionStatus =>
  value === 'pending' || value === 'answered' || value === 'withdrawn'

/**
 * Öğrencinin satırları, yeniden eskiye. Yanıt süresi alanları (`response`, `overdue`) öğrenci
 * ekranında gösterilmez; `questionRow` bir "şimdi" ister, bu yüzden cihaz saati yerine kaydın kendi
 * gönderim anı verilir (o alanlar hiç okunmaz).
 */
export function studentQuestionRows(
  items: readonly QuestionItem[],
  lookups: QuestionLookups,
): QuestionRow[] {
  return orderQuestions(
    items.map((item) => questionRow(item, lookups, item.record.createdAt)),
    'student',
  )
}

export function questionGroupCounts(
  rows: readonly Pick<QuestionRow, 'state'>[],
): Record<QuestionStatus, number> {
  const counts: Record<QuestionStatus, number> = { pending: 0, answered: 0, withdrawn: 0 }
  for (const row of rows) counts[row.state] += 1
  return counts
}

/** Sekme ve aramaya uyan satırlar (arama: başlık, metin, ders, öğretmen, kazanım, yanıt). */
export function visibleQuestionRows(
  rows: readonly QuestionRow[],
  filter: string,
  search: string,
): QuestionRow[] {
  return rows.filter(
    (row) =>
      (!isQuestionGroup(filter) || row.state === filter) &&
      matchesSearch([row.title, row.text, row.subject, row.teacher, row.topic, row.answer], search),
  )
}

export function questionEmptyText(filter: string): { title: string; text: string } {
  if (filter === 'pending')
    return { title: 'Yanıt bekleyen soru yok', text: 'Tüm sorularının yanıtı geldi.' }
  if (filter === 'answered')
    return { title: 'Yanıtlanan soru yok', text: 'Öğretmenin yanıtladığı sorular burada görünür.' }
  if (filter === 'withdrawn')
    return { title: 'Geri çekilen soru yok', text: 'Geri çektiğin sorular burada görünür.' }
  return {
    title: 'Henüz soru sormadın',
    text: 'Aklına takılan bir konuyu ders öğretmenine "Yeni soru" ile sorabilirsin.',
  }
}

export const questionBadgeTone = (state: QuestionStatus): 'green' | 'amber' | 'primary' =>
  state === 'answered' ? 'green' : state === 'pending' ? 'amber' : 'primary'

/** Yenileme hatası veri varken yerinde (satır içi), tam ekran hata yalnız hiç veri yokken. */
export function questionErrorView(error: unknown, hasData: boolean): 'none' | 'inline' | 'full' {
  if (!error) return 'none'
  return hasData ? 'inline' : 'full'
}

export const PHOTO_NOTE =
  'Bu soruya fotoğraf eklenmiş. Fotoğrafları şimdilik web sürümünden görebilirsin.'

// --- Soru formu ----------------------------------------------------------------------------

export type AskField = 'subjectId' | 'teacherId' | 'topic' | 'title' | 'text'
export type AskErrors = Partial<Record<AskField, string>>

export const EMPTY_ASK: AskValues = { subjectId: '', teacherId: '', topic: '', title: '', text: '' }

export type AskCheck = { ok: true; body: AskQuestionInput } | { ok: false; errors: AskErrors }

/**
 * Gönderimden önce denetim: ders ve öğretmen seçeneklerdeki bir değer olmalı, başlık ve metin core
 * şemasının sınırlarında (`askQuestionSchema`); hepsi tek seferde alan alan döner. Kural core'dadır,
 * burası yalnız gereksiz istek atmamak içindir; karar sunucudadır.
 */
export function checkAsk(values: AskValues, options: readonly AskOption[]): AskCheck {
  const errors: AskErrors = {}
  const body = askQuestionBody(values, options)
  if (!body.ok) errors[body.field] = body.message
  const title = askQuestionSchema.shape.title.safeParse(values.title)
  if (!title.success) errors.title = title.error.issues[0]?.message ?? 'Konu başlığını yazın.'
  const text = askQuestionSchema.shape.text.safeParse(values.text)
  if (!text.success) errors.text = text.error.issues[0]?.message ?? 'Sorunuzu yazın.'
  if (!body.ok || Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, body: body.body }
}

const ASK_FIELDS: readonly string[] = ['subjectId', 'teacherId', 'topic', 'title', 'text']

/** Sunucu alan hatalarının formda karşılığı olanları ve geri kalan genel mesajı ayırır. */
export function askServerFailure(error: ApiError, collected: FieldErrors): AskFailure {
  const failure = commandFailure(error, QUESTION_MESSAGES, collected)
  const errors: AskErrors = {}
  const rest: string[] = []
  for (const [name, message] of Object.entries(failure.fields)) {
    if (ASK_FIELDS.includes(name)) errors[name as AskField] = message
    else rest.push(message)
  }
  const message = [failure.message, ...rest].filter(Boolean).join(' ')
  return { errors, message: message === '' ? null : message, retryable: failure.retryable }
}

export type AskFailure = {
  errors: AskErrors
  message: string | null
  retryable: boolean
}

/** Geri çekme (formsuz): hata tek mesajdır. */
export function withdrawFailure(error: ApiError): CommandFailure {
  return commandFailure(error, QUESTION_MESSAGES)
}

export const WITHDRAW_TEXTS = {
  title: 'Soruyu geri çek',
  description:
    'Yanıtlanmamış sorunu geri çekebilirsin. Soru silinmez; öğretmenin bekleyen sorularından çıkar ve geri alınamaz.',
  confirm: 'Evet, geri çek',
  cancel: 'Vazgeç',
  done: 'Soru geri çekildi.',
} as const

export const ASK_DONE_TEXT = 'Sorun öğretmenine iletildi.'
