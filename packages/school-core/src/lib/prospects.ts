import { z } from 'zod'
import type { State } from '../data/seed.ts'
import type { InstitutionType } from '../modules/collection-modules.ts'
import { requireAuthorized } from './authorize.ts'
import type { Participant } from './communication.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'
import type { RequestActor } from './requests.ts'
import { intervalsOverlap, tutorConflict } from './tutor-conflicts.ts'

/**
 * Ön büro aday/CRM işlemleri (`prospects`, modül `crm`; docs/domain/kayit-ve-crm.md DOM-KAY-001…009,
 * DOM-KAY-030…034; deneme dersi docs/domain/dil-okulu.md DOM-DIL-030). Saf işlemler; önce bütün
 * kurallar denetlenir, sonra State değişir. Yetki `lib/authorize.ts` tablosundadır
 * (`prospect.create`, `prospect.stage`, `prospect.note`, `prospect.meeting`, `prospect.trial`):
 * yalnız yönetici ve ön büro.
 *
 * - Aday en az veriyle açılır: ad, kampüs, ilgi (hedef düzey/seviye), kaynak, telefon ve gösterilen
 *   aydınlatma metninin sürümü; e-posta isteğe bağlıdır. 18 yaş altı adayda iletişim bilgisi veliye
 *   aittir ve veli adı zorunludur; okul adayı her zaman 18 yaş altı sayılır (DOM-KAY-003, -009).
 * - Ticari ileti onayı kanal bazında saklanır; hizmet iletisi onaya bağlı değildir (DOM-KAY-004,
 *   DOM-ILT-022).
 * - Aynı telefon veya e-postayla açık ikinci aday açılmaz; iletişimi paylaşan farklı adlı aday
 *   yalnız kardeş olduğu açıkça belirtilirse açılır (DOM-KAY-002, -031).
 * - Aşama tablosu `nextProspectStages`: ileri geçiş serbest, geri dönüş yok; `Vazgeçti` nedenle
 *   girilir ve yalnız `İletişime geçildi` ile yeniden açılır. `Görüşme planlandı` yalnız planlamayla,
 *   `Kayıt oldu` yalnız kesin kayıtla girilir (DOM-KAY-005, -030).
 * - Notlar eklenir; değiştirilmez, silinmez. Kapalı adaya not eklenmez (DOM-KAY-032).
 * - Tanışma görüşmesi gelecek tarihlidir; aynı kampüste aynı görevli/oda için süre dikkate alınarak
 *   çakışamaz (DOM-KAY-006, -033). Deneme dersi yalnız dil okulunda, gerçek bir derse bir kez, kapasite
 *   ve 18 yaş altında veli onayıyla planlanır (DOM-DIL-030, DOM-KAY-034).
 *
 * Kesin kayıt (aday → öğrenci) mevcut `enrollProspect` işlemidir (`lib/domain.ts`, DOM-KAY-001,
 * DOM-KAY-011, DOM-KAY-035); `Kayıt oldu` aşamasını yalnız o yazar ve yalnız açık adayı kabul
 * eder. Yetki eylemi `prospect.enroll`'dur; işlem `payInvoice` gibi yetkiyi kendisi denetlemez.
 *
 * Şemalar API gövde şeması ve web/mobil form şemasıdır (`zodResolver`). Hata iletileri kişisel veri
 * (telefon, e-posta, başka adayın adı) taşımaz.
 */

z.config(z.locales.tr())

export type ProspectOptions = {
  institutionType?: InstitutionType
  /** Notu yazan kişinin gösterilen adı (API: oturum kullanıcısı); eski kayıtlar `author` okur. */
  authorName?: string
}

// --- Sözlük -------------------------------------------------------------------------------

/** Aday aşamaları; saklanan değer Türkçe etikettir (örnek veri ve mevcut kayıtlar aynı metni taşır). */
export const PROSPECT_STAGES = [
  'Yeni aday',
  'İletişime geçildi',
  'Görüşme planlandı',
  'Teklif verildi',
  'Kayıt oldu',
  'Vazgeçti',
] as const
export type ProspectStage = (typeof PROSPECT_STAGES)[number]
/** Açık aşamalar huni sırasıyla; `Kayıt oldu` ve `Vazgeçti` kapalıdır (DOM-KAY-002). */
export const OPEN_PROSPECT_STAGES = [
  'Yeni aday',
  'İletişime geçildi',
  'Görüşme planlandı',
  'Teklif verildi',
] as const satisfies readonly ProspectStage[]

/** Aşamanın gösterilen adı; dil okulunda görüşme aşaması seviye tespiti/deneme dersidir. */
export function prospectStageLabel(
  stage: string | undefined,
  institutionType: InstitutionType = 'school',
): string {
  return stage === 'Görüşme planlandı' && institutionType === 'language_school'
    ? 'Seviye tespiti / deneme dersi planlandı'
    : (stage ?? '')
}

