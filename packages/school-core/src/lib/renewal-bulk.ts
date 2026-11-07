import { z } from 'zod'

import type { State } from '../data/seed.ts'
import { daySchema, requiredText, type MakeId, type Session } from './domain.ts'
import { itemFor } from './enrollment.ts'
import { DomainError } from './errors.ts'
import { latestContractTuition } from './renewal-ceiling.ts'
import {
  planRenewal,
  quoteRenewal,
  renewalQuoteSchema,
  renewalTuitionLimit,
  requireRenewalRole,
  type RenewalContext,
  type RenewalPrice,
} from './renewals.ts'

/**
 * Yeni yılın toplu yenileme planı (IST-105, ON-086; docs/domain/finans.md DOM-FIN-005, -013, -020…
 * -025; kayit-ve-crm.md DOM-KAY-025). Ücret, tavan, ödeme koşulu, burs ve kuruş dağıtımı burada
 * yeniden yazılmaz: her satır tek öğrenci kuralını (`quoteRenewal`, `planRenewal`) çalıştırır. Burada
 * yalnız yeni yıl listesinin satırı, toplu istek şeması ve satır sonucu vardır.
 */

/** Bir toplu istekteki en fazla öğrenci; kurum kilidi öğrenci başına alınır, sınır istek süresini tutar. */
export const RENEWAL_BULK_LIMIT = 100

export const RENEWAL_PLAN_STATUSES = ['not_planned', 'planned', 'completed', 'cancelled'] as const
export type RenewalPlanStatus = (typeof RENEWAL_PLAN_STATUSES)[number]

export const RENEWAL_PLAN_STATUS_LABELS: Readonly<Record<RenewalPlanStatus, string>> = {
  not_planned: 'Planı yapılmadı',
  planned: 'Planlandı',
  completed: 'Tamamlandı',
  cancelled: 'İptal',
}

/** Liste durumu → yenileme kaydının saklanan durumları. */
export const RENEWAL_STATUS_BY_PLAN: Readonly<
  Record<Exclude<RenewalPlanStatus, 'not_planned'>, readonly string[]>
> = {
  planned: ['Planlandı'],
  completed: ['Tamamlandı', 'Mezun'],
  cancelled: ['İptal'],
}

/** 12. sınıf yenilenmez, mezuniyeti tek öğrenci yolundan planlanır (DOM-KAY-022). */
export const LAST_GRADE = 12

const quoteFields = renewalQuoteSchema.shape

const bulkRowsSchema = z
  .array(z.strictObject({ studentId: requiredText, targetClassId: requiredText }))
  .min(1, 'En az bir öğrenci seçin.')
  .max(RENEWAL_BULK_LIMIT, `Bir seferde en fazla ${String(RENEWAL_BULK_LIMIT)} öğrenci işlenir.`)
  .refine(
    (rows) => new Set(rows.map((row) => row.studentId)).size === rows.length,
    'Aynı öğrenci iki kez seçilemez.',
  )

/** Ortak ödeme planı ve seçili satırlar; borç onayı (`debtApproved`) bilerek yoktur (DOM-KAY-025). */
export const renewalBulkPreviewSchema = z.strictObject({
  academicYear: quoteFields.academicYear,
  installmentCount: quoteFields.installmentCount,
  firstDueDate: daySchema,
  discounts: quoteFields.discounts,
  extras: quoteFields.extras,
  scholarshipProgramId: quoteFields.scholarshipProgramId,
  rows: bulkRowsSchema,
})
export type RenewalBulkPreviewInput = z.input<typeof renewalBulkPreviewSchema>
type RenewalBulkFields = z.output<typeof renewalBulkPreviewSchema>
type RenewalBulkRow = RenewalBulkFields['rows'][number]

export const renewalBulkPlanSchema = z.strictObject({
  ...renewalBulkPreviewSchema.shape,
  /** Önizlemenin tarifesi; yayımdaki sürüm değiştiyse satır 409 `tariff_changed` olur. */
  tariffId: requiredText,
})
export type RenewalBulkPlanInput = z.input<typeof renewalBulkPlanSchema>

/** Bir satırın tek öğrenci önizleme gövdesi. */
function renewalBulkRowQuote(data: RenewalBulkFields, row: RenewalBulkRow) {
  return {
    studentId: row.studentId,
    targetClassId: row.targetClassId,
    academicYear: data.academicYear,
    installmentCount: data.installmentCount,
    discounts: data.discounts,
    extras: data.extras,
    ...(data.scholarshipProgramId === undefined
      ? {}
      : { scholarshipProgramId: data.scholarshipProgramId }),
  }
}

/** Bir satırın tek öğrenci plan gövdesi; önizleme ve onay aynı gövdeyi çalıştırır. */
export function renewalBulkRowPlan(data: RenewalBulkFields, row: RenewalBulkRow, tariffId: string) {
  return {
    ...renewalBulkRowQuote(data, row),
    mode: 'renew' as const,
    tariffId,
    firstDueDate: data.firstDueDate,
  }
}

