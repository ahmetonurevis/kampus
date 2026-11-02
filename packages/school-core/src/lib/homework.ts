import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import type { RequestActor } from './requests.ts'

/**
 * Ödev ve teslim (`homework`, `submissions`, modül `learning`; IST-095, docs/domain/akademik-olcme.md
 * DOM-AKD-070…074). Saf işlemler; önce bütün kurallar denetlenir, sonra State değişir. Yetki
 * `lib/authorize.ts` tablosundadır (`homework.assign`, `homework.update`, `homework.archive`,
 * `homework.submit`, `homework.grade`).
 *
 * - Ödevi derse giren öğretmen kendi sınıf ve branşına, yönetici her sınıfa verir; ödevin
 *   öğretmeni ders atamasından çözülür (DOM-AKD-070). Son teslim anı geçmişte olamaz.
 * - Ödevi ödevin öğretmeni ya da yönetici düzenler; sınıf ve ders değişmez. Teslim almış ödev
 *   arşivlenmez: teslim, puan ve geri bildirim korunur (DOM-AKD-071).
 * - Öğrenci kendi sınıfının ödevini metin ve/veya dosyayla teslim eder; puanlanana kadar yeniden
 *   teslim eder. Son tarihten sonraki teslim ödev geç teslime açıksa `late` işaretiyle kabul
 *   edilir, kapalıysa reddedilir (DOM-AKD-072).
 * - Teslimi ödevin öğretmeni 0–100 tam sayı puan ve geri bildirimle değerlendirir; puan resmî not
 *   değildir (DOM-AKD-060, DOM-AKD-073). Puanlanınca öğrenciye ve veliye bildirim gider (API).
 * - Öğrenci kendi teslimini, veli bağlı çocuğunun teslimini, öğretmen sınıflarındaki öğrencilerin
 *   teslimini görür (`platform/scope.ts`, DOM-AKD-074).
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`). Dosya kimlikleri dosya
 * ucundan (`POST /files`, amaç `submission`) gelir; bağlama ve sahiplik denetimi API'dedir
 * (ADR 0003 karar 5).
 */

z.config(z.locales.tr())

export type HomeworkOptions = { institutionType?: InstitutionType }

export const HOMEWORK_TITLE_MAX_LENGTH = 120
export const HOMEWORK_DESCRIPTION_MAX_LENGTH = 4000
export const SUBMISSION_NOTE_MAX_LENGTH = 4000
export const SUBMISSION_FILE_LIMIT = 5
export const HOMEWORK_FEEDBACK_MAX_LENGTH = 2000
export const HOMEWORK_SCORE_MAX = 100

const identifier = (message: string) => z.string().trim().min(1, message).max(200)

const title = z
  .string()
  .trim()
  .min(2, 'Ödev başlığını yazın.')
  .max(
    HOMEWORK_TITLE_MAX_LENGTH,
    `Ödev başlığı en fazla ${HOMEWORK_TITLE_MAX_LENGTH} karakter olabilir.`,
  )
const description = z
  .string()
  .trim()
  .min(2, 'Ödev açıklamasını yazın.')
  .max(
    HOMEWORK_DESCRIPTION_MAX_LENGTH,
    `Açıklama en fazla ${HOMEWORK_DESCRIPTION_MAX_LENGTH} karakter olabilir.`,
  )
/** Son teslim anı: saat dilimli ISO 8601 (`2026-10-09T23:59:00+03:00`); UTC'ye çevrilip saklanır. */
const dueDate = z.iso.datetime({ offset: true, error: 'Son teslim tarihini ve saatini seçin.' })
const allowLate = z.boolean()

export const assignHomeworkSchema = z.strictObject({
  classId: identifier('Sınıf seçin.'),
  /** Ders; öğretmen sınıfa tek dersle giriyorsa verilmeyebilir. Yöneticide zorunlu. */
  subjectId: identifier('Ders seçin.').optional(),
  title,
  description,
  dueDate,
  /** Son tarihten sonra teslim kabul edilir mi (geç teslim işaretiyle); varsayılan `true`. */
  allowLate: allowLate.optional(),
})
export type AssignHomeworkInput = z.input<typeof assignHomeworkSchema>