/** Kaynaklar (DOM-KAY-007); saklanan değer Türkçe etikettir. */
export const PROSPECT_SOURCES = [
  'Web sitesi',
  'Veli referansı',
  'Kampüs ziyareti',
  'Telefon',
  'Bursluluk sınavı',
  'Sosyal medya',
  'Kurumsal anlaşma',
] as const
export type ProspectSource = (typeof PROSPECT_SOURCES)[number]
const REFERRAL_SOURCE = 'Veli referansı' satisfies ProspectSource

/** Vazgeçme nedenleri (DOM-KAY-005); saklanan değer İngilizce anahtardır. */
export const PROSPECT_LOST_REASONS = [
  'price',
  'transport',
  'other_school',
  'academic_fit',
  'other',
] as const
export type ProspectLostReason = (typeof PROSPECT_LOST_REASONS)[number]
export const PROSPECT_LOST_REASON_LABELS = {
  price: 'Fiyat',
  transport: 'Ulaşım',
  other_school: 'Başka okul',
  academic_fit: 'Akademik uygunsuzluk',
  other: 'Diğer',
} as const satisfies Record<ProspectLostReason, string>

/** Ticari ileti kanalları (DOM-KAY-004). */
export const MARKETING_CHANNELS = ['sms', 'email', 'call'] as const
export type MarketingChannel = (typeof MARKETING_CHANNELS)[number]

export const PROSPECT_NOTE_MAX_LENGTH = 2000
/** Aday kartındaki not sayısı sınırı; kaydın sınırsız büyümesini önler. */
export const PROSPECT_NOTE_LIMIT = 200
/** Görüşme süresi sınırları (dakika). */
export const MEETING_DURATION = { min: 15, max: 120, default: 30 } as const
/** Süresi saklanmamış eski görüşmenin süresi (`lib/tutor-conflicts.ts` ile aynı). */
const LEGACY_MEETING_MINUTES = 30
/** Bir derse alınabilecek deneme katılımcısı (DOM-DIL-030). */
export const TRIAL_PARTICIPANTS_PER_LESSON = 2
/** Dil okulu grup kapasitesi tavanı (DOM-DIL-040). */
export const LANGUAGE_GROUP_CAPACITY_MAX = 18

/** Aday notu formunun özel nitelikli veri uyarısı (KVKK md. 6; DOM-KAY-003). */
export const PROSPECT_NOTE_NOTICE =
  'Sağlık, engellilik veya aileye ait özel bilgileri aday notuna yazmayın.'

// --- Kayıt biçimi -------------------------------------------------------------------------

/**
 * Aday notu: `text` ön büronun görüşme notudur (kvkk: K; loglanmaz, denetim kaydına yalnız alan adı
 * yazılır), `author` gösterilen yazar adıdır (eski kayıtlar yalnız bunu taşır), `by` yazan kişidir.
 */
export type ProspectNote = State['prospects'][number]['notes'][number]
export type ProspectMeeting = {
  date: string
  /** Dakika. */
  duration: number
  room: string
  /** Görüşmeye katılan öğretmen; ön büro görevlisi tek başına görüşüyorsa `null`. */
  teacherId: string | null
  scheduledAt: string
  by: RequestActor
}
export type ProspectTrialLesson = {
  lessonId: string
  classId: string
  date: string
  duration: number
  /** 18 yaş altı adayda velinin onay verdiğinin kaydedildiği an; yetişkinde `null` (DOM-DIL-030). */
  guardianConsentAt: string | null
  scheduledAt: string
  by: RequestActor
}
export type MarketingConsent = Record<MarketingChannel, { granted: boolean; at: string }>
/** Aday işlemlerinin eklediği alanlar; örnek veri ve eski kayıtlar taşımaz. */
export type ProspectFields = {
  /** 18 yaş altı mı; eski kayıtta yoksa 18 yaş altı sayılır (DOM-KAY-009). */
  minor?: boolean
  // kvkk: K — 18 yaş altı adayın velisinin adı; iletişim bilgisi veliye aittir (DOM-KAY-003).
  guardianName?: string
  /** Veli referansında referans veren öğrenci (DOM-KAY-007). */
  referrerStudentId?: string
  /** İletişimi paylaşan kardeş aday (DOM-KAY-031). */
  siblingOfId?: string
  /** Gösterilen aydınlatma metninin sürümü ve anı (DOM-KAY-003, KVKK md. 10). */
  privacyNotice?: { version: string; shownAt: string }
  marketingConsent?: MarketingConsent
  lostReason?: ProspectLostReason
  lostAt?: string
  /** Planlanan tanışma görüşmesi; `trialAt` eski okuyucular için görüşme anını taşır. */
  meeting?: ProspectMeeting
  trialLesson?: ProspectTrialLesson
  createdBy?: RequestActor
  updatedAt?: string
}

type ProspectRecord = State['prospects'][number]

// --- Şemalar ------------------------------------------------------------------------------

const identifier = (message: string) => z.string().trim().min(1, message).max(200)
const personName = z
  .string()
  .trim()
  .min(2, 'En az 2 karakter girin.')
  .max(80, 'En fazla 80 karakter girebilirsiniz.')

