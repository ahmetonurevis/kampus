// Gelir ve nakit akışı tahmini ekranının satır ve açıklama modeli (ON-246, ON-247; DOM-FIN-063).
// Hesap ve varsayımlar sunucudandır; burada yalnız gösterim metni üretilir.
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import { funnelStepLabel } from '@kampus/school-core/lib/enrollment-funnel.ts'
import type { CashFlowForecast, RevenueForecast } from '@kampus/school-core/lib/finance-forecast.ts'
import { dateLabel, money } from '@kampus/school-core/lib/format.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

/** On binde bir oranın yüzde gösterimi (`1250` → `%12,5`). */
export const percentLabel = (points: number) =>
  `%${(points / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`

export type RevenueRow = {
  key: string
  label: string
  prospects: number | null
  sampleSize: number | null
  rateBasisPoints: number | null
  grossCents: number | null
  discountCents: number | null
  netCents: number
}

/** Gelir tahmini tablosu: kesin gelir iki satır, huni adımları ve beklenen toplam. */
export function revenueRows(
  forecast: Pick<RevenueForecast, 'committed' | 'pipeline' | 'expectedTotalCents'>,
  institutionType: InstitutionType,
): RevenueRow[] {
  const fixed = (key: string, label: string, netCents: number): RevenueRow => ({
    key,
    label,
    prospects: null,
    sampleSize: null,
    rateBasisPoints: null,
    grossCents: null,
    discountCents: null,
    netCents,
  })
  return [
    fixed('new', 'Kesin gelir · yeni kayıt', forecast.committed.newEnrollmentCents),
    fixed('renewal', 'Kesin gelir · yenileme', forecast.committed.renewalCents),
    ...(forecast.pipeline?.steps ?? []).map((step) => ({
      key: step.step,
      label: `Huni · ${funnelStepLabel(step.step, institutionType)}`,
      prospects: step.prospects,
      sampleSize: step.sampleSize,
      rateBasisPoints: step.rateBasisPoints,
      grossCents: step.grossCents,
      discountCents: step.discountCents,
      netCents: step.netCents,
    })),
    fixed('total', 'Beklenen toplam', forecast.expectedTotalCents),
  ]
}

const yearDay = (day: string) => dateLabel(`${day}T12:00:00.000Z`, { year: 'numeric' })

/** Gelir tahmininin varsayım açıklamaları; sunucunun `assumptions` alanından. */
export function revenueNotes(
  forecast: Pick<RevenueForecast, 'assumptions' | 'pipeline' | 'enrollmentYear'>,
): string[] {
  const { assumptions: a, pipeline } = forecast
  const notes = [
    'Kesin gelir yılın iptal edilmemiş taksitleridir; indirim ve burs düşülmüştür, tahmin değildir.',
  ]
  switch (a.pipelineStatus) {
    case 'included':
      notes.push(
        `Dönüşüm oranları ${yearDay(a.historyFrom)} – ${yearDay(a.historyTo)} arasında açılıp sonuçlanan ${String(a.historyClosedProspects)} adaydan hesaplandı; yalnız bu dönemde açılmış açık adaylar sayıldı.`,
      )
      break
    case 'crm_disabled':
      notes.push('Kayıt (CRM) modülü kapalı olduğu için aday hunisi tahmine katılmadı.')
      break
    case 'past_year':
      notes.push(
        `Geçmiş yılda huni beklentisi hesaplanmaz; açık adaylar ${academicYearName(forecast.enrollmentYear)} kayıt yılına yazılır.`,
      )
      break
    default:
      a.pipelineStatus satisfies never
  }
  if (a.tariffYear === null) notes.push('Yayımlı ücret tarifesi yok.')
  else if (a.tariffCarriedOver)
    notes.push(
      `Bu yılın tarifesi yayımlanmadığı için ${academicYearName(a.tariffYear)} tarifesinin fiyatları kullanıldı.`,
    )
  else notes.push(`Aday fiyatları ${academicYearName(a.tariffYear)} yayımlı tarifesinden alındı.`)
  if (a.priceSources.contractAverage > 0 && a.contractAverageCents !== null)
    notes.push(
      `${String(a.priceSources.contractAverage)} adayın fiyatı, tarifede yıllık öğrenim kalemi olmadığı için sözleşmelerin liste ortalamasından (${money(a.contractAverageCents)}) alındı.`,
    )
  if (a.discountReferenceYear === null)
    notes.push('Tarifeli sözleşme olmadığı için indirim ve burs oranı sıfır alındı.')
  else
    notes.push(
      `İndirim ve burs oranı ${percentLabel(a.discountRateBasisPoints)}: ${academicYearName(a.discountReferenceYear)} sözleşmelerinden.`,
    )
  if (pipeline !== null && pipeline.unpricedProspects > 0)
    notes.push(
      `${String(pipeline.unpricedProspects)} aday fiyatı bulunamadığı için beklentiye girmedi.`,
    )
  if (pipeline !== null && pipeline.unratedProspects > 0)
    notes.push(
      `${String(pipeline.unratedProspects)} aday, adımında sonuçlanmış örnek olmadığı için beklentiye girmedi.`,
    )
  return notes
}

/** Nakit akışı tahmininin varsayım açıklamaları. */
export function cashFlowNotes(
  forecast: Pick<
    CashFlowForecast,
    'assumptions' | 'beyondHorizonCents' | 'pendingRefundCents' | 'totals'
  >,
): string[] {
  const { assumptions: a } = forecast
  const notes = [
    a.onTimeRateSource === 'history'
      ? `Vadesinde tahsil oranı ${percentLabel(a.onTimeRateBasisPoints)}: ${yearDay(a.historyFrom)} – ${yearDay(a.historyTo)} arasında vadesi gelen ${String(a.historyInvoices)} taksitten vadeden sonraki ${String(a.graceDays)} gün içinde tam ödenenlerin payı.`
      : 'Geçmiş taksit örneği yok; planlanan tahsilat düzeltilmeden beklendi.',
    a.lateRecoveryRateSource === 'history'
      ? `Gecikmiş alacağın ${percentLabel(a.lateRecoveryRateBasisPoints)} kadarı ilk ayda beklenir (geç ödenen taksitlerin payı).`
      : 'Geç tahsil örneği yok; gecikmiş alacaktan tahsilat beklenmedi.',
    a.expenseSource === 'manual'
      ? 'Gider her aya elle girilen aylık tutarla yazıldı.'
      : 'Gider verisi yok: net akış tahsilat eksi iadedir. Bütçe kalemleri eklenince gider oradan okunacak.',
  ]
  if (forecast.beyondHorizonCents > 0)
    notes.push(
      `Seçilen dönemden sonra vadesi gelen ${money(forecast.beyondHorizonCents)} ayrıca beklenir.`,
    )
  const laterRefunds = forecast.pendingRefundCents - forecast.totals.refundCents
  if (laterRefunds > 0)
    notes.push(`Seçilen dönemden sonra ödenecek ${money(laterRefunds)} iade ayrıca vardır.`)
  return notes
}
