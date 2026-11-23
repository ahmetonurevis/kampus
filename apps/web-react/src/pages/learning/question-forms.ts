// Öğretmenime Sor formlarının saf mantığı: ders/öğretmen seçenekleri, soru ve yanıt gövdeleri.
// Kuralın kendisi core'dadır (`lib/questions.ts`); burası kullanıcıya kapsam dışı seçenek
// göstermemek ve sunucuya gereksiz istek atmamak içindir. Seçenekler sunucunun kapsamladığı
// koleksiyonlardan (öğrencinin sınıfının atamaları, ders öğretmenleri, dersler) kurulur; istemci
// ders veya öğretmen uydurmaz. Karar yine sunucudadır (DOM-ILT-090).
import { z } from 'zod'
import {
  answerQuestionSchema,
  askQuestionSchema,
  QUESTION_PHOTO_LIMIT,
} from '@kampus/school-core/lib/questions.ts'
import type { FileUploadItem } from '@/components/FileUploadField.tsx'

export {
  askOptions,
  optionOf,
  teacherChoice,
  type AskOption,
  type AskTeacher,
} from '@kampus/react-shared/question-model.ts'

export const askFormSchema = z.object({
  subjectId: askQuestionSchema.shape.subjectId,
  teacherId: z.string(),
  topic: z.string(),
  title: askQuestionSchema.shape.title,
  text: askQuestionSchema.shape.text,
  /** Yüklenmiş fotoğraflar (`student_question_photo`); gövdeye yalnız kimlikleri gider. */
  files: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string(),
        key: z.string().optional(),
      }) satisfies z.ZodType<FileUploadItem>,
    )
    .max(QUESTION_PHOTO_LIMIT, `En fazla ${QUESTION_PHOTO_LIMIT} fotoğraf ekleyebilirsiniz.`),
})
export type AskFormValues = z.input<typeof askFormSchema>

export function askDefaults(): AskFormValues {
  return { subjectId: '', teacherId: '', topic: '', title: '', text: '', files: [] }
}

/**
 * Yüklenen fotoğrafı listeye ekler; aynı kimlik (aynı dosya yeniden seçildi, sunucu aynı kaydı
 * döndürdü) iki kez eklenmez ve liste soru sınırında kalır (DOM-ILT-094). `FileUploadField`
 * `maxFiles` ile sınırı yüklemeden önce uygular (sınıra varınca seçim kapanır, fazlası
 * yüklenmeden reddedilip alan hatası gösterilir); buradaki `slice` yalnız korumadır, normal
 * akışta bir şey atmaz.
 */
export function addQuestionPhoto(
  current: readonly FileUploadItem[],
  item: FileUploadItem,
): FileUploadItem[] {
  if (current.some((file) => file.id === item.id)) return [...current]
  return [...current, item].slice(0, QUESTION_PHOTO_LIMIT)
}

/** Form alanı adı: formun alanları ya da `root` hatası (react-hook-form `setError` adı). */
export type AskFieldName = keyof AskFormValues | 'root' | `root.${string}`

const ASK_FIELDS: readonly string[] = Object.keys(askDefaults())

function isAskFieldName(name: string): name is AskFieldName {
  return ASK_FIELDS.includes(name) || name === 'root' || name.startsWith('root.')
}

/**
 * Sunucunun alan adı → formdaki alan (fotoğraf listesi formda `files`'tır). Formda karşılığı
 * olmayan ad görünmez kalmasın diye form düzeyi hataya (`root.server`) düşer.
 */
export function askFieldName(name: string): AskFieldName {
  if (name === 'fileIds' || name.startsWith('fileIds.')) return 'files'
  return isAskFieldName(name) ? name : 'root.server'
}

export { askQuestionBody, type AskOutcome } from '@kampus/react-shared/question-model.ts'

export const answerFormSchema = z.object({ text: answerQuestionSchema.shape.text })
export type AnswerFormValues = z.input<typeof answerFormSchema>

export const answerDefaults = (): AnswerFormValues => ({ text: '' })