const DEBT_CODE = 'renewal_debt_unapproved'

/** Toplu yolda borç onayı verilmez: satır atlanır, karar tek öğrenci yolundadır (DOM-KAY-025). */
const DEBT_SKIP_MESSAGE =
  'Önceki yıldan öğrenim ücreti borcu var; yönetici onayı gerekir. Bu öğrenci tek tek planlanır.'

export interface RenewalBulkProblem {
  code: string
  message: string
}

/** Atlanan satır hata değildir: borçlu öğrenci kararı bekler, planı olan öğrenci zaten tamamdır. */
export function renewalBulkSkipped(code: string): boolean {
  return code === DEBT_CODE || code === 'renewal_already_exists'
}

/** Satırın sebep metni: borçta toplu yolun metni, öteki kurallarda core'un kendi iletisi. */
export function renewalBulkProblem(code: string, message: string): RenewalBulkProblem {
  return { code, message: code === DEBT_CODE ? DEBT_SKIP_MESSAGE : message }
}

/** Toplu istekte öğrenci başına değişmeyen fiyat girdileri; servis bir kez yükler. */
export type RenewalBulkContext = Omit<
  RenewalContext,
  'outstandingTuitionCents' | 'scholarshipStudentAwarded'
> & {
  /** Öğrenci → önceki yıllardan ödenmemiş öğrenim ücreti (kuruş); borcu olmayan yoktur. */
  debts: ReadonlyMap<string, number>
  /** Yenileme yılında arşivlenmemiş burs ataması olan öğrenciler (DOM-FIN-025). */
  scholarshipStudents?: ReadonlySet<string>
}

type TargetClass = {
  id: string
  name: string
  grade: number
  branchId: string
  section?: string
}

const sectionOf = (item: TargetClass) =>
  item.section ?? /-(.+)$/.exec(item.name)?.[1]?.trim() ?? null

/**
 * Önerilen hedef sınıf: aynı kampüste bir üst düzey; önce aynı şube adı (6-A → 7-A), yoksa tek
 * seçenek. Birden çok aday varsa öneri yoktur, kullanıcı seçer. Karar `renewalPreconditions`'ındır.
 */
export function suggestRenewalTarget<TClass extends TargetClass & { isActive?: boolean }>(
  classes: readonly TClass[],
  current: TargetClass,
): TClass | null {
  const options = classes.filter(
    (item) =>
      item.isActive !== false &&
      item.grade === current.grade + 1 &&
      item.branchId === current.branchId,
  )
  const section = sectionOf(current)
  const same = section === null ? undefined : options.find((item) => sectionOf(item) === section)
  return same ?? (options.length === 1 ? (options[0] ?? null) : null)
}

export interface RenewalCandidateLine {
  studentId: string
  classId: string
  grade: number
  targetClassId: string | null
  /** Hedef yıldan önceki son sözleşmenin yılı ve indirimsiz ücreti; sözleşmesi yoksa `null`. */
  previousContract: { academicYear: number; tuitionCents: number } | null
  /** Hedef düzeyin ilan ücreti; tarife veya düzey kalemi yoksa `null`. */
  announcedCents: number | null
  ceiling: RenewalPrice['ceiling'] | null
  /** Önerilen ücret: ilan ve tavanın küçüğü (plan boş tutarda bunu uygular). */
  suggestedTuitionCents: number | null
  outstandingTuitionCents: number
  planStatus: RenewalPlanStatus
  renewalId: string | null
  renewalNetCents: number | null
  /** Ücret hesaplanamıyorsa nedeni (ör. `price_index_missing`). */
  problem: RenewalBulkProblem | null
}

function planStatusOf(status: string): RenewalPlanStatus {
  if (RENEWAL_STATUS_BY_PLAN.completed.includes(status)) return 'completed'
  if (RENEWAL_STATUS_BY_PLAN.cancelled.includes(status)) return 'cancelled'
  return 'planned'
}

/**
 * Yeni yıl listesinin satırları: yazmaz, ücret ve tavan plan kuralından gelir (`renewalTuitionLimit`).
 * Tavan oranı eksik gibi ücret sorunu satırı düşürmez, `problem` olarak söylenir; kontenjan ve
 * tekillik önizlemenin işidir. Olmayan öğrenci satır üretmez.
 */
