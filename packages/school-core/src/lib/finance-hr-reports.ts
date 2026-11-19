import type { Role } from '../modules/navigation.ts'
import { CSV_SEPARATOR, csvCell } from './csv.ts'
import { DomainError } from './errors.ts'
import { BOARD_REPORT_MIN_GROUP, suppressSmallGroups } from './finance-board-report.ts'
import { costCenterPath } from './finance-cost-centers.ts'
import {
  completedYears,
  leaveEntitlement,
  type LeaveKind,
  type LeaveProfile,
} from './finance-staff-leave.ts'
import {
  allocationInMonth,
  monthEnd,
  monthOf,
  monthRangeLabel,
  monthStart,
  shareLabel,
} from './finance-staff-costs.ts'
import { dateLabel } from './format.ts'
import { isStaffRole, type StaffRole } from './staff-accounts.ts'

/**
 * İK raporları (docs/domain/finans.md DOM-FIN-117; ON-192, K-400…K-402): seçilen ay aralığında
 * personel devir oranı, bugünkü kıdem dağılımı ve izin kullanımı. Hiçbir şey saklanmaz; kişi adı ve
 * kimliği taşımaz.
 *
 * - **Personel:** yönetici, öğretmen ve ön büro üyelikleri. Giriş günü izin profilindeki kıdem
 *   başlangıcıdır (ON-181), girilmemişse kurum üyeliğinin açıldığı gün; çıkış günü pasifleştirme
 *   günüdür (K-400). Kişi çıkış gününde çalışmış sayılır.
 * - **Devir oranı (K-400):** çıkış ÷ ortalama personel × 100, ortalama = (dönem başı + dönem
 *   sonu) ÷ 2. Dönem başı ilk günden önce girip ilk gün hâlâ çalışan, dönem sonu son gün
 *   (süren dönemde bugün) çıkmamış personeldir; dönem başı + giriş − çıkış = dönem sonu.
 * - **Kıdem (K-400):** dönem sonundaki personelin tam hizmet yılı bantları; kıdem başlangıcı
 *   yoksa "bilinmiyor".
 * - **İzin (K-402):** kullanılmış izin kayıtları başladığı güne göre döneme yazılır, iş günü olduğu
 *   gibi; rapor günleri (ON-185) yalnız kurum toplamıdır. Kalan bakiye dönem sonundaki personelin
 *   yıllık izin bakiyesi toplamıdır (DOM-FIN-109).
 * - **Küçük grup (K-401):** 1–4 kişilik kırılım `null` ve `suppressed` döner; toplamdan geri
 *   hesaplanmasın diye `suppressSmallGroups` (K-77) en küçük görünür kırılımı da gizler. Toplamın
 *   kendisi 1–4 kişiyse o da gizlenir.
 *
 * Fonksiyonlar saftır; bugün `today` (Europe/Istanbul günü) ile gelir.
 */

/** Rapor kişisel veri toplamıdır: yalnız yönetici (ücret ve izin verisiyle aynı, K-306). */
export const FINANCE_HR_REPORT_ROLES = ['yonetici'] as const satisfies readonly Role[]

/** Kırılımda bundan az kişi varsa gizlenir (K-77 eşiği). */
export const HR_REPORT_MIN_GROUP = BOARD_REPORT_MIN_GROUP

/** Gizli hücrenin metni: "<5". */
export const hrHiddenText = (minGroupSize: number) => `<${String(minGroupSize)}`

export const HR_TURNOVER_FORMULA =
  'Devir oranı = dönemdeki çıkış ÷ ortalama personel × 100; ortalama personel = (dönem başı + dönem sonu) ÷ 2.'

export const HR_ROLE_GROUPS = ['teacher', 'administrative'] as const
export type HrRoleGroup = (typeof HR_ROLE_GROUPS)[number]
export const HR_ROLE_GROUP_LABELS = {
  teacher: 'Öğretmen',
  administrative: 'İdari (yönetici ve ön büro)',
} as const satisfies Record<HrRoleGroup, string>

