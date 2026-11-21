import type {
  EnrollmentDocument,
  EnrollmentDocumentRow,
  EnrollmentDocuments,
} from '@kampus/react-shared/use-enrollment-documents.ts'
import { ENROLLMENT_DOCUMENT_ROLES } from '@kampus/school-core/lib/enrollment-documents.ts'
import { DOCUMENT_CONSENT_GRANTOR_LABELS } from '@kampus/school-core/lib/prospect-documents.ts'
import {
  byteSizeLabel,
  gapBadgeLabel,
  missingLabel,
  SPECIAL_HIDDEN_NAME,
} from './prospect-documents.ts'

// Kayıt belgeleri bölümünün saf kuralları (DOM-KAY-045; ON-344): liste satırı, belge satırı ve rıza
// metni. Belge kesin kayıtta aday belgesinden öğrenciye bağlanır; kopyası yoktur (K-384).

/** "Eksik belgesi olanlar" süzgecinin değeri (`missingOnly=true`). */
export const MISSING_FILTER = 'missing'

export const canReadEnrollmentDocuments = (role: string | undefined) =>
  ENROLLMENT_DOCUMENT_ROLES.some((allowed) => allowed === role)

export type EnrollmentListRowView = {
  id: string
  prospectId: string
  name: string
  documents: string
  missingCount: string
  missing: string
  awaiting: string
}

export function enrollmentListRow(row: EnrollmentDocumentRow): EnrollmentListRowView {
  return {
    id: row.studentId,
    prospectId: row.prospectId,
    name: row.name,
    documents: row.documentCount === 0 ? 'Belge yok' : `${row.documentCount} belge`,
    missingCount: gapBadgeLabel(row.missing.length) ?? 'Tam',
    missing: row.missing.length === 0 ? '—' : missingLabel(row.missing),
    awaiting: row.awaitingReview > 0 ? `${row.awaitingReview} inceleme bekliyor` : '—',
  }
}

export type EnrollmentDocumentView = {
  id: string
  prospectId: string
  typeLabel: string
  name: string
  detail: string
  canOpen: boolean
  /** Açılamayan belgenin nedeni (özel nitelikli belge yalnız yöneticide); açılabiliyorsa `null`. */
  locked: string | null
}

/** Bağlı belge satırı; özel nitelikli belgeyi açamayan dosya adı yerine genel ad görür. */
export function enrollmentDocumentView(document: EnrollmentDocument): EnrollmentDocumentView {
  const name =
    document.file.name ?? (document.specialCategory ? SPECIAL_HIDDEN_NAME : document.typeLabel)
  return {
    id: document.id,
    prospectId: document.prospectId,
    typeLabel: document.typeLabel,
    name,
    detail: document.file.available ? byteSizeLabel(document.file.byteSize) : 'Dosya imha edildi',
    canOpen: document.canOpen,
    locked:
      document.canOpen || !document.file.available
        ? null
        : document.specialCategory
          ? 'Yalnız yönetici açar'
          : null,
  }
}

/** Öğrenciye bağlı rızanın metni; yoksa `null` (bölüm gösterilmez). */
export function enrollmentConsentLabel(consent: EnrollmentDocuments['consent']): string | null {
  if (consent === null) return null
  return `${DOCUMENT_CONSENT_GRANTOR_LABELS[consent.grantor]} açık rızası öğrenci dosyasına bağlı (ıslak imzalı form).`
}
