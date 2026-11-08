// Gelir senaryo analizi ekranının modeli (ON-248; DOM-FIN-067). Senaryolar saklanmaz, adreste
// tutulur (K-90): `senaryo1=Ad`, `senaryo1.yeni=-10`, `senaryo1.yeniBirim=adet`, `senaryo1.yenileme`,
// `senaryo1.yenilemeBirim`, `senaryo1.fiyat=12.5`, `senaryo1.burs=2`, `senaryo1.mevcut=1`; ayrıca
// `senaryoYili` ve `senaryoNakit` (ay). Sınırlar ve mesajlar core şemasındandır; hesap sunucudadır.
import { CASH_FLOW_MAX_MONTHS } from '@kampus/school-core/lib/finance-forecast.ts'
import {
  FINANCE_SCENARIO_MAX,
  financeScenarioSchema,
  type FinanceScenario,
  type FinanceScenarioComparison,
  type StudentChange,
} from '@kampus/school-core/lib/finance-scenarios.ts'
import { money } from '@kampus/school-core/lib/format.ts'
import { percentLabel } from './finance-forecast-model.ts'

export const SCENARIO_NAME_MAX = 40
const PREFIX = 'senaryo'
export const SCENARIO_YEAR_PARAM = 'senaryoYili'
export const SCENARIO_CASH_PARAM = 'senaryoNakit'

export type ChangeUnit = StudentChange['unit']

/** Formdaki senaryo: kullanıcının yazdığı metinler (yüzde, puan ve adet; ondalık virgül olabilir). */
export interface ScenarioDraft {
  /** Satır anahtarı; adrese yazılmaz (adresten gelen satırda `senaryo<n>`). */
  id: string
  name: string
  newValue: string
  newUnit: ChangeUnit
  renewalValue: string
  renewalUnit: ChangeUnit
  price: string
  discount: string
  applyToExisting: boolean
}

export type DraftField = 'name' | 'newValue' | 'renewalValue' | 'price' | 'discount'
export type DraftErrors = Partial<Record<DraftField, string>>

export const emptyDraft = (index: number, id: string): ScenarioDraft => ({
  id,
  name: `Senaryo ${String(index + 1)}`,
  newValue: '',
  newUnit: 'percent',
  renewalValue: '',
  renewalUnit: 'percent',
  price: '',
  discount: '',
  applyToExisting: false,
})

const DECIMAL = /^[+-]?\d+(?:[.,]\d{1,2})?$/
const INTEGER = /^[+-]?\d+$/

/** Boş metin sıfırdır; geçersizse `null`. Yüzde ve puan iki ondalık, adet tam sayı alır. */
function parseInput(text: string, kind: 'decimal' | 'integer'): number | null {
  const value = text.trim()
  if (value === '') return 0
  if (!(kind === 'decimal' ? DECIMAL : INTEGER).test(value)) return null
  return Number(value.replace(',', '.'))
}

/** Yüzde ya da puanı on binde bire çevirir (`12,5` → 1250). */
const toBasisPoints = (value: number) => Math.round(value * 100)

const FIELD_OF: Record<string, DraftField> = {
  newStudents: 'newValue',
  renewalStudents: 'renewalValue',
  priceChangeBasisPoints: 'price',
  discountChangeBasisPoints: 'discount',
}

const INPUT_MESSAGES: Record<Exclude<DraftField, 'name'>, string> = {
  newValue: 'Geçerli bir değişim girin (ör. -10 ya da 12,5).',
  renewalValue: 'Geçerli bir değişim girin (ör. -10 ya da 12,5).',
  price: 'Geçerli bir yüzde girin (ör. 25 ya da 12,5).',
  discount: 'Geçerli bir puan girin (ör. 2 ya da -1,5).',
}

function studentChange(text: string, unit: ChangeUnit): StudentChange | null {
  const value = parseInput(text, unit === 'percent' ? 'decimal' : 'integer')
  if (value === null) return null
  return { unit, value: unit === 'percent' ? toBasisPoints(value) : value }
}

