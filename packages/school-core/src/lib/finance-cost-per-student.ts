import { z } from 'zod'

import { CSV_SEPARATOR, csvAmount, csvCell } from './csv.ts'
import {
  COST_CENTER_TYPE_LABELS,
  costCenterPath,
  type CostCenterNode,
  type CostCenterType,
} from './finance-cost-centers.ts'
import { dayKey } from './format.ts'

/**
 * Öğrenci başı maliyet (docs/domain/finans.md DOM-FIN-065; ON-249, K24). Seçilen bütçe döneminin
 * gider satırları maliyet merkezlerine yazılıdır; ortak merkezlerin (birim) gideri bölüşüm
 * anahtarıyla kampüs ve program merkezlerine paylaştırılır. Rapor salt okurdur, kayıt değiştirmez,
 * kişi verisi taşımaz. Tutarlar kuruş tamsayıdır; bölüşümde kalan kuruşlar en büyük kalan
 * yöntemiyle dağıtılır, toplam korunur.
 *
 * Bölüşüm yukarıdan aşağıya yürür. Birimler saydamdır: birimin altındaki merkezler hesapta birimin
 * en yakın birim olmayan üst merkezine bağlı sayılır, birimin gideri o kapsamın ortak gideridir.
 * Kapsamın (kurum kökü ya da kampüs/program merkezi) paylaşılacak tutarı kapsama gelen pay, kapsam
 * merkezinin kendi gideri ve kapsamdaki birimlerin gideridir; öğrencisi olan alt kampüs/program
 * merkezlerine anahtarla bölünür. Öğrencili alt merkezi olmayan kapsamda tutar kapsamda kalır; kökte
 * kalan tutar "paylaştırılamayan" diye ayrıca verilir. Merkezin toplam maliyeti kendi ve altındaki
 * bütün giderler artı yukarıdan gelen paydır; öğrenci başı maliyet toplam ÷ öğrenci sayısıdır.
 */

/** Bölüşüm anahtarı: öğrenci sayısıyla orantılı (varsayılan) ya da eşit (K-100). */
export const COST_ALLOCATION_KEYS = ['students', 'equal'] as const
export type CostAllocationKey = (typeof COST_ALLOCATION_KEYS)[number]
export const COST_ALLOCATION_KEY_LABELS = {
  students: 'Öğrenci sayısına göre',
  equal: 'Eşit',
} as const satisfies Record<CostAllocationKey, string>

/**
 * Küçük grup bastırma (DOM-YTK-024'teki 5 öğrenci eşiği; K-102): öğrencisi bundan az olan merkezin
 * ve kampüsün öğrenci başı değeri gösterilmez. Toplam tutar ve öğrenci sayısı görünür kalır.
 */
export const COST_REPORT_MIN_GROUP = 5

/** Okuma uçlarının ortak sorgusu: bütçe dönemi ve bölüşüm anahtarı. */
export const costReportQuerySchema = z.strictObject({
  periodId: z.uuid('Bütçe dönemini seçin.'),
  key: z.enum(COST_ALLOCATION_KEYS, 'Bölüşüm anahtarını seçin.').default('students'),
})
export type CostReportQuery = z.output<typeof costReportQuerySchema>

// --- Dönemin öğrencileri -------------------------------------------------------------------------

/** Öğrenci kaydının okunan alanları; alanı olmayan eski kayıt aktiftir. */
export interface CostStudent {
  id: string
  classId?: string | null | undefined
  isActive?: boolean | undefined
  joinedAt?: string | null | undefined
}

export interface CostClass {
  id: string
  branchId?: string | null | undefined
  grade?: number | null | undefined
}

/** Kursiyerin kur bağı: dönemle kesişen, iptal edilmemiş gruptaki üyelik (servis süzer). */
export interface CostCourseMembership {
  studentId: string
  courseId: string
}

/** Dönemde sayılan öğrencinin kampüs ve program bağı. */
export interface PlacedStudent {
  id: string
  campusId: string | null
  gradeLevel: number | null
  courseIds: readonly string[]
}

const validDay = (value: string | null | undefined): string | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value)) ? dayKey(value) : null

