// Genel Bakış süzgeçlerinin ve mini grafiklerin saf mantığı: kampüs süzgeci (`?sube=`), tahsilat
// dönemi (`?donem=`), dönem penceresi ve sayaç kartı mini grafiği (Vue `Dashboard.vue` `branch`,
// `period`, `collectionSpark`, `gradeSpark`). Sunucu seçili kampüsün özetini döndürür (`branchId`);
// burada yalnız adres değerleri doğrulanır ve sunucunun 12 aylık serisi dönem seçimine göre kesilir.
import type { components } from '@kampus/api-client/schema.d.ts'
import { monthlyPoints, type TrendPoint } from './dashboard-model.ts'

export type MonthlyCollection = NonNullable<
  components['schemas']['DashboardAdmin']['finance']
>['monthlyCollection']

/** Adres anahtarları: kampüs ve tahsilat dönemi. */
export const BRANCH_PARAM = 'sube'
export const PERIOD_PARAM = 'donem'

/** "Tüm kampüsler": adreste anahtar yoktur. */
export const ALL_BRANCHES = ''

/** Dönem seçenekleri (ay); Vue "Son 6 ay" ve "Son 12 ay". */
export const COLLECTION_PERIODS = [6, 12] as const
export type CollectionPeriod = (typeof COLLECTION_PERIODS)[number]
export const DEFAULT_PERIOD: CollectionPeriod = 6
/** Sayaç kartı mini grafiğinin ay sayısı (Vue: son 6 ay). */
export const SPARK_MONTHS = 6

/** Dönemin seçenek etiketi. */
export const periodLabel = (period: CollectionPeriod) => `Son ${period} ay`

/** Adresteki `?donem=` değeri; bilinmeyen ya da bozuk değer varsayılan dönemdir. */
export function periodValue(raw: string | null): CollectionPeriod {
  const period = COLLECTION_PERIODS.find((candidate) => String(candidate) === raw)
  return period ?? DEFAULT_PERIOD
}

/**
 * Adresteki `?sube=` değeri: kampüs yalnız kampüs listesinde varsa süzgeçtir. Bilinmeyen, arşivli
 * ya da kapsam dışı değer "tüm kampüsler" sayılır; kimse görmediği bir kampüsün özetinde kalmaz.
 * `branchIds` boşken (liste henüz yok) değer sunucuya gönderilmez.
 */
export function branchValue(raw: string | null, branchIds: readonly string[]): string {
  return raw !== null && branchIds.includes(raw) ? raw : ALL_BRANCHES
}

export type CollectionWindow = {
  /** Eskiden yeniye, en çok `period` ay. */
  months: MonthlyCollection['months']
  /** Penceredeki ödenen taksit sayısı ve toplamı (kuruş). */
  count: number
  amount: number
}

/**
 * Sunucunun aylık tahsilat serisinin son `period` ayı. Toplamlar pencereden hesaplanır (sunucu
 * toplamı bütün seriyi kapsar), bu yüzden dönem değişince yeni istek gerekmez.
 */
export function collectionWindow(
  monthly: MonthlyCollection,
  period: CollectionPeriod,
): CollectionWindow {
  const months = monthly.months.slice(-period)
  return {
    months,
    count: months.reduce((sum, month) => sum + month.count, 0),
    amount: months.reduce((sum, month) => sum + month.amount, 0),
  }
}

/** Sayaç kartı mini grafiği: son `SPARK_MONTHS` ayın tahsilatı; hiç tahsilat yoksa boş (çizilmez). */
export function collectionSpark(monthly: MonthlyCollection | undefined): TrendPoint[] {
  const points = monthly ? monthlyPoints(monthly.months.slice(-SPARK_MONTHS)) : []
  return points.some((point) => point.value > 0) ? points : []
}

/** Bu ayın tahsilatı (kuruş): serinin son ayı, sunucu bugünün ayını son sıraya koyar. */
export const currentMonthAmount = (monthly: MonthlyCollection | undefined): number =>
  monthly?.months.at(-1)?.amount ?? 0

/** Mini grafiğin erişilebilir adı: başlık ve ay ay değerler (grafik görsel destektir). */
export function sparkLabel(
  label: string,
  points: readonly TrendPoint[],
  format: (value: number) => string,
): string {
  return points.length === 0
    ? label
    : `${label}: ${points.map((point) => `${point.label} ${format(point.value)}`).join(', ')}`
}
