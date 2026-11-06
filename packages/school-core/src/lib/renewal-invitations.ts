import { z } from 'zod'

import type { State } from '../data/seed.ts'
import type { MakeId } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * Yenileme daveti (K-10; docs/domain/kayit-ve-crm.md DOM-KAY-027; IST-100). Yönetici ya da ön büro
 * hedef eğitim yılı için seçili öğrencilere davet açar; ödeyici veli çevrim içi niyetini bildirir.
 * Yanıt niyet beyanıdır: sözleşme, taksit ve sınıf yazmaz; plan (`planRenewal`) ve sözleşme onayı
 * (`approveContract`) ayrı işlemlerdir ve yanıta bakmaz. Durum saklanmaz: yenileme kaydı ve velinin
 * yanıtından türetilir (DOM-KAY-026 ile aynı gerekçe: plan hangi yoldan açılırsa açılsın davet
 * `planned` görünür, ikinci doğruluk kaynağı olmaz). Fonksiyonlar saftır; yükleme ve yazma
 * `apps/api/src/services/finance-renewal-invitations.ts`'tedir.
 */

z.config(z.locales.tr())

export const RENEWAL_INVITATION_RESPONSES = ['will_renew', 'will_not_renew'] as const
export type RenewalInvitationResponse = (typeof RENEWAL_INVITATION_RESPONSES)[number]

export const RENEWAL_INVITATION_STATUSES = [
  'pending',
  'will_renew',
  'will_not_renew',
  'planned',
] as const
export type RenewalInvitationStatus = (typeof RENEWAL_INVITATION_STATUSES)[number]

export const RENEWAL_INVITATION_STATUS_LABELS = {
  pending: 'Bekliyor',
  will_renew: 'Yenileyecek',
  will_not_renew: 'Yenilemeyecek',
  planned: 'Planlandı',
} as const satisfies Record<RenewalInvitationStatus, string>

/** Tek istekte açılacak davet üst sınırı: işlem kurum kilidi altında bildirim de yazar. */
export const RENEWAL_INVITATION_MAX_STUDENTS = 200
export const RENEWAL_INVITATION_NOTE_MAX = 280

/** Mezuniyet düzeyi (DOM-KAY-022): son sınıfın yenileyeceği bir üst düzey yoktur. */
export const RENEWAL_INVITATION_FINAL_GRADE = 12

const yearSchema = z.number('Eğitim yılını seçin.').int().min(2000).max(2100)

export const openRenewalInvitationsSchema = z.strictObject({
  academicYear: yearSchema,
  studentIds: z
    .array(z.string().trim().min(1).max(200))
    .min(1, 'En az bir öğrenci seçin.')
    .max(
      RENEWAL_INVITATION_MAX_STUDENTS,
      `Tek seferde en çok ${String(RENEWAL_INVITATION_MAX_STUDENTS)} öğrenciye davet açılır.`,
    ),
})
export type OpenRenewalInvitationsInput = z.input<typeof openRenewalInvitationsSchema>

export const respondRenewalInvitationSchema = z.strictObject({
  response: z.enum(RENEWAL_INVITATION_RESPONSES, 'Yanıtınızı seçin.'),
  // kvkk: K — velinin serbest metin notu; loglanmaz, denetime yalnız alan adı düşer.
  note: z
    .string()
    .trim()
    .max(
      RENEWAL_INVITATION_NOTE_MAX,
      `Not en çok ${String(RENEWAL_INVITATION_NOTE_MAX)} karakter olabilir.`,
    )
    .optional(),
})
export type RespondRenewalInvitationInput = z.input<typeof respondRenewalInvitationSchema>

type RenewalLike = { studentId: string; year: number; status: string }

/** Öğrencinin o yıl için geçerli yenilemesi var mı; ayrılışla iptal edilen plan sayılmaz. */
export const isRenewalPlanned = (
  renewals: readonly RenewalLike[],
  studentId: string,
  academicYear: number,
): boolean =>
  renewals.some(
    (renewal) =>
      renewal.studentId === studentId &&
      renewal.year === academicYear &&
      renewal.status !== 'İptal',
  )

/** Davetin durumu: plan yanıttan önce gelir; "yenilemeyecek" plan engellemez (DOM-KAY-027). */
export function renewalInvitationStatus(
  invitation: { response: RenewalInvitationResponse | null },
  planned: boolean,
): RenewalInvitationStatus {
  if (planned) return 'planned'
  return invitation.response ?? 'pending'
}

type ActorLinkLike = { kind: string; recordId: string }

/** Velinin kapsamındaki öğrenciler: velayetli (`child`) ya da ödeyici (`payer`, K-04) bağı. */
export const renewalInvitationStudentIds = (links: readonly ActorLinkLike[]): string[] => [
  ...new Set(
    links
      .filter((link) => link.kind === 'child' || link.kind === 'payer')
      .map((link) => link.recordId),
  ),
]

export type RenewalInvitationAccess = 'respond' | 'read' | 'none'

/**
 * Yanıt ödeyici velinindir: borcun tarafı odur (DOM-FIN-052). Velayetli olup ödeyici olmayan veli
 * daveti görür, yanıt veremez; bağsız ya da iletişim kısıtlı veliye davet yoktur (kapalı başarısız).
 */
export function renewalInvitationAccess(
  links: readonly ActorLinkLike[],
  studentId: string,
): RenewalInvitationAccess {
  const own = links.filter((link) => link.recordId === studentId)
  if (own.some((link) => link.kind === 'payer')) return 'respond'
  return own.some((link) => link.kind === 'child') ? 'read' : 'none'
}