/**
 * Dönemde kayıtlı öğrenciler (K-101). Öğrenci kayıt günü (`joinedAt`, yoksa sınırsız) dönem
 * bitişinden sonra değilse ve ya aktifse ya da ayrılış/mezuniyet günü dönem başlangıcından önce
 * değilse sayılır; çıkış günü bilinmeyen pasif öğrenci sayılmaz. Kampüs ve sınıf düzeyi öğrencinin
 * güncel sınıfından okunur (sınıf geçmişi tutulmaz); kur bağı dönemle kesişen grup üyeliğidir.
 */
export function periodStudents(input: {
  period: { startDate: string; endDate: string }
  students: readonly CostStudent[]
  classes: readonly CostClass[]
  /** Öğrenci → çıkış günü (`YYYY-MM-DD`): ayrılış günü ya da mezuniyet geçişi günü. */
  exits: ReadonlyMap<string, string>
  memberships: readonly CostCourseMembership[]
}): PlacedStudent[] {
  const classes = new Map(input.classes.map((item) => [item.id, item]))
  const courses = new Map<string, Set<string>>()
  for (const membership of input.memberships) {
    const set = courses.get(membership.studentId)
    if (set) set.add(membership.courseId)
    else courses.set(membership.studentId, new Set([membership.courseId]))
  }
  const placed: PlacedStudent[] = []
  for (const student of input.students) {
    const joined = validDay(student.joinedAt)
    if (joined !== null && joined > input.period.endDate) continue
    if (student.isActive === false) {
      const exit = input.exits.get(student.id)
      if (exit === undefined || exit < input.period.startDate) continue
    }
    const cls = student.classId ? classes.get(student.classId) : undefined
    const grade = cls?.grade
    placed.push({
      id: student.id,
      campusId: cls?.branchId ? cls.branchId : null,
      gradeLevel: typeof grade === 'number' && Number.isInteger(grade) ? grade : null,
      courseIds: [...(courses.get(student.id) ?? [])].sort(),
    })
  }
  return placed.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// --- Bölüşüm -------------------------------------------------------------------------------------

/**
 * Tutarı ağırlıklarla böler; kalan kuruşlar en büyük kesirden başlayarak, eşitlikte sıra önce
 * olana birer verilir. Ağırlık toplamı sıfırsa herkes sıfır alır (çağıran kontrol eder).
 */
export function splitByWeights(amountCents: number, weights: readonly number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0 || amountCents === 0) return weights.map(() => 0)
  const exact = weights.map((weight) => (amountCents * weight) / total)
  const shares = exact.map((value) => Math.floor(value))
  let remainder = amountCents - shares.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
  for (const { index } of order) {
    if (remainder <= 0) break
    shares[index] = (shares[index] ?? 0) + 1
    remainder -= 1
  }
  return shares
}

/** Gider satırı: merkez ve planlanan tutar (yalnız gider kalemleri). */
export interface CostExpenseLine {
  costCenterId: string
  amountCents: number
}

export interface CostCenterInfo extends CostCenterNode {
  name: string
}

export interface CostCenterResult {
  id: string
  code: string
  name: string
  type: CostCenterType
  path: string
  /** Kökten düzey, 1'den başlar (girinti için). */
  depth: number
  isActive: boolean
  campusId: string | null
  /** Merkeze doğrudan yazılmış gider. */
  directCents: number
  /** Birimde: payı kapsamdaki merkezlere dağıtıldı mı. Kampüs ve programda `false`. */
  shared: boolean
  /** Yukarıdaki ortak giderden merkeze düşen pay (birimde 0). */
  sharedInCents: number
  /** Merkezin ve altındaki bütün giderler artı gelen pay (birimde kendi gideri). */
  totalCents: number
  /** Birimde `null`. */
  studentCount: number | null
  /** Öğrencisi yoksa ya da küçük grupsa `null`. */
  perStudentCents: number | null
  suppressed: boolean
}

export interface CostPerStudentReport {
  key: CostAllocationKey
  minGroupSize: number
  centers: CostCenterResult[]
  totals: {
    expenseCents: number
    studentCount: number
    perStudentCents: number | null
    suppressed: boolean
    /** Kökteki ortak gider öğrencili merkez olmadığı için paylaştırılamadı. */
    unallocatedCents: number
    /** Kampüs bağı olmayan (sınıfı ya da sınıfın kampüsü yok) öğrenci sayısı. */
    studentsWithoutCampus: number
  }
}

const isBearer = (type: CostCenterType) => type !== 'unit'