/** Öğretmen bir grup, yönetici ve ön büro idari personeldir. */
export const hrRoleGroupOf = (role: StaffRole): HrRoleGroup =>
  role === 'ogretmen' ? 'teacher' : 'administrative'

export const SENIORITY_BAND_KEYS = [
  'under_1',
  'from_1_to_3',
  'from_3_to_5',
  'from_5_to_10',
  'over_10',
  'unknown',
] as const
export type SeniorityBandKey = (typeof SENIORITY_BAND_KEYS)[number]
export const SENIORITY_BAND_LABELS = {
  under_1: '0–1 yıl',
  from_1_to_3: '1–3 yıl',
  from_3_to_5: '3–5 yıl',
  from_5_to_10: '5–10 yıl',
  over_10: '10 yıl ve üstü',
  unknown: 'Bilinmiyor',
} as const satisfies Record<SeniorityBandKey, string>

/** Tam hizmet yılının bandı; alt sınır dahil, üst sınır hariç (1 yıl dolan "1–3 yıl"). */
export function seniorityBandOf(years: number | null): SeniorityBandKey {
  if (years === null) return 'unknown'
  if (years < 1) return 'under_1'
  if (years < 3) return 'from_1_to_3'
  if (years < 5) return 'from_3_to_5'
  if (years < 10) return 'from_5_to_10'
  return 'over_10'
}

// --- Dönem ---------------------------------------------------------------------------------------

export interface HrReportPeriod {
  from: string
  to: string
  firstDay: string
  lastDay: string
  /** Hesabın bittiği gün: son gün ya da süren dönemde bugün. */
  endDay: string
}

/**
 * Ay aralığının günleri. Aralık (`to` ≥ `from`, en çok 12 ay) sorgu şemasında denetlenir; başlangıç
 * ayı bu aydan sonraysa 422 `hr_report_period_not_started`.
 */
export function hrReportPeriod(from: string, to: string, today: string): HrReportPeriod {
  const firstDay = monthStart(from)
  const lastDay = monthEnd(to)
  if (firstDay > today)
    throw new DomainError(
      'hr_report_period_not_started',
      'Dönem henüz başlamadı; başlangıç ayı bu aydan sonra olamaz.',
      { kind: 'rule', path: ['from'] },
    )
  return { from, to, firstDay, lastDay, endDay: lastDay < today ? lastDay : today }
}

// --- Girdiler ------------------------------------------------------------------------------------

export interface HrStaffMember {
  membershipId: string
  role: string
  /** Kurum üyeliğinin açıldığı gün (Europe/Istanbul). */
  joinedDay: string
  /** Pasifleştirme günü (Europe/Istanbul); etkin personelde `null`. */
  deactivatedDay: string | null
}

export interface HrLeaveProfile {
  membershipId: string
  profile: LeaveProfile
}

export interface HrAllocation {
  membershipId: string
  startMonth: string
  shares: readonly { costCenterId: string; shareBasisPoints: number }[]
}

export interface HrCostCenter {
  id: string
  code: string
  name: string
  parentId: string | null
  isActive: boolean
}

export interface HrLeaveType {
  code: string
  label: string
  kind: LeaveKind
  isActive: boolean
}

/** İptal edilmemiş kullanılmış izin kaydı (bütün dönemler; bakiye için de kullanılır). */
export interface HrLeaveRecord {
  membershipId: string
  typeCode: string
  kind: LeaveKind
  typeLabel: string
  deductsFromAnnual: boolean
  startDate: string
  days: number
}

/** Personelin dönemdeki rapor günü (`medicalReportDays`, ON-185); yalnız toplam okunur. */
export interface HrMedicalDays {
  membershipId: string
  totalDays: number
}

export interface HrReportInput {
  period: HrReportPeriod
  staff: readonly HrStaffMember[]
  profiles: readonly HrLeaveProfile[]
  allocations: readonly HrAllocation[]
  centers: readonly HrCostCenter[]
  leaveTypes: readonly HrLeaveType[]
  leaveRecords: readonly HrLeaveRecord[]
  medicalDays: readonly HrMedicalDays[]
  minGroupSize?: number
}

