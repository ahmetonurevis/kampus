// Kayıt Yenileme listesi ve ayrıntısının web ile mobilde ortak saf hesapları (IST-100; DOM-FIN-002,
// -005, -023; DOM-KAY-020): liste satırı, dönem ve sınıf geçişi metni, tavan açıklaması ve ayrıntı
// bölümleri. Ücret sunucuda hesaplanır; burada yalnız biçimlenir.
import type { operations } from '@kampus/api-client/schema.d.ts'
import { FEE_ITEM_KIND_LABELS, carriedOverTariffNote } from '@kampus/school-core/lib/fee-tariffs.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import { contractPaymentTermLabel } from '@kampus/school-core/lib/payment-terms.ts'
import type { RenewalCeiling } from '@kampus/school-core/lib/renewal-ceiling.ts'

/** Yenileme kaydının durumları (liste süzgeci). */
export const RENEWAL_STATUSES = ['Planlandı', 'Tamamlandı', 'Mezun', 'İptal'] as const

export type RenewalListItem =
  operations['listRenewals']['responses'][200]['content']['application/json']['data'][number]
export type RenewalDetail =
  operations['getRenewal']['responses'][200]['content']['application/json']['data']

/** "2027–2028" eğitim yılı. */
export const renewalPeriod = (year: number) => `${String(year)}–${String(year + 1)}`

type Transition = Pick<RenewalListItem, 'fromClassName' | 'targetClassName' | 'mode'>

/** "9-A → 10-A"; mezuniyette hedef "Mezuniyet". Kapsam dışı sınıf adı "—". */
export const renewalTransition = (item: Transition) =>
  `${item.fromClassName ?? '—'} → ${
    item.mode === 'graduate' ? 'Mezuniyet' : (item.targetClassName ?? '—')
  }`

export type RenewalRow = {
  id: string
  version: number
  studentName: string
  period: string
  transition: string
  netCents: number
  netLabel: string
  status: string
}

export function renewalRow(item: RenewalListItem): RenewalRow {
  return {
    id: item.id,
    version: item.version,
    studentName: item.studentName ?? '—',
    period: renewalPeriod(item.academicYear),
    transition: renewalTransition(item),
    netCents: item.netCents,
    netLabel: money(item.netCents),
    status: item.status,
  }
}

const percent = (basisPoints: number) =>
  `%${(basisPoints / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`

/** Tavanın açıklaması (DOM-FIN-005, DOM-FIN-023); uygulanmıyorsa nedeni. */
export function ceilingLines(ceiling: RenewalCeiling): string[] {
  if (ceiling.status === 'entry_grade')
    return ['Kademenin başlangıç sınıfı: artış tavanı uygulanmaz, ücret ilanla sınırlıdır.']
  if (ceiling.status === 'no_base')
    return [
      'Artış tavanı hesaplanamadı: öğrencinin önceki sözleşmesi ve önceki yılın ilan ücreti yok. Ücret ilanla sınırlıdır.',
    ]
  const source =
    ceiling.baseSource === 'previous_tariff'
      ? 'önceki yılın ilan ücreti'
      : ceiling.baseSource === 'enrollment_contract'
        ? 'kayıt yılındaki indirimsiz ücret'
        : 'son sözleşmedeki ücret'
  const rates = ceiling.rates
    .map(
      (rate) =>
        `${String(rate.academicYear)}: ÜFE ${percent(rate.ppiBasisPoints)}, TÜFE ${percent(rate.cpiBasisPoints)}`,
    )
    .join('; ')
  return [
    `Artış tavanı: ${money(ceiling.ceilingCents)} (baz ${money(ceiling.baseCents)}, ${source}, ${String(ceiling.baseYear)})`,
    `Uygulanan oranlar: ${rates} · ek ${percent(ceiling.extraBasisPoints)}`,
    ...(ceiling.discountLoss ? [ceiling.discountLoss.reason] : []),
  ]
}

export type RenewalDetailSection = { title: string; lines: string[] }

const feeKindLabel = (kind: string | null | undefined) =>
  kind && kind !== 'tuition'
    ? ` · ${(FEE_ITEM_KIND_LABELS as Readonly<Record<string, string>>)[kind] ?? 'Ek hizmet'}`
    : ''

/**
 * Ayrıntı bölümleri: dönem geçişi, (yenilemede) plan anındaki ücret kararı ve yeni dönem taksitleri.
 * Sınıf geçişi planla değişmez, ayrı işlemdir (DOM-KAY-020); metin bunu söyler.
 */
export function renewalDetailSections(data: RenewalDetail): RenewalDetailSection[] {
  const sections: RenewalDetailSection[] = [
    {
      title: 'Dönem geçişi',
      lines: [
        renewalPeriod(data.academicYear),
        renewalTransition(data),
        data.status === 'Planlandı'
          ? 'Dönem geçişi uygulanınca sınıf değişir; geçmiş not, yoklama ve tahsilatlar korunur.'
          : 'Dönem geçişi uygulanmış.',
      ],
    },
  ]
  if (data.mode === 'renew') {
    const pricing = data.pricing
    sections.push({
      title: 'Ücret',
      lines: [
        ...(pricing?.tariffCarriedOverFromYear
          ? [carriedOverTariffNote(pricing.tariffCarriedOverFromYear)]
          : []),
        ...(pricing ? [`İlan edilen ücret: ${money(pricing.announcedCents)}`] : []),
        ...(pricing ? ceilingLines(pricing.ceiling) : []),
        ...(pricing?.paymentTerm
          ? [`Ödeme koşulu: ${contractPaymentTermLabel(pricing.paymentTerm)}`]
          : []),
        ...(data.tuitionCents === null ? [] : [`Öğrenim ücreti: ${money(data.tuitionCents)}`]),
        ...(data.discountCents ? [`İndirim: −${money(data.discountCents)}`] : []),
        ...(data.scholarshipCents ? [`Burs: −${money(data.scholarshipCents)}`] : []),
        `Net eğitim bedeli: ${money(data.netCents)}`,
      ],
    })
  }
  if (data.invoices.length)
    sections.push({
      title: 'Yeni dönem taksitleri',
      lines: data.invoices.map(
        (invoice) =>
          `${String(invoice.installment)}. taksit · ${dateLabel(invoice.dueDate, { year: 'numeric' })} · ${money(invoice.amountCents)} · ${invoice.paidAt ? 'Ödendi' : 'Bekliyor'}${feeKindLabel(invoice.feeKind)}`,
      ),
    })
  return sections
}
