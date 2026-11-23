import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import { BOARD_REPORT_MIN_GROUP, suppressSmallGroups } from './finance-board-report.ts'
import {
  COST_CENTER_TYPE_LABELS,
  costCenterPath,
  type CostCenterType,
} from './finance-cost-centers.ts'
import { splitByWeights } from './finance-cost-per-student.ts'
import type { PayRateComponent, PayRateType } from './finance-pay-rates.ts'
import {
  effectivePayrollParameters,
  payrollDerivedValues,
  type PayrollInstitutionSet,
  type PayrollOrigin,
  type PayrollParameterField,
  type PayrollPlatformSet,
  PAYROLL_PLATFORM_DEFAULTS,
} from './finance-payroll-parameters.ts'
import {
  allocationInMonth,
  daysInMonth,
  monthEnd,
  monthRangeLabel,
  monthsBetween,
  monthStart,
  shareLabel,
  STAFF_COST_SHARE_SCALE,
  type StaffCostShare,
} from './finance-staff-costs.ts'
import { DomainError } from './errors.ts'
import { STAFF_ROLE_LABELS, isStaffRole } from './staff-accounts.ts'

/**
 * Personel maliyet raporu (docs/domain/finans.md DOM-FIN-104; ON-204, K-333, K-334). Seçilen ay
 * aralığında her personelin tahmini işveren maliyeti maliyet merkezlerine paylarıyla dağıtılır.
 * Bordro hesabı (ON-198) değildir: tutar **tahmindir** ve saklanmaz.
 *
 * - **Brüt:** ay içinde yürürlükteki ücret tanımları (DOM-FIN-099) gün oranıyla: aylık brüt ana
 *   ücret × (yürürlükteki gün ÷ ayın günü); saatlik ve ders saati ücreti × atamadaki tahmini aylık
 *   saat × gün oranı; ek ders ve nöbet ücreti × atamadaki tahmini saat × gün oranı. Pasifleştirilen
 *   personelin pasifleştirme gününden sonraki günleri sayılmaz. Net tanımlı ana ücret dahil
 *   edilmez (tahmin; brüte çevirme bordro hesabındadır, DOM-FIN-115) ve uyarıyla işaretlenir; saati girilmemiş saatli ücret de öyle.
 * - **İşveren payları:** ayın ilk günü geçerli bordro parametre setinden (DOM-FIN-100): SGK
 *   işveren payı (prim indirimi düşülmüş) ve işsizlik sigortası işveren payı; matrah brüttür, SGK
 *   tavanını aşmaz, taban uygulanmaz.
 * - **Yan haklar:** aylık tutar gün oranıyla, olduğu gibi; prim ve vergi karşılığı hesaplanmaz.
 * - **Dağıtım:** ayın ataması (DOM-FIN-104) payları en büyük kalan yöntemiyle böler, toplam
 *   korunur; ataması olmayan personel "Atanmamış" satırındadır.
 * - **Küçük grup:** kişi satırları istenmedikçe 5'ten az personelli merkezin tutarları gizlenir
 *   (K-77 deseni, `suppressSmallGroups`); personel sayısı görünür.
 *
 * Fonksiyonlar saftır; girdiler servisin yüklediği satırlardır.
 */

export const STAFF_COST_MIN_GROUP = BOARD_REPORT_MIN_GROUP

const DAY = 86_400_000

export const STAFF_COST_FLAGS = ['net_wage', 'missing_wage_hours', 'missing_lesson_hours'] as const
export type StaffCostFlag = (typeof STAFF_COST_FLAGS)[number]
export const STAFF_COST_FLAG_LABELS = {
  net_wage: 'Net ücret tanımlı, ana ücret dahil edilmedi',
  missing_wage_hours: 'Saatli ana ücretin aylık saati girilmemiş, ana ücret dahil edilmedi',
  missing_lesson_hours: 'Ek ders ya da nöbet saati girilmemiş, o ücret dahil edilmedi',
} as const satisfies Record<StaffCostFlag, string>

/** Raporda kullanılan ve platformda "doğrulanmalı" olabilen parametreler. */
const COST_PARAMETER_FIELDS: readonly PayrollParameterField[] = [
  'minimumWageGrossCents',
  'sgkEmployerRateBasisPoints',
  'sgkEmployerIncentiveBasisPoints',
  'unemploymentEmployerRateBasisPoints',
  'sgkCeilingMultiplierBasisPoints',
]

// --- Girdiler ------------------------------------------------------------------------------------

