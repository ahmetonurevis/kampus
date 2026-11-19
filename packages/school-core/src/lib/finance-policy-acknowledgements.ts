import { z } from 'zod'

import type { Role } from '../modules/navigation.ts'
import { daySchema } from './domain.ts'
import { DomainError } from './errors.ts'
import { isStaffRole, type StaffRole } from './staff-accounts.ts'

/**
 * Politika belgesi okundu onayı (docs/domain/finans.md DOM-FIN-127; ON-190). Kurum personel
 * yönetmeliği, KVKK taahhüdü, iş güvenliği talimatı gibi belgeleri PDF olarak yayımlar; personelin
 * "okudum, anladım" onayı belge sürümüne bağlanır. Yeni sürüm önceki sürümün yerine geçer ve önceki
 * sürümün onayları geçersiz sayılır: personel yeni sürümü yeniden onaylar (K-436). Personel kendi
 * onayını veremiyorsa yönetici ya da ön büro personel adına kanal ve tarihle kaydeder; ıslak imza
 * taraması isteğe bağlı dosyadır (K-437). Onay silinmez ve düzeltilmez. Hedef kitle tüm personel,
 * öğretmen ya da idari personeldir (yönetici ve ön büro); takip yalnız etkin personelde yapılır
 * (K-438). Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Liste, takip ve onay kaydı: yönetici ve ön büro (K-437). */
export const FINANCE_POLICY_ROLES = ['yonetici', 'onburo'] as const satisfies readonly Role[]
/** Belge ve yeni sürüm yayımlama: yalnız yönetici (K-437). */
export const FINANCE_POLICY_MANAGE_ROLES = ['yonetici'] as const satisfies readonly Role[]

export const POLICY_TYPES = [
  'staff_regulation',
  'kvkk_commitment',
  'occupational_safety',
  'discipline',
  'other',
] as const
export type PolicyType = (typeof POLICY_TYPES)[number]
export const POLICY_TYPE_LABELS = {
  staff_regulation: 'Personel yönetmeliği',
  kvkk_commitment: 'KVKK taahhüdü',
  occupational_safety: 'İş güvenliği',
  discipline: 'Disiplin',
  other: 'Diğer',
} as const satisfies Record<PolicyType, string>

export const POLICY_AUDIENCES = ['all_staff', 'teachers', 'administrative'] as const
export type PolicyAudience = (typeof POLICY_AUDIENCES)[number]
export const POLICY_AUDIENCE_LABELS = {
  all_staff: 'Tüm personel',
  teachers: 'Öğretmenler',
  administrative: 'İdari personel',
} as const satisfies Record<PolicyAudience, string>

/** Hedef kitlenin üyelik rolleri (K-438): idari personel yönetici ve ön büro üyeliğidir. */
export const POLICY_AUDIENCE_ROLES = {
  all_staff: ['yonetici', 'ogretmen', 'onburo'],
  teachers: ['ogretmen'],
  administrative: ['yonetici', 'onburo'],
} as const satisfies Record<PolicyAudience, readonly StaffRole[]>

export function audienceIncludesRole(audience: PolicyAudience, role: string): boolean {
  return (POLICY_AUDIENCE_ROLES[audience] as readonly string[]).includes(role)
}

/**
 * Onay kanalı. `self_service` personelin kendi ekranından verdiği onaydır (personel kabuğu); bu
 * görevdeki kayıt ucu yalnız personel adına girilen kanalları kabul eder (K-437).
 */
export const POLICY_ACK_CHANNELS = ['self_service', 'wet_signature', 'email', 'in_person'] as const
export type PolicyAckChannel = (typeof POLICY_ACK_CHANNELS)[number]
export const PROXY_POLICY_ACK_CHANNELS = ['wet_signature', 'email', 'in_person'] as const
export const POLICY_ACK_CHANNEL_LABELS = {
  self_service: 'Personelin kendi ekranı',
  wet_signature: 'Islak imzalı form',
  email: 'E-posta ile onay',
  in_person: 'Yüz yüze beyan',
} as const satisfies Record<PolicyAckChannel, string>