// --- Çıktı ---------------------------------------------------------------------------------------

export interface HrTurnoverCounts {
  opening: number
  hires: number
  exits: number
  closing: number
  /** (dönem başı + dönem sonu) ÷ 2; buçuklu olabilir. */
  averageHeadcount: number
  /** Devir oranı, on binde bir (1250 = %12,5); ortalama 0 ise `null`. */
  turnoverBasisPoints: number | null
}

type Hidden<T> = { [Key in keyof T]: T[Key] | null }
export type HrHiddenTurnover = Hidden<HrTurnoverCounts> & { suppressed: boolean }

export interface HrRoleRow extends HrHiddenTurnover {
  group: HrRoleGroup
}

export interface HrCenterRow extends HrHiddenTurnover {
  /** Atanmamış satırında `null`. */
  id: string | null
  code: string | null
  name: string
  path: string | null
  isActive: boolean
}

export interface HrSeniorityBand {
  key: SeniorityBandKey
  count: number | null
  suppressed: boolean
}

export interface HrLeaveTypeRow {
  code: string
  label: string
  kind: LeaveKind
  usedDays: number | null
  /** Bu türden izin kullanan farklı personel. */
  staffCount: number | null
  /** Kullanılan gün ÷ ortalama personel (bir ondalık). */
  perStaffDays: number | null
  suppressed: boolean
}

export interface HrReport {
  from: string
  to: string
  firstDay: string
  lastDay: string
  endDay: string
  minGroupSize: number
  turnover: {
    totals: HrHiddenTurnover
    byRole: HrRoleRow[]
    byCenter: HrCenterRow[]
  }
  seniority: {
    asOf: string
    total: number | null
    totalSuppressed: boolean
    bands: HrSeniorityBand[]
  }
  leave: {
    types: HrLeaveTypeRow[]
    totals: Omit<HrLeaveTypeRow, 'code' | 'label' | 'kind'>
    balance: {
      /** Dönem sonundaki personelden kıdem başlangıcı girilmiş olanlar. */
      staffCount: number | null
      balanceDays: number | null
      perStaffDays: number | null
      suppressed: boolean
      /** Dönem sonundaki personelden kıdem başlangıcı girilmemiş olanlar (bakiyeye girmez). */
      missingProfileCount: number
    }
    /** Rapor günleri (takvim günü), yalnız kurum toplamı; 1–4 kişide gizli. */
    medical: { totalDays: number | null; suppressed: boolean }
  }
  warnings: {
    /** Dönemdeki personelden kıdem başlangıcı girilmemiş olanlar. */
    missingSeniorityCount: number
  }
}

// --- Hesap ---------------------------------------------------------------------------------------

interface Person {
  membershipId: string
  group: HrRoleGroup
  start: string
  exit: string | null
  profile: LeaveProfile | null
}

const UNASSIGNED = 'Atanmamış'

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const list = map.get(key(item))
    if (list === undefined) map.set(key(item), [item])
    else list.push(item)
  }
  return map
}

const inPeriod = (person: Person, period: HrReportPeriod) =>
  person.start <= period.endDay && (person.exit === null || person.exit >= period.firstDay)
const atEnd = (person: Person, period: HrReportPeriod) =>
  person.start <= period.endDay && (person.exit === null || person.exit > period.endDay)

/** Kişi kümesinin dönem sayıları (K-400). */
export function turnoverCounts(
  persons: readonly Pick<Person, 'start' | 'exit'>[],
  period: Pick<HrReportPeriod, 'firstDay' | 'endDay'>,
): HrTurnoverCounts {
  let opening = 0
  let hires = 0
  let exits = 0
  let closing = 0
  for (const person of persons) {
    const present = person.exit === null || person.exit >= period.firstDay
    if (person.start < period.firstDay && present) opening += 1
    if (person.start >= period.firstDay && person.start <= period.endDay) hires += 1
    if (person.exit !== null && person.exit >= period.firstDay && person.exit <= period.endDay)
      exits += 1
    if (person.start <= period.endDay && (person.exit === null || person.exit > period.endDay))
      closing += 1
  }
  return {
    opening,
    hires,
    exits,
    closing,
    averageHeadcount: (opening + closing) / 2,
    turnoverBasisPoints:
      opening + closing === 0 ? null : Math.round((exits * 20_000) / (opening + closing)),
  }
}