/**
 * Yeni aday (DOM-KAY-003, -007, -009). Gövde katıdır; T.C. kimlik no, doğum tarihi, adres gibi
 * alanlar alınmaz (bilinmeyen alan 400).
 */
export const createProspectSchema = z
  .strictObject({
    // kvkk: K — aday adı.
    name: personName,
    // kvkk: K — adayın veya 18 yaş altında velinin telefonu.
    phone: z
      .string()
      .trim()
      .regex(/^0\d{10}$/, 'Telefonu 05XXXXXXXXX biçiminde girin.'),
    // kvkk: K — isteğe bağlı; boş metin "yok" sayılır.
    email: z
      .union([z.literal(''), z.email('Geçerli bir e-posta adresi girin.').toLowerCase()])
      .optional(),
    branchId: identifier('Kampüs seçin.'),
    /** Hedef düzey/seviye ve ilgi alanı. */
    interest: z
      .string()
      .trim()
      .min(2, 'İlgilendiği programı yazın.')
      .max(200, 'En fazla 200 karakter girebilirsiniz.'),
    source: z.enum(PROSPECT_SOURCES, 'Aday kaynağını seçin.'),
    referrerStudentId: identifier('Referans veren öğrenciyi seçin.').optional(),
    /** Dil okulunda zorunlu; okulda verilmezse 18 yaş altı sayılır, `false` reddedilir. */
    minor: z.boolean('18 yaş altı olup olmadığını seçin.').optional(),
    guardianName: personName.optional(),
    siblingOfId: identifier('Kardeş adayı seçin.').optional(),
    privacyNoticeVersion: z
      .string()
      .trim()
      .min(1, 'Aydınlatma metni gösterilmeden aday kaydedilemez.')
      .max(40),
    marketingConsent: z
      .strictObject({ sms: z.boolean(), email: z.boolean(), call: z.boolean() })
      .partial()
      .optional(),
  })
  .refine((data) => data.source === REFERRAL_SOURCE || data.referrerStudentId === undefined, {
    message: 'Referans öğrencisi yalnız veli referansında seçilir.',
    path: ['referrerStudentId'],
  })
export type CreateProspectInput = z.input<typeof createProspectSchema>

export const changeProspectStageSchema = z
  .strictObject({
    stage: z.enum(PROSPECT_STAGES, 'Aşamayı seçin.'),
    lostReason: z.enum(PROSPECT_LOST_REASONS, 'Vazgeçme nedenini seçin.').optional(),
    /**
     * Vazgeçen aday yeniden açılırken iletişimi paylaşan kardeş aday (açık veya kayıtlı;
     * DOM-KAY-031). Yalnız `Vazgeçti` adayın yeniden açılışında geçerlidir.
     */
    siblingOfId: identifier('Kardeş adayı seçin.').optional(),
  })
  .refine((data) => data.stage === 'Vazgeçti' || data.lostReason === undefined, {
    message: 'Vazgeçme nedeni yalnız "Vazgeçti" aşamasında seçilir.',
    path: ['lostReason'],
  })
  .refine((data) => data.stage !== 'Vazgeçti' || data.siblingOfId === undefined, {
    message: 'Kardeş aday yalnız adayı yeniden açarken seçilir.',
    path: ['siblingOfId'],
  })
export type ChangeProspectStageInput = z.input<typeof changeProspectStageSchema>

export const addProspectNoteSchema = z.strictObject({
  text: z
    .string()
    .trim()
    .min(2, 'En az 2 karakter girin.')
    .max(PROSPECT_NOTE_MAX_LENGTH, `En fazla ${PROSPECT_NOTE_MAX_LENGTH} karakter girebilirsiniz.`),
})
export type AddProspectNoteInput = z.input<typeof addProspectNoteSchema>

export const scheduleMeetingSchema = z.strictObject({
  /** ISO 8601 UTC başlangıç anı. */
  date: z.iso.datetime('Geçerli bir tarih ve saat seçin.'),
  duration: z
    .number('Süreyi dakika olarak girin.')
    .int('Süre tam sayı olmalıdır.')
    .min(MEETING_DURATION.min, `Süre en az ${MEETING_DURATION.min} dakika olmalıdır.`)
    .max(MEETING_DURATION.max, `Süre en fazla ${MEETING_DURATION.max} dakika olabilir.`)
    .default(MEETING_DURATION.default),
  room: z.string().trim().min(1, 'Görüşme odasını yazın.').max(40),
  teacherId: identifier('Öğretmen seçin.').optional(),
})
export type ScheduleMeetingInput = z.input<typeof scheduleMeetingSchema>

export const scheduleTrialLessonSchema = z.strictObject({
  lessonId: identifier('Deneme dersini seçin.'),
  /** 18 yaş altı adayda velinin onay verdiği ön büroca işaretlenir (DOM-DIL-030). */
  guardianConsent: z.boolean().optional(),
})
export type ScheduleTrialLessonInput = z.input<typeof scheduleTrialLessonSchema>

// --- Yardımcılar --------------------------------------------------------------------------

