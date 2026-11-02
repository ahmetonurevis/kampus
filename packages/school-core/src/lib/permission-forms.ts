import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { ADULT_AGE, ageOn, isCalendarDay } from './age.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import { dayKey } from './format.ts'
import type { LearnerAgeFacts } from './notifications.ts'
import type { RequestActor } from './requests.ts'

/**
 * Dijital veli onayı ve izin formu (`permissionForms`, `permissionDecisions`, modül
 * `communication`; IST-067, docs/domain/iletisim-ve-veli.md DOM-ILT-030, -031, -036…039). Saf
 * işlemler; önce bütün kurallar denetlenir, sonra State değişir. Yetki `lib/authorize.ts`
 * tablosundadır (`permissionForm.create`, `.update`, `.close`, `.archive`, `.decide`).
 *
 * Okul takvimindeki etkinlik onayı (`schoolEvents.requiresConsent` + `eventConsents`, iş akışı
 * `consent` komutu) Vue demosunun davranışıdır ve değişmez; bu dosya konu türlü (gezi, etkinlik,
 * fotoğraf çekimi, kulüp, diğer) ayrı form koleksiyonudur (DOM-ILT-036). KVKK açık rızası
 * (`consents` tablosu, `lib/consents.ts`) bundan ayrıdır: "fotoğraf" konulu izin formu görüntünün
 * yayımlanmasına rıza yerine geçmez (DOM-ILT-033).
 *
 * - Formu yönetici her sınıf ve öğrenciye, sınıf rehber öğretmeni yalnız rehberi olduğu sınıflara
 *   ve o sınıfların öğrencilerine açar; hedef öğrenciler açılışta çözülür ve saklanır (DOM-ILT-036).
 * - Karar öğrenci başınadır: 18 yaş altında velayetli ve kısıtsız her veli kendi kararını verir,
 *   18 yaşını doldurmuş öğrenci kendisi verir (`permissionDecider`; bildirim kitlesi de buradan).
 *   Her karar yeni satırdır; geçerli durum bugün karar vermeye yetkili olanların son kararından
 *   hesaplanır, saklanmaz; velayeti kalkan velinin eski kararı sayılmaz; bir ret onayın önüne
 *   geçer (DOM-ILT-031, DOM-ILT-034, DOM-ILT-037, DOM-ILT-071).
 * - Son gün Europe/Istanbul'a göre o günün sonuna kadardır; sonra ve kapalı formda karar
 *   verilmez, değişmez (DOM-ILT-030, DOM-ILT-038).
 * - Kararı olan formun hedefi daraltılamaz, form arşivlenemez (kapatılır); son günü geçmiş formun
 *   son günü değişmez (DOM-ILT-038).
 * - Hatırlatılacaklar saf hesaptır (`permissionReminders`, DOM-ILT-039); zamanlanmış iş API'dedir.
 */

z.config(z.locales.tr())

export type PermissionFormOptions = { institutionType?: InstitutionType }

export const PERMISSION_FORM_TOPICS = {
  trip: 'Gezi',
  event: 'Etkinlik',
  photo: 'Fotoğraf çekimi',
  club: 'Kulüp',
  other: 'Diğer',
} as const
export type PermissionFormTopic = keyof typeof PERMISSION_FORM_TOPICS
export const PERMISSION_FORM_TOPIC_KEYS = Object.keys(PERMISSION_FORM_TOPICS) as [
  PermissionFormTopic,
  ...PermissionFormTopic[],
]

export const PERMISSION_DECISIONS = ['approved', 'rejected'] as const
export type PermissionDecision = (typeof PERMISSION_DECISIONS)[number]
/** Öğrencinin geçerli izin durumu; saklanmaz, kararlardan hesaplanır (DOM-ILT-037). */
export type PermissionStatus = 'pending' | PermissionDecision

