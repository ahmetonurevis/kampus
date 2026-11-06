// Yenileme sözleşmesinin yenilemeye özgü parçaları (IST-100): Ek 1'de dönem geçişi, Ek 2'de plan
// anındaki ücret kararı: ilan, artış tavanı hesabı ve oranların kaynağı (DOM-FIN-005), indirim
// koşulu kalkınca gerekçe (DOM-FIN-023) ve burs (DOM-FIN-025). Tutarlar yenileme kaydındaki
// kopyadır; tarife veya oran sonradan değişse de belge değişmez (DOM-FIN-051).
import type { DocumentDataMap } from '@kampus/school-core/lib/document-data.ts'
import {
  FEE_DISCOUNT_KIND_LABELS,
  tuitionIncreaseCeiling,
} from '@kampus/school-core/lib/fee-tariffs.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import type { RenewalCeiling, RenewalPricing } from '@kampus/school-core/lib/renewal-ceiling.ts'
import { COLORS, date, type DocumentLayout } from '../layout.ts'

/** Ücret yılının oran satırı ve kaynağı (TÜİK bülteni ve tarihi). */
export type PriceIndexSource = {
  academicYear: number
  ppiBasisPoints: number
  cpiBasisPoints: number
  source: string
  bulletinDate: string
}

export type RenewalContractContext = {
  academicYear: number
  status: string
  fromClassName: string | null
  targetClassName: string | null
  /** Plan anındaki ücret kararı; iş akışı köprüsüyle açılan yenilemede yoktur. */
  pricing: RenewalPricing | null
  /**
   * Kurum profilindeki oranlar; rol okuyamıyorsa (veli) verilmez ve belge kaynağı genel cümleyle
   * yazar. Profil yalnız kaynağı verir; oranlar plan kaydındakidir.
   */
  rateSources?: readonly PriceIndexSource[]
}

type AppliedCeiling = Extract<RenewalCeiling, { status: 'applied' }>

const DISCOUNT_LABELS: Readonly<Record<string, string>> = { ...FEE_DISCOUNT_KIND_LABELS }

export const periodLabel = (year: number) => `${String(year)}–${String(year + 1)}`

/** On binde birlik oran (4250 → %42,5). */
export const percentLabel = (basisPoints: number) =>
  `%${(basisPoints / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`

const BASE_SOURCE_LABELS = {
  contract: 'Son sözleşmenin indirimsiz ücreti',
  enrollment_contract: 'Kayıt yılı sözleşmesinin indirimsiz ücreti',
  previous_tariff: 'Önceki yılın ilan ücreti',
} as const satisfies Record<AppliedCeiling['baseSource'], string>

const RATE_COLUMNS = [
  { header: 'Ücret yılı', width: 30 },
  { header: 'ÜFE ort.', width: 28 },
  { header: 'TÜFE ort.', width: 28 },
  { header: 'Artış oranı', width: 32 },
  { header: 'Yıl sonu tavan', width: 56 },
] as const

/** Yıllık artış oranı: (ÜFE + TÜFE) / 2 + ek puan, on binde birlik. */
const yearlyIncrease = (rate: AppliedCeiling['rates'][number], extraBasisPoints: number) =>
  (rate.ppiBasisPoints + rate.cpiBasisPoints) / 2 + extraBasisPoints

/** Tavan bazdan hedef yıla her yılın oranıyla sırayla büyür (core `tuitionAfterDiscountLoss`). */
export function ceilingRows(ceiling: AppliedCeiling): string[][] {
  let cents = ceiling.baseCents
  return ceiling.rates.map((rate) => {
    cents = tuitionIncreaseCeiling(cents, rate, ceiling.extraBasisPoints)
    return [
      periodLabel(rate.academicYear),
      percentLabel(rate.ppiBasisPoints),
      percentLabel(rate.cpiBasisPoints),
      percentLabel(yearlyIncrease(rate, ceiling.extraBasisPoints)),
      money(cents),
    ]
  })
}