const actorOf = (by: Participant): RequestActor => ({ role: by.role, userId: by.userId })
const normalizedName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
const normalizedEmail = (value: string | undefined) => value?.trim().toLowerCase() ?? ''
const isOpen = (stage: string | undefined) =>
  (OPEN_PROSPECT_STAGES as readonly (string | undefined)[]).includes(stage)
const isStage = (value: string | undefined): value is ProspectStage =>
  value !== undefined && (PROSPECT_STAGES as readonly string[]).includes(value)

function requireProspect(state: State, prospectId: string): ProspectRecord {
  const prospect = state.prospects.find((p) => p.id === prospectId)
  if (!prospect)
    throw new DomainError('prospect_not_found', 'Aday bulunamadı.', { kind: 'not_found' })
  return prospect
}
function requireOpen(prospect: ProspectRecord) {
  if (!isOpen(prospect.stage))
    throw new DomainError(
      'prospect_closed',
      prospect.stage === 'Kayıt oldu'
        ? 'Kesin kaydı tamamlanan adayda bu işlem yapılamaz.'
        : 'Vazgeçen adayda bu işlem yapılamaz; önce adayı yeniden açın.',
      { kind: 'conflict' },
    )
}

export type ProspectDuplicate = {
  /** `same`: aynı iletişim ve aynı ad; `shared`: iletişimi paylaşan farklı adlı aday. */
  kind: 'same' | 'shared'
  prospectId: string
}

/**
 * Açık adaylar arasında aynı telefon veya e-postayı taşıyan kayıt (DOM-KAY-002, -031). Aynı ad
 * (boşluk ve büyük/küçük harf farkı gözetilmez) `same`, farklı ad `shared` döner; `same` önceliklidir.
 * Kapalı (`Kayıt oldu`, `Vazgeçti`) adaylar sayılmaz. Liste bir kez taranır.
 */
export function findProspectDuplicate(
  prospects: readonly Pick<ProspectRecord, 'id' | 'name' | 'phone' | 'email' | 'stage'>[],
  candidate: { name: string; phone: string; email?: string | undefined },
  ignoreId = '',
): ProspectDuplicate | null {
  const name = normalizedName(candidate.name)
  const email = normalizedEmail(candidate.email)
  let shared: ProspectDuplicate | null = null
  for (const other of prospects) {
    if (other.id === ignoreId || !isOpen(other.stage)) continue
    const contact =
      other.phone === candidate.phone || (email !== '' && normalizedEmail(other.email) === email)
    if (!contact) continue
    if (normalizedName(other.name) === name) return { kind: 'same', prospectId: other.id }
    shared ??= { kind: 'shared', prospectId: other.id }
  }
  return shared
}

function rejectDuplicate(duplicate: ProspectDuplicate | null, siblingAcknowledged: boolean) {
  if (duplicate?.kind === 'same')
    throw new DomainError(
      'prospect_duplicate',
      'Bu telefon veya e-postayla açık bir aday kaydı var; yeni temas için mevcut karta not ekleyin.',
      { kind: 'conflict', path: ['phone'] },
    )
  if (duplicate?.kind === 'shared' && !siblingAcknowledged)
    throw new DomainError(
      'prospect_contact_shared',
      'Bu telefon veya e-posta başka bir açık adayda kayıtlı; kardeş adaysa kardeşini seçin.',
      { kind: 'conflict', path: ['siblingOfId'] },
    )
}

/**
 * Yeniden açılan adayın kardeşi (DOM-KAY-031): aynı kurumun (State yalnız etkin kurumun
 * adaylarını taşır) başka adayıdır, vazgeçmemiştir (açık veya kayıtlı) ve telefon ya da e-postayı
 * gerçekten paylaşır.
 */
function requireSibling(state: State, prospect: ProspectRecord, siblingOfId: string) {
  const sibling = state.prospects.find((p) => p.id === siblingOfId)
  const email = normalizedEmail(prospect.email)
  const valid =
    sibling !== undefined &&
    sibling.id !== prospect.id &&
    (isOpen(sibling.stage) || sibling.stage === 'Kayıt oldu') &&
    (sibling.phone === prospect.phone || (email !== '' && normalizedEmail(sibling.email) === email))
  if (!valid)
    throw new DomainError(
      'sibling_not_found',
      'Kardeş aday aynı iletişim bilgisini taşıyan açık veya kayıtlı bir aday olmalıdır.',
      { path: ['siblingOfId'] },
    )
}

// --- Aday ---------------------------------------------------------------------------------

/**
 * Yeni aday açar (DOM-KAY-002, -003, -004, -007, -009). Aday `Yeni aday` aşamasında başlar ve
 * akademik/finansal kayıt üretmez (DOM-KAY-001).
 */