export interface StaffCostMember {
  membershipId: string
  name: string
  role: string
  /** Pasifleştirme günü (Europe/Istanbul); etkin personelde `null`. */
  deactivatedDay: string | null
}

export interface StaffCostRate {
  membershipId: string
  component: PayRateComponent
  rateType: PayRateType
  amountCents: number
  startDate: string
  endDate: string | null
}

export interface StaffCostAllocation {
  id: string
  membershipId: string
  startMonth: string
  shares: readonly StaffCostShare[]
  wageHours: number | null
  extraLessonHours: number | null
  dutyHours: number | null
}

export interface StaffCostCenter {
  id: string
  code: string
  name: string
  type: CostCenterType
  parentId: string | null
  isActive: boolean
}

/** Ayın parametreleri (`staffCostParameters`). */
export interface StaffCostMonthParameters {
  setId: string
  origin: PayrollOrigin
  /** Ayın yılı için set yok, son bilinen set kullanıldı. */
  stale: boolean
  /** Kullanılan alanlardan biri platformda "doğrulanmalı". */
  unverified: boolean
  sgkEmployerNetRateBasisPoints: number
  unemploymentEmployerRateBasisPoints: number
  sgkCeilingCents: number
}

/**
 * Her ayın ilk günü geçerli bordro parametreleri (K-333). İlk setten önceki ay 422
 * `payroll_parameters_missing`.
 */
export function staffCostParameters(
  months: readonly string[],
  institutionSets: readonly PayrollInstitutionSet[],
  platform: readonly PayrollPlatformSet[] = PAYROLL_PLATFORM_DEFAULTS,
): Map<string, StaffCostMonthParameters> {
  const result = new Map<string, StaffCostMonthParameters>()
  for (const month of months) {
    const set = effectivePayrollParameters(monthStart(month), institutionSets, platform)
    if (set === null)
      throw new DomainError(
        'payroll_parameters_missing',
        `${monthRangeLabel(month, month)} için bordro parametresi tanımlı değil.`,
        { path: ['from'] },
      )
    const derived = payrollDerivedValues(set.values)
    result.set(month, {
      setId: set.id,
      origin: set.origin,
      stale: set.stale,
      unverified: set.unverifiedFields.some((field) => COST_PARAMETER_FIELDS.includes(field)),
      sgkEmployerNetRateBasisPoints: derived.sgkEmployerNetRateBasisPoints,
      unemploymentEmployerRateBasisPoints: set.values.unemploymentEmployerRateBasisPoints,
      sgkCeilingCents: derived.sgkCeilingCents,
    })
  }
  return result
}

// --- Kişi × ay -----------------------------------------------------------------------------------

export interface StaffCostAmounts {
  grossCents: number
  employerSgkCents: number
  unemploymentCents: number
  benefitsCents: number
  totalCents: number
}

const ZERO: StaffCostAmounts = {
  grossCents: 0,
  employerSgkCents: 0,
  unemploymentCents: 0,
  benefitsCents: 0,
  totalCents: 0,
}

const addAmounts = (a: StaffCostAmounts, b: StaffCostAmounts): StaffCostAmounts => ({
  grossCents: a.grossCents + b.grossCents,
  employerSgkCents: a.employerSgkCents + b.employerSgkCents,
  unemploymentCents: a.unemploymentCents + b.unemploymentCents,
  benefitsCents: a.benefitsCents + b.benefitsCents,
  totalCents: a.totalCents + b.totalCents,
})

const dayIndex = (day: string) => Date.parse(`${day}T00:00:00.000Z`) / DAY
const ofBasisPoints = (cents: number, basisPoints: number) =>
  Math.round((cents * basisPoints) / STAFF_COST_SHARE_SCALE)

export interface StaffCostMonthResult extends StaffCostAmounts {
  /** Ayda yürürlükte (pasifleştirmeden önce) en az bir ücret tanımı var. */
  included: boolean
  flags: StaffCostFlag[]
}

/**
 * Bir personelin bir aydaki tahmini maliyeti (K-333). `rates` personelin iptal edilmemiş
 * tanımları, `allocation` ayın ataması (saatler için; yoksa saatler boş).
 */