function perStudent(totalCents: number, count: number | null) {
  if (count === null || count === 0) return { perStudentCents: null, suppressed: false }
  if (count < COST_REPORT_MIN_GROUP) return { perStudentCents: null, suppressed: true }
  return { perStudentCents: Math.round(totalCents / count), suppressed: false }
}

const ROOT = ''

/**
 * Öğrenci başı maliyet raporu. `centers` kurumun bütün merkezleridir (pasifler dahil); satır listesi
 * etkin merkezlerle tutarı olan pasif merkezlerdir, hiyerarşi yoluna göre sıralanır.
 */
export function costPerStudent(input: {
  key: CostAllocationKey
  centers: readonly CostCenterInfo[]
  lines: readonly CostExpenseLine[]
  students: readonly PlacedStudent[]
}): CostPerStudentReport {
  const byId = new Map(input.centers.map((center) => [center.id, center]))
  const direct = new Map<string, number>()
  let expenseCents = 0
  for (const line of input.lines) {
    expenseCents += line.amountCents
    if (byId.has(line.costCenterId))
      direct.set(line.costCenterId, (direct.get(line.costCenterId) ?? 0) + line.amountCents)
  }
  const directOf = (id: string) => direct.get(id) ?? 0

  // Birim saydam: merkezin kapsamı en yakın kampüs/program üst merkezidir, yoksa kök.
  const scopeOf = new Map<string, string>()
  const campusOf = new Map<string, string | null>()
  for (const center of input.centers) {
    let cursor = center.parentId
    let scope: string | null = null
    let campus: string | null = null
    for (let steps = 0; cursor !== null && steps <= byId.size; steps += 1) {
      const parent = byId.get(cursor)
      if (parent === undefined) break
      if (scope === null && isBearer(parent.type)) scope = parent.id
      if (campus === null && parent.type === 'campus') campus = parent.campusId
      cursor = parent.parentId
    }
    scopeOf.set(center.id, scope ?? ROOT)
    campusOf.set(center.id, center.type === 'campus' ? center.campusId : campus)
  }
  const bearersIn = new Map<string, string[]>()
  const unitsIn = new Map<string, string[]>()
  for (const center of [...input.centers].sort((a, b) => (a.code < b.code ? -1 : 1))) {
    const scope = scopeOf.get(center.id) ?? ROOT
    const target = isBearer(center.type) ? bearersIn : unitsIn
    const list = target.get(scope)
    if (list) list.push(center.id)
    else target.set(scope, [center.id])
  }

  // Öğrenci kümeleri: bağlı merkezde bağ ∩ kampüs kısıtı, bağsız programda alt merkezlerin birleşimi.
  const studentSets = new Map<string, Set<string>>()
  const visiting = new Set<string>()
  const studentsOf = (id: string): Set<string> => {
    const known = studentSets.get(id)
    if (known) return known
    const center = byId.get(id)
    const set = new Set<string>()
    if (center === undefined || visiting.has(id)) return set
    visiting.add(id)
    const campus = campusOf.get(id) ?? null
    const inCampus = (student: PlacedStudent) => campus === null || student.campusId === campus
    if (center.type === 'campus') {
      for (const student of input.students)
        if (student.campusId === center.campusId) set.add(student.id)
    } else if (center.gradeLevel !== null) {
      for (const student of input.students)
        if (student.gradeLevel === center.gradeLevel && inCampus(student)) set.add(student.id)
    } else if (center.courseId !== null) {
      const course = center.courseId
      for (const student of input.students)
        if (student.courseIds.includes(course) && inCampus(student)) set.add(student.id)
    } else if (center.type === 'program') {
      for (const child of bearersIn.get(id) ?? []) for (const s of studentsOf(child)) set.add(s)
    }
    visiting.delete(id)
    studentSets.set(id, set)
    return set
  }

  // Alt ağaç gideri (birimler saydam): merkez + kapsamındaki birimler + alt kampüs/programlar.
  const subtree = new Map<string, number>()
  const subtreeOf = (scope: string, guard: number): number => {
    const known = subtree.get(scope)
    if (known !== undefined) return known
    if (guard > byId.size) return 0
    let total = scope === ROOT ? 0 : directOf(scope)
    for (const unit of unitsIn.get(scope) ?? []) total += directOf(unit)
    for (const child of bearersIn.get(scope) ?? []) total += subtreeOf(child, guard + 1)
    subtree.set(scope, total)
    return total
  }

  const sharedIn = new Map<string, number>()
  let unallocatedCents = 0
  const distribute = (scope: string, inflow: number, guard: number) => {
    if (guard > byId.size) return
    let shareable = inflow + (scope === ROOT ? 0 : directOf(scope))
    for (const unit of unitsIn.get(scope) ?? []) shareable += directOf(unit)
    const children = bearersIn.get(scope) ?? []
    const receivers = children.filter((child) => studentsOf(child).size > 0)
    const weights = receivers.map((child) =>
      input.key === 'students' ? studentsOf(child).size : 1,
    )
    const shares = receivers.length > 0 ? splitByWeights(shareable, weights) : []
    if (receivers.length === 0 && scope === ROOT) unallocatedCents = shareable
    for (const child of children) {
      const index = receivers.indexOf(child)
      const share = index === -1 ? 0 : (shares[index] ?? 0)
      sharedIn.set(child, share)
      distribute(child, share, guard + 1)
    }
  }
  distribute(ROOT, 0, 0)

  const pathOf = new Map(
    input.centers.map((center) => [center.id, costCenterPath(byId, center.id)]),
  )
  const rows: CostCenterResult[] = input.centers
    .map((center): CostCenterResult => {
      const bearer = isBearer(center.type)
      const incoming = bearer ? (sharedIn.get(center.id) ?? 0) : 0
      const totalCents = bearer ? subtreeOf(center.id, 0) + incoming : directOf(center.id)
      const studentCount = bearer ? studentsOf(center.id).size : null
      const path = pathOf.get(center.id) ?? center.code
      return {
        id: center.id,
        code: center.code,
        name: center.name,
        type: center.type,
        path,
        depth: path.split(' / ').length,
        isActive: center.isActive,
        campusId: campusOf.get(center.id) ?? null,
        directCents: directOf(center.id),
        shared: !bearer,
        sharedInCents: incoming,
        totalCents,
        studentCount,
        ...(bearer
          ? perStudent(totalCents, studentCount)
          : { perStudentCents: null, suppressed: false }),
      }
    })
    .filter((row) => row.isActive || row.totalCents !== 0 || row.directCents !== 0)
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

  const studentCount = input.students.length
  return {
    key: input.key,
    minGroupSize: COST_REPORT_MIN_GROUP,
    centers: rows,
    totals: {
      expenseCents,
      studentCount,
      ...perStudent(expenseCents, studentCount),
      unallocatedCents,
      studentsWithoutCampus: input.students.filter((student) => student.campusId === null).length,
    },
  }
}

