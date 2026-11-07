// Pano finans kartlarının saf gösterim hesapları (IST-116). Tutarlar sunucunun finans özetinden
// (`GET /finance/overview`) gelir; burada yalnız etiket ve mini grafik noktası türetilir.
import { INVOICE_STATUS_LABELS, number } from '@kampus/school-core/lib/format.ts'
import type { CollectionQuery } from '@kampus/react-shared/collections.ts'
import { monthLabel, type TrendPoint } from '../dashboard/dashboard-model.ts'
import type { InvoiceClassScope } from './finance-rows.ts'

/**
 * Vade ayına göre gecikmiş tutar serisi (kuruş). Hiç gecikme yoksa boştur: kayıt olmadan grafik
 * çizilmez.
 */
export function overdueTrendPoints(
  months: readonly { month: string; overdueCents: number }[],
): TrendPoint[] {
  if (!months.some((month) => month.overdueCents > 0)) return []
  return months.map((month) => ({ label: monthLabel(month.month), value: month.overdueCents }))
}

/**
 * Gecikmiş kartının notu: borçlu öğrenci sayısı. Kayıtlı kişi kurum türünün terimiyle yazılır
 * (`learner`: okulda "öğrenci", dil okulu ve kursta "kursiyer"; DOM-KAY-012).
 */
export function overdueStudentsNote(students: number, learner = 'öğrenci'): string {
  return students > 0
    ? `${number(students)} ${learner}de gecikmiş borç`
    : 'Gecikmiş borç bulunmuyor'
}

/**
 * Tahsilat oranı (Vue `Dashboard.vue` yönetici "Tahsilat oranı" kartı): ödenmiş taksit tutarının
 * ödeme planı toplamına oranı, yüzde ve yuvarlanmış. Özet seçili kampüse daralır; "Taksit durumu"
 * kartındaki "Ödendi" payıyla aynı sayıdır. Ödeme planı yoksa oran yoktur (`null`).
 */
export function collectionRate(summary: {
  amount: number
  paid: { amount: number }
}): number | null {
  if (summary.amount <= 0) return null
  return Math.round((summary.paid.amount / summary.amount) * 100)
}

/** Kartın değeri: `%62`; oran yoksa tire. */
export const collectionRateLabel = (rate: number | null) =>
  rate === null ? '—' : `%${String(rate)}`

/** "Yaklaşan ödemeler & takip" kartındaki satır sayısı (Vue: dört). */
export const PRIORITY_INVOICE_COUNT = 4

/**
 * Öncelikli tahsilatlar (Vue `Dashboard.vue` "Yaklaşan ödemeler & takip"): ödenmemiş (gecikmiş ya
 * da yaklaşan) taksitlerden vadesi en erken dördü; eşitlikte kimlik. Kampüs seçiliyse kampüsün
 * sınıflarıyla daralır (`invoiceClassScope`); `too_many` kapsamda sorgu kurulmaz (`null`).
 */
export function priorityInvoicesQuery(scope: InvoiceClassScope): CollectionQuery | null {
  if (scope.kind === 'too_many') return null
  return {
    page: 1,
    pageSize: PRIORITY_INVOICE_COUNT,
    sort: ['dueDate', 'id'],
    filters: {
      status: [INVOICE_STATUS_LABELS.gecikmis, INVOICE_STATUS_LABELS.yaklasan],
      ...(scope.kind === 'classes' ? { classId: scope.classIds } : {}),
    },
  }
}
