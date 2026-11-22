import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { istanbulInstant } from './finance-infirmary-schedule.ts'
import { addDays } from './finance-opening-watch.ts'
import { dayKey } from './format.ts'
import type { GuardianLink } from './guardianship.ts'

/**
 * Erken çıkış ve izinli ayrılış (docs/domain/finans.md DOM-FIN-161; ON-168). Veli kendi çocuğu için
 * gün, saat, neden ve teslim alacak kişiyle talep açar; okul (yönetici ya da ön büro) onaylar ya da
 * gerekçeyle reddeder. Acil durumda talebi okul kendisi açar; okulun açtığı talep onaylı doğar
 * (K-538). Teslim alan kişi öğrencinin teslim yetkilisi (velayetli ve kısıtsız veli ya da teslim
 * alma yetkisi işaretli bağ; IST-019, DOM-ILT-074) ya da kayıtlı olmayan, adı, kimliğinin son dört
 * hanesi ve yakınlığı yazılan ve okulca onaylanan kişidir; kimlik numarasının tamamı alınmaz.
 *
 * Teslimde ön büro kişiyi yetkili listesinden seçer, kimliği gördüğünü işaretler ve gerçek çıkış
 * anı kaydedilir; yetkisiz kişiye teslim reddedilir (K-539). Erken çıkışın etkilediği dersler ders
 * programından hesaplanır ve yoklama için okuma olarak sunulur; yoklama kaydı değiştirilmez
 * (IST-072: mazeret yoklamayı kendiliğinden değiştirmez; K-540). Fonksiyonlar saftır; zaman `now`
 * ile gelir, gün Europe/Istanbul'dur.
 */

/** Liste, ayrıntı, onay, ret, teslim ve okulun açtığı talep: yönetici ve ön büro (K-538). */
export const EARLY_DISMISSAL_STAFF_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Talep açma ve iptal: okul ve veli (veli yalnız velayetli olduğu çocuğu için). */
export const EARLY_DISMISSAL_REQUEST_ROLES = [
  'yonetici',
  'onburo',
  'veli',
] as const satisfies readonly Role[]
/** Yoklamaya yansıma okuması: okul ve öğretmen (öğretmen kendi sınıfları; K-540). */
export const EARLY_DISMISSAL_EFFECT_ROLES = [
  'yonetici',
  'onburo',
  'ogretmen',
] as const satisfies readonly Role[]

export const EARLY_DISMISSAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'released',
] as const
export type EarlyDismissalStatus = (typeof EARLY_DISMISSAL_STATUSES)[number]
export const EARLY_DISMISSAL_STATUS_LABELS = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  cancelled: 'İptal edildi',
  released: 'Teslim edildi',
} as const satisfies Record<EarlyDismissalStatus, string>
/** Öğrencinin aynı gündeki tek etkin talebini sayan durumlar (kısmi tekil indeks). */
export const EARLY_DISMISSAL_ACTIVE_STATUSES = [
  'pending',
  'approved',
  'released',
] as const satisfies readonly EarlyDismissalStatus[]

export const EARLY_DISMISSAL_REASONS = ['health', 'appointment', 'family', 'other'] as const
export type EarlyDismissalReason = (typeof EARLY_DISMISSAL_REASONS)[number]
export const EARLY_DISMISSAL_REASON_LABELS = {
  health: 'Sağlık',
  appointment: 'Randevu (doktor, resmî işlem)',
  family: 'Aile işi',
  other: 'Diğer',
} as const satisfies Record<EarlyDismissalReason, string>

export const EARLY_DISMISSAL_SOURCES = ['guardian', 'school'] as const
export type EarlyDismissalSource = (typeof EARLY_DISMISSAL_SOURCES)[number]

/** Teslim alan: kayıtlı bağ (`guardian`) ya da kayıtlı olmayan, okulca onaylanan kişi (`other`). */
export const EARLY_DISMISSAL_PICKUP_KINDS = ['guardian', 'other'] as const
export type EarlyDismissalPickupKind = (typeof EARLY_DISMISSAL_PICKUP_KINDS)[number]