/**
 * Oranların kaynağı: profil satırı plan anındaki oranla aynıysa bülteni yazar; sonradan
 * düzeltildiyse belge plan anındaki oranı gösterdiğini söyler.
 */
export function rateSourceLines(
  ceiling: AppliedCeiling,
  sources: readonly PriceIndexSource[] | undefined,
): string[] {
  if (sources === undefined)
    return ['Oranlar, kurumun TÜİK bülteninden girdiği önceki yılın ÜFE ve TÜFE ortalamalarıdır.']
  return ceiling.rates.map((rate) => {
    const year = periodLabel(rate.academicYear)
    const entry = sources.find((item) => item.academicYear === rate.academicYear)
    if (!entry) return `${year}: oranın kaynak kaydı bulunamadı.`
    const bulletin = `${entry.source}, ${date(entry.bulletinDate)}`
    return entry.ppiBasisPoints === rate.ppiBasisPoints &&
      entry.cpiBasisPoints === rate.cpiBasisPoints
      ? `${year}: ${bulletin}`
      : `${year}: oran plandan sonra düzeltildi (güncel kaynak: ${bulletin}); bu belge plan anındaki oranı gösterir.`
  })
}

/** Sınıf geçişi yenilemeden ayrı işlemdir; durum yenileme kaydındandır (IST-100). */
function transitionText(renewal: RenewalContractContext): string {
  if (renewal.status === 'İptal')
    return 'Yenileme planı iptal edildi; bu sözleşme yeni dönemde uygulanmaz.'
  return renewal.status === 'Planlandı'
    ? 'Sınıf, dönem geçişi uygulanınca değişir; geçmiş not, yoklama ve tahsilat korunur.'
    : 'Dönem geçişi uygulandı; geçmiş not, yoklama ve tahsilat korunur.'
}

const transitionLabel = (renewal: RenewalContractContext) =>
  `${renewal.fromClassName || '—'} → ${renewal.targetClassName || '—'} · ${periodLabel(renewal.academicYear)}`

/** Ek 1 alt başlığı: öğrenci ve dönem geçişi (önceki sınıf → yeni sınıf, yeni dönem). */
export const renewalPlanSubtitle = (
  data: DocumentDataMap['contract'],
  renewal: RenewalContractContext,
) => `${data.student.name} · ${transitionLabel(renewal)}`

/**
 * Ek 1 sonu: ücret kararı varsa Ek 2'ye yönlendirir; köprüyle açılmış (tarifesiz) yenilemede kararın
 * kayıtta olmadığını söyler. Metin sayfası büyümesin diye ilk sayfaya yazılmaz.
 */
export function renewalPlanNote(doc: DocumentLayout, renewal: RenewalContractContext): void {
  doc.paragraph(
    `${transitionText(renewal)} ${
      renewal.pricing
        ? "Ücretin ilan ve artış tavanından nasıl belirlendiği Ek 2'dedir."
        : 'Bu yenileme ücret tarifesinden önce planlandı; ilan ve artış tavanı kararı kayıtta yok.'
    }`,
    9,
    COLORS.muted,
  )
}

