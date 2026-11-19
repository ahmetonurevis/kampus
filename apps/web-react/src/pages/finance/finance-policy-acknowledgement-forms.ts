import { z } from 'zod'

import type {
  CreatePolicyAcknowledgementBody,
  CreatePolicyDocumentBody,
  PolicyDocumentRow,
} from '@kampus/react-shared/use-finance-policy-acknowledgements.ts'
import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  POLICY_ACK_CHANNEL_LABELS,
  POLICY_AUDIENCE_LABELS,
  POLICY_AUDIENCES,
  POLICY_TITLE_MAX,
  POLICY_TYPE_LABELS,
  POLICY_TYPES,
  PROXY_POLICY_ACK_CHANNELS,
  type PolicyAckChannel,
} from '@kampus/school-core/lib/finance-policy-acknowledgements.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'

/**
 * Politika onayları sekmesinin saf mantığı (DOM-FIN-127; ON-190): yayın ve onay formlarının
 * şeması, gövdesi ve tablo metinleri. Bileşen yalnız bunları çağırır.
 */

export const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

export const policyDocumentFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, 'Belge adı en az 2 karakter olmalı.')
    .max(POLICY_TITLE_MAX, `Belge adı en çok ${String(POLICY_TITLE_MAX)} karakter olabilir.`),
  policyType: z.enum(POLICY_TYPES, 'Belge türünü seçin.'),
  audience: z.enum(POLICY_AUDIENCES, 'Hedef kitleyi seçin.'),
  publishedOn: daySchema,
})
export type PolicyDocumentFormValues = z.infer<typeof policyDocumentFormSchema>

/** Yeni sürümde ad, tür ve kitle önceki sürümden gelir; yayın günü bugündür. */
export function policyDocumentDefaults(
  today: string,
  previous: Pick<PolicyDocumentRow, 'title' | 'policyType' | 'audience'> | null,
): PolicyDocumentFormValues {
  return {
    title: previous?.title ?? '',
    policyType: previous?.policyType ?? 'staff_regulation',
    audience: previous?.audience ?? 'all_staff',
    publishedOn: today,
  }
}

export function policyDocumentBody(
  values: PolicyDocumentFormValues,
  fileId: string,
  replacesDocumentId: string | null,
): CreatePolicyDocumentBody {
  return { ...values, title: values.title.trim(), fileId, replacesDocumentId }
}

export const policyAckFormSchema = z.object({
  acknowledgedOn: daySchema,
  channel: z.enum(PROXY_POLICY_ACK_CHANNELS, 'Onay kanalını seçin.'),
})
export type PolicyAckFormValues = z.infer<typeof policyAckFormSchema>

export const policyAckDefaults = (today: string): PolicyAckFormValues => ({
  acknowledgedOn: today,
  channel: 'wet_signature',
})

export function policyAckBody(
  documentId: string,
  membershipId: string,
  values: PolicyAckFormValues,
  scanFileId: string | null,
): CreatePolicyAcknowledgementBody {
  return { policyDocumentId: documentId, membershipId, ...values, scanFileId }
}

/** Sunucu alanını forma eşler; eşleşmeyen alan kök hatadır. */
export function policyDocumentFormField(name: string): keyof PolicyDocumentFormValues | null {
  return name === 'title' || name === 'policyType' || name === 'audience' || name === 'publishedOn'
    ? name
    : null
}
export function policyAckFormField(name: string): keyof PolicyAckFormValues | null {
  return name === 'acknowledgedOn' || name === 'channel' ? name : null
}

export const policyTypeText = (value: keyof typeof POLICY_TYPE_LABELS) => POLICY_TYPE_LABELS[value]
export const audienceText = (value: keyof typeof POLICY_AUDIENCE_LABELS) =>
  POLICY_AUDIENCE_LABELS[value]
export const channelText = (value: PolicyAckChannel) => POLICY_ACK_CHANNEL_LABELS[value]

/** "2 / 3 (%67)"; hedef kitlede personel yoksa "Hedef personel yok". */
export function rateText(row: {
  acknowledgedCount: number
  targetCount: number
  rate: number | null
}): string {
  if (row.rate === null) return 'Hedef personel yok'
  return `${String(row.acknowledgedCount)} / ${String(row.targetCount)} (%${String(row.rate)})`
}

export const versionText = (version: number) => `Sürüm ${String(version)}`

/** Personelin eksik onaylarının kısa metni; eksik yoksa `null`. */
export function missingDocumentsText(
  documents: readonly { title: string; version: number }[],
): string | null {
  if (documents.length === 0) return null
  return documents.map((doc) => `${doc.title} (${versionText(doc.version)})`).join(', ')
}
