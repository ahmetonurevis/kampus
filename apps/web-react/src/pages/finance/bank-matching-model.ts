import {
  BANK_MATCH_CONFIDENCE_LABELS,
  BANK_MATCH_REASON_LABELS,
  BANK_TRANSACTION_STATUS_LABELS,
  type BankMatchConfidence,
  type BankMatchReason,
  type BankTransactionStatus,
} from '@kampus/school-core/lib/finance-bank-matching.ts'
import type { BankImportRowStatus } from '@kampus/school-core/lib/finance-bank-statement.ts'
import { IMPORT_FILE_MAX_BYTES } from '@kampus/school-core/lib/enrollment-import-cells.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import type {
  BankMatchSuggestion,
  BankStatementImportResult,
} from '@kampus/react-shared/use-finance-bank-matching.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'

// Banka eşleştirme ekranının saf yardımcıları (IST-115, ON-099; DOM-FIN-069): etiket, ton, özet ve
// dosya denetimi. Bileşenler `FinanceBankMatchingSection.tsx`, `BankStatementImportDialog.tsx`,
// `BankMatchPanel.tsx`'tedir.

export const STATUS_TONES = {
  unmatched: 'amber',
  matched: 'green',
  ignored: 'gray',
} as const satisfies Record<BankTransactionStatus, BadgeTone>

export const CONFIDENCE_TONES = {
  high: 'green',
  medium: 'amber',
  low: 'gray',
} as const satisfies Record<BankMatchConfidence, BadgeTone>

export const statusLabel = (status: BankTransactionStatus) => BANK_TRANSACTION_STATUS_LABELS[status]
export const confidenceLabel = (confidence: BankMatchConfidence) =>
  `${BANK_MATCH_CONFIDENCE_LABELS[confidence]} güven`

export const IMPORT_ROW_LABELS = {
  ready: 'Aktarılacak',
  skipped: 'Daha önce aktarılmış',
  outgoing: 'Giden hareket',
  ignored: 'Hareket değil',
  invalid: 'Hatalı',
} as const satisfies Record<BankImportRowStatus, string>

export const IMPORT_ROW_TONES = {
  ready: 'green',
  skipped: 'gray',
  outgoing: 'gray',
  ignored: 'gray',
  invalid: 'red',
} as const satisfies Record<BankImportRowStatus, BadgeTone>

/** Gerekçe kodları kullanıcı metnine; değer taşımaz (kimlik no yanıtta yoktur). */
export const reasonText = (reasons: readonly BankMatchReason[]) =>
  reasons.map((reason) => BANK_MATCH_REASON_LABELS[reason]).join(', ')

/** Tutarın taksite oturuşu: kısmi ve fazla ödemede ne olacağını söyler (DOM-FIN-030). */
export function amountNote(suggestion: BankMatchSuggestion, amountCents: number): string {
  switch (suggestion.amountFit) {
    case 'exact':
      return 'Tutar taksitin kalanına eşit; taksit kapanır.'
    case 'multiple':
      return 'Tutar birden çok taksiti kapatır; en eski vadeden başlanır.'
    case 'partial':
      return `Kısmi ödeme: taksitte ${money(suggestion.openCents - amountCents)} kalır.`
    case 'over':
      return suggestion.creditCents > 0
        ? `Fazla ödeme: açık taksitler kapanır, ${money(suggestion.creditCents)} iade alacağı olur.`
        : 'Fazla ödeme: artan tutar sonraki taksitlere dağıtılır.'
    default:
      return suggestion.amountFit satisfies never
  }
}

export function importSummary(result: BankStatementImportResult): string {
  const parts = [
    `${String(result.readyCount)} gelen hareket aktarılacak (${money(result.totalCents)})`,
    result.skippedCount > 0 ? `${String(result.skippedCount)} daha önce aktarılmış` : null,
    result.outgoingCount > 0 ? `${String(result.outgoingCount)} giden hareket alınmaz` : null,
    result.ignoredCount > 0 ? `${String(result.ignoredCount)} satır hareket değil` : null,
    result.invalidCount > 0 ? `${String(result.invalidCount)} hatalı satır` : null,
  ]
  return `${parts.filter(Boolean).join(' · ')}.`
}

/** Ekstre dosyası: CSV, Excel ya da MT940 (.sta, .940, .txt); en çok 5 MB. */
export const STATEMENT_FILE_MESSAGE =
  'En fazla 5 MB boyutunda CSV, Excel (.xlsx) ya da MT940 (.sta, .txt) dosyası seçin.'
export function statementFileProblem(file: { name: string; size: number }): string | null {
  if (file.size === 0 || file.size > IMPORT_FILE_MAX_BYTES) return STATEMENT_FILE_MESSAGE
  return /\.(csv|txt|xlsx|sta|940|mt940)$/i.test(file.name) ? null : STATEMENT_FILE_MESSAGE
}
