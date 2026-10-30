import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { requireAuthorized } from './authorize.ts'
import {
  DEFAULT_WORKING_CALENDAR,
  responseDueAt,
  type Participant,
  type WorkingCalendar,
} from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import type { RequestActor } from './requests.ts'

/**
 * Öğretmenime Sor (`questions`, modül `learning`; docs/domain/iletisim-ve-veli.md DOM-ILT-090…093).
 * Saf işlemler; önce bütün kurallar denetlenir, sonra State değişir. Yetki `lib/authorize.ts`
 * tablosundadır (`question.ask`, `question.answer`, `question.withdraw`).
 *
 * - Öğrenci yalnız kendi sınıfının o dersine atanmış öğretmene soru gönderir; öğretmeni sunucu
 *   ders atamasından çözer (DOM-ILT-090, DOM-ILT-011). Pasif öğrenci soru gönderemez.
 * - Gönderilen soru (başlık, metin, ders, kazanım) değişmez. Öğrenci yanıtlanmamış sorusunu geri
 *   çekebilir; kayıt silinmez, `withdrawnAt` yazılır (DOM-ILT-091).
 * - Yanıtı yalnız sorunun atandığı öğretmen yazar; ders öğretmeni değişince açık sorular yeni
 *   öğretmene taşınır (`class.save`, `record.archive`). Verilmiş yanıt değişmez; düzeltme ek
 *   yanıtla (`followUps`) yapılır (DOM-ILT-092).
 * - Yanıt süresi saklanmaz; `questionResponse` ile hesaplanır (DOM-ILT-013, DOM-ILT-093).
 *
 * Eski kayıtlar ve örnek veri `answer` + `answeredAt` alanlarını taşır; ilk yanıt bu alanlara
 * yazıldığı için SLA raporu ve Vue/telefon görünümü aynı alanları okumaya devam eder.
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`).
 */

z.config(z.locales.tr())

export type QuestionOptions = { institutionType?: InstitutionType }

export const QUESTION_TITLE_MAX_LENGTH = 120
export const QUESTION_TEXT_MIN_LENGTH = 10
export const QUESTION_TEXT_MAX_LENGTH = 2000
export const QUESTION_ANSWER_MAX_LENGTH = 2000
/** İlk yanıt ve ek yanıtlar birlikte; kaydın sınırsız büyümesini önler (DOM-ILT-092). */
export const QUESTION_ANSWER_LIMIT = 10

/**
 * Soru formunun özel nitelikli veri uyarısı (DOM-ILT-014). Sağlık, ilaç, engellilik veya aile içi
 * hassas bilgi soru kanalıyla değil yapılandırılmış kanaldan (rehberlik randevusu, sağlık bilgisi
 * formu) iletilir; form bu metni gösterir.
 */
export const QUESTION_SENSITIVE_NOTICE =
  'Sağlık durumu, ilaç veya ailenize ait özel bilgileri buraya yazmayın; bunun için rehberlik servisinden randevu alın.'

const identifier = (message: string) => z.string().trim().min(1, message).max(200)

// kvkk: Ç — öğrencinin serbest metni; loglanmaz, denetim kaydına yalnız alan adı yazılır.
const questionText = z
  .string()
  .trim()
  .min(QUESTION_TEXT_MIN_LENGTH, `Sorunuzu en az ${QUESTION_TEXT_MIN_LENGTH} karakterle açıklayın.`)
  .max(QUESTION_TEXT_MAX_LENGTH, `En fazla ${QUESTION_TEXT_MAX_LENGTH} karakter yazabilirsiniz.`)

/**
 * Gövde katıdır: öğrenci kimliği (`studentId`) ve bilinmeyen alan reddedilir (API 400). Öğrenci
 * oturumdan, öğretmen ders atamasından çözülür; `teacherId` yalnız formun gösterdiği öğretmenin
 * hâlâ o dersin öğretmeni olduğunu doğrulamak içindir.
 */
