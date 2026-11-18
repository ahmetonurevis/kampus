import type {
  DocumentGapRow,
  DocumentTypeRow,
  ProspectDocumentRow,
  ProspectDocuments,
} from '@kampus/react-shared/use-prospect-documents.ts'
import {
  DOCUMENT_CONSENT_GRANTOR_LABELS,
  PROSPECT_DOCUMENT_KIND_LABELS,
  PROSPECT_DOCUMENT_STAGE_LABELS,
  PROSPECT_DOCUMENT_STATUS_LABELS,
  type ProspectDocumentStatus,
} from '@kampus/school-core/lib/prospect-documents.ts'
import { PROSPECT_NOTE_MAX_LENGTH } from '@kampus/school-core/lib/prospects.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Aday belgeleri ekranlarının saf kuralları (DOM-KAY-043; ON-263): durum tonu ve metni, belge
// satırı, eksik belge rozeti ve "Hatırlat" notunun metni (K-323).

export const STATUS_TONES = {
  uploaded: 'amber',
  accepted: 'green',
  rejected: 'red',
  superseded: 'gray',
} as const satisfies Record<ProspectDocumentStatus, BadgeTone>

export const SPECIAL_HIDDEN_NAME = 'Özel nitelikli belge'

/** Bayt değerinin kısa gösterimi (ör. 1,4 MB). */
export function byteSizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb).toLocaleString('tr-TR')} KB`
  return `${(kb / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`
}

export type DocumentRowView = {
  id: string
  typeLabel: string
  statusLabel: string
  tone: BadgeTone
  current: boolean
  name: string
  detail: string
  rejectionReason: string | null
  purgeAt: string | null
  canOpen: boolean
  /** İnceleme düğmeleri görünür mü (özel nitelikli belgede yalnız yönetici; sunucu da denetler). */
  reviewable: boolean
  version: number
}

/** Belge satırının gösterimi; tür adı arşivlenmiş türde de listeden okunur. */
export function documentRowView(
  document: ProspectDocumentRow,
  types: readonly Pick<DocumentTypeRow, 'id' | 'label'>[],
  accepting: boolean,
): DocumentRowView {
  const typeLabel = types.find((type) => type.id === document.documentTypeId)?.label ?? 'Belge'
  const fileGone = !document.file.available
  const name = document.file.name ?? (document.specialCategory ? SPECIAL_HIDDEN_NAME : typeLabel)
  return {
    id: document.id,
    typeLabel,
    statusLabel: fileGone ? 'Dosya imha edildi' : PROSPECT_DOCUMENT_STATUS_LABELS[document.status],
    tone: fileGone ? 'gray' : STATUS_TONES[document.status],
    current: document.status !== 'superseded',
    name,
    detail: fileGone ? 'Yeniden yükleyin' : byteSizeLabel(document.file.byteSize),
    rejectionReason: document.rejectionReason,
    purgeAt: document.file.purgeAt,
    canOpen: document.canOpen,
    reviewable: accepting && document.status === 'uploaded' && document.canOpen && !fileGone,
    version: document.version,
  }
}

/** Belge eklenecek türler: arşivlenmemiş türler, sırayla. */
export function uploadableTypes(types: readonly DocumentTypeRow[]): DocumentTypeRow[] {
  return types.filter((type) => !type.archived)
}

/** Seçeneğin metni: ad, aşama, zorunluluk ve özel nitelikli işareti. */
export function typeOptionLabel(type: DocumentTypeRow): string {
  const parts: string[] = [PROSPECT_DOCUMENT_STAGE_LABELS[type.stage]]
  if (type.required) parts.push('zorunlu')
  if (type.specialCategory) parts.push('özel nitelikli')
  return `${type.label} (${parts.join(', ')})`
}

/** Türün çeşit ve aşama özeti (ayar tablosu). */
export function typeSummary(type: DocumentTypeRow): string {
  return `${PROSPECT_DOCUMENT_KIND_LABELS[type.kind]} · ${PROSPECT_DOCUMENT_STAGE_LABELS[type.stage]}`
}

/** Eksik belge rozetinin metni; eksik yoksa `null`. */
export function gapBadgeLabel(missing: number): string | null {
  if (missing <= 0) return null
  return `${missing} eksik belge`
}

/** Liste satırlarının rozet sayısı: aday kimliği → eksik tür sayısı. */
export function gapCounts(rows: readonly Pick<DocumentGapRow, 'prospectId' | 'missing'>[]) {
  return new Map(rows.map((row) => [row.prospectId, row.missing.length]))
}

/** Eksik türlerin kısa listesi: "Kimlik (Kesin kayıt), Karne (Kesin kayıt)". */
export function missingLabel(missing: DocumentGapRow['missing']): string {
  return missing
    .map((item) => `${item.label} (${PROSPECT_DOCUMENT_STAGE_LABELS[item.stage]})`)
    .join(', ')
}

/**
 * "Hatırlat" notunun metni (K-323): platform ileti göndermez; ön büro aileye kendi kanalından
 * ulaştığını aday kartına not olarak düşer. Not sınırını aşmaz.
 */
export function reminderNote(missing: DocumentGapRow['missing']): string {
  const text = `Eksik belgeler için hatırlatma yapıldı: ${missing.map((item) => item.label).join(', ')}.`
  return text.length <= PROSPECT_NOTE_MAX_LENGTH
    ? text
    : `${text.slice(0, PROSPECT_NOTE_MAX_LENGTH - 1)}…`
}

/** Rıza satırının metni: veren ve yol. */
export function consentLabel(consent: ProspectDocuments['consent']): string {
  const who = DOCUMENT_CONSENT_GRANTOR_LABELS[consent.grantor]
  return consent.active
    ? `${who} açık rızası kayıtlı (ıslak imzalı form).`
    : `${who} açık rızası kayıtlı değil. Sağlık raporu gibi özel nitelikli belge yüklenmez.`
}

/** Özel nitelikli türü olan kurumda rıza paneli gösterilir. */
export const hasSpecialTypes = (types: readonly DocumentTypeRow[]) =>
  types.some((type) => type.specialCategory && !type.archived)