const HIDDEN_TURNOVER: Hidden<HrTurnoverCounts> = {
  opening: null,
  hires: null,
  exits: null,
  closing: null,
  averageHeadcount: null,
  turnoverBasisPoints: null,
}

const isSmall = (size: number, minGroupSize: number) => size > 0 && size < minGroupSize
const oneDecimal = (value: number) => Math.round(value * 10) / 10

/** Personelin dönemdeki son ayı (çıkış ayı ya da dönem sonu ayı). */
const lastMonthOf = (person: Person, period: HrReportPeriod) =>
  monthOf(person.exit !== null && person.exit < period.endDay ? person.exit : period.endDay)

/** İK raporu (DOM-FIN-117). */
export function hrReport(input: HrReportInput): HrReport {
  const { period } = input
  const minGroupSize = input.minGroupSize ?? HR_REPORT_MIN_GROUP
  const profileOf = new Map(input.profiles.map((row) => [row.membershipId, row.profile]))
  const persons: Person[] = []
  for (const member of input.staff) {
    if (!isStaffRole(member.role)) continue
    const profile = profileOf.get(member.membershipId) ?? null
    const exit = member.deactivatedDay
    const known = profile?.seniorityStartDate ?? member.joinedDay
    persons.push({
      membershipId: member.membershipId,
      group: hrRoleGroupOf(member.role),
      // Pasifleştirmeden sonraki kıdem başlangıcı tutarsızdır; giriş çıkıştan sonra olamaz.
      start: exit !== null && exit < known ? exit : known,
      exit,
      profile,
    })
  }
  const population = persons.filter((person) => inPeriod(person, period))
  const ending = persons.filter((person) => atEnd(person, period))
  const totalCounts = turnoverCounts(population, period)
  const hidden = (size: number) => isSmall(size, minGroupSize)

  return {
    from: period.from,
    to: period.to,
    firstDay: period.firstDay,
    lastDay: period.lastDay,
    endDay: period.endDay,
    minGroupSize,
    turnover: {
      totals: hidden(population.length)
        ? { ...HIDDEN_TURNOVER, suppressed: true }
        : { ...totalCounts, suppressed: false },
      byRole: roleRows(population, period, minGroupSize),
      byCenter: centerRows(population, period, input, minGroupSize),
    },
    seniority: seniority(ending, period, minGroupSize),
    leave: leaveUsage(input, ending, totalCounts.averageHeadcount, minGroupSize),
    warnings: {
      missingSeniorityCount: population.filter((person) => person.profile === null).length,
    },
  }
}

/** Kırılım hücresi: satır bilgisi ve kişileri; bastırma kişi kimliklerinden sayılır. */
interface Cell<T> {
  row: T
  persons: Person[]
}

function turnoverOf<T>(
  cells: readonly Cell<T>[],
  period: HrReportPeriod,
  minGroupSize: number,
): (T & HrHiddenTurnover)[] {
  return suppressSmallGroups(
    cells,
    (cell) => cell.persons.map((person) => person.membershipId),
    minGroupSize,
  ).map(({ row, persons, suppressed }) => ({
    ...row,
    ...(suppressed ? HIDDEN_TURNOVER : turnoverCounts(persons, period)),
    suppressed,
  }))
}

function roleRows(
  population: readonly Person[],
  period: HrReportPeriod,
  minGroupSize: number,
): HrRoleRow[] {
  const cells = HR_ROLE_GROUPS.map((group) => ({
    row: { group },
    persons: population.filter((person) => person.group === group),
  }))
  return turnoverOf(cells, period, minGroupSize)
}