// --- CSV -----------------------------------------------------------------------------------------

const cellOrBlank = (cents: number | null) => (cents === null ? csvCell('') : csvAmount(cents))

/** Rapor tablosunun CSV dökümü (`;`, ondalık virgül); kişi verisi taşımaz. */
export function costPerStudentCsv(report: CostPerStudentReport): string {
  const header = [
    'Merkez',
    'Ad',
    'Tür',
    'Doğrudan gider',
    'Ortak giderden pay',
    'Toplam maliyet',
    'Öğrenci',
    'Öğrenci başı maliyet',
  ]
  const rows = report.centers.map((row) => [
    csvCell(row.path),
    csvCell(row.name),
    csvCell(
      row.shared
        ? `${COST_CENTER_TYPE_LABELS[row.type]} (paylaştırıldı)`
        : COST_CENTER_TYPE_LABELS[row.type],
    ),
    csvAmount(row.directCents),
    row.shared ? csvCell('') : csvAmount(row.sharedInCents),
    csvAmount(row.totalCents),
    row.studentCount === null ? csvCell('') : String(row.studentCount),
    row.suppressed ? csvCell('Küçük grup') : cellOrBlank(row.perStudentCents),
  ])
  const total = [
    csvCell('Kurum toplamı'),
    csvCell(''),
    csvCell(''),
    csvAmount(report.totals.expenseCents),
    csvCell(''),
    csvAmount(report.totals.expenseCents),
    String(report.totals.studentCount),
    report.totals.suppressed ? csvCell('Küçük grup') : cellOrBlank(report.totals.perStudentCents),
  ]
  return [header.map(csvCell), ...rows, total].map((row) => row.join(CSV_SEPARATOR)).join('\r\n')
}
