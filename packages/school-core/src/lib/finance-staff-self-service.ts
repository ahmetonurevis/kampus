import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { leaveRequestCreateSchema } from './finance-leave-requests.ts'
import {
  mergePersonnelFile,
  PERSONNEL_EMERGENCY_MAX,
  personnelBankInputSchema,
  personnelContactInputSchema,
  personnelEmergencyContactSchema,
  type PersonnelEmergencyContact,
  type PersonnelFileUpdateFields,
  type PersonnelFileValues,
} from './finance-personnel-files.ts'
import {
  HEALTH_REPORT_KINDS,
  STAFF_DOCUMENT_NOTE_MAX,
  STAFF_DOCUMENT_TYPES,
  type HealthReportKind,
  type StaffDocumentSettings,
  type StaffDocumentType,
} from './finance-staff-documents.ts'
import { maskIban } from './finance-suppliers.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Personel self-servisi (docs/domain/finans.md DOM-FIN-166; ON-189; K-553…K-555). Tek giriş
 * oturumdaki kullanıcının kendi personel üyeliğidir: istekte personel kimliği yoktur, başka
 * personelin kaydı 404'tür.
 *
 * - **Değişiklik talebi (K-553):** personel özlük kartını (DOM-FIN-140) doğrudan yazmaz; adres ve
 *   telefon, acil durum kişileri, banka (IBAN, hesap sahibi) ya da yeni özlük belgesi (DOM-FIN-113)
 *   için talep açar. Talep bekliyor → onaylandı (kayda yazılır) ya da gerekçeyle reddedildi;
 *   personel bekleyen talebini geri çeker. Belge dışındaki her türde aynı anda tek bekleyen talep
 *   olur; belge talebi en çok `STAFF_CHANGE_DOCUMENT_PENDING_MAX` tanedir.
 * - **IBAN (K-554):** IBAN TR mod-97 ile doğrulanır, şifreli saklanır, her okumada maskelidir.
 *   Ek doğrulama: talep taze oturum ister (rotada) ve hesap sahibi personelin kendi adı olmalıdır
 *   (ücret personelin kendi hesabına ödenir).
 * - **Onay (K-553):** yalnız yönetici onaylar ya da reddeder (İK rolü yoktur; muhasebe rolü
 *   açılınca yeniden değerlendirilir). Onay aynı transaction'da kartı ya da belgeyi yazar; kartın
 *   ve belgenin kendi kuralları (DOM-FIN-140, DOM-FIN-113) onayda yeniden çalışır.
 *
 * Fonksiyonlar saftır.
 */

// --- Roller --------------------------------------------------------------------------------------

/** Self-servisi kullanan roller: kurum personeli. Öğrenci ve veli 403. */
export const STAFF_SELF_SERVICE_ROLES = [
  'yonetici',
  'ogretmen',
  'onburo',
] as const satisfies readonly Role[]
/** Değişiklik talebini onaylayan ve reddeden roller (K-553). */
export const STAFF_CHANGE_APPROVER_ROLES = ['yonetici'] as const satisfies readonly Role[]

// --- Türler ve durumlar --------------------------------------------------------------------------

export const STAFF_CHANGE_KINDS = ['contact', 'emergency_contacts', 'bank', 'document'] as const
export type StaffChangeKind = (typeof STAFF_CHANGE_KINDS)[number]
export const STAFF_CHANGE_KIND_LABELS = {
  contact: 'Adres ve telefon',
  emergency_contacts: 'Acil durum kişileri',
  bank: 'Banka bilgisi',
  document: 'Özlük belgesi',
} as const satisfies Record<StaffChangeKind, string>

export const STAFF_CHANGE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const
export type StaffChangeStatus = (typeof STAFF_CHANGE_STATUSES)[number]
export const STAFF_CHANGE_STATUS_LABELS = {
  pending: 'Onay bekliyor',
  approved: 'Onaylandı',
  rejected: 'Reddedildi',
  cancelled: 'Geri çekildi',
} as const satisfies Record<StaffChangeStatus, string>