/** Kısmi düzenleme: sınıf ve ders değişmez (gövdede 400); en az bir alan. */
export const updateHomeworkSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    dueDate: dueDate.optional(),
    allowLate: allowLate.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'En az bir alan gönderin.',
  })
export type UpdateHomeworkInput = z.input<typeof updateHomeworkSchema>

export const submitHomeworkSchema = z
  .strictObject({
    // kvkk: Ç — öğrencinin teslim metni; loglanmaz, denetim kaydına yalnız alan adı yazılır.
    note: z
      .string()
      .trim()
      .max(
        SUBMISSION_NOTE_MAX_LENGTH,
        `En fazla ${SUBMISSION_NOTE_MAX_LENGTH} karakter yazabilirsiniz.`,
      )
      .optional(),
    /** Dosya ucundan (`POST /files`, amaç `submission`) yüklenen, öğrencinin kendi dosyaları. */
    fileIds: z
      .array(identifier('Dosya kimliği geçersiz.'))
      .max(SUBMISSION_FILE_LIMIT, `En fazla ${SUBMISSION_FILE_LIMIT} dosya ekleyebilirsiniz.`)
      .refine((ids) => new Set(ids).size === ids.length, 'Aynı dosyayı bir kez ekleyin.')
      .optional(),
  })
  .refine((body) => (body.note?.length ?? 0) > 0 || (body.fileIds?.length ?? 0) > 0, {
    message: 'Teslim için açıklama yazın ya da dosya ekleyin.',
    path: ['note'],
  })
export type SubmitHomeworkInput = z.input<typeof submitHomeworkSchema>

export const gradeSubmissionSchema = z.strictObject({
  score: z
    .number('Puanı sayı olarak girin.')
    .int('Puan tam sayı olmalı.')
    .min(0, `Puan 0–${HOMEWORK_SCORE_MAX} arasında olmalı.`)
    .max(HOMEWORK_SCORE_MAX, `Puan 0–${HOMEWORK_SCORE_MAX} arasında olmalı.`),
  // kvkk: Ç — öğretmenin öğrenciye geri bildirimi; loglanmaz.
  feedback: z
    .string()
    .trim()
    .min(2, 'Geri bildirimi yazın.')
    .max(
      HOMEWORK_FEEDBACK_MAX_LENGTH,
      `En fazla ${HOMEWORK_FEEDBACK_MAX_LENGTH} karakter yazabilirsiniz.`,
    ),
})
export type GradeSubmissionInput = z.input<typeof gradeSubmissionSchema>

/** Ödev işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type HomeworkFields = {
  /** Eksikse `true` (eski kayıtlar geç teslimi kabul ederdi). */
  allowLate?: boolean
  createdBy?: RequestActor
  updatedAt?: string
}

/** Teslim işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type SubmissionFields = {
  /** Teslime bağlı dosyalar (`files` tablosu); kayıt yalnız kimlik taşır (ADR 0003). */
  fileIds?: string[]
  /** Teslim anında son tarih geçmiş miydi; son tarih sonradan değişse de korunur. */
  late?: boolean
  submittedBy?: RequestActor
  gradedAt?: string
  gradedBy?: RequestActor
  updatedAt?: string
}

/** Yetkinin dayandığı ödev tarafları (DOM-AKD-071). */
export type HomeworkParties = { classId: string; teacherId: string }

type HomeworkRecord = State['homework'][number]
type SubmissionRecord = State['submissions'][number]

const actorOf = (by: Participant): RequestActor => ({ role: by.role, userId: by.userId })
const instant = (value: string) => new Date(value).toISOString()

/** Ödev son tarihten sonra teslim alıyor mu; alanı olmayan eski kayıt alır. */
export const acceptsLate = (homework: Pick<HomeworkFields, 'allowLate'>) =>
  homework.allowLate !== false

/**
 * Teslim geç mi: kayıt `late` taşıyorsa o (teslim anındaki karar), taşımıyorsa (eski kayıt)
 * teslim anı son tarihten sonra mı.
 */
