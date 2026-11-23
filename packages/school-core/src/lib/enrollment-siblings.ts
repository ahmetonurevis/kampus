import type { State } from '../data/seed.ts'
import { isContractInForce } from './contract-status.ts'

/**
 * Bir eğitim yılında aktif kaydı olan kardeşler (DOM-FIN-022, K-22). Kardeş indiriminin koşulu
 * (`requireSiblingDiscountEligible`, `lib/enrollment.ts`) ve koşulun kalktığı yenilemenin tavan
 * istisnası (`renewalCeiling`, DOM-FIN-023) aynı tanımı okur; iki kural aynı aileye farklı cevap
 * vermez.
 */

/**
 * Kardeş kuralının okuduğu kayıtlar. `frozenAt` dondurma işlemiyle (DOM-KAY-024, ON-067) gelir;
 * öğrenci dondurulunca `isActive` true kalır.
 */
export type SiblingState = Pick<State, 'contracts'> & {
  students: readonly (Pick<State['students'][number], 'id' | 'isActive'> & {
    frozenAt?: string | null
  })[]
}
type Contract = SiblingState['contracts'][number]

/** Öğrencinin yürürlükteki sözleşmeleri, eğitim yılı ve tarihe göre eskiden yeniye. */
export function contractsInForce(state: SiblingState, studentId: string): Contract[] {
  return state.contracts
    .filter((item) => item.studentId === studentId && isContractInForce(item, state.contracts))
    .sort(
      (a, b) =>
        (a.academicYear ?? 0) - (b.academicYear ?? 0) ||
        Date.parse(a.date) - Date.parse(b.date) ||
        a.id.localeCompare(b.id),
    )
}

/** Aynı veliye bağlı öteki öğrenciler; velisi yazılmamış öğrencinin kardeşi yoktur. */
export function siblingIdsOf(
  students: readonly { id: string; parentId?: string | null }[],
  studentId: string,
): string[] {
  const parentId = students.find((item) => item.id === studentId)?.parentId
  if (!parentId) return []
  return students
    .filter((item) => item.id !== studentId && item.parentId === parentId)
    .map((item) => item.id)
}

export interface EnrolledSibling {
  id: string
  /** Kardeşin ilk yürürlükteki sözleşmesi; kayıt sırası buradan okunur. */
  first: Contract | undefined
  /** Kardeşin o yılki son yürürlükteki sözleşmesi; sözleşmesiz kardeşte yok. */
  latest: Contract | undefined
}

/**
 * Aktif kayıt: öğrenci ayrılmamış, mezun olmamış ve dondurulmamıştır; o yıla ait yürürlükte
 * sözleşmesi vardır. Yenilemede kardeşin planı o yılın sözleşmesini yazdığı için plan da kayıt
 * sayılır. Yılı yazılmamış eski sözleşme cari yıla aittir (`renewalCeiling` ile aynı). Sözleşmesi hiç
 * olmayan etkin kardeş (dosyadan aktarılan öğrenci) yalnız cari yılda kayıtlı sayılır.
 */
export function enrolledSiblings(
  state: SiblingState,
  child: {
    /** Kesin kayıtta henüz öğrenci yoktur: `null`. */
    studentId: string | null
    /** Aynı veliye bağlı öteki çocuklar; aktif kayıt burada süzülür. */
    siblingIds: readonly string[]
    /** Kaydın arandığı eğitim yılı. */
    academicYear: number
    /** Kurumun cari eğitim yılı. */
    currentAcademicYear: number
  },
): EnrolledSibling[] {
  const { academicYear, currentAcademicYear } = child
  return state.students.flatMap((student) => {
    if (student.id === child.studentId || !child.siblingIds.includes(student.id)) return []
    if (!student.isActive || student.frozenAt) return []
    const contracts = contractsInForce(state, student.id)
    const ofYear = contracts.filter(
      (item) => (item.academicYear ?? currentAcademicYear) === academicYear,
    )
    if (ofYear.length === 0 && (contracts.length > 0 || academicYear !== currentAcademicYear))
      return []
    return [{ id: student.id, first: contracts[0], latest: ofYear.at(-1) }]
  })
}
