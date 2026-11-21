import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { dateLabel } from './format.ts'
import { daysBetween } from './finance-opening-watch.ts'
import { FINANCE_TRANSPORT_ROLES, type MemberCheck } from './finance-transport.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Servis aracı ve personeli belgeleri, geçerlilik uyarısı ve araç uygunluğu (docs/domain/finans.md
 * DOM-FIN-147; ON-147; K-496…K-498). Belge üç öznenin birine bağlıdır: araç (muayene, zorunlu
 * trafik sigortası, koltuk sigortası, okul servis aracı uygunluk/izin belgesi), aracın kayıtlı
 * sürücüsü (sürücü kurum üyesi değildir; araç kaydındaki ada bağlanır) ya da kurum üyesi personel
 * (rehber ya da üye sürücü; üyelik yabancı anahtarı). Kişi belgesinde içerik saklanmaz: yalnız tür,
 * tarihler, ehliyet sınıfı ve isteğe bağlı dosya (KVKK en az veri; K-497). Belge silinmez ve
 * düzeltilmez; aynı öznenin aynı türdeki yeni belgesi eskisinin yerine geçer ("Diğer" hariç).
 * Bitişi kurum ayarlı gün (varsayılan 30) içinde olan belge "süresi yaklaşıyor", geçmiş belge
 * "süresi geçti"dir; zorunlu belgesi süresi geçmiş araç "uygun değil" işaretlenir ama atama
 * engellenmez (K-498). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Liste, uyarı ve belge kaydı: yönetici ve ön büro (servis modülüyle aynı; K-496). */
export const FINANCE_TRANSPORT_DOCUMENT_ROLES = FINANCE_TRANSPORT_ROLES
/** Uyarı ayarı ve özel nitelikli kişi belgesi (adli sicil, psikoteknik): yalnız yönetici (K-497). */
export const FINANCE_TRANSPORT_DOCUMENT_MANAGE_ROLES = [
  'yonetici',
] as const satisfies readonly Role[]

export const TRANSPORT_DOCUMENT_SUBJECTS = ['vehicle', 'driver', 'staff'] as const
export type TransportDocumentSubject = (typeof TRANSPORT_DOCUMENT_SUBJECTS)[number]
export const TRANSPORT_DOCUMENT_SUBJECT_LABELS = {
  vehicle: 'Araç',
  driver: 'Sürücü',
  staff: 'Rehber / personel',
} as const satisfies Record<TransportDocumentSubject, string>

export const VEHICLE_DOCUMENT_TYPES = [
  'inspection',
  'traffic_insurance',
  'seat_insurance',
  'school_bus_permit',
] as const
export const PERSON_DOCUMENT_TYPES = [
  'driving_license',
  'src_certificate',
  'psychotechnical',
  'criminal_record',
] as const
export const TRANSPORT_DOCUMENT_TYPES = [
  ...VEHICLE_DOCUMENT_TYPES,
  ...PERSON_DOCUMENT_TYPES,
  'other',
] as const
export type TransportDocumentType = (typeof TRANSPORT_DOCUMENT_TYPES)[number]
export const TRANSPORT_DOCUMENT_TYPE_LABELS = {
  inspection: 'Araç muayenesi',
  traffic_insurance: 'Zorunlu trafik sigortası',
  seat_insurance: 'Koltuk sigortası',
  school_bus_permit: 'Okul servis aracı uygunluk / izin belgesi',
  driving_license: 'Sürücü belgesi (ehliyet)',
  src_certificate: 'Mesleki yeterlilik (SRC)',
  psychotechnical: 'Psikoteknik raporu',
  criminal_record: 'Adli sicil kaydı',
  other: 'Diğer',
} as const satisfies Record<TransportDocumentType, string>

/** Öznenin alabileceği türler: araç belgeleri araca, kişi belgeleri sürücüye ve personele. */
export const TRANSPORT_DOCUMENT_TYPES_BY_SUBJECT = {
  vehicle: [...VEHICLE_DOCUMENT_TYPES, 'other'],
  driver: [...PERSON_DOCUMENT_TYPES, 'other'],
  staff: [...PERSON_DOCUMENT_TYPES, 'other'],
} as const satisfies Record<TransportDocumentSubject, readonly TransportDocumentType[]>