export function renewalCandidateLines(
  state: State,
  session: Session,
  input: { studentIds: readonly string[]; academicYear: number },
  context: RenewalBulkContext,
): RenewalCandidateLine[] {
  requireRenewalRole(session)
  if (input.academicYear <= state.academicYear)
    throw new DomainError(
      'renewal_year_invalid',
      'Yenileme için mevcut dönemden sonraki bir yıl seçin.',
    )
  const students = new Map(state.students.map((student) => [student.id, student]))
  const classes = new Map(state.classes.map((item) => [item.id, item]))
  const renewals = new Map(
    state.renewals
      .filter((item) => item.year === input.academicYear)
      .map((item) => [item.studentId, item]),
  )
  const { tariff } = context
  return input.studentIds.flatMap((studentId): RenewalCandidateLine[] => {
    const student = students.get(studentId)
    const current = student && classes.get(student.classId)
    if (!current) return []
    const targetGrade = current.grade + 1
    const renewal = renewals.get(studentId)
    const unpriced = {
      studentId,
      classId: current.id,
      grade: current.grade,
      targetClassId: suggestRenewalTarget(state.classes, current)?.id ?? null,
      previousContract: latestContractTuition(state, studentId, input.academicYear),
      announcedCents: null,
      ceiling: null,
      suggestedTuitionCents: null,
      outstandingTuitionCents: context.debts.get(studentId) ?? 0,
      planStatus: renewal ? planStatusOf(renewal.status) : ('not_planned' as const),
      renewalId: renewal?.id ?? null,
      renewalNetCents: renewal?.amount ?? null,
    }
    if (tariff === null)
      return [
        {
          ...unpriced,
          problem: {
            code: 'tariff_not_published',
            message: 'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.',
          },
        },
      ]
    const announcedCents = itemFor(tariff.items, 'tuition', String(targetGrade))?.amountCents
    if (announcedCents === undefined)
      return [
        {
          ...unpriced,
          problem: {
            code: 'tariff_tuition_missing',
            message: 'Tarifede bu düzey için öğrenim ücreti yok.',
          },
        },
      ]
    try {
      const { ceiling, maxTuitionCents } = renewalTuitionLimit(
        state,
        { studentId, targetGrade, year: input.academicYear, announcedCents },
        context,
      )
      return [
        {
          ...unpriced,
          announcedCents,
          ceiling,
          suggestedTuitionCents: maxTuitionCents,
          problem: null,
        },
      ]
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      return [
        { ...unpriced, announcedCents, problem: { code: error.code, message: error.message } },
      ]
    }
  })
}

export type RenewalBulkPreviewRow = RenewalBulkRow &
  (
    | { outcome: 'ready'; price: RenewalPrice; problem: null }
    | { outcome: 'skipped' | 'failed'; price: RenewalPrice | null; problem: RenewalBulkProblem }
  )

const problemOf = (error: DomainError): RenewalBulkProblem =>
  error.kind === 'not_found'
    ? { code: 'not_found', message: 'İstenen kayıt bulunamadı.' }
    : renewalBulkProblem(error.code, error.message)

/**
 * Toplu önizleme: yazmaz. Her satır tek öğrenci önizlemesini ve planını aynı State üzerinde sırayla
 * çalıştırır: öndeki satır sınıf ve burs kontenjanını doldurur, sonraki satır bunu görür; onaydaki
 * sonuç bu sırayla aynıdır. Borçlu öğrenci ücretiyle gösterilir, atlanır, yer tutmaz (DOM-KAY-025).
 * Çağıran State'i kaydetmez (`runReadOnly`). Öndeki satırın sözleşmesi de sonraki satıra görünür:
 * onayda satırlar sırayla işlenir, kardeşin o yılki kaydı aynı sırayla oluşur (DOM-FIN-022, K-22).
 */
export function previewRenewalBulk(
  state: State,
  session: Session,
  input: unknown,
  makeId: MakeId,
  now: string,
  context: RenewalBulkContext,
): RenewalBulkPreviewRow[] {
  requireRenewalRole(session)
  const data = renewalBulkPreviewSchema.parse(input)
  const { debts, scholarshipStudents, ...shared } = context
  let awardedCount = context.scholarshipAwardedCount ?? 0
  return data.rows.map((row): RenewalBulkPreviewRow => {
    const debtCents = debts.get(row.studentId) ?? 0
    const rowContext: RenewalContext = {
      ...shared,
      outstandingTuitionCents: debtCents,
      scholarshipAwardedCount: awardedCount,
      scholarshipStudentAwarded: scholarshipStudents?.has(row.studentId) ?? false,
    }
    let price: RenewalPrice | null = null
    try {
      price = quoteRenewal(state, session, renewalBulkRowQuote(data, row), rowContext)
      if (debtCents > 0)
        return {
          ...row,
          outcome: 'skipped',
          price,
          problem: renewalBulkProblem(DEBT_CODE, DEBT_SKIP_MESSAGE),
        }
      const planned = planRenewal(
        state,
        session,
        renewalBulkRowPlan(data, row, price.tariffId),
        makeId,
        now,
        { ...rowContext, approvedByUserId: session.userId ?? '' },
      )
      if (planned.scholarshipAward !== null) awardedCount += 1
      return { ...row, outcome: 'ready', price, problem: null }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      return {
        ...row,
        outcome: renewalBulkSkipped(error.code) ? 'skipped' : 'failed',
        price,
        problem: problemOf(error),
      }
    }
  })
}