/** Kayıtlı olmayan teslim alanın öğrenciye yakınlığı. */
export const PICKUP_RELATIONSHIPS = [
  'grandparent',
  'sibling',
  'relative',
  'family_friend',
  'other',
] as const
export type PickupRelationship = (typeof PICKUP_RELATIONSHIPS)[number]
export const PICKUP_RELATIONSHIP_LABELS = {
  grandparent: 'Büyükanne / büyükbaba',
  sibling: 'Kardeş (reşit)',
  relative: 'Diğer akraba',
  family_friend: 'Aile dostu',
  other: 'Diğer',
} as const satisfies Record<PickupRelationship, string>

export const EARLY_DISMISSAL_NOTE_MAX = 300
export const EARLY_DISMISSAL_DECISION_MIN = 5
export const EARLY_DISMISSAL_DECISION_MAX = 300
export const PICKUP_NAME_MAX = 120
/** Talep en çok bu kadar gün sonrası için açılır. */
export const EARLY_DISMISSAL_MAX_DAYS_AHEAD = 30
/** Bugünkü talepte planlanan saat en çok bu kadar dakika geçmişte olabilir (acil kayıt). */
export const EARLY_DISMISSAL_PAST_GRACE_MINUTES = 30
/** Kimliğin son dört hanesi: rakam ya da (pasaportta) büyük harf. */
export const PICKUP_ID_LAST4_PATTERN = /^[0-9A-Z]{4}$/
export const EARLY_DISMISSAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/
const MINUTE_MS = 60_000

// --- Şemalar -------------------------------------------------------------------------------------

const normalizeLast4 = (value: string) => value.trim().toUpperCase()
const idLast4Schema = z
  .string('Kimliğin son dört hanesini yazın.')
  .transform(normalizeLast4)
  .pipe(
    z
      .string()
      .regex(
        PICKUP_ID_LAST4_PATTERN,
        'Kimliğin yalnız son dört hanesini yazın (4 rakam ya da harf).',
      ),
  )