/** Aynı anda bekleyebilecek belge talebi sayısı. */
export const STAFF_CHANGE_DOCUMENT_PENDING_MAX = 10
export const STAFF_CHANGE_REASON_MIN = 5
export const STAFF_CHANGE_REASON_MAX = 500

// --- Şemalar -------------------------------------------------------------------------------------

const contactFields = personnelContactInputSchema.pick({ address: true, phone: true })

/** Adres ve telefon talebi; verilmeyen alan değişmez, `null` temizler. */
const contactChangeSchema = z
  .strictObject({
    kind: z.literal('contact'),
    // kvkk: K
    address: contactFields.shape.address,
    // kvkk: K
    phone: contactFields.shape.phone,
  })
  .refine(
    (value) => value.address !== undefined || value.phone !== undefined,
    'Değiştirilecek adresi ya da telefonu yazın.',
  )

/** Acil durum kişileri; liste bütün olarak yazılır. */
const emergencyChangeSchema = z.strictObject({
  kind: z.literal('emergency_contacts'),
  // kvkk: K
  emergencyContacts: z
    .array(personnelEmergencyContactSchema, 'Acil durum kişileri liste olmalı.')
    .min(1, 'En az bir acil durum kişisi girin.')
    .max(
      PERSONNEL_EMERGENCY_MAX,
      `En çok ${String(PERSONNEL_EMERGENCY_MAX)} acil durum kişisi girilebilir.`,
    )
    .describe('Acil durum kişilerinin yeni listesi (en çok 5); liste bütün olarak yazılır'),
})

const bankFields = personnelBankInputSchema.required()

/** Banka bilgisi: IBAN ve hesap sahibi birlikte (K-554). */
const bankChangeSchema = z.strictObject({
  kind: z.literal('bank'),
  // kvkk: Ç — şifreli saklanır, her okumada maskeli.
  iban: bankFields.shape.iban,
  // kvkk: K
  accountHolder: bankFields.shape.accountHolder,
})

/** Yeni özlük belgesi (DOM-FIN-113); belge onayda kaydedilir. */
const documentChangeSchema = z.strictObject({
  kind: z.literal('document'),
  documentType: z
    .enum(STAFF_DOCUMENT_TYPES, 'Belge türünü seçin.')
    .describe(
      '`diploma`, `health_report` sağlık raporu, `criminal_record` adli sicil kaydı, `certificate` sertifika/kurs belgesi, `id_copy` kimlik fotokopisi, `other` diğer',
    ),
  healthReportKind: z
    .enum(HEALTH_REPORT_KINDS, 'Raporun işe giriş ya da periyodik olduğunu seçin.')
    .nullable()
    .default(null)
    .describe('Yalnız sağlık raporunda ve orada zorunlu: `pre_employment`, `periodic`'),
  documentDate: daySchema.describe('Belgenin düzenlendiği gün; bugünden sonra olamaz'),
  fileId: z
    .uuid('Dosya geçersiz.')
    .nullable()
    .default(null)
    .describe('Yüklenmiş `document` amaçlı dosya (`POST /files`); isteğe bağlı'),
  // kvkk: K (serbest metin)
  note: z
    .string('Not metin olmalı.')
    .trim()
    .max(
      STAFF_DOCUMENT_NOTE_MAX,
      `Not en çok ${String(STAFF_DOCUMENT_NOTE_MAX)} karakter olabilir.`,
    )
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .default(null)
    .describe('İsteğe bağlı not; özel nitelikli belgede yazılmaz'),
})