export const askQuestionSchema = z.strictObject({
  subjectId: identifier('Bir ders seçin.'),
  teacherId: identifier('Öğretmen seçin.').optional(),
  /** Dersin kazanımı/konusu (`subjects[].topics`); verilmezse soru yalnız derse bağlıdır. */
  topic: z.string().trim().min(1, 'Kazanımı seçin.').max(200).optional(),
  title: z
    .string()
    .trim()
    .min(2, 'Konu başlığını yazın.')
    .max(
      QUESTION_TITLE_MAX_LENGTH,
      `Konu başlığı en fazla ${QUESTION_TITLE_MAX_LENGTH} karakter olabilir.`,
    ),
  text: questionText,
  /** Ek dosya; dosya deposu gelene kadar kabul edilmez (422 `question_files_unsupported`). */
  files: z.array(z.string().trim().min(1).max(200)).max(3).optional(),
})
export type AskQuestionInput = z.input<typeof askQuestionSchema>

export const answerQuestionSchema = z.strictObject({
  // kvkk: Ç — öğretmenin yanıtı; loglanmaz.
  text: z
    .string()
    .trim()
    .min(2, 'Yanıtı yazın.')
    .max(
      QUESTION_ANSWER_MAX_LENGTH,
      `En fazla ${QUESTION_ANSWER_MAX_LENGTH} karakter yazabilirsiniz.`,
    ),
})
export type AnswerQuestionInput = z.input<typeof answerQuestionSchema>

/**
 * Geri çekme tek izinli kısmi güncellemedir: başlık, metin, ders veya kazanım gönderilirse gövde
 * reddedilir (400; gönderilen soru değişmez, DOM-ILT-091).
 */
export const withdrawQuestionSchema = z.strictObject({
  withdrawn: z.literal(true, 'Soruda yalnız geri çekme yapılabilir.'),
})
export type WithdrawQuestionInput = z.input<typeof withdrawQuestionSchema>

export type QuestionAnswer = {
  id: string
  // kvkk: Ç — öğretmenin ek yanıtı; loglanmaz.
  text: string
  at: string
  by: RequestActor
}
/** Soru işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type QuestionFields = {
  /** Dersin kazanımı/konusu (`subjects[].topics`). */
  topic?: string
  askedBy?: RequestActor
  /** İlk yanıtı yazan öğretmen; ilk yanıtın metni `answer`, anı `answeredAt`'tadır. */
  answeredBy?: RequestActor
  /** İlk yanıttan sonra eklenen düzeltme/ek yanıtlar; eklenir, düzenlenmez ve silinmez. */
  followUps?: QuestionAnswer[]
  withdrawnAt?: string
  withdrawnBy?: RequestActor
  updatedAt?: string
}

type QuestionRecord = State['questions'][number]
type QuestionTimes = Pick<QuestionRecord, 'createdAt' | 'answeredAt'> &
  Pick<QuestionFields, 'withdrawnAt'>

const actorOf = (by: Participant): RequestActor => ({ role: by.role, userId: by.userId })

export const QUESTION_STATUSES = ['pending', 'answered', 'withdrawn'] as const
export type QuestionStatus = (typeof QUESTION_STATUSES)[number]
export const QUESTION_STATUS_LABELS: Record<QuestionStatus, string> = {
  pending: 'Yanıt bekliyor',
  answered: 'Yanıtlandı',
  withdrawn: 'Geri çekildi',
}

/** Sorunun durumu saklanmaz; yanıt ve geri çekme anından türetilir. */
export function questionStatus(question: QuestionTimes): QuestionStatus {
  if (question.answeredAt) return 'answered'
  if (question.withdrawnAt) return 'withdrawn'
  return 'pending'
}

/**
 * Yanıt bekleyen soru: yanıtlanmamış ve geri çekilmemiş. Ders öğretmeni değişince yalnız bunlar
 * yeni öğretmene taşınır; öğretmen arşivinde yalnız bunlar devir ister (`lib/school-management.ts`).
 */
export function isOpenQuestion(question: QuestionTimes): boolean {
  return questionStatus(question) === 'pending'
}

/**
 * Öğrenci aktörün öğrenci kaydı: oturumdaki `student` bağlantısı kurumda var olan tek kayıt olmalı.
 * Bağlantısız, birden çok bağlantılı veya başka kurumun öğrencisine bağlı aktör `undefined` alır.
 */
function linkedStudentId(state: State, by: Participant): string | undefined {
  if (by.role !== 'ogrenci') return undefined
  const ids = new Set(
    by.links.filter((link) => link.kind === 'student').map((link) => link.recordId),
  )
  const found = state.students.filter((s) => ids.has(s.id))
  return found.length === 1 ? found[0]?.id : undefined
}