export const POLICY_TITLE_MAX = 160

// --- Şemalar -------------------------------------------------------------------------------------

export const policyDocumentInputSchema = z.strictObject({
  title: z
    .string('Belge adını yazın.')
    .trim()
    .min(2, 'Belge adı en az 2 karakter olmalı.')
    .max(POLICY_TITLE_MAX, `Belge adı en çok ${String(POLICY_TITLE_MAX)} karakter olabilir.`)
    .describe('Belge adı (örn. "Personel yönetmeliği 2026")'),
  policyType: z
    .enum(POLICY_TYPES, 'Belge türünü seçin.')
    .describe(
      '`staff_regulation` personel yönetmeliği, `kvkk_commitment` KVKK taahhüdü, `occupational_safety` iş güvenliği, `discipline` disiplin, `other` diğer',
    ),
  audience: z
    .enum(POLICY_AUDIENCES, 'Hedef kitleyi seçin.')
    .describe(
      '`all_staff` tüm personel, `teachers` öğretmenler, `administrative` yönetici ve ön büro',
    ),
  publishedOn: daySchema.describe('Yayın günü; bugünden sonra olamaz'),
  fileId: z
    .uuid('Belge dosyasını (PDF) yükleyin.')
    .describe('Yüklenmiş `document` amaçlı PDF (`POST /files`); zorunlu'),
  replacesDocumentId: z
    .uuid('Önceki sürüm geçersiz.')
    .nullable()
    .default(null)
    .describe(
      'Yeni sürüm yayımlanırken geçerli sürümün kimliği; verilirse önceki sürümün onayları geçersiz sayılır (K-436)',
    ),
})
export type PolicyDocumentInput = z.input<typeof policyDocumentInputSchema>
export type PolicyDocumentFields = z.output<typeof policyDocumentInputSchema>

export const policyAcknowledgementInputSchema = z.strictObject({
  policyDocumentId: z.uuid('Belge geçersiz.').describe('Onaylanan belge sürümü'),
  // kvkk: K (personel üyeliği)
  membershipId: z
    .string('Personel seçin.')
    .trim()
    .min(1, 'Personel seçin.')
    .max(100, 'Personel geçersiz.')
    .describe('Onaylayan personelin kurum üyeliği'),
  acknowledgedOn: daySchema.describe(
    'Personelin okuyup imzaladığı gün; yayın gününden önce ve bugünden sonra olamaz',
  ),
  channel: z
    .enum(PROXY_POLICY_ACK_CHANNELS, 'Onay kanalını seçin.')
    .describe('`wet_signature` ıslak imzalı form, `email` e-posta, `in_person` yüz yüze beyan'),
  scanFileId: z
    .uuid('Tarama dosyası geçersiz.')
    .nullable()
    .default(null)
    .describe('İsteğe bağlı ıslak imza taraması (`POST /files` amaç `document`, PDF)'),
})
export type PolicyAcknowledgementInput = z.input<typeof policyAcknowledgementInputSchema>
export type PolicyAcknowledgementFields = z.output<typeof policyAcknowledgementInputSchema>

// --- Kurallar ------------------------------------------------------------------------------------

const ruleError = (code: string, message: string, path: string) =>
  new DomainError(code, message, { kind: 'rule', path: [path] })

/** Yerine geçilecek geçerli sürüm. */
export interface CurrentPolicyVersion {
  id: string
  seriesId: string
  version: number
  publishedOn: string
  supersededAt: string | null
}

export interface PolicyVersionPlan {
  seriesId: string | null
  version: number
  supersedes: string | null
}

/**
 * Yayın planı (K-436): yeni belge sürüm 1'dir; `replacesDocumentId` verilirse yalnız geçerli
 * (yerine geçilmemiş) sürümün yerine geçilir, yayın günü öncekinden önce olamaz, sürüm bir artar.
 */