export const PERMISSION_FORM_TITLE_MAX_LENGTH = 120
export const PERMISSION_FORM_DESCRIPTION_MAX_LENGTH = 4000
export const PERMISSION_NOTE_MAX_LENGTH = 500
export const PERMISSION_FORM_CLASS_LIMIT = 50
export const PERMISSION_FORM_STUDENT_LIMIT = 500
/** Son günden kaç gün önce ve son gün hatırlatılır (DOM-ILT-039). */
export const PERMISSION_REMINDER_DAYS = [2, 0] as const

const identifier = (message: string) => z.string().trim().min(1, message).max(200)
const title = z
  .string()
  .trim()
  .min(2, 'Form başlığını yazın.')
  .max(
    PERMISSION_FORM_TITLE_MAX_LENGTH,
    `Başlık en fazla ${PERMISSION_FORM_TITLE_MAX_LENGTH} karakter olabilir.`,
  )
const description = z
  .string()
  .trim()
  .min(2, 'Açıklamayı yazın.')
  .max(
    PERMISSION_FORM_DESCRIPTION_MAX_LENGTH,
    `Açıklama en fazla ${PERMISSION_FORM_DESCRIPTION_MAX_LENGTH} karakter olabilir.`,
  )
/** Son gün (`YYYY-MM-DD`, Europe/Istanbul); o günün sonuna kadar karar verilir. */
const deadline = z.iso.date('Son günü seçin.')
const ids = (label: string, limit: number) =>
  z
    .array(identifier(`${label} kimliği geçersiz.`))
    .max(limit, `En fazla ${limit} ${label.toLocaleLowerCase('tr')} seçebilirsiniz.`)
    .refine(
      (list) => new Set(list).size === list.length,
      `Aynı ${label.toLocaleLowerCase('tr')} bir kez seçilir.`,
    )
const classIds = ids('Sınıf', PERMISSION_FORM_CLASS_LIMIT)
const studentIds = ids('Öğrenci', PERMISSION_FORM_STUDENT_LIMIT)

const hasTarget = (body: { classIds?: string[] | undefined; studentIds?: string[] | undefined }) =>
  (body.classIds?.length ?? 0) > 0 || (body.studentIds?.length ?? 0) > 0
const TARGET_REQUIRED = { message: 'En az bir sınıf ya da öğrenci seçin.', path: ['classIds'] }

export const createPermissionFormSchema = z
  .strictObject({
    topic: z.enum(PERMISSION_FORM_TOPIC_KEYS, 'Konu türünü seçin.'),
    title,
    description,
    deadline,
    classIds: classIds.optional(),
    /** Sınıf dışında ya da sınıfın yalnız bir kısmı için tek tek öğrenciler. */
    studentIds: studentIds.optional(),
  })
  .refine(hasTarget, TARGET_REQUIRED)
export type CreatePermissionFormInput = z.input<typeof createPermissionFormSchema>

/** Kısmi düzenleme; konu türü değişmez. Hedef verilirse ikisi birlikte yeni hedeftir. */
export const updatePermissionFormSchema = z
  .strictObject({
    title: title.optional(),
    description: description.optional(),
    deadline: deadline.optional(),
    classIds: classIds.optional(),
    studentIds: studentIds.optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'En az bir alan gönderin.',
  })
  .refine(
    (body) => (body.classIds === undefined && body.studentIds === undefined) || hasTarget(body),
    TARGET_REQUIRED,
  )
export type UpdatePermissionFormInput = z.input<typeof updatePermissionFormSchema>

export const decidePermissionSchema = z.strictObject({
  studentId: identifier('Öğrenci seçin.'),
  decision: z.enum(PERMISSION_DECISIONS, 'Onay ya da ret seçin.'),
  // kvkk: Ç — velinin serbest notu (ör. "servisle değil kendim getireceğim"); sağlık bilgisi
  // yazılmaz (DOM-ILT-035). Loglanmaz, denetime yalnız alan adı yazılır.
  note: z
    .string()
    .trim()
    .max(
      PERMISSION_NOTE_MAX_LENGTH,
      `Not en fazla ${PERMISSION_NOTE_MAX_LENGTH} karakter olabilir.`,
    )
    .optional(),
})
export type DecidePermissionInput = z.input<typeof decidePermissionSchema>