export function createProspect(
  state: State,
  by: Participant,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: ProspectOptions = {},
): ProspectRecord {
  const data = createProspectSchema.parse(input)
  requireAuthorized(by, 'prospect.create', {}, state, options)
  const institutionType = options.institutionType ?? 'school'
  if (!state.branches.some((b) => b.id === data.branchId && b.isActive))
    throw new DomainError('branch_unavailable', 'Seçilen kampüs kullanılamıyor.', {
      path: ['branchId'],
    })
  // Okul adayı ortaokul/lise öğrencisidir; sözleşme tarafı velidir (DOM-KAY-012). Dil okulunda
  // yaş bilgisi alınmadan veli kuralı uygulanamayacağı için seçim zorunludur.
  if (institutionType === 'school' && data.minor === false)
    throw new DomainError(
      'prospect_guardian_required',
      'Okul adayları için veli bilgisi gerekir.',
      {
        path: ['minor'],
      },
    )
  if (institutionType === 'language_school' && data.minor === undefined)
    throw new DomainError('prospect_age_required', '18 yaş altı olup olmadığını seçin.', {
      path: ['minor'],
    })
  const minor = data.minor ?? true
  if (minor && data.guardianName === undefined)
    throw new DomainError('prospect_guardian_required', 'Velinin adını yazın.', {
      path: ['guardianName'],
    })
  if (
    data.referrerStudentId !== undefined &&
    !state.students.some((s) => s.id === data.referrerStudentId && s.isActive)
  )
    throw new DomainError('referrer_not_found', 'Referans veren öğrenci bulunamadı.', {
      path: ['referrerStudentId'],
    })
  if (data.source === REFERRAL_SOURCE && data.referrerStudentId === undefined)
    throw new DomainError('referrer_required', 'Referans veren öğrenciyi seçin.', {
      path: ['referrerStudentId'],
    })
  const email = data.email ?? ''
  if (data.marketingConsent?.email === true && email === '')
    throw new DomainError('consent_contact_missing', 'E-posta onayı için e-posta adresi girin.', {
      path: ['marketingConsent', 'email'],
    })
  const duplicate = findProspectDuplicate(state.prospects, { ...data, email })
  // Kardeş onayı yalnız iletişimi gerçekten paylaşan açık adayla geçerlidir.
  if (data.siblingOfId !== undefined) {
    const sibling = state.prospects.find((p) => p.id === data.siblingOfId)
    const sharesContact =
      sibling !== undefined &&
      isOpen(sibling.stage) &&
      (sibling.phone === data.phone || (email !== '' && normalizedEmail(sibling.email) === email))
    if (!sharesContact)
      throw new DomainError(
        'sibling_not_found',
        'Kardeş aday aynı iletişim bilgisini taşıyan açık bir aday olmalıdır.',
        { path: ['siblingOfId'] },
      )
  }
  rejectDuplicate(duplicate, data.siblingOfId !== undefined)
  const consent = data.marketingConsent ?? {}
  const prospect: ProspectRecord = {
    id: makeId('pr'),
    name: data.name,
    phone: data.phone,
    email,
    branchId: data.branchId,
    interest: data.interest,
    source: data.source,
    stage: 'Yeni aday',
    studentId: null,
    createdAt: now,
    trialAt: null,
    notes: [],
    minor,
    ...(minor && data.guardianName !== undefined ? { guardianName: data.guardianName } : {}),
    ...(data.referrerStudentId !== undefined ? { referrerStudentId: data.referrerStudentId } : {}),
    ...(data.siblingOfId !== undefined ? { siblingOfId: data.siblingOfId } : {}),
    privacyNotice: { version: data.privacyNoticeVersion, shownAt: now },
    marketingConsent: {
      sms: { granted: consent.sms ?? false, at: now },
      email: { granted: consent.email ?? false, at: now },
      call: { granted: consent.call ?? false, at: now },
    },
    createdBy: actorOf(by),
  }
  // TODO(crm-consent): ticari ileti onayının geri alınması (ret hakkı) ve İYS bildirimi ayrı
  // işlemdir (DOM-KAY-004); aday bilgisi düzeltme işlemi de yoktur.
  state.prospects.unshift(prospect)
  return prospect
}

/**
 * Elle seçilebilen sonraki aşamalar (DOM-KAY-005, -030). Açık aşamadan yalnız ileri gidilir;
 * `Görüşme planlandı` planlamayla, `Kayıt oldu` kesin kayıtla girilir. `Vazgeçti` yalnız
 * `İletişime geçildi` ile yeniden açılır; `Kayıt oldu` kilitlidir.
 */
export function nextProspectStages(stage: string | undefined): ProspectStage[] {
  // TODO(crm-stage-back): yanlışlıkla ileri alınan aşamayı düzeltmek geri dönüş yasağının
  // istisnasıdır; gerekirse yönetici onaylı, gerekçeli ayrı işlem olarak gelir.
  if (stage === 'Vazgeçti') return ['İletişime geçildi']
  const index = (OPEN_PROSPECT_STAGES as readonly (string | undefined)[]).indexOf(stage)
  if (index < 0) return []
  return [
    ...OPEN_PROSPECT_STAGES.slice(index + 1).filter((s) => s !== 'Görüşme planlandı'),
    'Vazgeçti',
  ]
}

/**
 * Adayın aşamasını değiştirir (DOM-KAY-005, -030). `Vazgeçti` nedenle girilir ve adayın ileri
 * tarihli görüşmesini ve deneme dersini iptal eder (yer boşalır); yeniden açılan aday tekillik
 * denetiminden geçer (DOM-KAY-002).
 */