export function staffMonthCost(input: {
  month: string
  member: Pick<StaffCostMember, 'deactivatedDay'>
  rates: readonly StaffCostRate[]
  allocation: Pick<StaffCostAllocation, 'wageHours' | 'extraLessonHours' | 'dutyHours'> | null
  parameters: StaffCostMonthParameters
}): StaffCostMonthResult {
  const { month, member, allocation, parameters } = input
  const days = daysInMonth(month)
  const first = dayIndex(monthStart(month))
  let last = dayIndex(monthEnd(month))
  if (member.deactivatedDay !== null) last = Math.min(last, dayIndex(member.deactivatedDay))
  const flags = new Set<StaffCostFlag>()
  let included = false
  let wage = 0
  let lesson = 0
  let benefits = 0
  for (const rate of input.rates) {
    const start = Math.max(first, dayIndex(rate.startDate))
    const end = Math.min(last, rate.endDate === null ? last : dayIndex(rate.endDate))
    if (end < start) continue
    included = true
    const fraction = (end - start + 1) / days
    if (rate.component === 'benefit') {
      benefits += rate.amountCents * fraction
      continue
    }
    if (rate.component === 'lesson') {
      const hours = rate.rateType === 'duty' ? allocation?.dutyHours : allocation?.extraLessonHours
      if (hours === null || hours === undefined) flags.add('missing_lesson_hours')
      else lesson += rate.amountCents * hours * fraction
      continue
    }
    if (rate.rateType === 'monthly_gross') wage += rate.amountCents * fraction
    else if (rate.rateType === 'monthly_net') flags.add('net_wage')
    else if (allocation?.wageHours === null || allocation?.wageHours === undefined)
      flags.add('missing_wage_hours')
    else wage += rate.amountCents * allocation.wageHours * fraction
  }
  const grossCents = Math.round(wage) + Math.round(lesson)
  const base = Math.min(grossCents, parameters.sgkCeilingCents)
  const employerSgkCents = ofBasisPoints(base, parameters.sgkEmployerNetRateBasisPoints)
  const unemploymentCents = ofBasisPoints(base, parameters.unemploymentEmployerRateBasisPoints)
  const benefitsCents = Math.round(benefits)
  return {
    included,
    flags: STAFF_COST_FLAGS.filter((flag) => flags.has(flag)),
    grossCents,
    employerSgkCents,
    unemploymentCents,
    benefitsCents,
    totalCents: grossCents + employerSgkCents + unemploymentCents + benefitsCents,
  }
}

/** Tutarları paylara böler; her bileşen ayrı bölünür, toplam korunur. */
export function splitStaffCost(
  amounts: StaffCostAmounts,
  weights: readonly number[],
): StaffCostAmounts[] {
  const gross = splitByWeights(amounts.grossCents, weights)
  const sgk = splitByWeights(amounts.employerSgkCents, weights)
  const unemployment = splitByWeights(amounts.unemploymentCents, weights)
  const benefits = splitByWeights(amounts.benefitsCents, weights)
  return weights.map((_, index) => {
    const part = {
      grossCents: gross[index] ?? 0,
      employerSgkCents: sgk[index] ?? 0,
      unemploymentCents: unemployment[index] ?? 0,
      benefitsCents: benefits[index] ?? 0,
    }
    return {
      ...part,
      totalCents:
        part.grossCents + part.employerSgkCents + part.unemploymentCents + part.benefitsCents,
    }
  })
}

// --- Rapor ---------------------------------------------------------------------------------------

type MaybeAmounts = { [Key in keyof StaffCostAmounts]: number | null }

export interface StaffCostCenterRow extends MaybeAmounts {
  /** Atanmamış satırında `null`. */
  id: string | null
  code: string | null
  name: string
  type: CostCenterType | null
  path: string | null
  isActive: boolean
  /** Dönemde bu merkeze payı düşen farklı personel. */
  staffCount: number
  /** Küçük grup: tutarlar gizlendi (`null`). */
  suppressed: boolean
}

export interface StaffCostPersonRow extends StaffCostAmounts {
  membershipId: string
  name: string
  role: string
  centerId: string | null
  centerName: string
  /** Dönem boyunca aynı paysa pay; değiştiyse `null`. Atanmamışta 10.000. */
  shareBasisPoints: number | null
  /** Bu merkeze payı düşen ay sayısı. */
  monthCount: number
  flags: StaffCostFlag[]
}

export interface StaffCostMonthRow extends StaffCostAmounts {
  month: string
  staffCount: number
  parameterSetId: string
  parameterOrigin: PayrollOrigin
  stale: boolean
}

