import type { AssignmentTarget } from './assignment.ts'

/**
 * Görev atamasının erişim kuralı (docs/domain/yetki-ve-kapsam.md DOM-YTK-028): kim okur, kim
 * değiştirir, kim puanlar. Saf ve State dışıdır: girdi servisin yüklediği satırlar ve kapsamdır;
 * API, web ve mobil aynı kuralı çalıştırır. Hata fırlatmaz, karar döner; HTTP durumu (404/403)
 * ve sıra (kapsam → yetki → sürüm) çağıranındır. SQL süzgeci (API `listFilter`) bu kuralın
 * eşdeğeridir ve onunla birlikte değişir.
 */

/** Kuralın okuduğu atama alanları. */
export type AssignmentAccessRow = {
  assignedByUserId: string
  targets: readonly AssignmentTarget[]
  archivedAt: string | null
}

/**
 * Atamaya bakan kişi ve kapsamı. Kapsamı çağıran çözer (öğretmen: ders verdiği/rehberi olduğu
 * sınıflar ve güncel öğrencileri, DOM-YTK-022; öğrenci/veli: kapsamdaki öğrenci → güncel sınıf).
 * `none`: atamaya hiç erişmeyen rol (ön büro).
 */
export type AssignmentViewer =
  | { kind: 'admin' }
  | {
      kind: 'teacher'
      userId: string
      classIds: ReadonlySet<string>
      studentIds: ReadonlySet<string>
    }
  | { kind: 'learner'; classOf: ReadonlyMap<string, string> }
  | { kind: 'none' }

/** Atamayı değiştirebilecek kişi: yalnız yönetici ve atayan öğretmen (kapsam gerekmez). */
export type AssignmentManager = { kind: 'admin' } | { kind: 'teacher'; userId: string }

/** Sınıf/grup hedefi `classes` kaydıdır; öğrenci hedefi öğrenci kaydıdır. */
const CLASS_TARGETS = new Set<AssignmentTarget['kind']>(['class', 'group'])

/**
 * Atamanın kapsamdaki kursiyerleri (öğrenci hedefi veya güncel sınıfı/grubu hedefte). Sınıf
 * değiştiren öğrenci yeni sınıfının atamalarını görür, eskisini görmez (ADR 0004 karar 4).
 * Sıralıdır.
 */
export function targetedLearners(
  classOf: ReadonlyMap<string, string>,
  assignment: Pick<AssignmentAccessRow, 'targets'>,
): string[] {
  const students = new Set(assignment.targets.filter((t) => t.kind === 'student').map((t) => t.id))
  const classes = new Set(
    assignment.targets.filter((t) => CLASS_TARGETS.has(t.kind)).map((t) => t.id),
  )
  return [...classOf]
    .filter(([studentId, classId]) => students.has(studentId) || classes.has(classId))
    .map(([studentId]) => studentId)
    .sort()
}

/** Hedef öğretmenin kapsamında mı: sınıf/grup hedefi kapsamdaki sınıf, öğrenci hedefi öğrencisi. */
export function teacherReachesTarget(
  viewer: Pick<Extract<AssignmentViewer, { kind: 'teacher' }>, 'classIds' | 'studentIds'>,
  target: AssignmentTarget,
): boolean {
  return CLASS_TARGETS.has(target.kind)
    ? viewer.classIds.has(target.id)
    : viewer.studentIds.has(target.id)
}

/**
 * Atamayı görür mü (DOM-YTK-028). Yönetici kurumda hepsini; öğretmen kendi atamalarını ve
 * kapsamındaki sınıfı/grubu veya öğrenciyi hedefleyenleri; öğrenci ve veli kapsamındaki
 * kursiyere hedeflenen, arşivlenmemiş atamayı görür; ön büro görmez.
 */
export function canReadAssignment(
  viewer: AssignmentViewer,
  assignment: AssignmentAccessRow,
): boolean {
  switch (viewer.kind) {
    case 'admin':
      return true
    case 'teacher':
      return (
        assignment.assignedByUserId === viewer.userId ||
        assignment.targets.some((target) => teacherReachesTarget(viewer, target))
      )
    case 'learner':
      return (
        assignment.archivedAt === null && targetedLearners(viewer.classOf, assignment).length > 0
      )
    case 'none':
      return false
    default:
      return viewer satisfies never
  }
}

/**
 * Atamayı değiştirir mi: yalnız atayan öğretmen ve yönetici. Atamayı gören ama atayan olmayan
 * öğretmen değiştiremez. Görünürlük ayrıca `canReadAssignment`'tadır.
 */
export function canManageAssignment(
  viewer: AssignmentManager,
  assignment: Pick<AssignmentAccessRow, 'assignedByUserId'>,
): boolean {
  return viewer.kind === 'admin' || assignment.assignedByUserId === viewer.userId
}

/**
 * Atamanın teslimlerini puanlar mı: yönetici ve atamayı gören öğretmen (atayan olmasa da).
 * Öğrenci, veli ve ön büro puanlayamaz.
 */
export function canGradeAssignment(
  viewer: AssignmentViewer,
  assignment: AssignmentAccessRow,
): boolean {
  switch (viewer.kind) {
    case 'admin':
      return true
    case 'teacher':
      return canReadAssignment(viewer, assignment)
    case 'learner':
    case 'none':
      return false
    default:
      return viewer satisfies never
  }
}