export function changeProspectStage(
  state: State,
  by: Participant,
  prospectId: string,
  input: unknown,
  now: string,
  options: ProspectOptions = {},
): ProspectRecord {
  const data = changeProspectStageSchema.parse(input)
  requireAuthorized(by, 'prospect.stage', {}, state, options)
  const prospect = requireProspect(state, prospectId)
  if (prospect.stage === 'Kayıt oldu' || prospect.studentId)
    throw new DomainError(
      'prospect_enrolled',
      'Kesin kaydı tamamlanan adayın aşaması değiştirilemez.',
      { kind: 'conflict' },
    )
  if (data.stage === prospect.stage)
    throw new DomainError('prospect_stage_unchanged', 'Aday zaten bu aşamada.', {
      kind: 'conflict',
      path: ['stage'],
    })
  if (data.stage === 'Kayıt oldu')
    throw new DomainError(
      'prospect_enroll_required',
      'Adayı kayda dönüştürmek için kesin kayıt işlemini kullanın.',
      { path: ['stage'] },
    )
  if (data.stage === 'Görüşme planlandı')
    throw new DomainError(
      'prospect_meeting_required',
      'Bu aşama tanışma görüşmesi planlanınca kendiliğinden seçilir.',
      { path: ['stage'] },
    )
  if (!isStage(prospect.stage))
    throw new DomainError('prospect_stage_unknown', 'Adayın kayıtlı aşaması tanınmıyor.', {
      kind: 'conflict',
    })
  if (!nextProspectStages(prospect.stage).includes(data.stage))
    throw new DomainError(
      'prospect_stage_backward',
      prospect.stage === 'Vazgeçti'
        ? 'Vazgeçen aday yalnız "İletişime geçildi" aşamasıyla yeniden açılır.'
        : 'Aday önceki bir aşamaya geri alınamaz.',
      { path: ['stage'] },
    )
  if (data.siblingOfId !== undefined && prospect.stage !== 'Vazgeçti')
    throw new DomainError(
      'sibling_reopen_only',
      'Kardeş aday yalnız vazgeçen adayı yeniden açarken seçilir.',
      { path: ['siblingOfId'] },
    )
  if (data.siblingOfId !== undefined) requireSibling(state, prospect, data.siblingOfId)
  if (prospect.stage === 'Vazgeçti')
    rejectDuplicate(
      findProspectDuplicate(state.prospects, prospect, prospect.id),
      prospect.siblingOfId !== undefined || data.siblingOfId !== undefined,
    )
  if (data.stage === 'Vazgeçti') {
    if (data.lostReason === undefined)
      throw new DomainError('prospect_lost_reason_required', 'Vazgeçme nedenini seçin.', {
        path: ['lostReason'],
      })
    // Ayrılmış saat başka adaya açılsın diye ileri tarihli görüşme ve deneme dersi kalkar;
    // gerçekleşmiş olanlar geçmiş olarak kalır.
    const future = (date: string | null | undefined) =>
      date != null && Date.parse(date) > Date.parse(now)
    if (future(prospect.trialAt)) {
      prospect.trialAt = null
      delete prospect.meeting
    }
    if (future(prospect.trialLesson?.date)) delete prospect.trialLesson
    prospect.lostReason = data.lostReason
    prospect.lostAt = now
  } else {
    delete prospect.lostReason
    delete prospect.lostAt
    if (data.siblingOfId !== undefined) prospect.siblingOfId = data.siblingOfId
  }
  prospect.stage = data.stage
  prospect.updatedAt = now
  return prospect
}

// --- Not ----------------------------------------------------------------------------------

/**
 * Aday kartına not ekler (DOM-KAY-002, -032). Not değiştirilmez ve silinmez; en yeni not başta
 * durur (Vue görünümü). Kapalı adaya not eklenmez: vazgeçen adayla yeni temas önce adayı yeniden
 * açar, kayıtlı adayın notu öğrenci dosyasına yazılır.
 */
export function addProspectNote(
  state: State,
  by: Participant,
  prospectId: string,
  input: unknown,
  makeId: MakeId,
  now: string,
  options: ProspectOptions = {},
): ProspectNote {
  const data = addProspectNoteSchema.parse(input)
  requireAuthorized(by, 'prospect.note', {}, state, options)
  const prospect = requireProspect(state, prospectId)
  requireOpen(prospect)
  if (prospect.notes.length >= PROSPECT_NOTE_LIMIT)
    throw new DomainError(
      'prospect_note_limit',
      `Bir adaya en fazla ${PROSPECT_NOTE_LIMIT} not eklenebilir.`,
      { kind: 'conflict' },
    )
  const note: ProspectNote = {
    id: makeId('note'),
    text: data.text,
    date: now,
    author: options.authorName ?? '',
    by: actorOf(by),
  }
  prospect.notes = [note, ...prospect.notes]
  prospect.updatedAt = now
  return note
}