function centerRows(
  population: readonly Person[],
  period: HrReportPeriod,
  input: HrReportInput,
  minGroupSize: number,
): HrCenterRow[] {
  const centerById = new Map(input.centers.map((center) => [center.id, center]))
  const allocationsOf = groupBy(input.allocations, (allocation) => allocation.membershipId)
  const buckets = new Map<string, Person[]>()
  for (const person of population) {
    const allocation = allocationInMonth(
      allocationsOf.get(person.membershipId) ?? [],
      lastMonthOf(person, period),
    )
    const keys = new Set(
      (allocation?.shares ?? [])
        .filter((share) => share.shareBasisPoints > 0 && centerById.has(share.costCenterId))
        .map((share) => share.costCenterId),
    )
    if (keys.size === 0) keys.add('')
    for (const key of keys) buckets.set(key, [...(buckets.get(key) ?? []), person])
  }
  const cells = [...buckets.entries()]
    .map(([key, persons]) => {
      const center = key === '' ? undefined : centerById.get(key)
      return {
        row: {
          id: center?.id ?? null,
          code: center?.code ?? null,
          name: center?.name ?? UNASSIGNED,
          path: center === undefined ? null : costCenterPath(centerById, center.id),
          isActive: center?.isActive ?? true,
        },
        persons,
      }
    })
    .sort((a, b) =>
      a.row.path === null
        ? 1
        : b.row.path === null
          ? -1
          : a.row.path.localeCompare(b.row.path, 'tr'),
    )
  return turnoverOf(cells, period, minGroupSize)
}

function seniority(ending: readonly Person[], period: HrReportPeriod, minGroupSize: number) {
  const cells = SENIORITY_BAND_KEYS.map((key) => ({ key, members: new Set<string>() }))
  const cellOf = new Map(cells.map((cell) => [cell.key, cell]))
  for (const person of ending) {
    const years =
      person.profile === null
        ? null
        : completedYears(person.profile.seniorityStartDate, period.endDay)
    cellOf.get(seniorityBandOf(years))?.members.add(person.membershipId)
  }
  const totalSuppressed = isSmall(ending.length, minGroupSize)
  return {
    asOf: period.endDay,
    total: totalSuppressed ? null : ending.length,
    totalSuppressed,
    bands: suppressSmallGroups(cells, (cell) => cell.members, minGroupSize).map(
      ({ key, members, suppressed }) => ({
        key,
        count: suppressed ? null : members.size,
        suppressed,
      }),
    ),
  }
}