function ceilingPart(
  doc: DocumentLayout,
  ceiling: RenewalCeiling,
  renewal: RenewalContractContext,
) {
  doc.section('Artış tavanı')
  if (ceiling.status === 'entry_grade') {
    doc.paragraph(
      'Yeni sınıf kademenin başlangıç sınıfıdır (1, 5 ve 9. sınıf); artış tavanı uygulanmaz, ücret ilanla sınırlıdır.',
    )
    return
  }
  if (ceiling.status === 'no_base') {
    doc.paragraph(
      'Artış tavanının bazı bulunamadı: öğrencinin önceki sözleşmesi ve önceki yılın ilan ücreti kayıtlı değil. Ücret ilanla sınırlıdır.',
    )
    return
  }
  doc.fields([
    ['Baz ücret', money(ceiling.baseCents)],
    ['Bazın kaynağı', BASE_SOURCE_LABELS[ceiling.baseSource]],
    ['Baz dönemi', periodLabel(ceiling.baseYear)],
    ['Ek puan', percentLabel(ceiling.extraBasisPoints)],
  ])
  doc.paragraph(
    'Tavan = baz × (1 + ((ÜFE ortalaması + TÜFE ortalaması) / 2 + ek puan) / 100). Bazdan sonraki her ücret yılının oranı sırayla uygulanır; kuruş aşağı yuvarlanır (Özel Öğretim Kurumları Yönetmeliği md. 53/1).',
    9,
  )
  doc.table(RATE_COLUMNS, ceilingRows(ceiling), true)
  doc.fields([['Artış tavanı', money(ceiling.ceilingCents)]])
  doc.paragraph('Oranların kaynağı', 9, COLORS.sapphire)
  for (const line of rateSourceLines(ceiling, renewal.rateSources)) doc.paragraph(line, 9)
  if (ceiling.discountLoss) {
    doc.section('İndirim değişikliği')
    doc.fields([
      [
        'Bu dönem uygulanmayan indirim',
        ceiling.discountLoss.kinds.map((kind) => DISCOUNT_LABELS[kind] ?? kind).join(', '),
      ],
    ])
    doc.paragraph(ceiling.discountLoss.reason)
  }
}

/**
 * Ek 2: plan anındaki ücret kararı. İlan ve tavanın küçüğü uygulanabilecek en yüksek ücrettir;
 * sözleşmedeki öğrenim ücreti bunu aşamaz (DOM-FIN-002, DOM-FIN-005).
 */
export function renewalAppendix(
  doc: DocumentLayout,
  data: DocumentDataMap['contract'],
  renewal: RenewalContractContext,
  pricing: RenewalPricing,
): void {
  const { ceiling } = pricing
  const maxCents =
    ceiling.status === 'applied'
      ? Math.min(pricing.announcedCents, ceiling.ceilingCents)
      : pricing.announcedCents
  doc.newPage()
  doc.heading('Ek 2 / Yenileme ücret kararı', renewalPlanSubtitle(data, renewal))
  doc.fields([
    ['Önceki sınıf', renewal.fromClassName || '—'],
    [
      'Yeni dönem ve sınıf',
      `${periodLabel(renewal.academicYear)} · ${renewal.targetClassName || '—'}`,
    ],
  ])
  doc.highlight(
    'UYGULANABİLECEK EN YÜKSEK ÖĞRENİM ÜCRETİ',
    money(maxCents),
    ceiling.status === 'applied' ? 'İlan ve tavanın küçüğü' : 'İlan ücreti',
  )
  doc.section('İlan ve sözleşme ücreti')
  doc.fields([
    ['İlan edilen ücret', money(pricing.announcedCents)],
    ['Tarife sürümü', String(pricing.tariffVersion)],
    // Süresinde ilan yapılmadıysa uygulanan önceki yılın tarifesi (DOM-FIN-002, K-11).
    ...(pricing.tariffCarriedOverFromYear
      ? ([
          ['Uygulanan tarife', `${periodLabel(pricing.tariffCarriedOverFromYear)} (önceki yıl)`],
        ] as [string, string][])
      : []),
    ['Uygulanan öğrenim ücreti', money(data.contract?.grossCents ?? maxCents)],
    ['Net öğrenim ücreti', money(data.contract?.netCents ?? data.contract?.amount ?? 0)],
  ])
  ceilingPart(doc, ceiling, renewal)
  if (pricing.scholarship) {
    doc.section('Burs')
    doc.paragraph(
      `Bu eğitim yılının bildirilmiş burs programından ${money(pricing.scholarship.amountCents)} burs atandı. Burs indirim değildir, indirim tavanına girmez; bursluya senet veya taahhüt düzenlenmez.`,
    )
  }
  doc.paragraph(
    'Ücret kararı yenilemenin planlandığı andaki kayıttır; tarife veya oranlar sonradan değişse de bu sözleşmenin tutarı değişmez. Değişiklik yalnız ek protokolle yapılır.',
    9,
    COLORS.muted,
  )
}