// --- Görüşme ve deneme dersi -------------------------------------------------------------

type Slot = { date: string; duration: number }
const meetingSlot = (prospect: ProspectRecord): Slot | null =>
  prospect.trialAt
    ? {
        date: prospect.trialAt,
        duration: prospect.meeting?.duration ?? LEGACY_MEETING_MINUTES,
      }
    : null
const trialSlot = (prospect: ProspectRecord): Slot | null =>
  prospect.trialLesson
    ? { date: prospect.trialLesson.date, duration: prospect.trialLesson.duration }
    : null

const ownScheduleConflict = () =>
  new DomainError(
    'prospect_schedule_conflict',
    'Adayın bu saatte başka bir görüşmesi veya deneme dersi var.',
    { kind: 'conflict', path: ['date'] },
  )

/**
 * Tanışma görüşmesi planlar veya yeniden planlar (DOM-KAY-006, -033). Görüşme adayın kampüsünde,
 * gelecek bir anda yapılır; aynı kampüsteki başka görüşmeyle aynı oda veya aynı öğretmen için
 * süre dikkate alınarak çakışamaz. Oda/öğretmen bilgisi olmayan eski görüşme kampüsün bütün
 * odalarını tutuyor sayılır. Öğretmenin dersi, randevusu, etüdü ve oda kullanımı
 * `tutorConflict` ile denetlenir. Görüşme `Yeni aday` ve `İletişime geçildi` adayı
 * `Görüşme planlandı` yapar; `Teklif verildi` aşaması geri alınmaz.
 */
export function scheduleProspectMeeting(
  state: State,
  by: Participant,
  prospectId: string,
  input: unknown,
  now: string,
  options: ProspectOptions = {},
): ProspectRecord {
  const data = scheduleMeetingSchema.parse(input)
  requireAuthorized(by, 'prospect.meeting', {}, state, options)
  const prospect = requireProspect(state, prospectId)
  requireOpen(prospect)
  if (Date.parse(data.date) <= Date.parse(now))
    throw new DomainError('meeting_in_past', 'Gelecek bir tarih ve saat seçin.', {
      path: ['date'],
    })
  if (!state.branches.some((b) => b.id === prospect.branchId && b.isActive))
    throw new DomainError('branch_unavailable', 'Adayın kampüsü kullanılamıyor.', {
      path: ['branchId'],
    })
  const teacherId = data.teacherId ?? null
  if (
    teacherId !== null &&
    !state.teachers.some(
      (t) => t.id === teacherId && t.isActive && t.branchId === prospect.branchId,
    )
  )
    throw new DomainError(
      'meeting_teacher_unavailable',
      'Görüşmeye adayın kampüsündeki aktif bir öğretmen katılabilir.',
      { path: ['teacherId'] },
    )
  const slot: Slot = { date: data.date, duration: data.duration }
  const room = data.room.toLocaleLowerCase('tr')
  for (const other of state.prospects) {
    // Kayda alınmış veya vazgeçmiş adayın kalan ileri tarihli görüşmesi saati tutmaz.
    if (other.id === prospect.id || other.branchId !== prospect.branchId || !isOpen(other.stage))
      continue
    const otherSlot = meetingSlot(other)
    if (!otherSlot || !intervalsOverlap(slot, otherSlot)) continue
    const known = other.meeting
    const clash =
      !known ||
      known.room.toLocaleLowerCase('tr') === room ||
      (teacherId !== null && known.teacherId === teacherId)
    if (clash)
      throw new DomainError(
        'meeting_conflict',
        'Bu kampüste seçilen saatte aynı oda veya görevli için başka bir görüşme var.',
        { kind: 'conflict', path: ['date'] },
      )
  }
  const resource = tutorConflict(state, {
    date: data.date,
    duration: data.duration,
    teacherId,
    branchId: prospect.branchId,
    room: data.room,
  })
  if (resource)
    throw new DomainError('meeting_conflict', resource, { kind: 'conflict', path: ['date'] })
  const trial = trialSlot(prospect)
  if (trial && intervalsOverlap(slot, trial)) throw ownScheduleConflict()
  prospect.meeting = {
    date: data.date,
    duration: data.duration,
    room: data.room,
    teacherId,
    scheduledAt: now,
    by: actorOf(by),
  }
  prospect.trialAt = data.date
  if (prospect.stage === 'Yeni aday' || prospect.stage === 'İletişime geçildi')
    prospect.stage = 'Görüşme planlandı'
  prospect.updatedAt = now
  // TODO(crm-meeting-host): ön büro görevlisinin (kullanıcı) kendi çakışması üyelik ve personel
  // kaydı gelince denetlenir; şimdilik görevli oda ve isteğe bağlı öğretmenle temsil edilir.
  return prospect
}