/** Araç uygunluğunu belirleyen zorunlu türler: aracın dört belgesi (K-498). */
export const REQUIRED_VEHICLE_DOCUMENT_TYPES = VEHICLE_DOCUMENT_TYPES
/** Aracın sürücüsünde zorunlu türler (K-497, K-498): ehliyet, SRC, psikoteknik, adli sicil. */
export const REQUIRED_DRIVER_DOCUMENT_TYPES = PERSON_DOCUMENT_TYPES

/**
 * Bitişi zorunlu türler (K-496, K-497): muayene, sigortalar, izin belgesi, ehliyet ve psikoteknik.
 * SRC, adli sicil ve diğerde bitiş isteğe bağlıdır; bitişsiz belge süresiz sayılır.
 */
export const END_DATE_REQUIRED_TYPES = [
  ...VEHICLE_DOCUMENT_TYPES,
  'driving_license',
  'psychotechnical',
] as const satisfies readonly TransportDocumentType[]

/**
 * Özel nitelikli kişi belgeleri (KVKK md. 6: ceza mahkûmiyeti ve sağlık verisi; K-497): yalnız
 * yönetici kaydeder ve dosyasını açar; ön büroda listede yalnız tür ve tarih görünür.
 */
export const SENSITIVE_TRANSPORT_DOCUMENT_TYPES = [
  'criminal_record',
  'psychotechnical',
] as const satisfies readonly TransportDocumentType[]

/** Ehliyet sınıfları (2918 sayılı Karayolları Trafik Kanunu md. 39). */
export const DRIVING_LICENSE_CLASSES = [
  'M',
  'A1',
  'A2',
  'A',
  'B1',
  'B',
  'BE',
  'C1',
  'C1E',
  'C',
  'CE',
  'D1',
  'D1E',
  'D',
  'DE',
  'F',
  'G',
] as const
export type DrivingLicenseClass = (typeof DRIVING_LICENSE_CLASSES)[number]

export const TRANSPORT_DOCUMENT_NUMBER_MAX = 50
export const TRANSPORT_DOCUMENT_WARNING_DAYS_DEFAULT = 30
export const TRANSPORT_DOCUMENT_WARNING_DAYS_MIN = 1
export const TRANSPORT_DOCUMENT_WARNING_DAYS_MAX = 180
/** Uçtaki dosya sınırı (K-496): PDF ya da görsel, en çok 10 MB (amaç sınırından dar). */
export const TRANSPORT_DOCUMENT_FILE_MAX_BYTES = 10 * 1024 * 1024
export const TRANSPORT_DOCUMENT_FILE_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

const includes = <T extends string>(list: readonly T[], value: string): value is T =>
  (list as readonly string[]).includes(value)

export const isSensitiveTransportDocumentType = (type: TransportDocumentType) =>
  includes(SENSITIVE_TRANSPORT_DOCUMENT_TYPES, type)
export const isEndDateRequired = (type: TransportDocumentType) =>
  includes(END_DATE_REQUIRED_TYPES, type)
export const transportDocumentTypesFor = (subject: TransportDocumentSubject) =>
  TRANSPORT_DOCUMENT_TYPES_BY_SUBJECT[subject]

// --- Şemalar -------------------------------------------------------------------------------------

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `En çok ${String(max)} karakter girebilirsiniz.`)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)

