import { z } from 'zod'

import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { FIXED_ASSET_LOCATION_MAX, type FixedAssetStatus } from './finance-fixed-assets.ts'
import { isStaffRole } from './staff-accounts.ts'

/**
 * Demirbaş zimmeti (docs/domain/finans.md DOM-FIN-086; ON-236). Demirbaş bir personele (kurumun
 * yönetici, öğretmen ya da ön büro üyeliği) ya da bir konuma (isteğe bağlı kampüs ve oda/yer
 * metni) zimmetlenir. Bir demirbaşın aynı anda tek açık zimmeti olur; devir iade ve yeni zimmettir
 * (K-211). İade gün, durum (sağlam/hasarlı) ve not ister; zimmet kaydı silinmez ve düzeltilmez
 * (K-212). Hurdaya ayrılmış demirbaşa zimmet verilmez; açık zimmetli demirbaş hurdaya ayrılmaz
 * (K-213, `planFixedAssetScrap`). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

export const FIXED_ASSET_ASSIGNEE_TYPES = ['staff', 'location'] as const
export type FixedAssetAssigneeType = (typeof FIXED_ASSET_ASSIGNEE_TYPES)[number]
export const FIXED_ASSET_ASSIGNEE_TYPE_LABELS = {
  staff: 'Personel',
  location: 'Konum',
} as const satisfies Record<FixedAssetAssigneeType, string>

export const FIXED_ASSET_RETURN_CONDITIONS = ['intact', 'damaged'] as const
export type FixedAssetReturnCondition = (typeof FIXED_ASSET_RETURN_CONDITIONS)[number]
export const FIXED_ASSET_RETURN_CONDITION_LABELS = {
  intact: 'Sağlam',
  damaged: 'Hasarlı',
} as const satisfies Record<FixedAssetReturnCondition, string>

/** Açık zimmet süzgeci: `open` iade edilmemiş, `returned` iade edilmiş. */
export const FIXED_ASSET_ASSIGNMENT_STATES = ['open', 'returned'] as const
export type FixedAssetAssignmentState = (typeof FIXED_ASSET_ASSIGNMENT_STATES)[number]

export const FIXED_ASSET_ASSIGNMENT_NOTE_MAX = 500
export const FIXED_ASSET_DAMAGE_NOTE_MIN = 5

// --- Şemalar -------------------------------------------------------------------------------------

const noteSchema = z
  .string()
  .trim()
  .max(
    FIXED_ASSET_ASSIGNMENT_NOTE_MAX,
    `En fazla ${String(FIXED_ASSET_ASSIGNMENT_NOTE_MAX)} karakter girebilirsiniz.`,
  )
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .default(null)
const membershipSchema = z
  .string('Personel seçin.')
  .trim()
  .min(1, 'Personel seçin.')
  .max(100, 'Personel geçersiz.')
const campusSchema = z.string().trim().min(1, 'Kampüs seçin.').max(100).nullable().default(null)
const locationSchema = z
  .string('Konumu yazın.')
  .trim()
  .min(2, 'Konumu en az 2 karakterle yazın (ör. 2. kat fen laboratuvarı).')
  .max(
    FIXED_ASSET_LOCATION_MAX,
    `En fazla ${String(FIXED_ASSET_LOCATION_MAX)} karakter girebilirsiniz.`,
  )
const assignedDateSchema = daySchema.describe('Zimmet (teslim) günü; bugünden sonra olamaz')

/** Personele zimmet (K-210): kurumun etkin yönetici, öğretmen ya da ön büro üyeliği. */
export const staffAssignmentSchema = z.strictObject({
  assigneeType: z.literal('staff'),
  membershipId: membershipSchema.describe('Teslim alan personelin kurum üyeliği'),
  assignedDate: assignedDateSchema,
  note: noteSchema.describe('İsteğe bağlı not, en çok 500 karakter'),
})
/** Konuma zimmet (K-210): isteğe bağlı kampüs ve oda ya da yer. */
export const locationAssignmentSchema = z.strictObject({
  assigneeType: z.literal('location'),
  campusId: campusSchema.describe('Kampüs (branches kaydı); tek kampüslü kurumda boş'),
  location: locationSchema.describe('Oda ya da yer, serbest metin'),
  assignedDate: assignedDateSchema,
  note: noteSchema.describe('İsteğe bağlı not, en çok 500 karakter'),
})
/** Zimmet ver (DOM-FIN-086): personele ya da konuma. */
export const fixedAssetAssignmentSchema = z.discriminatedUnion(
  'assigneeType',
  [staffAssignmentSchema, locationAssignmentSchema],
  'Zimmetin personele mi konuma mı verileceğini seçin.',
)
export type FixedAssetAssignmentInput = z.input<typeof fixedAssetAssignmentSchema>
export type FixedAssetAssignmentFields = z.output<typeof fixedAssetAssignmentSchema>

/** Zimmet iadesi (K-212): gün, durum ve not; hasarlı iadede not zorunludur. */
export const fixedAssetReturnSchema = z
  .strictObject({
    returnDate: daySchema.describe('İade günü; zimmet gününden önce, bugünden sonra olamaz'),
    condition: z
      .enum(FIXED_ASSET_RETURN_CONDITIONS, 'İade durumunu seçin.')
      .describe('`intact` sağlam, `damaged` hasarlı'),
    note: noteSchema.describe('Durum notu; hasarlı iadede en az 5 karakter'),
  })
  .superRefine((value, context) => {
    if (value.condition === 'damaged' && (value.note ?? '').length < FIXED_ASSET_DAMAGE_NOTE_MIN)
      context.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'Hasarı en az 5 karakterle açıklayın.',
      })
  })