export function isLateSubmission(
  submission: { submittedAt: string; late?: boolean },
  homework: { dueDate: string },
): boolean {
  if (typeof submission.late === 'boolean') return submission.late
  return Date.parse(submission.submittedAt) > Date.parse(homework.dueDate)
}

/** Ödevin son tarihi geçmiş mi (liste süzgeci `closed`). */
export const isHomeworkClosed = (homework: { dueDate: string }, now: string) =>
  Date.parse(homework.dueDate) < Date.parse(now)

function linkedStudentId(state: State, by: Participant): string | undefined {
  if (by.role !== 'ogrenci') return undefined
  const ids = new Set(
    by.links.filter((link) => link.kind === 'student').map((link) => link.recordId),
  )
  const found = state.students.filter((s) => ids.has(s.id))
  return found.length === 1 ? found[0]?.id : undefined
}

const homeworkNotFound = () =>
  new DomainError('homework_not_found', 'Ödev bulunamadı.', { kind: 'not_found' })
const submissionNotFound = () =>
  new DomainError('submission_not_found', 'Ödev teslimi bulunamadı.', { kind: 'not_found' })

function assertFutureDue(due: string, now: string) {
  if (Date.parse(due) <= Date.parse(now))
    throw new DomainError('homework_due_in_past', 'Son teslim tarihi geçmişte olamaz.', {
      path: ['dueDate'],
    })
}

/**
 * Ödev ver (DOM-AKD-070). Öğretmen yalnız derse girdiği sınıf ve branşa (403
 * `homework_scope_denied`); sınıfa birden çok dersle giren öğretmen dersi seçer (422
 * `homework_subject_required`). Yönetici dersi seçer; ödevin öğretmeni sınıfın o dersine atanmış
 * öğretmendir (yoksa 422 `homework_teacher_unavailable`). Olmayan sınıf 404, pasif sınıf 422
 * `record_inactive`, geçmiş son tarih 422 `homework_due_in_past`.
 */
export function assignHomework(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: HomeworkOptions = {},
): HomeworkRecord & HomeworkFields {
  const data = assignHomeworkSchema.parse(input)
  const teacherId =
    by.role === 'ogretmen' ? by.links.find((link) => link.kind === 'teacher')?.recordId : undefined
  let subjectId = data.subjectId
  if (subjectId === undefined) {
    if (by.role !== 'ogretmen')
      throw new DomainError('homework_subject_required', 'Ödevin dersini seçin.', {
        path: ['subjectId'],
      })
    const subjects = [
      ...new Set(
        state.assignments
          .filter((a) => a.classId === data.classId && a.teacherId === teacherId)
          .map((a) => a.subjectId),
      ),
    ]
    // Sınıfa girmeyen öğretmen yetki denetiminde 403 alır; dersi tek olan öğretmen seçmez.
    subjectId = subjects.length === 1 ? subjects[0] : undefined
    if (subjects.length > 1)
      throw new DomainError('homework_subject_required', 'Ödevin dersini seçin.', {
        path: ['subjectId'],
      })
  }
  requireAuthorized(
    by,
    'homework.assign',
    { classId: data.classId, subjectId: subjectId ?? '' },
    state,
    options,
  )
  const classroom: { id: string; isActive?: boolean; deletedAt?: string | null } | undefined =
    state.classes.find((c) => c.id === data.classId)
  if (!classroom)
    throw new DomainError('class_not_found', 'Sınıf bulunamadı.', { kind: 'not_found' })
  if (classroom.isActive === false || classroom.deletedAt)
    throw new DomainError('record_inactive', 'Pasif sınıfa ödev verilemez.', {
      path: ['classId'],
    })
  const assignment = state.assignments.find(
    (a) =>
      a.classId === data.classId &&
      a.subjectId === subjectId &&
      (teacherId === undefined || a.teacherId === teacherId),
  )
  const teacher = state.teachers.find((t) => t.id === assignment?.teacherId)
  if (!assignment || !teacher || teacher.isActive === false || teacher.deletedAt)
    throw new DomainError(
      'homework_teacher_unavailable',
      'Bu sınıfın bu dersine atanmış aktif öğretmen yok.',
      { path: ['subjectId'] },
    )
  const due = instant(data.dueDate)
  assertFutureDue(due, now)
  const subject = state.subjects.find((s) => s.id === assignment.subjectId)
  const homework: HomeworkRecord & HomeworkFields = {
    id: makeId('hw'),
    classId: classroom.id,
    subjectId: assignment.subjectId,
    teacherId: teacher.id,
    subject: subject?.name ?? '',
    title: data.title,
    description: data.description,
    dueDate: due,
    allowLate: data.allowLate ?? true,
    createdAt: now,
    createdBy: actorOf(by),
    updatedAt: now,
  }
  // Yeni kayıt sona eklenir: API koleksiyonu kısmi yükler (yalnız sona ekleme serbesttir).
  state.homework.push(homework)
  return homework
}

