import type { ProgressionDecisionRecord, ProgressionOutcome } from '../cefr/progression.ts'
import type { CefrLevel } from '../content/taxonomy.ts'
import type { EnrollmentTariff } from './enrollment.ts'
import { DomainError } from './errors.ts'
import {
  packageTariffPrice,
  type LessonPackage,
  type PackageCourse,
  type PackageKind,
} from './finance-packages.ts'
import {
  COURSE_OFFER_MESSAGES,
  renewalCourseOffer,
  type CourseOfferCourse,
  type CourseOfferEnrollment,
} from './renewal-course-offer.ts'

/**
 * Kur yenileme ve üst kur teklif listesi (IST-088, ON-082; docs/domain/dil-okulu.md DOM-DIL-070,
 * DOM-DIL-071, DOM-DIL-050; finans.md DOM-FIN-020). Kur sonunda ön büro, son kurunun geçerli kararı
 * onaylı kursiyerleri görür: karar sonucu, son kur, teklif edilen kur ve seviye, teklife uyan
 * paketlerin kurum tarifesinden indirimsiz fiyatı. Kararın dayanağı ON-295'in `renewalCourseOffer`
 * işlevidir; onay bekleyen ya da hiç verilmemiş karar listeye girmez. Teklif paket satışıyla açılır
 * (`sellPackage`): indirim yalnız tarifede ilanlı türden seçilir, serbest indirim yoktur. Satırda
 * kararın gerekçesi, dayanağı ve öğretmen notu yoktur; yalnız kursiyerin kendi kararının sonucu
 * vardır. Saftır.
 */

/** Listeyi yönetici ve ön büro okur; teklifi paket satışı açar (`PACKAGE_SELL_ROLES`). */
export const COURSE_OFFER_LIST_ROLES = ['yonetici', 'onburo'] as const

export interface CourseOfferStudent {
  id: string
  name: string
  /** Pasif (ayrılmış) kursiyere teklif açılmaz; listede yoktur. */
  isActive: boolean
}

export type CourseOfferListCourse = CourseOfferCourse &
  Pick<PackageCourse, 'totalHours' | 'status'> & { name: string }

/** Kursiyerin paket satışı; saat, kur ve seviye satış anındaki kopyadır. */
export interface CourseOfferSale {
  id: string
  studentId: string
  courseId: string | null
  level: CefrLevel | null
  soldAt: string
}

/** Teklife uyan paket ve kurum tarifesinden indirimsiz fiyatı (DOM-DIL-050). */
export interface CourseOfferOption {
  packageId: string
  packageName: string
  kind: PackageKind
  hours: number
  /** Saat × tarifenin saat ücreti. */
  announcedCents: number
  /** Saat × uygulanan saat ücreti (paketin ilan altı ücreti varsa o); indirimler satışta düşer. */
  priceCents: number
}

export interface CourseOfferProblem {
  code: string
  message: string
}

/**
 * `ready`: teklif açılabilir. `no_next_level`: kursiyer geçti ama üst seviye ya da sonraki kur yok;
 * satırda görünür, teklif açılmaz.
 */
export const COURSE_OFFER_ROW_STATUSES = ['ready', 'no_next_level'] as const
export type CourseOfferRowStatus = (typeof COURSE_OFFER_ROW_STATUSES)[number]

export interface CourseOfferRow {
  studentId: string
  studentName: string
  status: CourseOfferRowStatus
  decisionId: string
  outcome: ProgressionOutcome
  /** Kararın onaylandığı an; satış bundan sonraysa teklif kapanmıştır. */
  approvedAt: string | null
  fromCourseId: string
  fromCourseName: string
  fromLevel: CefrLevel
  /** Teklif edilen kur; geçti kararında zincirdeki sonraki kur, öteki kararlarda aynı kur. */
  courseId: string | null
  courseName: string | null
  level: CefrLevel | null
  /** Ada göre; teklif açılamıyorsa boş ve neden `problem`te. */
  options: CourseOfferOption[]
  /** Karar onayından sonra teklif edilen kur ya da seviyede yapılmış en son satış. */
  saleId: string | null
  problem: CourseOfferProblem | null
}

export const COURSE_OFFER_PACKAGE_MISSING =
  'Teklif edilen kur ya da seviye için tanımlı paket yok; önce yönetici paket tanımlamalıdır.'
const TARIFF_MISSING = 'Bu eğitim yılı için yayımlanmış ücret tarifesi yok.'
const COURSE_INACTIVE = 'Teklif edilen kur etkin değil; paket satılamaz.'

/** Paketin ücret seviyesi: kura bağlıysa kurun seviyesi, değilse paketin kendi seviyesi. */
const packageLevel = (pkg: LessonPackage, courses: ReadonlyMap<string, CourseOfferListCourse>) =>
  pkg.courseId === null ? pkg.level : (courses.get(pkg.courseId)?.level ?? null)

/**
 * Teklife uyan paketler: sonraki kur biliniyorsa o kura bağlı paketler, bilinmiyorsa (zincirsiz
 * kurdan geçen kursiyer) ücret seviyesi teklif seviyesi olan paketler.
 */