export interface StaffCostReport {
  from: string
  to: string
  people: boolean
  minGroupSize: number
  centers: StaffCostCenterRow[]
  persons: StaffCostPersonRow[] | null
  months: StaffCostMonthRow[]
  totals: StaffCostAmounts & { staffCount: number }
  warnings: {
    /** Net tanımlı ana ücreti dahil edilmeyen personel. */
    netWageStaffCount: number
    /** Saatli ücretinin saati girilmediği için ücreti dahil edilmeyen personel. */
    missingHoursStaffCount: number
    /** Dönemde ataması olan ama ücret tanımı olmayan personel. */
    assignedWithoutRateCount: number
    /** Ataması olmayan, maliyeti "Atanmamış" satırına düşen personel. */
    unassignedStaffCount: number
    /** Yılın seti olmadığı için son bilinen setin kullanıldığı aylar. */
    staleMonths: string[]
    /** Kullanılan parametrelerden biri platformda "doğrulanmalı". */
    unverifiedParameters: boolean
  }
}

export interface StaffCostReportInput {
  from: string
  to: string
  people: boolean
  staff: readonly StaffCostMember[]
  rates: readonly StaffCostRate[]
  allocations: readonly StaffCostAllocation[]
  centers: readonly StaffCostCenter[]
  parameters: ReadonlyMap<string, StaffCostMonthParameters>
  minGroupSize?: number
}

const UNASSIGNED = 'Atanmamış'

interface Bucket {
  amounts: StaffCostAmounts
  staff: Set<string>
}

interface PersonBucket {
  amounts: StaffCostAmounts
  shares: Set<number>
  months: number
  flags: Set<StaffCostFlag>
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(key(item))
    if (list === undefined) map.set(key(item), [item])
    else list.push(item)
  }
  return map
}

/** Tahmini personel maliyeti raporu (DOM-FIN-104). */
export function staffCostReport(input: StaffCostReportInput): StaffCostReport {
  const minGroupSize = input.minGroupSize ?? STAFF_COST_MIN_GROUP
  const months = monthsBetween(input.from, input.to)
  const ratesOf = groupBy(input.rates, (rate) => rate.membershipId)
  const allocationsOf = groupBy(input.allocations, (allocation) => allocation.membershipId)
  const centerById = new Map(input.centers.map((center) => [center.id, center]))

  const buckets = new Map<string, Bucket>()
  const persons = new Map<string, PersonBucket>()
  const monthRows: StaffCostMonthRow[] = []
  const included = new Set<string>()
  const netWage = new Set<string>()
  const missingHours = new Set<string>()
  const assigned = new Set<string>()
  const unassigned = new Set<string>()
  const staffById = new Map(input.staff.map((member) => [member.membershipId, member]))

  for (const month of months) {
    const parameters = input.parameters.get(month)
    if (parameters === undefined) throw new Error(`staff cost parameters missing for ${month}`)
    let monthAmounts = ZERO
    let monthStaff = 0
    for (const member of input.staff) {
      if (!isStaffRole(member.role)) continue
      const allocation = allocationInMonth(allocationsOf.get(member.membershipId) ?? [], month)
      const cost = staffMonthCost({
        month,
        member,
        rates: ratesOf.get(member.membershipId) ?? [],
        allocation,
        parameters,
      })
      if (allocation !== null) assigned.add(member.membershipId)
      if (!cost.included) continue
      included.add(member.membershipId)
      monthStaff += 1
      monthAmounts = addAmounts(monthAmounts, cost)
      if (cost.flags.includes('net_wage')) netWage.add(member.membershipId)
      if (cost.flags.includes('missing_wage_hours') || cost.flags.includes('missing_lesson_hours'))
        missingHours.add(member.membershipId)
      const shares =
        allocation === null
          ? [{ centerId: null, shareBasisPoints: STAFF_COST_SHARE_SCALE }]
          : allocation.shares.map((share) => ({
              centerId: share.costCenterId as string | null,
              shareBasisPoints: share.shareBasisPoints,
            }))
      if (allocation === null) unassigned.add(member.membershipId)
      const parts = splitStaffCost(
        cost,
        shares.map((share) => share.shareBasisPoints),
      )
      shares.forEach((share, index) => {
        const part = parts[index] ?? ZERO
        const key = share.centerId ?? ''
        const bucket = buckets.get(key) ?? { amounts: ZERO, staff: new Set<string>() }
        bucket.amounts = addAmounts(bucket.amounts, part)
        bucket.staff.add(member.membershipId)
        buckets.set(key, bucket)
        const personKey = `${member.membershipId}\u0000${key}`
        const person = persons.get(personKey) ?? {
          amounts: ZERO,
          shares: new Set<number>(),
          months: 0,
          flags: new Set<StaffCostFlag>(),
        }
        person.amounts = addAmounts(person.amounts, part)
        person.shares.add(share.shareBasisPoints)
        person.months += 1
        for (const flag of cost.flags) person.flags.add(flag)
        persons.set(personKey, person)
      })
    }
    monthRows.push({
      month,
      staffCount: monthStaff,
      ...monthAmounts,
      parameterSetId: parameters.setId,
      parameterOrigin: parameters.origin,
      stale: parameters.stale,
    })
  }

  const centerRows = [...buckets.entries()]
    .map(([key, bucket]) => {
      const center = key === '' ? undefined : centerById.get(key)
      return {
        id: key === '' ? null : key,
        code: center?.code ?? null,
        name: center?.name ?? UNASSIGNED,
        type: center?.type ?? null,
        path: center === undefined ? null : costCenterPath(centerById, center.id),
        isActive: center?.isActive ?? true,
        staffIds: bucket.staff,
        amounts: bucket.amounts,
      }
    })
    .sort((a, b) =>
      a.path === null ? 1 : b.path === null ? -1 : a.path.localeCompare(b.path, 'tr'),
    )
  const visible = input.people
    ? centerRows.map((row) => ({ ...row, suppressed: false }))
    : suppressSmallGroups(centerRows, (row) => row.staffIds, minGroupSize)

  const totals = [...buckets.values()].reduce(
    (sum, bucket) => addAmounts(sum, bucket.amounts),
    ZERO,
  )
  return {
    from: input.from,
    to: input.to,
    people: input.people,
    minGroupSize,
    centers: visible.map(({ staffIds, amounts, suppressed, ...row }) => ({
      ...row,
      staffCount: staffIds.size,
      suppressed,
      ...(suppressed
        ? {
            grossCents: null,
            employerSgkCents: null,
            unemploymentCents: null,
            benefitsCents: null,
            totalCents: null,
          }
        : amounts),
    })),
    persons: input.people ? personRows(persons, staffById, centerById) : null,
    months: monthRows,
    totals: { ...totals, staffCount: included.size },
    warnings: {
      netWageStaffCount: netWage.size,
      missingHoursStaffCount: missingHours.size,
      assignedWithoutRateCount: [...assigned].filter((id) => !included.has(id)).length,
      unassignedStaffCount: unassigned.size,
      staleMonths: monthRows.filter((row) => row.stale).map((row) => row.month),
      unverifiedParameters: months.some((month) => input.parameters.get(month)?.unverified),
    },
  }
}