export interface OpenRenewalInvitationsContext {
  /** Seçili öğrencilerden hedef yılda açık daveti olanlar. */
  invitedStudentIds: ReadonlySet<string>
  makeId: MakeId
}

export interface PlannedRenewalInvitations {
  academicYear: number
  invitations: { id: string; studentId: string }[]
}

/**
 * Davet planı (DOM-KAY-027). Toplu açma tek işlemdir: bir öğrenci reddedilirse hiçbiri açılmaz.
 * Öğrenci ve yıl başına tek davet; planı yapılmış öğrenciye davet açılmaz (409).
 */
export function planRenewalInvitations(
  state: Pick<State, 'academicYear' | 'students' | 'classes' | 'renewals'>,
  input: unknown,
  context: OpenRenewalInvitationsContext,
): PlannedRenewalInvitations {
  const data = openRenewalInvitationsSchema.parse(input)
  if (data.academicYear <= state.academicYear)
    throw new DomainError(
      'renewal_year_invalid',
      'Yenileme için mevcut dönemden sonraki bir yıl seçin.',
      { path: ['academicYear'] },
    )
  const studentIds = [...new Set(data.studentIds)]
  for (const studentId of studentIds) {
    const student = state.students.find((item) => item.id === studentId)
    if (!student)
      throw new DomainError('student_not_found', 'Öğrenci bulunamadı.', { kind: 'not_found' })
    if (student.isActive === false)
      throw new DomainError(
        'renewal_invitation_student_inactive',
        'Kaydı aktif olmayan öğrenciye yenileme daveti açılamaz.',
        { kind: 'conflict' },
      )
    const grade = state.classes.find((item) => item.id === student.classId)?.grade
    if (grade === RENEWAL_INVITATION_FINAL_GRADE)
      throw new DomainError(
        'renewal_invitation_final_grade',
        'Son sınıf öğrencisine yenileme daveti açılamaz; mezuniyet ayrı işlemdir.',
      )
    if (isRenewalPlanned(state.renewals, studentId, data.academicYear))
      throw new DomainError(
        'renewal_invitation_already_planned',
        'Seçili öğrencilerden birinin bu yıl için yenilemesi zaten planlanmış.',
        { kind: 'conflict' },
      )
    if (context.invitedStudentIds.has(studentId))
      throw new DomainError(
        'renewal_invitation_exists',
        'Seçili öğrencilerden birine bu yıl için zaten davet açılmış.',
        { kind: 'conflict' },
      )
  }
  return {
    academicYear: data.academicYear,
    invitations: studentIds.map((studentId) => ({
      id: context.makeId('renewal-invitation'),
      studentId,
    })),
  }
}

/**
 * Davet açılabilecek öğrenciler (DOM-KAY-027): `planRenewalInvitations` ile aynı süzgeç; form yalnız
 * bunları sunar, toplu açma tek öğrenci yüzünden reddedilmesin. Karar yine sunucudadır.
 */
export function invitableStudentIds(
  state: {
    students: readonly { id: string; classId: string; isActive?: boolean | undefined }[]
    classes: readonly { id: string; grade?: number | undefined }[]
    renewals: readonly RenewalLike[]
  },
  academicYear: number,
  invited: ReadonlySet<string>,
): string[] {
  const grades = new Map(state.classes.map((item) => [item.id, item.grade]))
  return state.students
    .filter(
      (student) =>
        student.isActive !== false &&
        grades.get(student.classId) !== RENEWAL_INVITATION_FINAL_GRADE &&
        !invited.has(student.id) &&
        !isRenewalPlanned(state.renewals, student.id, academicYear),
    )
    .map((student) => student.id)
}

export interface PlannedRenewalInvitationResponse {
  response: RenewalInvitationResponse
  /** Boş not saklanmaz; önceki not yeni yanıtla birlikte kalkar. */
  note: string | null
}

/**
 * Velinin yanıtı (DOM-KAY-027): yalnız ödeyici veli, öğrenci aktifken ve plan yapılana kadar
 * değiştirebilir. Kapsam dışı veliye davetin varlığı sızmaz (404).
 */
export function planRenewalInvitationResponse(
  state: Pick<State, 'students' | 'renewals'>,
  invitation: { studentId: string; academicYear: number },
  input: unknown,
  access: RenewalInvitationAccess,
): PlannedRenewalInvitationResponse {
  const data = respondRenewalInvitationSchema.parse(input)
  if (access === 'none')
    throw new DomainError('renewal_invitation_not_found', 'Davet bulunamadı.', {
      kind: 'not_found',
    })
  if (access === 'read')
    throw new DomainError(
      'renewal_invitation_payer_only',
      'Daveti yalnız ödeyici veli yanıtlayabilir.',
      { kind: 'forbidden' },
    )
  const student = state.students.find((item) => item.id === invitation.studentId)
  if (!student || student.isActive === false)
    throw new DomainError('renewal_invitation_student_inactive', 'Öğrencinin kaydı aktif değil.', {
      kind: 'conflict',
    })
  if (isRenewalPlanned(state.renewals, invitation.studentId, invitation.academicYear))
    throw new DomainError(
      'renewal_invitation_planned',
      'Yenileme planlandığı için yanıt değiştirilemez.',
      { kind: 'conflict' },
    )
  return { response: data.response, note: data.note ? data.note : null }
}
