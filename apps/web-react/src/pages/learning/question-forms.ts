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
  type AskQuestionInput,
} from '@kampus/school-core/lib/questions.ts'
import type { FileUploadItem } from '@/components/FileUploadField.tsx'
import type { CoreRow } from '@/hooks/use-core-collection.ts'

export type AskTeacher = { id: string; name: string }

/** Bir ders: kazanımları ve o dersi sınıfta veren aktif öğretmenler. */
export type AskOption = {
  subjectId: string
  subject: string
  topics: readonly string[]
  teachers: readonly AskTeacher[]
}

/** Sunucunun daralttığı kayıtlardan ders seçenekleri; öğretmeni olmayan ders sunulmaz. */
export function askOptions(
  assignments: readonly CoreRow<'assignments'>[],
  teachers: readonly CoreRow<'teachers'>[],
  subjects: readonly CoreRow<'subjects'>[],
): AskOption[] {
  const active = new Map(
    teachers
      .filter(({ record }) => record.isActive !== false && !record.deletedAt)
      .map(({ record }) => [record.id, record.name]),
  )
  const options: AskOption[] = []
  for (const { record: subject } of subjects) {
    const ids = [
      ...new Set(
        assignments
          .filter(({ record }) => record.subjectId === subject.id)
          .map(({ record }) => record.teacherId),
      ),
    ]
    const people = ids.flatMap((id): AskTeacher[] => {
      const name = active.get(id)
      return name === undefined ? [] : [{ id, name }]
    })
    if (people.length > 0)
      options.push({
        subjectId: subject.id,
        subject: subject.name,
        topics: subject.topics,
        teachers: people.sort((a, b) => a.name.localeCompare(b.name, 'tr')),
      })
  }
  return options.sort((a, b) => a.subject.localeCompare(b.subject, 'tr'))
}

export const optionOf = (options: readonly AskOption[], subjectId: string) =>
  options.find((option) => option.subjectId === subjectId)

/**
 * Formdaki öğretmen değeri: seçilen öğretmen dersin öğretmenlerindense o, dersin tek öğretmeni
 * varsa o (seçim gerekmez), aksi hâlde boş (öğrenci seçer).
 */
export function teacherChoice(option: AskOption | undefined, selected: string): string {
  if (!option) return ''
  if (option.teachers.some((teacher) => teacher.id === selected)) return selected
  return option.teachers.length === 1 ? (option.teachers[0]?.id ?? '') : ''
}

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

export type AskOutcome =
  | { ok: true; body: AskQuestionInput }
  | { ok: false; field: 'subjectId' | 'teacherId' | 'topic'; message: string }

/**
 * Gönderilecek gövde: ders ve öğretmen seçeneklerdeki bir değer olmalı (kapsam dışı değer istek
 * atmadan reddedilir), kazanım yalnız dersin listesinden, boşsa gönderilmez. Mesajlar sunucuyla
 * aynıdır.
 */
export function askQuestionBody(values: AskFormValues, options: readonly AskOption[]): AskOutcome {
  const option = optionOf(options, values.subjectId)
  if (!option) return { ok: false, field: 'subjectId', message: 'Bir ders seçin.' }
  const teacherId = teacherChoice(option, values.teacherId)
  if (teacherId === '') return { ok: false, field: 'teacherId', message: 'Öğretmen seçin.' }
  const topic = values.topic.trim()
  if (topic !== '' && !option.topics.includes(topic))
    return { ok: false, field: 'topic', message: 'Kazanım bu derse ait değil.' }
  return {
    ok: true,
    body: {
      subjectId: option.subjectId,
      teacherId,
      ...(topic === '' ? {} : { topic }),
      title: values.title.trim(),
      text: values.text.trim(),
      ...(values.files.length === 0 ? {} : { fileIds: values.files.map((file) => file.id) }),
    },
  }
}

export const answerFormSchema = z.object({ text: answerQuestionSchema.shape.text })
export type AnswerFormValues = z.input<typeof answerFormSchema>

export const answerDefaults = (): AnswerFormValues => ({ text: '' })