/** Değişiklik talebi (K-553): türe göre alanlar. */
export const staffChangeRequestInputSchema = z
  .discriminatedUnion(
    'kind',
    [contactChangeSchema, emergencyChangeSchema, bankChangeSchema, documentChangeSchema],
    'Talep türünü seçin.',
  )
  .superRefine((value, context) => {
    if (value.kind !== 'document') return
    if (value.documentType === 'health_report' && value.healthReportKind === null)
      context.addIssue({
        code: 'custom',
        path: ['healthReportKind'],
        message: 'Raporun işe giriş ya da periyodik olduğunu seçin.',
      })
    if (value.documentType !== 'health_report' && value.healthReportKind !== null)
      context.addIssue({
        code: 'custom',
        path: ['healthReportKind'],
        message: 'Rapor türü yalnız sağlık raporunda seçilir.',
      })
  })
export type StaffChangeRequestInput = z.input<typeof staffChangeRequestInputSchema>
export type StaffChangeRequestFields = z.output<typeof staffChangeRequestInputSchema>

/** Ret gerekçesi (K-553): personele gösterilir; denetim kaydına yazılmaz. */
export const staffChangeRejectSchema = z.strictObject({
  // kvkk: K (serbest metin)
  reason: z
    .string('Ret gerekçesini yazın.')
    .trim()
    .min(
      STAFF_CHANGE_REASON_MIN,
      `Ret gerekçesi en az ${String(STAFF_CHANGE_REASON_MIN)} karakter olmalı.`,
    )
    .max(
      STAFF_CHANGE_REASON_MAX,
      `Ret gerekçesi en çok ${String(STAFF_CHANGE_REASON_MAX)} karakter olabilir.`,
    )
    .describe('Ret gerekçesi (5–500); personele gösterilir, denetim kaydına yazılmaz'),
})
export type StaffChangeRejectFields = z.output<typeof staffChangeRejectSchema>

/**
 * Personelin kendi izin talebi (DOM-FIN-116): yönetici talebinin alanları, personel ve yedek
 * seçimi olmadan. Personel oturumdan gelir; yedek öğretmeni onayda yönetici seçer.
 */
export const myLeaveRequestInputSchema = z
  .strictObject({
    typeCode: leaveRequestCreateSchema.shape.typeCode,
    startDate: leaveRequestCreateSchema.shape.startDate,
    endDate: leaveRequestCreateSchema.shape.endDate,
    days: leaveRequestCreateSchema.shape.days,
    // kvkk: K (serbest metin)
    description: leaveRequestCreateSchema.shape.description,
  })
  .superRefine((value, context) => {
    if (value.endDate < value.startDate)
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Bitiş günü başlangıç gününden önce olamaz.',
      })
  })
export type MyLeaveRequestInput = z.input<typeof myLeaveRequestInputSchema>

// --- Saklanan yük --------------------------------------------------------------------------------

/**
 * Talebin saklanan yükü (IBAN dışında; IBAN şifreli kolondadır). Okumada şemadan geçer; bozuk
 * satır programlama hatasıdır.
 */
export const storedStaffChangePayloadSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('contact'),
    address: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }),
  z.strictObject({
    kind: z.literal('emergency_contacts'),
    emergencyContacts: z.array(personnelEmergencyContactSchema),
  }),
  z.strictObject({ kind: z.literal('bank'), accountHolder: z.string() }),
  z.strictObject({
    kind: z.literal('document'),
    documentType: z.enum(STAFF_DOCUMENT_TYPES),
    healthReportKind: z.enum(HEALTH_REPORT_KINDS).nullable(),
    documentDate: z.string(),
    note: z.string().nullable(),
  }),
])
export type StoredStaffChangePayload = z.output<typeof storedStaffChangePayloadSchema>

/** Gövdeyi saklanacak yük ve ayrı tutulan IBAN'a ayırır. */
export function splitStaffChange(input: StaffChangeRequestFields): {
  payload: StoredStaffChangePayload
  iban: string | null
  fileId: string | null
} {
  switch (input.kind) {
    case 'contact':
      return {
        payload: {
          kind: 'contact',
          ...(input.address === undefined ? {} : { address: input.address }),
          ...(input.phone === undefined ? {} : { phone: input.phone }),
        },
        iban: null,
        fileId: null,
      }
    case 'emergency_contacts':
      return {
        payload: { kind: 'emergency_contacts', emergencyContacts: input.emergencyContacts },
        iban: null,
        fileId: null,
      }
    case 'bank':
      return {
        payload: { kind: 'bank', accountHolder: input.accountHolder },
        iban: input.iban,
        fileId: null,
      }
    case 'document':
      return {
        payload: {
          kind: 'document',
          documentType: input.documentType,
          healthReportKind: input.healthReportKind,
          documentDate: input.documentDate,
          note: input.note,
        },
        iban: null,
        fileId: input.fileId,
      }
    default:
      return input satisfies never
  }
}