function leaveUsage(
  input: HrReportInput,
  ending: readonly Person[],
  averageHeadcount: number,
  minGroupSize: number,
): HrReport['leave'] {
  const { period } = input
  const perStaff = (days: number) =>
    averageHeadcount === 0 ? null : oneDecimal(days / averageHeadcount)
  const inRange = input.leaveRecords.filter(
    (record) =>
      record.kind !== 'sick' &&
      record.startDate >= period.firstDay &&
      record.startDate <= period.endDay,
  )
  const byCode = groupBy(inRange, (record) => record.typeCode)
  const known = new Set(input.leaveTypes.map((type) => type.code))
  const types = [
    ...input.leaveTypes
      .filter((type) => type.kind !== 'sick' && (type.isActive || byCode.has(type.code)))
      .map((type) => ({ code: type.code, label: type.label, kind: type.kind })),
    ...[...byCode.entries()]
      .filter(([code]) => !known.has(code))
      .map(([code, records]) => {
        const [first] = records
        return {
          code,
          label: first?.typeLabel ?? code,
          kind: first?.kind ?? ('other' as const),
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'tr')),
  ]
  const cells = types.map((type) => {
    const records = byCode.get(type.code) ?? []
    return {
      ...type,
      days: records.reduce((sum, record) => sum + record.days, 0),
      members: new Set(records.map((record) => record.membershipId)),
    }
  })
  const totalDays = inRange.reduce((sum, record) => sum + record.days, 0)
  const users = new Set(inRange.map((record) => record.membershipId))
  const totalSuppressed = isSmall(users.size, minGroupSize)

  const recordsOf = groupBy(input.leaveRecords, (record) => record.membershipId)
  const withProfile = ending.filter((person) => person.profile !== null)
  const balanceDays = withProfile.reduce((sum, person) => {
    if (person.profile === null) return sum
    const usages = recordsOf.get(person.membershipId) ?? []
    return sum + leaveEntitlement(person.profile, usages, period.endDay, person.exit).balanceDays
  }, 0)
  const balanceSuppressed = isSmall(withProfile.length, minGroupSize)

  const medicalStaff = input.medicalDays.filter((row) => row.totalDays > 0)
  const medicalSuppressed = isSmall(medicalStaff.length, minGroupSize)

  return {
    types: suppressSmallGroups(cells, (cell) => cell.members, minGroupSize).map(
      ({ code, label, kind, days, members, suppressed }) => ({
        code,
        label,
        kind,
        usedDays: suppressed ? null : days,
        staffCount: suppressed ? null : members.size,
        perStaffDays: suppressed ? null : perStaff(days),
        suppressed,
      }),
    ),
    totals: {
      usedDays: totalSuppressed ? null : totalDays,
      staffCount: totalSuppressed ? null : users.size,
      perStaffDays: totalSuppressed ? null : perStaff(totalDays),
      suppressed: totalSuppressed,
    },
    balance: {
      staffCount: balanceSuppressed ? null : withProfile.length,
      balanceDays: balanceSuppressed ? null : balanceDays,
      perStaffDays:
        balanceSuppressed || withProfile.length === 0
          ? null
          : oneDecimal(balanceDays / withProfile.length),
      suppressed: balanceSuppressed,
      missingProfileCount: ending.length - withProfile.length,
    },
    medical: {
      totalDays: medicalSuppressed
        ? null
        : medicalStaff.reduce((sum, row) => sum + row.totalDays, 0),
      suppressed: medicalSuppressed,
    },
  }
}

// --- Gösterim ve CSV -----------------------------------------------------------------------------

const decimal = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 })
/** "12,5"; `null` boş. */
export const hrDecimalText = (value: number | null) => (value === null ? '' : decimal.format(value))
/** "%12,5"; ortalama 0 ise tire. */
export const hrRateText = (basisPoints: number | null) =>
  basisPoints === null ? '—' : shareLabel(basisPoints)
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })

/** Dönem metni; süren dönemde "… (bugüne kadar)". */
export const hrPeriodLabel = (report: Pick<HrReport, 'from' | 'to' | 'endDay' | 'lastDay'>) =>
  `${monthRangeLabel(report.from, report.to)}${report.endDay < report.lastDay ? ` (${dayText(report.endDay)} itibarıyla)` : ''}`

/** Raporun varsayım ve uyarı notları (ekran, CSV ve PDF aynı metni kullanır). */
export function hrReportNotes(report: HrReport): string[] {
  const hiddenText = hrHiddenText(report.minGroupSize)
  const notes = [
    HR_TURNOVER_FORMULA,
    `Kişi adı yazılmaz. ${String(report.minGroupSize)} kişiden az personelli kırılım "${hiddenText}" gösterilir; toplamdan geri hesaplanmasın diye en küçük görünür kırılım da gizlenir.`,
    'Giriş günü kıdem başlangıcıdır, girilmemişse personel hesabının açıldığı gündür; çıkış günü pasifleştirme günüdür. Yeniden etkinleştirilen personelin önceki çıkışı sayılmaz.',
    'Maliyet merkezi kırılımı personelin dönemdeki son ayının atamasıyla yapılır; birden çok merkeze paylı personel her merkezinde sayılır.',
    'İzin günleri izin başladığı güne göre döneme yazılır (iş günü). Rapor günleri yalnız kurum toplamıdır (takvim günü); kişi bazlı sağlık verisi raporda yoktur.',
  ]
  if (report.warnings.missingSeniorityCount > 0)
    notes.push(
      `${String(report.warnings.missingSeniorityCount)} personelin kıdem başlangıcı girilmemiş: girişi hesabın açıldığı gündür, kıdem bandı "Bilinmiyor", izin bakiyesine girmez.`,
    )
  return notes
}