/**
 * Öğrenci kendi sınıfının o dersine atanmış öğretmene soru gönderir (DOM-ILT-090). Öğretmen ders
 * atamasından çözülür; kapsam dışı ders veya öğretmen 403 `question_scope_denied` (varlık
 * sızdırmaz), pasif öğrenci 422 `student_inactive`, öğretmeni pasif ders 422
 * `question_teacher_unavailable`, dersin listesinde olmayan kazanım 422 `question_topic_unknown`.
 * Mükerrer gönderim istek anahtarıyla önlenir (API `Idempotency-Key` zorunlu).
 */
export function askQuestion(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: QuestionOptions = {},
): QuestionRecord {
  const data = askQuestionSchema.parse(input)
  const studentId = linkedStudentId(state, by)
  requireAuthorized(
    by,
    'question.ask',
    {
      studentId,
      subjectId: data.subjectId,
      ...(data.teacherId === undefined ? {} : { teacherId: data.teacherId }),
    },
    state,
    options,
  )
  // Yetki öğrencinin kapsamda olduğunu denetledi; burada kayıt vardır.
  const student = state.students.find((s) => s.id === studentId)
  if (!student || studentId === undefined)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  if (student.isActive === false)
    throw new DomainError('student_inactive', 'Kaydı pasif olan öğrenci yeni soru gönderemez.', {
      path: ['subjectId'],
    })
  const teacherIds = [
    ...new Set(
      state.assignments
        .filter((a) => a.classId === student.classId && a.subjectId === data.subjectId)
        .map((a) => a.teacherId),
    ),
  ]
  // Aynı dersi iki öğretmen paylaşıyorsa öğretmen seçilmeden soru gönderilmez.
  // TODO(soru-ortak-ders): ortak dersin hangi öğretmene düşeceği kurum kuralı değildir; şimdilik
  // öğretmeni öğrenci seçer.
  if (data.teacherId === undefined && teacherIds.length > 1)
    throw new DomainError('question_teacher_required', 'Bu dersin öğretmenini seçin.', {
      path: ['teacherId'],
    })
  const teacherId = data.teacherId ?? teacherIds[0]
  const teacher = state.teachers.find((t) => t.id === teacherId)
  if (!teacher || teacher.isActive === false || teacher.deletedAt)
    throw new DomainError(
      'question_teacher_unavailable',
      'Bu ders için aktif öğretmen ataması bulunamadı.',
      { path: ['subjectId'] },
    )
  if (data.topic !== undefined) {
    const topics: readonly string[] =
      state.subjects.find((s) => s.id === data.subjectId)?.topics ?? []
    if (!topics.includes(data.topic))
      throw new DomainError('question_topic_unknown', 'Kazanım bu derse ait değil.', {
        path: ['topic'],
      })
  }
  // TODO(question-files): soru fotoğrafı dosya deposu gelince eklenir; o zamana kadar dosyalı
  // soru açılmaz (Vue demosu yalnız dosya adını saklıyordu).
  if (data.files !== undefined && data.files.length > 0)
    throw new DomainError(
      'question_files_unsupported',
      'Dosya ekleme henüz kullanılamıyor; sorunuzu yazıyla gönderin.',
      { path: ['files'] },
    )
  const question: QuestionRecord = {
    id: makeId('ask'),
    studentId: student.id,
    teacherId: teacher.id,
    subjectId: data.subjectId,
    ...(data.topic === undefined ? {} : { topic: data.topic }),
    title: data.title,
    text: data.text,
    createdAt: now,
    answeredAt: null,
    answer: '',
    fileName: null,
    askedBy: actorOf(by),
    followUps: [],
  }
  // TODO(notifications): öğretmene uygulama içi bildirim (DOM-ILT-020).
  state.questions.unshift(question)
  return question
}

function findQuestion(state: State, questionId: string): QuestionRecord | undefined {
  return state.questions.find((q) => q.id === questionId)
}
const notFound = () =>
  new DomainError('question_not_found', 'Soru bulunamadı.', { kind: 'not_found' })