/**
 * Dil okulunda deneme dersi planlar (DOM-DIL-030, DOM-KAY-034). Aday kendi kampüsündeki açık bir
 * grubun gelecek, iptal edilmemiş dersine bir kez katılır; gerçekleşmiş deneme dersi ikinci kez
 * planlanamaz, ileri tarihli olan değiştirilebilir. Derse en fazla iki deneme katılımcısı alınır ve
 * aktif kursiyer + deneme katılımcısı grup kapasitesini (en fazla 18) aşamaz. 18 yaş altı adayda
 * veli adı, iletişim bilgisi ve veli onayı zorunludur. Deneme kaydı yoklamaya yazılmaz.
 */
export function scheduleTrialLesson(
  state: State,
  by: Participant,
  prospectId: string,
  input: unknown,
  now: string,
  options: ProspectOptions = {},
): ProspectRecord {
  const data = scheduleTrialLessonSchema.parse(input)
  requireAuthorized(by, 'prospect.trial', {}, state, options)
  const prospect = requireProspect(state, prospectId)
  requireOpen(prospect)
  // Kullanılmışlık dersin güncel kaydından okunur: iptal edilen veya programdan kalkan derse
  // bağlı deneme yapılmamış sayılır, yeniden planlanabilir.
  const previous = prospect.trialLesson
  const previousLesson = previous && state.schedule.find((l) => l.id === previous.lessonId)
  if (
    previousLesson &&
    !previousLesson.cancelledAt &&
    Date.parse(previousLesson.date) <= Date.parse(now)
  )
    throw new DomainError('trial_already_used', 'Aday deneme dersine zaten katıldı.', {
      kind: 'conflict',
    })
  const lesson = state.schedule.find((l) => l.id === data.lessonId)
  if (!lesson)
    throw new DomainError('lesson_not_found', 'Ders bulunamadı.', {
      kind: 'not_found',
      path: ['lessonId'],
    })
  if (lesson.cancelledAt)
    throw new DomainError('lesson_cancelled', 'İptal edilen derse deneme katılımcısı alınmaz.', {
      path: ['lessonId'],
    })
  if (Date.parse(lesson.date) <= Date.parse(now))
    throw new DomainError('trial_in_past', 'Gelecek bir ders seçin.', { path: ['lessonId'] })
  const group = state.classes.find((c) => c.id === lesson.classId)
  if (!group || !group.isActive || group.branchId !== prospect.branchId)
    throw new DomainError(
      'trial_group_unavailable',
      'Deneme dersi adayın kampüsündeki açık bir grubun dersi olmalıdır.',
      { path: ['lessonId'] },
    )
  // TODO(crm-trial-level): grubun seviyesi adayın hedef seviyesine ve yaş bandına (DOM-DIL-041)
  // uygun mu; aday seviyesi serbest metin olduğu için ön büro seçer.
  const minor = prospect.minor !== false
  if (minor && (!prospect.guardianName || !prospect.phone))
    throw new DomainError(
      'trial_guardian_contact_required',
      '18 yaş altı adayın deneme dersi için veli adı ve iletişim bilgisi gerekir.',
      { path: ['guardianName'] },
    )
  if (minor && data.guardianConsent !== true)
    throw new DomainError(
      'trial_guardian_consent_required',
      '18 yaş altı adayın deneme dersi için veli onayı gerekir.',
      { path: ['guardianConsent'] },
    )
  // Yalnız açık adayların denemesi sayılır: kayda alınan aday artık kursiyer olarak sayılır
  // (iki kez sayılmaz), vazgeçenin yeri boşalmıştır.
  const participants = state.prospects.filter(
    (p) => p.id !== prospect.id && isOpen(p.stage) && p.trialLesson?.lessonId === lesson.id,
  ).length
  if (participants >= TRIAL_PARTICIPANTS_PER_LESSON)
    throw new DomainError(
      'trial_lesson_full',
      `Bir derse en fazla ${TRIAL_PARTICIPANTS_PER_LESSON} deneme katılımcısı alınır.`,
      { kind: 'conflict', path: ['lessonId'] },
    )
  const enrolled = state.students.filter((s) => s.classId === group.id && s.isActive).length
  const capacity = Math.min(group.capacity, LANGUAGE_GROUP_CAPACITY_MAX)
  if (enrolled + participants + 1 > capacity)
    throw new DomainError('trial_capacity_full', 'Grubun bu dersteki kapasitesi dolu.', {
      kind: 'conflict',
      path: ['lessonId'],
    })
  const slot: Slot = { date: lesson.date, duration: lesson.duration }
  const meeting = meetingSlot(prospect)
  if (meeting && intervalsOverlap(slot, meeting)) throw ownScheduleConflict()
  prospect.trialLesson = {
    lessonId: lesson.id,
    classId: group.id,
    date: lesson.date,
    duration: lesson.duration,
    guardianConsentAt: minor ? now : null,
    scheduledAt: now,
    by: actorOf(by),
  }
  if (prospect.stage === 'Yeni aday' || prospect.stage === 'İletişime geçildi')
    prospect.stage = 'Görüşme planlandı'
  prospect.updatedAt = now
  // TODO(crm-trial-result): öğretmenin deneme dersi sonucu (DOM-DIL-031) öğretmene aday kartı
  // yetkisi gerektirir; yetki matrisinde öğretmenin aday erişimi yoktur.
  return prospect
}