const row = (cells: readonly string[]) => cells.join(CSV_SEPARATOR)
const countCell = (value: number | null, hiddenText: string) =>
  value === null ? csvCell(hiddenText) : String(value)

function turnoverCells(counts: HrHiddenTurnover, hiddenText: string): string[] {
  if (counts.suppressed) return Array.from({ length: 6 }, () => csvCell(hiddenText))
  return [
    String(counts.opening),
    String(counts.hires),
    String(counts.exits),
    String(counts.closing),
    csvCell(hrDecimalText(counts.averageHeadcount)),
    csvCell(hrRateText(counts.turnoverBasisPoints)),
  ]
}

/** Raporun CSV dökümü (`;`, ondalık virgül, formül kaçışı); kişi satırı yoktur. */
export function hrReportCsv(report: HrReport): string {
  const hiddenText = hrHiddenText(report.minGroupSize)
  const { turnover, seniority: bands, leave } = report
  const lines = [
    row([csvCell('Dönem'), csvCell(hrPeriodLabel(report))]),
    '',
    row(
      [
        'Kırılım',
        'Grup',
        'Dönem başı',
        'Giriş',
        'Çıkış',
        'Dönem sonu',
        'Ortalama personel',
        'Devir oranı',
      ].map(csvCell),
    ),
    row([csvCell('Kurum'), csvCell('Toplam'), ...turnoverCells(turnover.totals, hiddenText)]),
    ...turnover.byRole.map((item) =>
      row([
        csvCell('Rol'),
        csvCell(HR_ROLE_GROUP_LABELS[item.group]),
        ...turnoverCells(item, hiddenText),
      ]),
    ),
    ...turnover.byCenter.map((item) =>
      row([
        csvCell('Maliyet merkezi'),
        csvCell(item.path === null ? item.name : `${item.path} · ${item.name}`),
        ...turnoverCells(item, hiddenText),
      ]),
    ),
    '',
    row([csvCell('Kıdem bandı'), csvCell(`Personel (${dayText(bands.asOf)})`)]),
    ...bands.bands.map((band) =>
      row([csvCell(SENIORITY_BAND_LABELS[band.key]), countCell(band.count, hiddenText)]),
    ),
    row([csvCell('Toplam'), countCell(bands.total, hiddenText)]),
    '',
    row(['İzin türü', 'Kullanılan gün', 'Kullanan personel', 'Personel başına gün'].map(csvCell)),
    ...leave.types.map((type) =>
      row([
        csvCell(type.label),
        countCell(type.usedDays, hiddenText),
        countCell(type.staffCount, hiddenText),
        type.suppressed ? csvCell(hiddenText) : csvCell(hrDecimalText(type.perStaffDays)),
      ]),
    ),
    row([
      csvCell('Toplam'),
      countCell(leave.totals.usedDays, hiddenText),
      countCell(leave.totals.staffCount, hiddenText),
      leave.totals.suppressed
        ? csvCell(hiddenText)
        : csvCell(hrDecimalText(leave.totals.perStaffDays)),
    ]),
    '',
    row([
      csvCell('Kalan yıllık izin bakiyesi (gün)'),
      countCell(leave.balance.balanceDays, hiddenText),
    ]),
    row([csvCell('Bakiyesi hesaplanan personel'), countCell(leave.balance.staffCount, hiddenText)]),
    row([csvCell('Rapor günleri (toplam)'), countCell(leave.medical.totalDays, hiddenText)]),
  ]
  lines.push('', ...hrReportNotes(report).map((note) => csvCell(note)))
  return `${lines.join('\r\n')}\r\n`
}

/** Dosya adı: `ik-raporu-2026-01-2026-10.csv`. */
export const hrReportFilename = (from: string, to: string, extension: 'csv' | 'pdf') =>
  `ik-raporu-${from}${from === to ? '' : `-${to}`}.${extension}`