function personRows(
  persons: ReadonlyMap<string, PersonBucket>,
  staffById: ReadonlyMap<string, StaffCostMember>,
  centerById: ReadonlyMap<string, StaffCostCenter>,
): StaffCostPersonRow[] {
  return [...persons.entries()]
    .map(([key, person]): StaffCostPersonRow => {
      const [membershipId = '', centerKey = ''] = key.split('\u0000')
      const member = staffById.get(membershipId)
      const center = centerKey === '' ? undefined : centerById.get(centerKey)
      const [onlyShare] = person.shares
      return {
        membershipId,
        name: member?.name ?? membershipId,
        role: member?.role ?? '',
        centerId: centerKey === '' ? null : centerKey,
        centerName: center === undefined ? UNASSIGNED : `${center.code} · ${center.name}`,
        shareBasisPoints: person.shares.size === 1 ? (onlyShare ?? null) : null,
        monthCount: person.months,
        flags: STAFF_COST_FLAGS.filter((flag) => person.flags.has(flag)),
        ...person.amounts,
      }
    })
    .sort(
      (a, b) =>
        (a.centerId === null ? 1 : 0) - (b.centerId === null ? 1 : 0) ||
        a.centerName.localeCompare(b.centerName, 'tr') ||
        a.name.localeCompare(b.name, 'tr') ||
        a.membershipId.localeCompare(b.membershipId),
    )
}

// --- Gösterim ve CSV -----------------------------------------------------------------------------

const roleText = (role: string) => (isStaffRole(role) ? STAFF_ROLE_LABELS[role] : role)