/** Yeni belge (DOM-FIN-147; K-496, K-497). */
export const transportDocumentInputSchema = z
  .strictObject({
    subject: z
      .enum(TRANSPORT_DOCUMENT_SUBJECTS, 'Belgenin kime ait olduğunu seçin.')
      .describe(
        '`vehicle` araç, `driver` aracın kayıtlı sürücüsü (kurum üyesi değil), `staff` kurum üyesi personel (rehber ya da üye sürücü)',
      ),
    vehicleId: z
      .uuid('Aracı seçin.')
      .nullable()
      .default(null)
      .describe('Araç ve sürücü belgesinde zorunlu: servis aracı'),
    // kvkk: K (personel üyeliği)
    membershipId: z
      .string('Personeli seçin.')
      .trim()
      .min(1, 'Personeli seçin.')
      .max(100, 'Personel geçersiz.')
      .nullable()
      .default(null)
      .describe(
        'Personel belgesinde zorunlu: kurumun etkin yönetici, öğretmen ya da ön büro üyeliği',
      ),
    documentType: z
      .enum(TRANSPORT_DOCUMENT_TYPES, 'Belge türünü seçin.')
      .describe(
        'Araçta `inspection` muayene, `traffic_insurance` zorunlu trafik sigortası, `seat_insurance` koltuk sigortası, `school_bus_permit` okul servis aracı uygunluk/izin belgesi; kişide `driving_license` ehliyet, `src_certificate` SRC, `psychotechnical` psikoteknik, `criminal_record` adli sicil; ikisinde `other`',
      ),
    documentNumber: optionalText(TRANSPORT_DOCUMENT_NUMBER_MAX).describe(
      'Belge ya da poliçe numarası (yalnız araç belgesinde, isteğe bağlı, en çok 50); kişi belgesinde numara tutulmaz (K-497)',
    ),
    licenseClass: z
      .enum(DRIVING_LICENSE_CLASSES, 'Ehliyet sınıfını seçin.')
      .nullable()
      .default(null)
      .describe('Yalnız ehliyette ve orada zorunlu: ehliyet sınıfı (`B`, `D1`, `D` …)'),
    startDate: daySchema.describe(
      'Belgenin düzenlendiği ya da başladığı gün; bugünden sonra olamaz',
    ),
    endDate: daySchema
      .nullable()
      .default(null)
      .describe(
        'Geçerlilik bitişi (dahil); muayene, sigortalar, izin belgesi, ehliyet ve psikoteknikte zorunlu, diğerlerinde boşsa süresiz',
      ),
    fileId: z
      .uuid('Dosya geçersiz.')
      .nullable()
      .default(null)
      .describe(
        'Yüklenmiş dosya (`POST /files`; amaç `document` PDF ya da `question_image` görsel), en çok 10 MB; isteğe bağlı',
      ),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message })
    if (value.subject === 'staff') {
      if (value.membershipId === null) issue('membershipId', 'Personeli seçin.')
      if (value.vehicleId !== null) issue('vehicleId', 'Personel belgesinde araç seçilmez.')
    } else {
      if (value.vehicleId === null) issue('vehicleId', 'Aracı seçin.')
      if (value.membershipId !== null)
        issue('membershipId', 'Araç ve sürücü belgesinde personel seçilmez.')
    }
    if (!includes(transportDocumentTypesFor(value.subject), value.documentType))
      issue(
        'documentType',
        value.subject === 'vehicle'
          ? 'Bu tür araç belgesi değil.'
          : 'Bu tür sürücü ya da personel belgesi değil.',
      )
    if (value.documentType === 'driving_license' && value.licenseClass === null)
      issue('licenseClass', 'Ehliyet sınıfını seçin.')
    if (value.documentType !== 'driving_license' && value.licenseClass !== null)
      issue('licenseClass', 'Ehliyet sınıfı yalnız sürücü belgesinde seçilir.')
    if (value.subject !== 'vehicle' && value.documentNumber !== null)
      issue('documentNumber', 'Kişi belgesinde belge numarası tutulmaz.')
    if (isEndDateRequired(value.documentType) && value.endDate === null)
      issue('endDate', 'Geçerlilik bitişini girin.')
    if (value.endDate !== null && value.endDate < value.startDate)
      issue('endDate', 'Bitiş başlangıçtan önce olamaz.')
  })
export type TransportDocumentInput = z.input<typeof transportDocumentInputSchema>
export type TransportDocumentFields = z.output<typeof transportDocumentInputSchema>

