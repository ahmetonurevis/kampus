// Öğretmenime Sor formlarının saf mantığı: ders/öğretmen seçenekleri, soru ve yanıt gövdeleri.
// Kuralın kendisi core'dadır (`lib/questions.ts`); burası kullanıcıya kapsam dışı seçenek
// göstermemek ve sunucuya gereksiz istek atmamak içindir. Seçenekler sunucunun kapsamladığı
// koleksiyonlardan (öğrencinin sınıfının atamaları, ders öğretmenleri, dersler) kurulur; istemci
// ders veya öğretmen uydurmaz. Karar yine sunucudadır (DOM-ILT-090).
import { z } from 'zod'
import {
  answerQuestionSchema,
  askQuestionSchema,
  type AskQuestionInput,
} from '@kampus/school-core/lib/questions.ts'
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
})
export type AskFormValues = z.input<typeof askFormSchema>

export function askDefaults(): AskFormValues {
  return { subjectId: '', teacherId: '', topic: '', title: '', text: '' }
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
    },
  }
}

export const answerFormSchema = z.object({ text: answerQuestionSchema.shape.text })
export type AnswerFormValues = z.input<typeof answerFormSchema>

export const answerDefaults = (): AnswerFormValues => ({ text: '' })