/** Raporun uyarı ve varsayım notları (ekran ve CSV aynı metni kullanır). */
export function staffCostNotes(report: StaffCostReport): string[] {
  const { warnings } = report
  const notes = [
    'Tutarlar bordro değil, tahmindir: brüt ücret, SGK işveren payı (prim indirimi düşülmüş) ve işsizlik sigortası işveren payı (SGK tavanına kadar) ile yan hakların toplamıdır.',
  ]
  if (!report.people)
    notes.push(
      `Personeli ${String(report.minGroupSize)}'ten az olan merkezlerin tutarları gizlenir; kişi satırlarıyla görüntüleme denetim kaydına yazılır.`,
    )
  if (warnings.netWageStaffCount > 0)
    notes.push(
      `${String(warnings.netWageStaffCount)} personelin ana ücreti net tanımlı: brüte çevrilmediği için dahil edilmedi.`,
    )
  if (warnings.missingHoursStaffCount > 0)
    notes.push(
      `${String(warnings.missingHoursStaffCount)} personelin saatli ücretinin tahmini aylık saati girilmemiş: o ücret dahil edilmedi.`,
    )
  if (warnings.unassignedStaffCount > 0)
    notes.push(
      `${String(warnings.unassignedStaffCount)} personelin maliyet merkezi ataması yok: maliyeti "Atanmamış" satırındadır.`,
    )
  if (warnings.assignedWithoutRateCount > 0)
    notes.push(
      `${String(warnings.assignedWithoutRateCount)} personelin ataması var ama dönemde ücret tanımı yok.`,
    )
  if (warnings.staleMonths.length > 0)
    notes.push(
      'Bazı aylarda yılın bordro parametresi tanımlı olmadığı için son bilinen set kullanıldı.',
    )
  if (warnings.unverifiedParameters)
    notes.push('Kullanılan platform parametrelerinden bazıları doğrulanmalı (M-40).')
  return notes
}

const row = (cells: readonly string[]) => cells.join(CSV_SEPARATOR)
const maybe = (cents: number | null) => (cents === null ? csvCell('Küçük grup') : csvAmount(cents))
const AMOUNT_HEADERS = [
  'Brüt ücret',
  'SGK işveren payı',
  'İşsizlik işveren payı',
  'Yan haklar',
  'Tahmini toplam maliyet',
]

/** Raporun CSV dökümü (`;`, ondalık virgül, formül kaçışı); kişi satırları istenmişse ayrı tablo. */
export function staffCostCsv(report: StaffCostReport): string {
  const lines = [
    row([csvCell('Dönem'), csvCell(monthRangeLabel(report.from, report.to))]),
    '',
    row(['Merkez yolu', 'Merkez', 'Tür', 'Personel', ...AMOUNT_HEADERS].map(csvCell)),
    ...report.centers.map((center) =>
      row([
        csvCell(center.path ?? ''),
        csvCell(center.name),
        csvCell(center.type === null ? '' : COST_CENTER_TYPE_LABELS[center.type]),
        String(center.staffCount),
        maybe(center.grossCents),
        maybe(center.employerSgkCents),
        maybe(center.unemploymentCents),
        maybe(center.benefitsCents),
        maybe(center.totalCents),
      ]),
    ),
    row([
      csvCell('Kurum toplamı'),
      csvCell(''),
      csvCell(''),
      String(report.totals.staffCount),
      csvAmount(report.totals.grossCents),
      csvAmount(report.totals.employerSgkCents),
      csvAmount(report.totals.unemploymentCents),
      csvAmount(report.totals.benefitsCents),
      csvAmount(report.totals.totalCents),
    ]),
  ]
  if (report.persons !== null)
    lines.push(
      '',
      row(['Merkez', 'Personel', 'Rol', 'Pay', 'Ay', ...AMOUNT_HEADERS, 'Not'].map(csvCell)),
      ...report.persons.map((person) =>
        row([
          csvCell(person.centerName),
          csvCell(person.name),
          csvCell(roleText(person.role)),
          csvCell(
            person.shareBasisPoints === null ? 'değişti' : shareLabel(person.shareBasisPoints),
          ),
          String(person.monthCount),
          csvAmount(person.grossCents),
          csvAmount(person.employerSgkCents),
          csvAmount(person.unemploymentCents),
          csvAmount(person.benefitsCents),
          csvAmount(person.totalCents),
          csvCell(person.flags.map((flag) => STAFF_COST_FLAG_LABELS[flag]).join('; ')),
        ]),
      ),
    )
  lines.push('', ...staffCostNotes(report).map((note) => csvCell(note)))
  return `${lines.join('\r\n')}\r\n`
}