/** Formu uç parametresine çevirir; sınır dışı değerde core şemasının Türkçe mesajı alana yazılır. */
export function draftToScenario(
  draft: ScenarioDraft,
): { scenario: FinanceScenario; errors: null } | { scenario: null; errors: DraftErrors } {
  const errors: DraftErrors = {}
  const name = draft.name.trim()
  if (name === '') errors.name = 'Senaryo adını girin.'
  else if (name.length > SCENARIO_NAME_MAX)
    errors.name = `Ad en çok ${String(SCENARIO_NAME_MAX)} karakter olabilir.`
  const newStudents = studentChange(draft.newValue, draft.newUnit)
  if (newStudents === null) errors.newValue = INPUT_MESSAGES.newValue
  const renewalStudents = studentChange(draft.renewalValue, draft.renewalUnit)
  if (renewalStudents === null) errors.renewalValue = INPUT_MESSAGES.renewalValue
  const price = parseInput(draft.price, 'decimal')
  if (price === null) errors.price = INPUT_MESSAGES.price
  const discount = parseInput(draft.discount, 'decimal')
  if (discount === null) errors.discount = INPUT_MESSAGES.discount
  if (Object.keys(errors).length > 0) return { scenario: null, errors }
  const parsed = financeScenarioSchema.safeParse({
    newStudents,
    renewalStudents,
    priceChangeBasisPoints: toBasisPoints(price ?? 0),
    discountChangeBasisPoints: toBasisPoints(discount ?? 0),
    applyToExistingContracts: draft.applyToExisting,
  })
  if (parsed.success) return { scenario: parsed.data, errors: null }
  for (const issue of parsed.error.issues) {
    const field = FIELD_OF[String(issue.path[0])]
    if (field !== undefined && errors[field] === undefined) errors[field] = issue.message
  }
  return { scenario: null, errors }
}

const key = (index: number, field?: string) =>
  `${PREFIX}${String(index + 1)}${field === undefined ? '' : `.${field}`}`

/** Adresteki senaryolar (`senaryo1` … `senaryo4`; adı olmayan sıra atlanır). */
export function draftsFromParams(params: URLSearchParams): ScenarioDraft[] {
  const drafts: ScenarioDraft[] = []
  for (let index = 0; index < FINANCE_SCENARIO_MAX; index += 1) {
    const name = params.get(key(index))
    if (name === null) continue
    const unit = (field: string): ChangeUnit =>
      params.get(key(index, field)) === 'adet' ? 'count' : 'percent'
    drafts.push({
      id: key(index),
      name,
      newValue: params.get(key(index, 'yeni')) ?? '',
      newUnit: unit('yeniBirim'),
      renewalValue: params.get(key(index, 'yenileme')) ?? '',
      renewalUnit: unit('yenilemeBirim'),
      price: params.get(key(index, 'fiyat')) ?? '',
      discount: params.get(key(index, 'burs')) ?? '',
      applyToExisting: params.get(key(index, 'mevcut')) === '1',
    })
  }
  return drafts
}

const SCENARIO_KEY = new RegExp(`^${PREFIX}\\d+(?:\\.|$)`)

/** Senaryoları adrese yazar; eski senaryo anahtarları silinir, öteki parametreler korunur. */
export function writeDrafts(params: URLSearchParams, drafts: readonly ScenarioDraft[]) {
  const next = new URLSearchParams(params)
  for (const name of [...next.keys()]) if (SCENARIO_KEY.test(name)) next.delete(name)
  const decimal = (value: string) => value.trim().replace(',', '.')
  drafts.forEach((draft, index) => {
    next.set(key(index), draft.name.trim())
    const optional = (field: string, value: string) => {
      if (value !== '' && Number(value) !== 0) next.set(key(index, field), value)
    }
    optional('yeni', decimal(draft.newValue))
    if (draft.newUnit === 'count') next.set(key(index, 'yeniBirim'), 'adet')
    optional('yenileme', decimal(draft.renewalValue))
    if (draft.renewalUnit === 'count') next.set(key(index, 'yenilemeBirim'), 'adet')
    optional('fiyat', decimal(draft.price))
    optional('burs', decimal(draft.discount))
    if (draft.applyToExisting) next.set(key(index, 'mevcut'), '1')
  })
  return next
}

/** Adresteki ay sayısı; yoksa ya da geçersizse `null` (nakit etkisi kapalı). */
export function cashMonthsFromParams(params: URLSearchParams): number | null {
  const value = Number(params.get(SCENARIO_CASH_PARAM))
  return Number.isInteger(value) && value >= 1 && value <= CASH_FLOW_MAX_MONTHS ? value : null
}

/** Adresteki yıl; `allowed` dışındaysa `null` (kayıt yılı). */
export function yearFromParams(params: URLSearchParams, allowed: readonly number[]): number | null {
  const value = Number(params.get(SCENARIO_YEAR_PARAM))
  return allowed.includes(value) ? value : null
}