export type FixedAssetReturnInput = z.input<typeof fixedAssetReturnSchema>
export type FixedAssetReturnFields = z.output<typeof fixedAssetReturnSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Zimmetlenen demirbaşın durumu ve geçmişi (servis kurum kilidi altında yükler). */
export interface FixedAssetAssignmentChecks {
  today: string
  asset: { status: FixedAssetStatus; acquisitionDate: string }
  /** Demirbaşın iade edilmemiş zimmeti var mı. */
  hasOpenAssignment: boolean
  /** Son iade günü (geçmiş zimmet yoksa `null`); yeni zimmet bundan önceye yazılmaz. */
  lastReturnDate: string | null
  /** Personel zimmetinde üyelik: kurumda yoksa `null`; `active` pasifleştirilmemiş demektir. */
  staff?: { role: string; active: boolean } | null
  /** Konum zimmetinde seçilen kampüs kurumda etkin mi (kampüs boşsa denetlenmez). */
  campusFound?: boolean
}

/** Yazılacak zimmet: alanın türüne göre üyelik ya da kampüs ve konum dolu, ötekiler boş. */
export interface FixedAssetAssignmentPlan {
  assigneeType: FixedAssetAssigneeType
  membershipId: string | null
  campusId: string | null
  location: string | null
  assignedDate: string
  note: string | null
}

/**
 * Zimmet verme kuralları (DOM-FIN-086). Hurdaya ayrılmış demirbaşa zimmet verilmez (K-213); açık
 * zimmet varken ikincisi açılmaz, devir önce iadedir (409; K-211). Zimmet günü alım gününden ve
 * son iade gününden önce, bugünden sonra olamaz. Personel kurumun etkin personel üyeliğidir.
 */
export function planFixedAssetAssignment(
  input: FixedAssetAssignmentFields,
  checks: FixedAssetAssignmentChecks,
): FixedAssetAssignmentPlan {
  if (checks.asset.status === 'scrapped')
    throw ruleError(
      'fixed_asset_scrapped',
      'Hurdaya ayrılmış demirbaşa zimmet verilemez.',
      'assigneeType',
    )
  if (checks.hasOpenAssignment)
    throw new DomainError(
      'fixed_asset_already_assigned',
      'Bu demirbaşın açık bir zimmeti var. Devretmek için önce iade alın.',
      { kind: 'conflict', path: ['assigneeType'] },
    )
  if (input.assignedDate > checks.today)
    throw ruleError(
      'fixed_asset_date_in_future',
      'Zimmet günü bugünden sonra olamaz.',
      'assignedDate',
    )
  if (input.assignedDate < checks.asset.acquisitionDate)
    throw ruleError(
      'fixed_asset_assignment_before_acquisition',
      'Zimmet günü demirbaşın alım gününden önce olamaz.',
      'assignedDate',
    )
  if (checks.lastReturnDate !== null && input.assignedDate < checks.lastReturnDate)
    throw ruleError(
      'fixed_asset_assignment_before_return',
      'Zimmet günü önceki zimmetin iade gününden önce olamaz.',
      'assignedDate',
    )
  if (input.assigneeType === 'staff') {
    if (checks.staff === undefined || checks.staff === null)
      throw ruleError('fixed_asset_assignee_not_found', 'Personel bulunamadı.', 'membershipId')
    if (!isStaffRole(checks.staff.role))
      throw ruleError(
        'fixed_asset_assignee_not_staff',
        'Demirbaş yalnız personele (yönetici, öğretmen, ön büro) zimmetlenir.',
        'membershipId',
      )
    if (!checks.staff.active)
      throw ruleError(
        'fixed_asset_assignee_inactive',
        'Pasif personele zimmet verilemez.',
        'membershipId',
      )
    return {
      assigneeType: 'staff',
      membershipId: input.membershipId,
      campusId: null,
      location: null,
      assignedDate: input.assignedDate,
      note: input.note,
    }
  }
  if (input.campusId !== null && checks.campusFound === false)
    throw ruleError('fixed_asset_campus_not_found', 'Kampüs bulunamadı.', 'campusId')
  return {
    assigneeType: 'location',
    membershipId: null,
    campusId: input.campusId,
    location: input.location,
    assignedDate: input.assignedDate,
    note: input.note,
  }
}

/** İade (K-212): bir kez yapılır; gün zimmet gününden önce ve bugünden sonra olamaz. */
export function planFixedAssetReturn(
  assignment: { assignedDate: string; returnDate: string | null },
  input: { returnDate: string },
  today: string,
): void {
  if (assignment.returnDate !== null)
    throw ruleError('fixed_asset_assignment_returned', 'Bu zimmet zaten iade alındı.', 'returnDate')
  if (input.returnDate > today)
    throw ruleError('fixed_asset_date_in_future', 'İade günü bugünden sonra olamaz.', 'returnDate')
  if (input.returnDate < assignment.assignedDate)
    throw ruleError(
      'fixed_asset_return_before_assignment',
      'İade günü zimmet gününden önce olamaz.',
      'returnDate',
    )
}

/** Zimmetin teslim alanını tek satırda yazar: personel adı ya da "kampüs · konum". */
export function fixedAssetHolderLabel(holder: {
  assigneeType: FixedAssetAssigneeType
  staffName: string | null
  campusName: string | null
  location: string | null
}): string {
  if (holder.assigneeType === 'staff') return holder.staffName ?? 'Personel'
  const place = holder.location ?? ''
  return holder.campusName ? `${holder.campusName} · ${place}` : place
}