/**
 * Sorunun atandığı öğretmen yanıt yazar (DOM-ILT-092). İlk yanıt `answer`/`answeredAt`'a, sonraki
 * yanıtlar `followUps` listesine eklenir; verilmiş yanıt değişmez. Geri çekilmiş soru 409
 * `question_withdrawn`, yanıt sınırı 422 `question_answer_limit`; başka öğretmenin sorusu ve
 * olmayan soru 404.
 */
export function answerQuestion(
  state: State,
  by: Participant,
  questionId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: QuestionOptions = {},
): QuestionRecord {
  const data = answerQuestionSchema.parse(input)
  const question = findQuestion(state, questionId)
  requireAuthorized(by, 'question.answer', { question }, state, options)
  if (!question) throw notFound()
  // Geri çekme yalnız yanıtsız soruda olur; geri çekilmiş soru yanıtlanmaz.
  if (question.withdrawnAt)
    throw new DomainError('question_withdrawn', 'Öğrenci bu soruyu geri çekti.', {
      kind: 'conflict',
    })
  if (!question.answeredAt) {
    Object.assign(question, {
      answer: data.text,
      answeredAt: now,
      answeredBy: actorOf(by),
      updatedAt: now,
    })
    // TODO(notifications): öğrenciye yanıt bildirimi (DOM-ILT-020).
    return question
  }
  const followUps = [...(question.followUps ?? [])]
  if (followUps.length + 1 >= QUESTION_ANSWER_LIMIT)
    throw new DomainError(
      'question_answer_limit',
      `Bir soruya en fazla ${QUESTION_ANSWER_LIMIT} yanıt yazılabilir.`,
      { path: ['text'] },
    )
  followUps.push({ id: makeId('answer'), text: data.text, at: now, by: actorOf(by) })
  Object.assign(question, { followUps, updatedAt: now })
  return question
}

/**
 * Öğrenci yanıtlanmamış sorusunu geri çeker (DOM-ILT-091). Kayıt silinmez; başlık ve metin
 * korunur, `withdrawnAt` yazılır. Yanıtlanmış soru 409 `question_answered`, ikinci geri çekme 409
 * `question_withdrawn`; başkasının sorusu ve olmayan soru 404.
 */
export function withdrawQuestion(
  state: State,
  by: Participant,
  questionId: string,
  input: unknown,
  now: string,
  options: QuestionOptions = {},
): QuestionRecord {
  withdrawQuestionSchema.parse(input)
  const question = findQuestion(state, questionId)
  requireAuthorized(by, 'question.withdraw', { question }, state, options)
  if (!question) throw notFound()
  if (question.answeredAt)
    throw new DomainError('question_answered', 'Yanıtlanmış soru geri çekilemez.', {
      kind: 'conflict',
    })
  if (question.withdrawnAt)
    throw new DomainError('question_withdrawn', 'Bu soru zaten geri çekildi.', {
      kind: 'conflict',
    })
  Object.assign(question, { withdrawnAt: now, withdrawnBy: actorOf(by), updatedAt: now })
  return question
}

export type QuestionResponse = {
  /** Hedef yanıt anı (ISO UTC); kurum takvimine göre bir iş günü (DOM-ILT-013). */
  dueAt: string
  /** İlk yanıtın anı; yanıt yoksa `null`. */
  answeredAt: string | null
  /** Yanıtsız, geri çekilmemiş ve hedef süre geçmiş. */
  overdue: boolean
}

/**
 * Sorunun yanıt süresi (DOM-ILT-013, DOM-ILT-093): hedef, soru anından itibaren iş saatiyle bir
 * iş günüdür; ilk yanıt veya geri çekme saati durdurur. Değer saklanmaz, her okumada hesaplanır.
 */
// TODO(api-sla-aggregate): yönetici SLA Raporu (`apps/web-react` `sla-rows.ts`) hâlâ duvar
// saatiyle 24 saat kullanır; rapor sunucu sayımına geçince bu hesaba bağlanır.
export function questionResponse(
  question: QuestionTimes,
  now: string,
  calendar: WorkingCalendar = DEFAULT_WORKING_CALENDAR,
): QuestionResponse {
  const dueAt = responseDueAt(question.createdAt, calendar)
  const answeredAt = question.answeredAt ?? null
  return {
    dueAt,
    answeredAt,
    overdue: isOpenQuestion(question) && Date.parse(now) > Date.parse(dueAt),
  }
}