export type PermissionFormRecord = {
  id: string
  topic: PermissionFormTopic
  title: string
  description: string
  deadline: string
  /** Hedef sınıflar (girildiği gibi). */
  classIds: string[]
  /** Tek tek hedeflenen öğrenciler (girildiği gibi). */
  targetStudentIds: string[]
  /** Açılışta çözülen hedef öğrenciler: sınıfların etkin öğrencileri ve tek tek seçilenler. */
  studentIds: string[]
  /** Formu açan öğretmen (yönetici açtıysa `null`); düzenleme yetkisi buna göredir. */
  teacherId: string | null
  status: 'open' | 'closed'
  closedAt: string | null
  createdBy: RequestActor
  createdAt: string
  updatedAt: string
}

export type PermissionDecisionRecord = {
  id: string
  formId: string
  studentId: string
  /** Formun öğretmeni (okuma kapsamı için kopya). */
  teacherId: string | null
  decision: PermissionDecision
  // kvkk: Ç — velinin notu.
  note: string
  /** `guardian`: 18 yaş altında veli; `self`: 18 yaşını doldurmuş öğrenci. */
  relation: 'guardian' | 'self'
  // kvkk: K — kararı veren kullanıcı; yalnız yöneticiye döner.
  decidedByUserId: string
  decidedByRole: 'veli' | 'ogrenci'
  decidedAt: string
}

/** Yetkinin dayandığı form tarafları. */
export type PermissionFormParties = {
  teacherId: string | null
  classIds: readonly string[]
  studentIds: readonly string[]
}

const actorOf = (by: Participant): RequestActor => ({ role: by.role, userId: by.userId })

const formNotFound = () =>
  new DomainError('permission_form_not_found', 'İzin formu bulunamadı.', { kind: 'not_found' })

const partiesOf = (form: PermissionFormRecord | undefined): PermissionFormParties | undefined =>
  form && { teacherId: form.teacherId, classIds: form.classIds, studentIds: form.studentIds }

/** Doğum tarihi (`YYYY-MM-DD`); kayıtta yoksa ya da geçersizse `null`. */
export function studentBirthDate(student: object): string | null {
  const value: unknown = Object.hasOwn(student, 'birthDate')
    ? Reflect.get(student, 'birthDate')
    : undefined
  return typeof value === 'string' && isCalendarDay(value) ? value : null
}

/** Öğrencinin izin kararını kim verir: kendisi (`self`) ya da velayetli velileri (`guardians`). */
export type PermissionDecider = 'self' | 'guardians'

/**
 * İzin kararını veren tarafın tek kaynağı (DOM-ILT-030, DOM-ILT-037): karar yetkisi, bildirim
 * kitlesi (form açılışı, hatırlatma) ve velinin formu görmesi bu sonuca göredir. Doğum tarihi
 * (API'de `student_identities`, ADR 0006 karar 9) biliniyorsa `now` anındaki Europe/Istanbul
 * gününe göre 18 yaşını dolduran öğrenci kendisi karar verir; kurum türü fark etmez (18 yaşındaki
 * lise öğrencisi de kendisi verir). Doğum tarihi yoksa en korumalı yorum 18 altıdır; yalnız dil
 * okulunda adayın açık `minor: false` seçimiyle kesin kayda alınan kursiyer yetişkindir (`prospects`
 * kaydı, DOM-DIL-091; okulda aday `minor: false` olamaz).
 */
export function permissionDecider(
  facts: LearnerAgeFacts,
  options: { institutionType?: InstitutionType | undefined; now: string },
): PermissionDecider {
  const birthDate =
    facts.birthDate !== undefined && isCalendarDay(facts.birthDate) ? facts.birthDate : null
  if (birthDate !== null) return ageOn(birthDate, options.now) >= ADULT_AGE ? 'self' : 'guardians'
  return options.institutionType === 'language_school' && facts.prospectMinor === false
    ? 'self'
    : 'guardians'
}