/** Uyarı ayarı (K-498): bitişine kaç gün kala "süresi yaklaşıyor" denir. */
export const transportDocumentSettingsSchema = z.strictObject({
  warningDays: z
    .number('Uyarı süresini gün olarak girin.')
    .int('Süre tam gün olmalı.')
    .min(
      TRANSPORT_DOCUMENT_WARNING_DAYS_MIN,
      `Süre en az ${String(TRANSPORT_DOCUMENT_WARNING_DAYS_MIN)} gün olmalı.`,
    )
    .max(
      TRANSPORT_DOCUMENT_WARNING_DAYS_MAX,
      `Süre en çok ${String(TRANSPORT_DOCUMENT_WARNING_DAYS_MAX)} gün olabilir.`,
    )
    .describe(
      'Bitişine bu kadar gün (dahil) kalan belge "süresi yaklaşıyor" (1–180; varsayılan 30)',
    ),
})
export type TransportDocumentSettingsFields = z.output<typeof transportDocumentSettingsSchema>

export interface TransportDocumentSettings {
  warningDays: number
}
export const DEFAULT_TRANSPORT_DOCUMENT_SETTINGS: TransportDocumentSettings = {
  warningDays: TRANSPORT_DOCUMENT_WARNING_DAYS_DEFAULT,
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Yerine geçilebilecek geçerli belge (aynı özne ve tür, yerine geçilmemiş). */
export interface CurrentTransportDocument {
  id: string
  startDate: string
}

/** Yeni belgenin denetimi için servis kurum kilidi altında yükler. */
export interface TransportDocumentChecks {
  /** Araç ve sürücü belgesinde aracın kaydı: arşivli ya da yoksa `null`. */
  vehicle: { driverName: string } | null | undefined
  /** Personel belgesinde üyelik: seçilmediyse `undefined`, kurumda yoksa `null`. */
  staff: MemberCheck
  /** Bağlanacak dosya: verilmediyse `undefined`, kurumda yoksa `null` (altyapı reddeder). */
  file: { mimeType: string; byteSize: number } | null | undefined
  /** Öznenin bu türdeki yerine geçilmemiş belgeleri (sürücüde aracın bütün sürücü belgeleri). */
  current: readonly CurrentTransportDocument[]
  actorRole: string
  today: string
}

export interface TransportDocumentPlan {
  /** Yerine geçilen belge; yoksa `null`. */
  supersedes: string | null
  sensitive: boolean
  /** Sürücü belgesinde kayıt anındaki sürücü adı (araçta sürücü değişirse belge eski sürücüde kalır). */
  driverName: string | null
}

/**
 * Yeni belge (DOM-FIN-147; K-496, K-497). Araç kurumun arşivlenmemiş aracı, personel etkin
 * yönetici, öğretmen ya da ön büro üyeliğidir; başlangıç bugünden sonra olamaz. Özel nitelikli türü
 * (adli sicil, psikoteknik) yalnız yönetici kaydeder. Dosya PDF ya da görsel ve en çok 10 MB'tır.
 * "Diğer" dışındaki türde yeni belge aynı öznenin geçerli belgesinin yerine kendiliğinden geçer;
 * geçerli belgeden eski başlangıçlı belge yerine geçemez (geçmiş belge sonradan girilmez).
 */
export function planTransportDocument(
  input: TransportDocumentFields,
  checks: TransportDocumentChecks,
): TransportDocumentPlan {
  if (input.subject !== 'staff' && (checks.vehicle === null || checks.vehicle === undefined))
    throw ruleError('transport_document_vehicle_not_found', 'Araç bulunamadı.', 'vehicleId')
  if (input.subject === 'staff') {
    const staff = checks.staff
    if (staff === null || staff === undefined)
      throw ruleError('transport_document_staff_not_found', 'Personel bulunamadı.', 'membershipId')
    if (!isStaffRole(staff.role))
      throw ruleError(
        'transport_document_not_staff',
        'Servis personeli belgesi yalnız kurum personeline (yönetici, öğretmen, ön büro) kaydedilir.',
        'membershipId',
      )
    if (!staff.active)
      throw ruleError(
        'transport_document_staff_inactive',
        'Pasifleştirilmiş personele yeni belge kaydedilmez.',
        'membershipId',
      )
  }
  const sensitive = isSensitiveTransportDocumentType(input.documentType)
  if (sensitive && checks.actorRole !== 'yonetici')
    throw new DomainError(
      'transport_document_sensitive_forbidden',
      `${TRANSPORT_DOCUMENT_TYPE_LABELS[input.documentType]} özel nitelikli kişisel veridir; yalnız yönetici kaydeder.`,
      { kind: 'forbidden' },
    )
  if (input.startDate > checks.today)
    throw ruleError(
      'transport_document_start_in_future',
      'Belge tarihi bugünden sonra olamaz.',
      'startDate',
    )
  if (checks.file !== undefined && checks.file !== null) {
    if (!includes(TRANSPORT_DOCUMENT_FILE_MIME_TYPES, checks.file.mimeType))
      throw ruleError(
        'transport_document_file_type',
        'Belge dosyası PDF ya da görsel (JPG, PNG, WebP) olmalı.',
        'fileId',
      )
    if (checks.file.byteSize > TRANSPORT_DOCUMENT_FILE_MAX_BYTES)
      throw ruleError(
        'transport_document_file_too_large',
        'Belge dosyası en çok 10 MB olabilir.',
        'fileId',
      )
  }
  const target = input.documentType === 'other' ? null : (checks.current[0] ?? null)
  if (target !== null && input.startDate < target.startDate)
    throw ruleError(
      'transport_document_older_than_current',
      `Yeni belgenin tarihi geçerli belgeden (${dayText(target.startDate)}) önce olamaz.`,
      'startDate',
    )
  return {
    supersedes: target?.id ?? null,
    sensitive,
    driverName: input.subject === 'driver' ? (checks.vehicle?.driverName ?? null) : null,
  }
}

/** Ayar (K-498): değişiklik yoksa 422. */
export function planTransportDocumentSettings(
  current: TransportDocumentSettings,
  input: TransportDocumentSettingsFields,
): { next: TransportDocumentSettings; changed: string[] } {
  if (input.warningDays === current.warningDays)
    throw ruleError(
      'transport_document_settings_unchanged',
      'Ayarda değişiklik yok.',
      'warningDays',
    )
  return { next: { warningDays: input.warningDays }, changed: ['warningDays'] }
}

// --- Geçerlilik ve uygunluk ----------------------------------------------------------------------

/** Durum (saklanmaz, bugüne göre). */
export const TRANSPORT_DOCUMENT_STATUSES = ['valid', 'expiring', 'expired', 'superseded'] as const
export type TransportDocumentStatus = (typeof TRANSPORT_DOCUMENT_STATUSES)[number]
export const TRANSPORT_DOCUMENT_STATUS_LABELS = {
  valid: 'Geçerli',
  expiring: 'Süresi yaklaşıyor',
  expired: 'Süresi geçti',
  superseded: 'Yerine yenisi geçti',
} as const satisfies Record<TransportDocumentStatus, string>

/**
 * Bugüne göre durum ve kalan gün (bitiş günü dahil geçerlidir; bugün biten belgede 0, geçende
 * eksi). Bitişi `warningDays` gün içinde (dahil) olan belge "yaklaşıyor"dur; bitişsiz belge geçerli.
 */
export function transportDocumentStatus(
  document: { endDate: string | null; supersededAt: unknown },
  today: string,
  warningDays: number = TRANSPORT_DOCUMENT_WARNING_DAYS_DEFAULT,
): { status: TransportDocumentStatus; daysLeft: number | null } {
  const daysLeft = document.endDate === null ? null : daysBetween(today, document.endDate)
  if (document.supersededAt !== null) return { status: 'superseded', daysLeft }
  if (daysLeft === null) return { status: 'valid', daysLeft }
  if (daysLeft < 0) return { status: 'expired', daysLeft }
  return { status: daysLeft <= warningDays ? 'expiring' : 'valid', daysLeft }
}

/** Sürücü belgesi aracın şimdiki sürücüsüne mi ait (kayıt anındaki ad aynı mı; K-497). */
export const isCurrentDriverDocument = (
  documentDriverName: string | null,
  vehicleDriverName: string,
) => documentDriverName !== null && documentDriverName === vehicleDriverName

export interface FitnessDocument {
  documentType: TransportDocumentType
  endDate: string | null
  supersededAt: unknown
}

export interface VehicleFitness {
  /** Zorunlu belgelerinin hiçbirinin süresi geçmemiş (eksik belge uygunluğu bozmaz; K-498). */
  fit: boolean
  /** Süresi geçmiş zorunlu türler (araç ve sürücü). */
  expiredTypes: TransportDocumentType[]
  /** Bitişi yaklaşan zorunlu türler. */
  expiringTypes: TransportDocumentType[]
  missingVehicleTypes: TransportDocumentType[]
  missingDriverTypes: TransportDocumentType[]
}

/**
 * Araç uygunluğu (K-498): aracın ve şimdiki sürücüsünün yerine geçilmemiş belgelerinden zorunlu
 * türde süresi geçmiş belge varsa araç "uygun değil"dir. Zorunlu türün hiç belgesi yoksa "eksik"
 * uyarısı verilir, uygunluk bozulmaz. "Diğer" uygunluğa sayılmaz.
 */
export function vehicleFitness(
  vehicleDocuments: readonly FitnessDocument[],
  driverDocuments: readonly FitnessDocument[],
  today: string,
  warningDays: number,
): VehicleFitness {
  const expired = new Set<TransportDocumentType>()
  const expiring = new Set<TransportDocumentType>()
  const scan = (
    documents: readonly FitnessDocument[],
    required: readonly TransportDocumentType[],
  ) => {
    const present = new Set<TransportDocumentType>()
    for (const document of documents) {
      if (document.supersededAt !== null || !required.includes(document.documentType)) continue
      present.add(document.documentType)
      const { status } = transportDocumentStatus(document, today, warningDays)
      if (status === 'expired') expired.add(document.documentType)
      if (status === 'expiring') expiring.add(document.documentType)
    }
    return required.filter((type) => !present.has(type))
  }
  const missingVehicleTypes = scan(vehicleDocuments, REQUIRED_VEHICLE_DOCUMENT_TYPES)
  const missingDriverTypes = scan(driverDocuments, REQUIRED_DRIVER_DOCUMENT_TYPES)
  const order = (types: Set<TransportDocumentType>) =>
    TRANSPORT_DOCUMENT_TYPES.filter((type) => types.has(type))
  return {
    fit: expired.size === 0,
    expiredTypes: order(expired),
    expiringTypes: order(expiring),
    missingVehicleTypes,
    missingDriverTypes,
  }
}

/** Dosyayı ve ayrıntıyı kimden gizle (K-497): özel nitelikli türde yönetici dışındakilerden. */
export const isTransportDocumentRestricted = (type: TransportDocumentType, role: string) =>
  isSensitiveTransportDocumentType(type) && role !== 'yonetici'

// --- Görünüm -------------------------------------------------------------------------------------

/** Kalan gün metni: "12 gün kaldı", "bugün bitiyor", "3 gün geçti", "süresiz". */
export function transportDocumentDaysText(daysLeft: number | null): string {
  if (daysLeft === null) return 'süresiz'
  if (daysLeft === 0) return 'bugün bitiyor'
  if (daysLeft > 0) return `${String(daysLeft)} gün kaldı`
  return `${String(-daysLeft)} gün geçti`
}

/** Tür listesi metni: "Araç muayenesi, Koltuk sigortası". */
export const transportDocumentTypesText = (types: readonly TransportDocumentType[]) =>
  types.map((type) => TRANSPORT_DOCUMENT_TYPE_LABELS[type]).join(', ')