const studentsLabel = (value: number) => value.toLocaleString('tr-TR', { maximumFractionDigits: 2 })
const signed = (cents: number) => (cents > 0 ? `+${money(cents)}` : money(cents))
const signedPercent = (points: number | null) =>
  points === null ? '—' : points > 0 ? `+${percentLabel(points)}` : percentLabel(points)

export type ComparisonRow = {
  key: string
  label: string
  cells: { key: string; text: string }[]
  emphasis?: boolean
}

/** Karşılaştırma tablosu: satır ölçüt, sütun temel ve senaryolar (`ids` senaryo sütun anahtarları). */
export function comparisonRows(
  comparison: Pick<FinanceScenarioComparison, 'baseline' | 'scenarios'>,
  ids: readonly string[],
): ComparisonRow[] {
  const columns = [comparison.baseline, ...comparison.scenarios]
  const keys = ['temel', ...comparison.scenarios.map((_, index) => ids[index] ?? String(index))]
  const row = (
    rowKey: string,
    label: string,
    cell: (outcome: (typeof columns)[number]) => string,
    emphasis = false,
  ): ComparisonRow => ({
    key: rowKey,
    label,
    cells: columns.map((outcome, index) => ({ key: keys[index] ?? '', text: cell(outcome) })),
    emphasis,
  })
  return [
    row('new-students', 'Yeni kayıt öğrenci', (o) => studentsLabel(o.newEnrollment.students)),
    row('renewal-students', 'Yenileme öğrenci', (o) => studentsLabel(o.renewal.students)),
    row('new-net', 'Yeni kayıt geliri', (o) => money(o.newEnrollment.netCents)),
    row('renewal-net', 'Yenileme geliri', (o) => money(o.renewal.netCents)),
    row('discount', 'İndirim ve burs oranı', (o) => percentLabel(o.discountRateBasisPoints)),
    row('total', 'Beklenen toplam', (o) => money(o.expectedTotalCents), true),
    row('difference', 'Temele göre fark', (o) => signed(o.differenceCents)),
    row('difference-rate', 'Temele göre fark (%)', (o) => signedPercent(o.differenceBasisPoints)),
  ]
}

/** Karşılaştırmanın varsayım açıklamaları. */
export function scenarioNotes(
  comparison: Pick<FinanceScenarioComparison, 'assumptions' | 'scenarios' | 'cashFlow'>,
  names: readonly string[],
): string[] {
  const { assumptions: a } = comparison
  const notes = [
    `Temel, gelir tahminidir; indirim ve burs oranı ${percentLabel(a.discountRateBasisPoints)}. Fiyat ve indirim değişimi, "mevcut sözleşmelere uygula" seçilmedikçe yalnız sözleşmesi olmayan öğrenciye (aday hunisi ve eklenen öğrenci) uygulanır.`,
    'Öğrenci azalışı önce aday hunisinden, sonra sözleşmeli öğrenciden düşer; eklenen öğrenci sözleşmesiz öğrencinin ortalama netiyle fiyatlanır.',
  ]
  if (a.pipelineStatus === 'crm_disabled')
    notes.push('Kayıt (CRM) modülü kapalı olduğu için yeni kayıt yalnız kesin kayıtlardır.')
  else if (a.pipelineStatus === 'past_year')
    notes.push('Geçmiş yılda aday hunisi yoktur; yeni kayıt yalnız kesin kayıtlardır.')
  comparison.scenarios.forEach((scenario, index) => {
    const unpriced = scenario.newEnrollment.unpricedStudents + scenario.renewal.unpricedStudents
    if (unpriced > 0)
      notes.push(
        `${names[index] ?? ''}: ${studentsLabel(unpriced)} öğrencinin fiyatı bulunamadığı için gelire girmedi (sözleşme ya da tarife yok).`,
      )
  })
  const cash = comparison.cashFlow
  if (cash !== null)
    notes.push(
      cash.spreadFrom === null
        ? 'Eğitim yılı bittiği için gelir farkı nakit akışına yazılmadı.'
        : `Nakit akışında gelir farkı ${cash.spreadFrom} – ${cash.spreadTo ?? ''} arasındaki ${String(cash.spreadMonths)} aya eşit yayıldı ve ${percentLabel(cash.onTimeRateBasisPoints)} vadesinde tahsil oranıyla beklendi; gider girilmedi.`,
    )
  return notes
}