/** Denetim kaydına yazılan alan adları (değer yazılmaz). */
export function staffChangeFields(payload: StoredStaffChangePayload): string[] {
  switch (payload.kind) {
    case 'contact':
      return [
        ...(payload.address === undefined ? [] : ['contact.address']),
        ...(payload.phone === undefined ? [] : ['contact.phone']),
      ]
    case 'emergency_contacts':
      return ['emergencyContacts']
    case 'bank':
      return ['bank.iban', 'bank.accountHolder']
    case 'document':
      return ['documentType', 'documentDate']
    default:
      return payload satisfies never
  }
}

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string[] = []) =>
  new DomainError(code, message, { kind: 'rule', path })

/** Türkçe ad karşılaştırması: büyük/küçük harf ve boşluk farkı yok sayılır. */
export const normalizePersonName = (value: string) =>
  value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')

/** Talebi açarken servis kurum kilidi altında yükler. */
export interface StaffChangeChecks {
  /** Oturumdaki üyelik; kurumda yoksa `null`. */
  staff: { role: string; active: boolean; name: string } | null
  /** Personelin bekleyen talepleri. */
  pending: readonly { kind: StaffChangeKind }[]
  /** Kartın bugünkü değerleri; kart yoksa `null`. */
  current: PersonnelFileValues | null
  /** Kurumun özlük belgesi tür ayarları (özel nitelik). */
  documentSettings: StaffDocumentSettings
  today: string
}

/**
 * Değişiklik talebi (K-553, K-554). Talep eden kurumun etkin personelidir. Belge dışındaki türde
 * bekleyen talep varsa 409; belge talebi en çok on tane bekler. Kartta zaten olan değer 422
 * `staff_change_request_unchanged`. Hesap sahibi personelin adı değilse 422
 * `staff_change_bank_holder_mismatch`. Belgede tarih bugünden sonra olamaz ve özel nitelikli
 * belgeye not yazılmaz (DOM-FIN-113).
 */
export function planStaffChangeRequest(
  input: StaffChangeRequestFields,
  checks: StaffChangeChecks,
): void {
  if (checks.staff === null || !isStaffRole(checks.staff.role))
    throw new DomainError('staff_self_service_not_staff', 'Personel kaydınız bulunamadı.', {
      kind: 'not_found',
    })
  if (!checks.staff.active)
    throw ruleError(
      'staff_self_service_inactive',
      'Ayrılmış personel değişiklik talebi açamaz; insan kaynaklarına başvurun.',
    )
  const pendingOfKind = checks.pending.filter((item) => item.kind === input.kind).length
  if (input.kind === 'document') {
    if (pendingOfKind >= STAFF_CHANGE_DOCUMENT_PENDING_MAX)
      throw ruleError(
        'staff_change_document_pending_limit',
        `Onay bekleyen en çok ${String(STAFF_CHANGE_DOCUMENT_PENDING_MAX)} belge olabilir.`,
      )
  } else if (pendingOfKind > 0)
    throw new DomainError(
      'staff_change_request_pending_exists',
      `${STAFF_CHANGE_KIND_LABELS[input.kind]} için onay bekleyen talebiniz var. Önce onu geri çekin.`,
      { kind: 'conflict', path: ['kind'] },
    )
  switch (input.kind) {
    case 'contact':
    case 'emergency_contacts': {
      const current = checks.current
      const update = staffChangeUpdate(splitStaffChange(input).payload, null)
      if (current !== null && update !== null) {
        const next = mergePersonnelFile(current, update)
        if (JSON.stringify(next) === JSON.stringify(current))
          throw ruleError('staff_change_request_unchanged', 'Kartınızda bu bilgi zaten kayıtlı.')
      }
      return
    }
    case 'bank': {
      if (normalizePersonName(input.accountHolder) !== normalizePersonName(checks.staff.name))
        throw ruleError(
          'staff_change_bank_holder_mismatch',
          'Hesap sahibi siz olmalısınız; ücret yalnız kendi adınıza açılmış hesaba ödenir.',
          ['accountHolder'],
        )
      const current = checks.current
      if (current?.iban === input.iban && current.accountHolder === input.accountHolder)
        throw ruleError('staff_change_request_unchanged', 'Kartınızda bu bilgi zaten kayıtlı.')
      return
    }
    case 'document': {
      if (input.documentDate > checks.today)
        throw ruleError('staff_document_date_in_future', 'Belge tarihi bugünden sonra olamaz.', [
          'documentDate',
        ])
      if (checks.documentSettings[input.documentType].sensitive && input.note !== null)
        throw ruleError(
          'staff_document_sensitive_note',
          'Özel nitelikli belgeye not yazılmaz; içerik yalnız dosyada tutulur.',
          ['note'],
        )
      return
    }
    default:
      input satisfies never
  }
}