/** Son günün bittiği an (UTC ISO): Europe/Istanbul günü sonu; Türkiye sabit UTC+3'tür. */
export const permissionDeadlineEndsAt = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00+03:00`) + 86_400_000).toISOString()

/** Son gün geçti mi (Europe/Istanbul günü). */
export const isPermissionDeadlinePassed = (
  form: Pick<PermissionFormRecord, 'deadline'>,
  now: string,
) => dayKey(now) > form.deadline

/** Karar alınıyor mu: form açık ve son gün geçmemiş (DOM-ILT-038). */
export const isPermissionFormOpen = (
  form: Pick<PermissionFormRecord, 'deadline' | 'status'>,
  now: string,
) => form.status === 'open' && !isPermissionDeadlinePassed(form, now)

function assertDeadlineNotPast(day: string, now: string) {
  if (day < dayKey(now))
    throw new DomainError('permission_form_deadline_in_past', 'Son gün geçmişte olamaz.', {
      path: ['deadline'],
    })
}

type Targets = { classIds: string[]; targetStudentIds: string[] }

/**
 * Hedefi öğrencilere çözer: sınıfların etkin öğrencileri ve tek tek seçilenler (sıra: sınıf
 * sırası, sonra seçim sırası). Olmayan sınıf/öğrenci 404, pasif sınıf 422 `record_inactive`,
 * pasif tek öğrenci 422 `student_inactive`; hiç öğrenci çıkmazsa 422 `permission_form_no_students`.
 */
function resolveStudents(state: State, targets: Targets): string[] {
  const resolved: string[] = []
  const seen = new Set<string>()
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id)
      resolved.push(id)
    }
  }
  for (const classId of targets.classIds) {
    const classroom: { id: string; isActive?: boolean; deletedAt?: string | null } | undefined =
      state.classes.find((c) => c.id === classId)
    if (!classroom)
      throw new DomainError('class_not_found', 'Sınıf bulunamadı.', {
        kind: 'not_found',
        path: ['classIds'],
      })
    if (classroom.isActive === false || classroom.deletedAt)
      throw new DomainError('record_inactive', 'Pasif sınıfa izin formu açılamaz.', {
        path: ['classIds'],
      })
    for (const student of state.students)
      if (student.classId === classId && student.isActive !== false) add(student.id)
  }
  for (const studentId of targets.targetStudentIds) {
    const student = state.students.find((s) => s.id === studentId)
    if (!student)
      throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', {
        kind: 'not_found',
        path: ['studentIds'],
      })
    if (student.isActive === false)
      throw new DomainError('student_inactive', 'Kaydı pasif öğrenciye izin formu açılamaz.', {
        path: ['studentIds'],
      })
    add(student.id)
  }
  if (resolved.length === 0)
    throw new DomainError(
      'permission_form_no_students',
      'Seçilen sınıflarda izin istenecek öğrenci yok.',
      { path: ['classIds'] },
    )
  return resolved
}

/**
 * İzin formu aç (DOM-ILT-036). Yönetici her sınıf ve öğrenciye; öğretmen yalnız rehberi olduğu
 * sınıflara ve onların öğrencilerine (403 `permission_form_scope_denied`). Son gün bugünden önce
 * olamaz (422 `permission_form_deadline_in_past`). Hedef öğrenciler açılışta çözülür.
 */
export function createPermissionForm(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: PermissionFormOptions = {},
): PermissionFormRecord {
  const data = createPermissionFormSchema.parse(input)
  const targets: Targets = {
    classIds: data.classIds ?? [],
    targetStudentIds: data.studentIds ?? [],
  }
  requireAuthorized(
    by,
    'permissionForm.create',
    { classIds: targets.classIds, studentIds: targets.targetStudentIds },
    state,
    options,
  )
  assertDeadlineNotPast(data.deadline, now)
  const studentIds = resolveStudents(state, targets)
  const teacherId =
    by.role === 'ogretmen'
      ? (by.links.find((link) => link.kind === 'teacher')?.recordId ?? null)
      : null
  const form: PermissionFormRecord = {
    id: makeId('pf'),
    topic: data.topic,
    title: data.title,
    description: data.description,
    deadline: data.deadline,
    ...targets,
    studentIds,
    teacherId,
    status: 'open',
    closedAt: null,
    createdBy: actorOf(by),
    createdAt: now,
    updatedAt: now,
  }
  // Yeni kayıt sona eklenir: API koleksiyonu kısmi yükler (yalnız sona ekleme serbesttir).
  state.permissionForms.push(form)
  return form
}

function findForm(state: State, formId: string) {
  return state.permissionForms.find((form) => form.id === formId)
}

const hasDecisions = (state: State, formId: string) =>
  state.permissionDecisions.some((decision) => decision.formId === formId)

const removed = (before: readonly string[], after: readonly string[]) => {
  const kept = new Set(after)
  return before.filter((id) => !kept.has(id))
}

function assertOpen(form: PermissionFormRecord) {
  if (form.status === 'closed')
    throw new DomainError('permission_form_closed', 'İzin formu kapatılmış.', { kind: 'rule' })
}

export type PermissionFormUpdate = {
  form: PermissionFormRecord
  /** Düzenlemeyle hedefe yeni giren öğrenciler (bildirim yalnız onlara gider). */
  addedStudentIds: string[]
}

/**
 * İzin formunu düzenle (DOM-ILT-038): başlık, açıklama, son gün ve hedef; konu türü değişmez.
 * Kapalı form 422 `permission_form_closed`. Son günü geçmiş formun son günü değişmez (422
 * `permission_form_deadline_passed`); yeni son gün bugünden önce olamaz. Kararı olan formda
 * hedeften sınıf ya da öğrenci çıkarılamaz (422 `permission_form_scope_locked`); eklenebilir ve
 * önceden çözülmüş öğrenciler hedefte kalır. Formun öğretmeni ya da yönetici düzenler; formu
 * gören başka öğretmen 403 `permission_form_not_owner`, görmeyen 404.
 */
export function updatePermissionForm(
  state: State,
  by: Participant,
  formId: string,
  input: unknown,
  now: string,
  options: PermissionFormOptions = {},
): PermissionFormUpdate {
  const data = updatePermissionFormSchema.parse(input)
  const form = findForm(state, formId)
  const retarget = data.classIds !== undefined || data.studentIds !== undefined
  const targets: Targets | undefined = retarget
    ? { classIds: data.classIds ?? [], targetStudentIds: data.studentIds ?? [] }
    : undefined
  requireAuthorized(
    by,
    'permissionForm.update',
    {
      form: partiesOf(form),
      ...(targets
        ? { targets: { classIds: targets.classIds, studentIds: targets.targetStudentIds } }
        : {}),
    },
    state,
    options,
  )
  if (!form) throw formNotFound()
  assertOpen(form)
  if (data.deadline !== undefined && data.deadline !== form.deadline) {
    if (isPermissionDeadlinePassed(form, now))
      throw new DomainError(
        'permission_form_deadline_passed',
        'Son günü geçmiş formun son günü değiştirilemez.',
        { path: ['deadline'] },
      )
    assertDeadlineNotPast(data.deadline, now)
  }
  let studentIds = form.studentIds
  if (targets) {
    const locked = hasDecisions(state, form.id)
    if (
      locked &&
      (removed(form.classIds, targets.classIds).length > 0 ||
        removed(form.targetStudentIds, targets.targetStudentIds).length > 0)
    )
      throw new DomainError(
        'permission_form_scope_locked',
        'Karar verilmiş formun hedefinden sınıf ya da öğrenci çıkarılamaz.',
        { path: ['classIds'] },
      )
    const resolved = resolveStudents(state, targets)
    studentIds = locked ? [...form.studentIds, ...removed(resolved, form.studentIds)] : resolved
  }
  const addedStudentIds = removed(studentIds, form.studentIds)
  Object.assign(form, {
    ...(data.title === undefined ? {} : { title: data.title }),
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(data.deadline === undefined ? {} : { deadline: data.deadline }),
    ...(targets ?? {}),
    studentIds,
    updatedAt: now,
  })
  return { form, addedStudentIds }
}

/**
 * İzin formunu kapat (DOM-ILT-038): son günden önce karar almayı bitirir; kararlar korunur.
 * Kapalı form yeniden kapatılmaz (409 `permission_form_closed`). Yetki düzenlemeyle aynıdır.
 */
export function closePermissionForm(
  state: State,
  by: Participant,
  formId: string,
  now: string,
  options: PermissionFormOptions = {},
): PermissionFormRecord {
  const form = findForm(state, formId)
  requireAuthorized(by, 'permissionForm.close', { form: partiesOf(form) }, state, options)
  if (!form) throw formNotFound()
  if (form.status === 'closed')
    throw new DomainError('permission_form_closed', 'İzin formu zaten kapatılmış.', {
      kind: 'conflict',
    })
  Object.assign(form, { status: 'closed', closedAt: now, updatedAt: now })
  return form
}

/**
 * İzin formunu arşivle: kayıt State'ten çıkar (API arşivler, silmez). Kararı olan form
 * arşivlenmez, kapatılır (409 `permission_form_has_decisions`): kararlar ispat kaydıdır
 * (DOM-ILT-034). Yetki düzenlemeyle aynıdır.
 */
export function archivePermissionForm(
  state: State,
  by: Participant,
  formId: string,
  options: PermissionFormOptions = {},
): PermissionFormRecord {
  const form = findForm(state, formId)
  requireAuthorized(by, 'permissionForm.archive', { form: partiesOf(form) }, state, options)
  if (!form) throw formNotFound()
  if (hasDecisions(state, form.id))
    throw new DomainError(
      'permission_form_has_decisions',
      'Karar verilmiş form arşivlenemez; formu kapatın.',
      { kind: 'conflict' },
    )
  state.permissionForms = state.permissionForms.filter((item) => item.id !== form.id)
  return form
}

export type DecideOptions = PermissionFormOptions & {
  /**
   * Öğrencinin yaşına dair bilinenler (API'de kimlik satırının doğum tarihi ve adayın 18 yaş
   * seçimi). Verilmezse yalnız öğrenci kaydındaki doğum tarihi okunur: aday koleksiyonu karar
   * komutunun koleksiyonlarında değildir (`modules/commands.ts`).
   */
  learner?: LearnerAgeFacts
}

export type DecisionOutcome = {
  decision: PermissionDecisionRecord
  /** Yeni karar satırı yazıldı mı; aynı kişinin aynı kararı ve notu yeni satır açmaz. */
  created: boolean
}

/**
 * Veli ya da yetişkin öğrenci kararı (DOM-ILT-030, -031, -037). Öğrenci gövdeden gelir ve
 * aktörün kapsamında olmalıdır: veli yalnız velayetli ve kısıtsız bağlı çocuğu, öğrenci yalnız
 * kendisi için karar verir; başka çocuk ve formun hedefinde olmayan öğrenci 404. 18 yaş altında
 * karar veliden (öğrenciye 403 `permission_guardian_required`), 18 yaşını doldurmuş öğrencide
 * kendisinden alınır (veliye 403 `permission_adult_self`). Pasif öğrenci 422 `student_inactive`;
 * kapalı form 422 `permission_form_closed`; son gün geçtiyse 422 `permission_form_deadline_passed`.
 * Her karar yeni satırdır (DOM-ILT-034); aynı kişinin son kararıyla aynı karar ve not yeni satır
 * açmaz. Karar veren taraf `permissionDecider`'dandır: `options.learner` (API'de kimlik satırı,
 * ADR 0006 karar 9, ve aday) verilirse ondan, yoksa öğrenci kaydındaki doğum tarihinden.
 */
export function decidePermission(
  state: State,
  by: Participant,
  formId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: DecideOptions = {},
): DecisionOutcome {
  const data = decidePermissionSchema.parse(input)
  const form = findForm(state, formId)
  requireAuthorized(
    by,
    'permissionForm.decide',
    { studentId: data.studentId, form: form && { studentIds: form.studentIds } },
    state,
    options,
  )
  if (!form) throw formNotFound()
  const student = state.students.find((s) => s.id === data.studentId)
  if (!student)
    throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
  const learner: LearnerAgeFacts = options.learner ?? {
    birthDate: studentBirthDate(student) ?? undefined,
  }
  const adult =
    permissionDecider(learner, { institutionType: options.institutionType, now }) === 'self'
  if (by.role === 'veli' && adult)
    throw new DomainError(
      'permission_adult_self',
      'Öğrenci 18 yaşını doldurduğu için izni kendisi verir.',
      { kind: 'forbidden' },
    )
  if (by.role === 'ogrenci' && !adult)
    throw new DomainError(
      'permission_guardian_required',
      '18 yaşından küçük öğrenci için izni velayet sahibi veli verir.',
      { kind: 'forbidden' },
    )
  if (student.isActive === false)
    throw new DomainError('student_inactive', 'Kaydı pasif öğrenci için karar verilemez.')
  assertOpen(form)
  if (isPermissionDeadlinePassed(form, now))
    throw new DomainError(
      'permission_form_deadline_passed',
      'Son gün geçtiği için karar verilemez ya da değiştirilemez.',
    )
  const note = data.note ?? ''
  const previous = latestDecisions(
    state.permissionDecisions.filter((d) => d.formId === form.id && d.studentId === student.id),
  ).find((d) => d.decidedByUserId === by.userId)
  if (previous && previous.decision === data.decision && previous.note === note)
    return { decision: previous, created: false }
  const decision: PermissionDecisionRecord = {
    id: makeId('pd'),
    formId: form.id,
    studentId: student.id,
    teacherId: form.teacherId,
    decision: data.decision,
    note,
    relation: by.role === 'ogrenci' ? 'self' : 'guardian',
    decidedByUserId: by.userId,
    decidedByRole: by.role === 'ogrenci' ? 'ogrenci' : 'veli',
    decidedAt: now,
  }
  state.permissionDecisions.push(decision)
  return { decision, created: true }
}

/**
 * Karar verenlerin son kararları (karar anına, eşitlikte sıraya göre son satır). Girdi tek
 * öğrencinin tek formdaki kararlarıdır.
 */
export function latestDecisions<
  D extends Pick<PermissionDecisionRecord, 'decidedByUserId' | 'decidedAt'>,
>(decisions: readonly D[]): D[] {
  const latest = new Map<string, D>()
  for (const decision of decisions) {
    const current = latest.get(decision.decidedByUserId)
    if (!current || decision.decidedAt >= current.decidedAt)
      latest.set(decision.decidedByUserId, decision)
  }
  return [...latest.values()]
}

/**
 * Öğrencinin bugün kararı sayılanlar: karar veren taraf (`permissionDecider`) ve velayetli,
 * iletişim kısıtı olmayan velilerin kullanıcı kimlikleri (API'de `student_guardians`,
 * `lib/guardianship.ts` `isCustodial`; DOM-ILT-070…072).
 */
export type PermissionDeciders = {
  decider: PermissionDecider
  guardianUserIds: ReadonlySet<string>
}

/**
 * Öğrencinin geçerli izin durumu (DOM-ILT-031, -037, -071). Yalnız bugün karar vermeye yetkili
 * olanların kararları sayılır: 18 yaşını doldurmuşsa öğrencinin kendisi (`self`), 18 yaş altında
 * bugün velayetli ve kısıtsız veliler (`guardian`). Velayeti kalkan ya da iletişimi kısıtlanan
 * velinin kararı satır olarak kalır (ispat, DOM-ILT-034) ama durumu etkilemez. Her karar verenin
 * son kararı alınır; bir ret varsa `rejected`, yoksa bir onay `approved`, hiç karar yoksa
 * `pending` (sessizlik onay değildir, DOM-ILT-030).
 */
export function permissionStatus(
  decisions: readonly Pick<
    PermissionDecisionRecord,
    'decidedByUserId' | 'decidedAt' | 'decision' | 'relation'
  >[],
  deciders: PermissionDeciders,
): PermissionStatus {
  const counted = decisions.filter((d) =>
    deciders.decider === 'self'
      ? d.relation === 'self'
      : d.relation === 'guardian' && deciders.guardianUserIds.has(d.decidedByUserId),
  )
  const latest = latestDecisions(counted)
  if (latest.some((d) => d.decision === 'rejected')) return 'rejected'
  if (latest.some((d) => d.decision === 'approved')) return 'approved'
  return 'pending'
}

export type PermissionCounts = Record<PermissionStatus, number> & { total: number }

/** Öğrenci başına durumlardan bekleyen/onay/ret sayıları. */
export function permissionCounts(statuses: Iterable<PermissionStatus>): PermissionCounts {
  const counts: PermissionCounts = { pending: 0, approved: 0, rejected: 0, total: 0 }
  for (const status of statuses) {
    counts[status] += 1
    counts.total += 1
  }
  return counts
}

export type PermissionReminder = {
  formId: string
  /** Kararı beklenen öğrenciler. */
  studentIds: string[]
  /** Son güne kalan gün (`PERMISSION_REMINDER_DAYS`). */
  daysLeft: number
  /** Bildirimin tekil anahtarı: aynı hatırlatma aynı alıcıya ikinci kez yazılmaz. */
  dedupeKey: string
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000

/**
 * Hatırlatılacaklar (DOM-ILT-039): açık formlarda son güne `PERMISSION_REMINDER_DAYS` gün kalan
 * (Europe/Istanbul günü) ve kararı beklenen (`pending`) öğrenciler. Saf hesaptır; reddetmiş veya
 * onaylamış öğrenciye hatırlatma gitmez. `deciders` öğrencinin bugün kararı sayılanlarıdır.
 */
export function permissionReminders(input: {
  forms: readonly Pick<PermissionFormRecord, 'id' | 'deadline' | 'status' | 'studentIds'>[]
  decisions: readonly Pick<
    PermissionDecisionRecord,
    'formId' | 'studentId' | 'decidedByUserId' | 'decidedAt' | 'decision' | 'relation'
  >[]
  deciders: (studentId: string) => PermissionDeciders
  now: string
}): PermissionReminder[] {
  const today = dayKey(input.now)
  const byForm = new Map<string, (typeof input.decisions)[number][]>()
  for (const decision of input.decisions) {
    const list = byForm.get(decision.formId) ?? []
    list.push(decision)
    byForm.set(decision.formId, list)
  }
  const reminders: PermissionReminder[] = []
  for (const form of input.forms) {
    if (!isPermissionFormOpen(form, input.now)) continue
    const daysLeft = dayNumber(form.deadline) - dayNumber(today)
    if (!(PERMISSION_REMINDER_DAYS as readonly number[]).includes(daysLeft)) continue
    const decisions = byForm.get(form.id) ?? []
    const studentIds = form.studentIds.filter(
      (studentId) =>
        permissionStatus(
          decisions.filter((d) => d.studentId === studentId),
          input.deciders(studentId),
        ) === 'pending',
    )
    if (studentIds.length > 0)
      reminders.push({
        formId: form.id,
        studentIds,
        daysLeft,
        dedupeKey: `${form.id}:${form.deadline}:${daysLeft}`,
      })
  }
  return reminders
}
// `permissionReminders` her sabah 08:00 (Europe/Istanbul) API'nin `permission-forms.remind` işiyle
// kurum başına çalışır ve `permission_form_reminder` bildirimini `dedupeKey` ile yazar
// (`apps/api/src/jobs/permission-reminders.ts`, `sendPermissionReminders`; OG-094).