const optionalText = (max: number, label: string) =>
  z
    .string(`${label} metin olmalı.`)
    .trim()
    .max(max, `${label} en çok ${String(max)} karakter olabilir.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()

const pickupSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('self').describe('Talebi açan veli kendisi (yalnız veli)'),
    }),
    z.strictObject({
      kind: z.literal('guardian').describe('Öğrencinin kayıtlı teslim yetkilisi'),
      guardianLinkId: z
        .uuid('Teslim yetkilisini seçin.')
        .describe('Veli–öğrenci bağı (`pickup-options` listesinden)'),
    }),
    z.strictObject({
      kind: z.literal('other').describe('Kayıtlı olmayan kişi; okul onayı şart'),
      // kvkk: K (teslim alan kişinin adı)
      name: z
        .string('Teslim alacak kişinin adını yazın.')
        .trim()
        .min(2, 'Ad soyad en az 2 karakter olmalı.')
        .max(PICKUP_NAME_MAX, `Ad soyad en çok ${String(PICKUP_NAME_MAX)} karakter olabilir.`)
        .describe('Ad soyad (2–120)'),
      // kvkk: K (kimliğin yalnız son dört hanesi; tamamı alınmaz)
      idLast4: idLast4Schema.describe(
        'Kimliğin yalnız son dört hanesi (rakam ya da harf); tamamı gönderilmez ve saklanmaz',
      ),
      relationship: z
        .enum(PICKUP_RELATIONSHIPS, 'Öğrenciye yakınlığını seçin.')
        .describe(
          '`grandparent` büyükanne/büyükbaba, `sibling` reşit kardeş, `relative` akraba, `family_friend` aile dostu, `other` diğer',
        ),
    }),
  ],
  { error: 'Teslim alacak kişiyi seçin.' },
)
export type EarlyDismissalPickupInput = z.output<typeof pickupSchema>

export const earlyDismissalCreateSchema = z
  .strictObject({
    studentId: z
      .string('Öğrenciyi seçin.')
      .trim()
      .min(1, 'Öğrenciyi seçin.')
      .max(200)
      .describe('Öğrenci (veli yalnız velayetli olduğu çocuğu)'),
    date: daySchema.describe('Çıkış günü (YYYY-MM-DD, Europe/Istanbul); bugün ya da 30 gün içinde'),
    time: z
      .string('Çıkış saatini girin.')
      .regex(EARLY_DISMISSAL_TIME_PATTERN, 'Saati SS:DD biçiminde girin (ör. 13:40).')
      .describe('Planlanan çıkış saati (SS:DD, Europe/Istanbul)'),
    reason: z
      .enum(EARLY_DISMISSAL_REASONS, 'Çıkış nedenini seçin.')
      .describe(
        '`health` sağlık, `appointment` randevu (doktor, resmî işlem), `family` aile işi, `other` diğer',
      ),
    // kvkk: K (serbest metin; sağlık ayrıntısı yazılmaması istenir)
    reasonNote: optionalText(EARLY_DISMISSAL_NOTE_MAX, 'Açıklama')
      .default(null)
      .describe('Açıklama (≤ 300); `other` nedeninde zorunlu; denetime ve loga yazılmaz'),
    pickup: pickupSchema.describe('Teslim alacak kişi'),
  })
  .superRefine((value, context) => {
    if (value.reason === 'other' && value.reasonNote === null)
      context.addIssue({
        code: 'custom',
        path: ['reasonNote'],
        message: '"Diğer" nedeninde açıklama yazın.',
      })
  })
export type EarlyDismissalCreateInput = z.input<typeof earlyDismissalCreateSchema>
export type EarlyDismissalCreateFields = z.output<typeof earlyDismissalCreateSchema>

export const earlyDismissalApproveSchema = z.strictObject({})

export const earlyDismissalRejectSchema = z.strictObject({
  // kvkk: K (serbest metin)
  reason: z
    .string('Ret gerekçesini yazın.')
    .trim()
    .min(
      EARLY_DISMISSAL_DECISION_MIN,
      `Gerekçe en az ${String(EARLY_DISMISSAL_DECISION_MIN)} karakter olmalı.`,
    )
    .max(
      EARLY_DISMISSAL_DECISION_MAX,
      `Gerekçe en çok ${String(EARLY_DISMISSAL_DECISION_MAX)} karakter olabilir.`,
    )
    .describe('Ret gerekçesi (5–300); veliye görünür, denetime ve loga yazılmaz'),
})
export type EarlyDismissalRejectFields = z.output<typeof earlyDismissalRejectSchema>

export const earlyDismissalCancelSchema = z.strictObject({
  // kvkk: K (serbest metin)
  reason: optionalText(EARLY_DISMISSAL_DECISION_MAX, 'Gerekçe')
    .default(null)
    .describe('İptal gerekçesi (isteğe bağlı, ≤ 300)'),
})
export type EarlyDismissalCancelFields = z.output<typeof earlyDismissalCancelSchema>

const releasePickupSchema = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({
      kind: z.literal('guardian').describe('Öğrencinin teslim yetkilisi'),
      guardianLinkId: z
        .uuid('Teslim alan kişiyi listeden seçin.')
        .describe('Teslim alan veli–öğrenci bağı (ayrıntıdaki `authorizedPickups`)'),
    }),
    z.strictObject({
      kind: z.literal('other').describe('Talepte onaylanan kayıtlı olmayan kişi'),
      // kvkk: K (kimliğin son dört hanesi)
      idLast4: idLast4Schema.describe(
        'Görülen kimliğin son dört hanesi; talepte onaylananla eşleşmeli',
      ),
    }),
  ],
  { error: 'Teslim alan kişiyi seçin.' },
)

export const earlyDismissalReleaseSchema = z.strictObject({
  pickup: releasePickupSchema.describe('Öğrenciyi teslim alan kişi'),
  identityVerified: z
    .literal(true, 'Teslim alan kişinin kimliğini görüp işaretleyin.')
    .describe('Teslim alanın kimliği görüldü (zorunlu `true`; numara yazılmaz)'),
  releasedAt: z.iso
    .datetime({ offset: true, error: 'Çıkış saatini girin.' })
    .nullable()
    .default(null)
    .describe('Gerçek çıkış anı (ISO 8601); boşsa şimdi. Gelecekte ve başka günde olamaz'),
})
export type EarlyDismissalReleaseFields = z.output<typeof earlyDismissalReleaseSchema>

// --- Teslim yetkilisi ----------------------------------------------------------------------------

/**
 * Bağ öğrenciyi teslim alabilir mi (K-538): iletişim kısıtı yok ve velayetli (tam ya da ortak
 * velayet; velayet teslim yetkisini içerir) ya da teslim alma yetkisi işaretli. İletişim kısıtlı
 * veli hiçbir durumda teslim alamaz (DOM-ILT-074).
 */
export const canPickUpStudent = (
  link: Pick<GuardianLink, 'custody' | 'contactRestricted' | 'canPickUp'>,
) => !link.contactRestricted && (link.custody !== 'none' || link.canPickUp)

/** Öğrencinin teslim yetkilileri: öğrencinin etkin bağlarından yetkili olanlar, sıra korunur. */
export const authorizedPickups = <T extends GuardianLink>(
  links: readonly T[],
  studentId: string,
): T[] => links.filter((link) => link.studentId === studentId && canPickUpStudent(link))

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

/** Talebi açanın bağlamı: okul ya da veli (veli üyeliği ve öğrencideki bağları). */
export type EarlyDismissalRequester =
  { kind: 'school' } | { kind: 'guardian'; membershipId: string }

export interface EarlyDismissalCreateChecks {
  now: Date
  requester: EarlyDismissalRequester
  /** Öğrenci kurumda var mı, etkin mi ve sınıfı; yoksa (ya da velinin kapsamı dışındaysa) `null`. */
  student: { active: boolean; classId: string | null } | null
  /** Öğrencinin etkin veli bağları. */
  links: readonly GuardianLink[]
  /** Öğrencinin aynı gün açık (bekleyen, onaylı ya da teslim edilmiş) talebi var mı. */
  activeExists: boolean
}

export interface EarlyDismissalPlan {
  status: 'pending' | 'approved'
  source: EarlyDismissalSource
  dismissalOn: string
  plannedAt: string
  classId: string | null
  pickup:
    | { kind: 'guardian'; guardianLinkId: string }
    | { kind: 'other'; name: string; idLast4: string; relationship: PickupRelationship }
}

/** Gün ve saatin Europe/Istanbul anı. */
export const plannedInstant = (day: string, time: string) => istanbulInstant(day, time)

/**
 * Talep kuralı (K-538). Öğrenci kurumda ve etkin olmalı; veli yalnız velayetli ve iletişim kısıtı
 * olmayan çocuğu için açar (kapsam dışı öğrenci 404 gibi, velayetsiz ya da kısıtlı bağ 403). Gün
 * bugün ya da 30 gün içinde; bugünkü talepte saat en çok 30 dakika geçmişte olabilir. Teslim
 * alacak kişi `self` (yalnız veli; kendi bağı), öğrencinin teslim yetkilisi bağ ya da kayıtlı
 * olmayan kişidir. Velinin talebi onay bekler; okulun açtığı talep (acil durum) onaylı doğar.
 * Öğrenciye aynı gün ikinci açık talep 409.
 */
export function planEarlyDismissal(
  input: EarlyDismissalCreateFields,
  checks: EarlyDismissalCreateChecks,
): EarlyDismissalPlan {
  if (checks.student === null)
    throw new DomainError('early_dismissal_student_not_found', 'Öğrenci bulunamadı.', {
      kind: 'not_found',
      path: ['studentId'],
    })
  if (!checks.student.active)
    throw ruleError(
      'early_dismissal_student_inactive',
      'Kaydı kapalı öğrenci için erken çıkış açılamaz.',
      ['studentId'],
    )
  const requester = checks.requester
  let ownLink: GuardianLink | undefined
  if (requester.kind === 'guardian') {
    ownLink = checks.links.find(
      (link) => link.studentId === input.studentId && link.membershipId === requester.membershipId,
    )
    if (ownLink === undefined)
      throw new DomainError('early_dismissal_student_not_found', 'Öğrenci bulunamadı.', {
        kind: 'not_found',
        path: ['studentId'],
      })
    if (ownLink.contactRestricted || ownLink.custody === 'none')
      throw new DomainError(
        'early_dismissal_custody_required',
        'Bu öğrenci için erken çıkış talebini yalnız velayeti olan ve iletişim kısıtı bulunmayan veli açabilir.',
        { kind: 'forbidden', path: ['studentId'] },
      )
  }
  const today = dayKey(checks.now)
  if (input.date < today)
    throw ruleError('early_dismissal_date_past', 'Geçmiş güne erken çıkış açılamaz.', ['date'])
  if (input.date > addDays(today, EARLY_DISMISSAL_MAX_DAYS_AHEAD))
    throw ruleError(
      'early_dismissal_date_too_far',
      `Erken çıkış en çok ${String(EARLY_DISMISSAL_MAX_DAYS_AHEAD)} gün sonrası için açılır.`,
      ['date'],
    )
  const plannedAt = plannedInstant(input.date, input.time)
  if (Date.parse(plannedAt) < checks.now.getTime() - EARLY_DISMISSAL_PAST_GRACE_MINUTES * MINUTE_MS)
    throw ruleError('early_dismissal_time_past', 'Çıkış saati geçmiş; saati güncelleyin.', ['time'])

  let pickup: EarlyDismissalPlan['pickup']
  const pickupInput = input.pickup
  if (pickupInput.kind === 'self') {
    if (ownLink === undefined)
      throw ruleError(
        'early_dismissal_pickup_self_school',
        'Okul talebinde teslim alacak kişiyi listeden seçin ya da adını yazın.',
        ['pickup', 'kind'],
      )
    pickup = { kind: 'guardian', guardianLinkId: ownLink.id }
  } else if (pickupInput.kind === 'guardian') {
    const link = authorizedPickups(checks.links, input.studentId).find(
      (item) => item.id === pickupInput.guardianLinkId,
    )
    if (link === undefined)
      throw ruleError(
        'early_dismissal_pickup_not_authorized',
        'Seçilen kişi bu öğrencinin teslim yetkilisi değil.',
        ['pickup', 'guardianLinkId'],
      )
    pickup = { kind: 'guardian', guardianLinkId: link.id }
  } else {
    pickup = {
      kind: 'other',
      name: pickupInput.name,
      idLast4: pickupInput.idLast4,
      relationship: pickupInput.relationship,
    }
  }
  if (checks.activeExists)
    throw new DomainError(
      'early_dismissal_exists',
      'Bu öğrencinin o gün için açık bir erken çıkış kaydı var.',
      { kind: 'conflict', path: ['date'] },
    )
  return {
    status: requester.kind === 'school' ? 'approved' : 'pending',
    source: requester.kind === 'school' ? 'school' : 'guardian',
    dismissalOn: input.date,
    plannedAt,
    classId: checks.student.classId,
    pickup,
  }
}

export interface EarlyDismissalState {
  status: EarlyDismissalStatus
  dismissalOn: string
  pickupKind: EarlyDismissalPickupKind
  pickupIdLast4: string | null
}

const assertOpen = (current: Pick<EarlyDismissalState, 'status'>) => {
  if (current.status === 'released')
    throw ruleError('early_dismissal_already_released', 'Öğrenci zaten teslim edildi.')
  if (current.status === 'rejected' || current.status === 'cancelled')
    throw ruleError('early_dismissal_closed', 'Talep reddedildi ya da iptal edildi.')
}

/** Onay (K-538): yalnız bekleyen talep; günü geçmiş talep onaylanmaz. */
export function planEarlyDismissalApproval(current: EarlyDismissalState, now: Date): void {
  assertOpen(current)
  if (current.status !== 'pending')
    throw ruleError('early_dismissal_not_pending', 'Talep zaten onaylandı.')
  if (current.dismissalOn < dayKey(now))
    throw ruleError('early_dismissal_expired', 'Talebin günü geçti; onaylanamaz.')
}

/** Ret (K-538): yalnız bekleyen talep; gerekçe şemadadır. */
export function planEarlyDismissalRejection(current: EarlyDismissalState): void {
  assertOpen(current)
  if (current.status !== 'pending')
    throw ruleError(
      'early_dismissal_not_pending',
      'Onaylanmış talep reddedilmez; gerekiyorsa iptal edin.',
    )
}

/** İptal: bekleyen ya da onaylı, teslim edilmemiş talep. */
export function planEarlyDismissalCancel(current: EarlyDismissalState): void {
  assertOpen(current)
}

export interface EarlyDismissalReleaseChecks {
  now: Date
  /** Öğrencinin teslim anındaki etkin veli bağları. */
  links: readonly GuardianLink[]
  studentId: string
}

/**
 * Teslim (K-539): yalnız onaylı talep ve yalnız çıkış gününde. Teslim alan öğrencinin şu anki
 * teslim yetkilisi bağ (listeden seçilir) ya da talepte onaylanan kayıtlı olmayan kişidir; onun
 * kimliğinin son dört hanesi talepteki ile eşleşmelidir. Kimliğin görüldüğü şemada zorunludur.
 * Yetkisiz kişiye teslim 422'dir. Gerçek çıkış anı boşsa şimdidir; gelecekte ve başka günde olamaz.
 */
export function planEarlyDismissalRelease(
  current: EarlyDismissalState,
  input: EarlyDismissalReleaseFields,
  checks: EarlyDismissalReleaseChecks,
): {
  releasedAt: string
  releasedTo: { kind: 'guardian'; guardianLinkId: string } | { kind: 'other' }
} {
  assertOpen(current)
  if (current.status !== 'approved')
    throw ruleError(
      'early_dismissal_not_approved',
      'Onaylanmamış talepte öğrenci teslim edilemez; önce onaylayın.',
    )
  const today = dayKey(checks.now)
  if (current.dismissalOn !== today)
    throw ruleError(
      'early_dismissal_not_today',
      'Öğrenci yalnız erken çıkış gününde teslim edilir.',
    )
  const at = input.releasedAt === null ? checks.now : new Date(input.releasedAt)
  if (at.getTime() > checks.now.getTime())
    throw ruleError('early_dismissal_release_future', 'Çıkış saati şimdiden sonra olamaz.', [
      'releasedAt',
    ])
  if (dayKey(at) !== current.dismissalOn)
    throw ruleError(
      'early_dismissal_release_other_day',
      'Çıkış saati erken çıkış gününde olmalı.',
      ['releasedAt'],
    )
  const pickup = input.pickup
  if (pickup.kind === 'guardian') {
    const link = authorizedPickups(checks.links, checks.studentId).find(
      (item) => item.id === pickup.guardianLinkId,
    )
    if (link === undefined)
      throw ruleError(
        'early_dismissal_pickup_not_authorized',
        'Bu kişi öğrenciyi teslim almaya yetkili değil; öğrenci teslim edilemez.',
        ['pickup', 'guardianLinkId'],
      )
    return {
      releasedAt: at.toISOString(),
      releasedTo: { kind: 'guardian', guardianLinkId: link.id },
    }
  }
  if (current.pickupKind !== 'other' || current.pickupIdLast4 === null)
    throw ruleError(
      'early_dismissal_pickup_not_authorized',
      'Talepte kayıtlı olmayan bir kişi onaylanmadı; öğrenciyi yalnız teslim yetkilisi alabilir.',
      ['pickup', 'kind'],
    )
  if (pickup.idLast4 !== current.pickupIdLast4)
    throw ruleError(
      'early_dismissal_pickup_mismatch',
      'Kimliğin son dört hanesi onaylanan kişiyle eşleşmiyor; öğrenci teslim edilemez.',
      ['pickup', 'idLast4'],
    )
  return { releasedAt: at.toISOString(), releasedTo: { kind: 'other' } }
}

// --- Yoklamaya yansıma ---------------------------------------------------------------------------

/** Ders programındaki ders (yalnız gereken alanlar; `lib/finance-leave-requests.ts` ile aynı). */
export interface DismissalScheduleLesson {
  id: string
  /** Başlangıç anı (ISO 8601 UTC). */
  date: string
  /** Dakika. */
  duration: number
  classId: string
  subjectId: string
  title: string | null
  cancelledAt: string | null
}

export interface DismissalLessonEffect {
  lessonId: string
  /** Günün kaçıncı dersi (sınıfın o günkü iptal edilmemiş dersleri içinde, 1'den). */
  period: number
  startsAt: string
  endsAt: string
  subjectId: string
  title: string | null
  /** Ders sürerken çıktı (dersin bir bölümüne katıldı). */
  partial: boolean
}

const lessonEndMs = (lesson: Pick<DismissalScheduleLesson, 'date' | 'duration'>) =>
  Date.parse(lesson.date) + (lesson.duration > 0 ? lesson.duration : 40) * MINUTE_MS

/**
 * Erken çıkışın etkilediği dersler (K-540): sınıfın çıkış günündeki (Europe/Istanbul) iptal
 * edilmemiş dersleri başlangıca göre sıralanır, sıra numarası ders saatidir; çıkış anından sonra
 * biten her ders etkilenir, çıkış ders sırasında olduysa ders `partial` işaretlenir. `fromPeriod`
 * ilk etkilenen dersin sırasıdır ("4. dersten itibaren"); etkilenen ders yoksa `null`.
 */
export function dismissalLessonEffects(
  lessons: readonly DismissalScheduleLesson[],
  classId: string | null,
  day: string,
  departureAt: string,
): { fromPeriod: number | null; lessons: DismissalLessonEffect[] } {
  if (classId === null) return { fromPeriod: null, lessons: [] }
  const departure = Date.parse(departureAt)
  const ofDay = lessons
    .filter(
      (lesson) =>
        lesson.classId === classId &&
        !lesson.cancelledAt &&
        Number.isFinite(Date.parse(lesson.date)) &&
        dayKey(lesson.date) === day,
    )
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id))
  const affected = ofDay.flatMap((lesson, index) => {
    const end = lessonEndMs(lesson)
    if (end <= departure) return []
    return [
      {
        lessonId: lesson.id,
        period: index + 1,
        startsAt: new Date(lesson.date).toISOString(),
        endsAt: new Date(end).toISOString(),
        subjectId: lesson.subjectId,
        title: lesson.title,
        partial: Date.parse(lesson.date) < departure,
      },
    ]
  })
  return { fromPeriod: affected[0]?.period ?? null, lessons: affected }
}

/**
 * Yoklamaya yansıyan çıkış anı (K-540): teslim edilen talepte gerçek çıkış, onaylı ve henüz teslim
 * edilmemiş talepte planlanan saat; diğer durumlar yansımaz (`null`).
 */
export function dismissalDeparture(state: {
  status: EarlyDismissalStatus
  plannedAt: string
  releasedAt: string | null
}): { basis: 'released' | 'planned'; at: string } | null {
  if (state.status === 'released' && state.releasedAt !== null)
    return { basis: 'released', at: state.releasedAt }
  if (state.status === 'approved') return { basis: 'planned', at: state.plannedAt }
  return null
}

/** Kayıtlı olmayan kişinin kimlik son dört hanesi ekranda maskeli: `•••• 1234`. */
export const maskIdLast4 = (value: string | null) => (value === null ? null : `•••• ${value}`)