function findHomework(state: State, homeworkId: string) {
  return state.homework.find((h) => h.id === homeworkId)
}
const partiesOf = (homework: HomeworkRecord | undefined): HomeworkParties | undefined =>
  homework && { classId: homework.classId, teacherId: homework.teacherId }

/**
 * Ödevi düzenle (DOM-AKD-071): başlık, açıklama, son tarih ve geç teslim. Sınıf ve ders
 * değişmez. Yeni son tarih geçmişte olamaz (422 `homework_due_in_past`). Ödevin öğretmeni ya da
 * yönetici düzenler; ödevi gören başka öğretmen 403 `homework_not_owner`, görmeyen 404.
 */
export function updateHomework(
  state: State,
  by: Participant,
  homeworkId: string,
  input: unknown,
  now: string,
  options: HomeworkOptions = {},
): HomeworkRecord & HomeworkFields {
  const data = updateHomeworkSchema.parse(input)
  const homework: (HomeworkRecord & HomeworkFields) | undefined = findHomework(state, homeworkId)
  requireAuthorized(by, 'homework.update', { homework: partiesOf(homework) }, state, options)
  if (!homework) throw homeworkNotFound()
  const due = data.dueDate === undefined ? undefined : instant(data.dueDate)
  if (due !== undefined && due !== homework.dueDate) assertFutureDue(due, now)
  Object.assign(homework, {
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(due === undefined ? {} : { dueDate: due }),
    ...(data.allowLate === undefined ? {} : { allowLate: data.allowLate }),
    updatedAt: now,
  })
  return homework
}

/**
 * Ödevi arşivle (DOM-AKD-071): kayıt State'ten çıkar (API arşivler, silmez). Teslim almış ödev
 * arşivlenmez: 409 `homework_has_submissions` (öğrencinin çalışması, puanı ve geri bildirimi
 * korunur). Yetki düzenlemeyle aynıdır.
 */
export function archiveHomework(
  state: State,
  by: Participant,
  homeworkId: string,
  options: HomeworkOptions = {},
): HomeworkRecord & HomeworkFields {
  const homework = findHomework(state, homeworkId)
  requireAuthorized(by, 'homework.archive', { homework: partiesOf(homework) }, state, options)
  if (!homework) throw homeworkNotFound()
  if (state.submissions.some((s) => s.homeworkId === homework.id))
    throw new DomainError(
      'homework_has_submissions',
      'Teslim alınmış ödev arşivlenemez; teslimler ve puanlar korunur.',
      { kind: 'conflict' },
    )
  state.homework = state.homework.filter((h) => h.id !== homework.id)
  return homework
}

export type SubmitOutcome = {
  submission: SubmissionRecord & SubmissionFields
  /** İlk teslim mi (201) yoksa yeniden teslim mi (200). */
  created: boolean
  /** Bu teslimle yeni bağlanacak dosyalar (önceki teslimde olmayanlar). */
  attach: string[]
}