function matchingPackages(
  offer: { courseId: string | null; level: CefrLevel },
  packages: readonly LessonPackage[],
  courses: ReadonlyMap<string, CourseOfferListCourse>,
) {
  return packages.filter((pkg) =>
    offer.courseId === null
      ? packageLevel(pkg, courses) === offer.level
      : pkg.courseId === offer.courseId,
  )
}

function priceOptions(
  candidates: readonly LessonPackage[],
  courses: ReadonlyMap<string, CourseOfferListCourse>,
  tariff: Pick<EnrollmentTariff, 'items'>,
): { options: CourseOfferOption[]; problem: CourseOfferProblem | null } {
  const options: CourseOfferOption[] = []
  let problem: CourseOfferProblem | null = null
  for (const pkg of candidates) {
    const course = pkg.courseId === null ? null : (courses.get(pkg.courseId) ?? null)
    if (pkg.courseId !== null && course?.status !== 'active') {
      problem ??= { code: 'package_course_inactive', message: COURSE_INACTIVE }
      continue
    }
    try {
      const price = packageTariffPrice(pkg, course, tariff)
      options.push({
        packageId: pkg.id,
        packageName: pkg.name,
        kind: pkg.kind,
        hours: price.purchasedHours,
        announcedCents: price.announcedCents,
        priceCents: price.grossCents,
      })
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      problem ??= { code: error.code, message: error.message }
    }
  }
  options.sort((a, b) => a.packageName.localeCompare(b.packageName, 'tr'))
  return { options, problem: options.length > 0 ? null : problem }
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string) {
  const map = new Map<string, T[]>()
  for (const item of items) map.set(keyOf(item), [...(map.get(keyOf(item)) ?? []), item])
  return map
}

/**
 * Teklif listesinin satırları, kursiyer adına göre. Her kursiyer yalnız kendi kayıt ve kararlarıyla
 * hesaplanır; başka kursiyerin kararı satıra girmez. Pasif kursiyer, son kuru olmayan ya da son
 * kurunun kararı onay bekleyen, reddedilmiş veya hiç verilmemiş kursiyer listede yoktur.
 */
export function courseOfferRows(input: {
  students: readonly CourseOfferStudent[]
  enrollments: readonly CourseOfferEnrollment[]
  courses: readonly CourseOfferListCourse[]
  decisions: readonly ProgressionDecisionRecord[]
  packages: readonly LessonPackage[]
  sales: readonly CourseOfferSale[]
  tariff: Pick<EnrollmentTariff, 'items'> | null
}): CourseOfferRow[] {
  const courses = new Map(input.courses.map((course) => [course.id, course]))
  const enrollments = groupBy(input.enrollments, (item) => item.studentId)
  const decisions = groupBy(input.decisions, (item) => item.learnerId)
  const sales = groupBy(input.sales, (item) => item.studentId)
  return input.students
    .filter((student) => student.isActive)
    .flatMap((student): CourseOfferRow[] => {
      const offer = renewalCourseOffer({
        studentId: student.id,
        enrollments: enrollments.get(student.id) ?? [],
        courses: input.courses,
        decisions: decisions.get(student.id) ?? [],
      })
      if (offer.status !== 'ready' && offer.status !== 'no_next_level') return []
      const { decisionId, outcome, fromCourseId, fromLevel } = offer
      if (decisionId === null || outcome === null || fromCourseId === null || fromLevel === null)
        return []
      const decision = decisions.get(student.id)?.find((item) => item.id === decisionId)
      const approvedAt = decision?.reviewedAt ?? null
      const base = {
        studentId: student.id,
        studentName: student.name,
        decisionId,
        outcome,
        approvedAt,
        fromCourseId,
        fromCourseName: courses.get(fromCourseId)?.name ?? '',
        fromLevel,
        courseId: offer.courseId,
        courseName: offer.courseId === null ? null : (courses.get(offer.courseId)?.name ?? null),
        level: offer.level,
      }
      if (offer.status === 'no_next_level' || offer.level === null)
        return [
          {
            ...base,
            status: 'no_next_level',
            options: [],
            saleId: null,
            problem: {
              code: 'course_next_level_missing',
              message: COURSE_OFFER_MESSAGES.no_next_level,
            },
          },
        ]
      const target = { courseId: offer.courseId, level: offer.level }
      const sale = (sales.get(student.id) ?? [])
        .filter(
          (item) =>
            (approvedAt === null || item.soldAt >= approvedAt) &&
            (target.courseId === null
              ? item.level === target.level
              : item.courseId === target.courseId),
        )
        .toSorted((a, b) => b.soldAt.localeCompare(a.soldAt))[0]
      const candidates = matchingPackages(target, input.packages, courses)
      const priced =
        input.tariff === null
          ? { options: [], problem: { code: 'tariff_not_published', message: TARIFF_MISSING } }
          : candidates.length === 0
            ? {
                options: [],
                problem: {
                  code: 'course_offer_package_missing',
                  message: COURSE_OFFER_PACKAGE_MISSING,
                },
              }
            : priceOptions(candidates, courses, input.tariff)
      return [{ ...base, status: 'ready', saleId: sale?.id ?? null, ...priced }]
    })
    .sort(
      (a, b) =>
        a.studentName.localeCompare(b.studentName, 'tr') || a.studentId.localeCompare(b.studentId),
    )
}