export function planPolicyVersion(
  input: Pick<PolicyDocumentFields, 'publishedOn' | 'replacesDocumentId'>,
  checks: { previous: CurrentPolicyVersion | null; today: string },
): PolicyVersionPlan {
  if (input.publishedOn > checks.today)
    throw ruleError(
      'policy_published_in_future',
      'Yayın günü bugünden sonra olamaz.',
      'publishedOn',
    )
  if (input.replacesDocumentId === null) return { seriesId: null, version: 1, supersedes: null }
  const previous = checks.previous
  if (previous === null)
    throw ruleError(
      'policy_previous_not_found',
      'Yerine geçilecek belge bulunamadı.',
      'replacesDocumentId',
    )
  if (previous.supersededAt !== null)
    throw ruleError(
      'policy_previous_superseded',
      'Bu sürümün yerine daha önce yeni sürüm yayımlanmış; geçerli sürümü seçin.',
      'replacesDocumentId',
    )
  if (input.publishedOn < previous.publishedOn)
    throw ruleError(
      'policy_published_before_previous',
      'Yeni sürümün yayın günü önceki sürümden önce olamaz.',
      'publishedOn',
    )
  return { seriesId: previous.seriesId, version: previous.version + 1, supersedes: previous.id }
}

export interface PolicyAckChecks {
  document: {
    audience: PolicyAudience
    publishedOn: string
    supersededAt: string | null
  } | null
  staff: { role: string; active: boolean } | null
  alreadyAcknowledged: boolean
  today: string
}

/**
 * Onay kaydı kuralı (K-436…K-438): belge geçerli sürüm olmalı, personel etkin ve hedef kitlede,
 * onay günü yayın gününden önce ve bugünden sonra olamaz; aynı sürüme ikinci onay alınmaz.
 */
export function assertPolicyAcknowledgement(
  input: Pick<PolicyAcknowledgementFields, 'acknowledgedOn'>,
  checks: PolicyAckChecks,
): void {
  const { document, staff } = checks
  if (document === null)
    throw ruleError('policy_not_found', 'Politika belgesi bulunamadı.', 'policyDocumentId')
  if (document.supersededAt !== null)
    throw ruleError(
      'policy_version_superseded',
      'Bu sürümün yerine yeni sürüm yayımlandı; onay yalnız geçerli sürüme alınır.',
      'policyDocumentId',
    )
  if (staff === null)
    throw ruleError('policy_staff_not_found', 'Personel bulunamadı.', 'membershipId')
  if (!isStaffRole(staff.role))
    throw ruleError(
      'policy_not_staff',
      'Politika onayı yalnız personelden (yönetici, öğretmen, ön büro) alınır.',
      'membershipId',
    )
  if (!staff.active)
    throw ruleError(
      'policy_staff_inactive',
      'Pasifleştirilmiş (ayrılan) personelden onay alınmaz.',
      'membershipId',
    )
  if (!audienceIncludesRole(document.audience, staff.role))
    throw ruleError(
      'policy_not_in_audience',
      `Personel bu belgenin hedef kitlesinde değil (${POLICY_AUDIENCE_LABELS[document.audience]}).`,
      'membershipId',
    )
  if (input.acknowledgedOn > checks.today)
    throw ruleError('policy_ack_in_future', 'Onay günü bugünden sonra olamaz.', 'acknowledgedOn')
  if (input.acknowledgedOn < document.publishedOn)
    throw ruleError(
      'policy_ack_before_publish',
      'Onay günü belgenin yayın gününden önce olamaz.',
      'acknowledgedOn',
    )
  if (checks.alreadyAcknowledged)
    throw new DomainError(
      'policy_already_acknowledged',
      'Bu personelin bu sürüme onayı zaten kayıtlı.',
      { kind: 'conflict', path: ['membershipId'] },
    )
}

/** Onay oranı (yüzde, tam sayıya yuvarlanır); hedef kitlede etkin personel yoksa `null`. */
export function acknowledgementRate(acknowledged: number, target: number): number | null {
  if (target <= 0) return null
  return Math.round((acknowledged / target) * 100)
}