/**
 * Ödevi teslim et (DOM-AKD-072). Öğrenci oturumdan çözülür; yalnız kendi sınıfının ödevi (başka
 * sınıfın ödevi ve olmayan ödev 404). Pasif öğrenci 422 `student_inactive`. Son tarih geçmişse
 * ödev geç teslime açıksa `late: true` ile kabul edilir, değilse 422 `homework_closed`.
 * Puanlanmış teslim değişmez (409 `submission_graded`); puanlanmamışsa yeniden teslim aynı kaydı
 * günceller. `fileNames` dosya kimliğinden özgün ada eşlemedir (eski görünümlerin `fileName`
 * alanı için; API dosya satırından verir).
 */
export function submitHomework(
  state: State,
  by: Participant,
  homeworkId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: HomeworkOptions & { fileNames?: ReadonlyMap<string, string> } = {},
): SubmitOutcome {
  const data = submitHomeworkSchema.parse(input)
  const studentId = linkedStudentId(state, by)
  const homework: (HomeworkRecord & HomeworkFields) | undefined = findHomework(state, homeworkId)
  requireAuthorized(
    by,
    'homework.submit',
    { studentId, homework: homework && { classId: homework.classId } },
    state,
    options,
  )
  const student = state.students.find((s) => s.id === studentId)
  if (!homework) throw homeworkNotFound()
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError('student_inactive', 'Kaydı pasif olan öğrenci ödev teslim edemez.')
  const late = isHomeworkClosed(homework, now)
  if (late && !acceptsLate(homework))
    throw new DomainError('homework_closed', 'Bu ödevin teslim süresi doldu.', {
      path: ['note'],
    })
  const fileIds = data.fileIds ?? []
  const fileName = fileIds.length > 0 ? (options.fileNames?.get(fileIds[0] ?? '') ?? '') : ''
  const existing: (SubmissionRecord & SubmissionFields) | undefined = state.submissions.find(
    (s) => s.homeworkId === homework.id && s.studentId === student.id,
  )
  if (existing && existing.score != null)
    throw new DomainError('submission_graded', 'Değerlendirilmiş ödev yeniden teslim edilemez.', {
      kind: 'conflict',
    })
  const fields = {
    note: data.note ?? '',
    fileIds,
    fileName,
    submittedAt: now,
    late,
    submittedBy: actorOf(by),
    updatedAt: now,
  }
  if (existing) {
    const previous = new Set(existing.fileIds ?? [])
    Object.assign(existing, fields)
    return {
      submission: existing,
      created: false,
      attach: fileIds.filter((id) => !previous.has(id)),
    }
  }
  const submission: SubmissionRecord & SubmissionFields = {
    id: makeId('sub'),
    homeworkId: homework.id,
    studentId: student.id,
    score: null,
    feedback: '',
    ...fields,
  }
  state.submissions.push(submission)
  return { submission, created: true, attach: fileIds }
}

/**
 * Teslimi değerlendir (DOM-AKD-073): ödevin öğretmeni 0–100 tam sayı puan ve geri bildirim
 * yazar; yeniden değerlendirme puanı ve geri bildirimi günceller. Ödevi gören başka öğretmen 403
 * `homework_not_owner`; görmeyen ve başka ödevin teslimi 404. Puan resmî not değildir
 * (DOM-AKD-060); not defterine aktarım ayrı işlemdir.
 */
export function gradeSubmission(
  state: State,
  by: Participant,
  homeworkId: string,
  submissionId: string,
  input: unknown,
  now: string,
  options: HomeworkOptions = {},
): SubmissionRecord & SubmissionFields {
  const data = gradeSubmissionSchema.parse(input)
  const homework = findHomework(state, homeworkId)
  requireAuthorized(by, 'homework.grade', { homework: partiesOf(homework) }, state, options)
  if (!homework) throw homeworkNotFound()
  const submission: (SubmissionRecord & SubmissionFields) | undefined = state.submissions.find(
    (s) => s.id === submissionId && s.homeworkId === homework.id,
  )
  if (!submission) throw submissionNotFound()
  Object.assign(submission, {
    score: data.score,
    feedback: data.feedback,
    gradedAt: now,
    gradedBy: actorOf(by),
    updatedAt: now,
  })
  return submission
}