/**
 * Talebin karta uygulanacak güncellemesi; belge talebinde `null`. `iban` banka talebinde çözülmüş
 * IBAN'dır (yalnız sunucu belleğinde).
 */
export function staffChangeUpdate(
  payload: StoredStaffChangePayload,
  iban: string | null,
): PersonnelFileUpdateFields | null {
  switch (payload.kind) {
    case 'contact':
      return {
        contact: {
          ...(payload.address === undefined ? {} : { address: payload.address }),
          ...(payload.phone === undefined ? {} : { phone: payload.phone }),
        },
      }
    case 'emergency_contacts':
      return { emergencyContacts: payload.emergencyContacts }
    case 'bank':
      if (iban === null) throw new Error('bank change request without IBAN')
      return { bank: { iban, accountHolder: payload.accountHolder } }
    case 'document':
      return null
    default:
      return payload satisfies never
  }
}

/** Kararı bekleyen talep: yoksa 422 `staff_change_request_not_pending`. */
export function assertStaffChangePending(status: StaffChangeStatus): void {
  if (status !== 'pending')
    throw ruleError('staff_change_request_not_pending', 'Bu talep artık onay beklemiyor.')
}

// --- Görünüm -------------------------------------------------------------------------------------

/** Talepte önerilen değerler; IBAN maskeli, belge dosyası yalnız var/yok. */
export type StaffChangeProposal =
  | { kind: 'contact'; address?: string | null; phone?: string | null }
  | { kind: 'emergency_contacts'; emergencyContacts: PersonnelEmergencyContact[] }
  | { kind: 'bank'; ibanMasked: string; accountHolder: string }
  | {
      kind: 'document'
      documentType: StaffDocumentType
      healthReportKind: HealthReportKind | null
      documentDate: string
      note: string | null
      hasFile: boolean
    }

/**
 * Yanıttaki öneri (K-554): IBAN her okumada maskelidir. Özel nitelikli belgenin notu yoktur
 * (yazılmaz); dosyanın kendisi yalnız denetimli uçtan açılır.
 */
export function staffChangeProposal(
  payload: StoredStaffChangePayload,
  extras: { iban: string | null; hasFile: boolean },
): StaffChangeProposal {
  switch (payload.kind) {
    case 'contact':
    case 'emergency_contacts':
      return payload
    case 'bank':
      return {
        kind: 'bank',
        ibanMasked: extras.iban === null ? '' : maskIban(extras.iban),
        accountHolder: payload.accountHolder,
      }
    case 'document':
      return { ...payload, hasFile: extras.hasFile }
    default:
      return payload satisfies never
  }
}
