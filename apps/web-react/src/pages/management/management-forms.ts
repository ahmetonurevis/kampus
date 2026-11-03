// Kampüs, sınıf ve kadro formlarının saf hesapları (Vue `SchoolManagement.vue` form mantığı):
// varsayılan değerler, ders → öğretmen eşleştirme, arşiv aktarım hedefleri ve hata alanı eşlemesi.
// Kuralın kendisi core'dadır (`school-management.ts`); burası yalnız kullanıcıya geçersiz seçenek
// göstermemek ve sunucu hatasını doğru alana bağlamak içindir.
import type { z } from 'zod'
import { subjectsForGrade } from '@kampus/school-core/data/curriculum.ts'
import type {
  branchSchema,
  classInputSchema,
  teacherSchema,
} from '@kampus/school-core/lib/school-management.ts'
import {
  transferredCounts,
  type ManagedKind,
} from '@kampus/react-shared/use-management-commands.ts'
import type { CoreRecord } from '@/hooks/use-core-collection.ts'
import type { RoleKey } from '@/lib/navigation.ts'
import type { ManagementLookups } from './management-rows.ts'

type Branch = CoreRecord<'branches'>
type Teacher = CoreRecord<'teachers'>
type SchoolClass = CoreRecord<'classes'>

export type BranchFormValues = z.input<typeof branchSchema>
export type TeacherFormValues = z.input<typeof teacherSchema>
export type ClassFormValues = z.input<typeof classInputSchema>
/** Şemadan geçmiş (sayıya çevrilmiş) sınıf gövdesi; API'ye bu gider. */
export type ClassPayload = z.output<typeof classInputSchema>

/**
 * Düzenleme düğmeleri yalnız yöneticide görünür (core `branch.save` `class.save` `teacher.save`
 * `record.archive` `record.restore`: yalnız `yonetici`); ön büro ve diğer roller salt okur.
 * Karar sunucudadır (403), bu yalnız kullanıcıya geçersiz işlem göstermemektir.
 */
export const canManageStructure = (role: RoleKey | undefined) => role === 'yonetici'

/** Aktif kayıtlar (arşivli kayıt seçenek olarak sunulmaz). */
export const activeOf = <T extends { isActive: boolean }>(items: Iterable<T>): T[] =>
  [...items].filter((item) => item.isActive)

export function branchDefaults(record?: Branch): BranchFormValues {
  return { name: record?.name ?? '', address: record?.address ?? '' }
}

export function teacherDefaults(
  record: Teacher | undefined,
  branches: readonly Branch[],
): TeacherFormValues {
  return {
    name: record?.name ?? '',
    email: record?.email ?? '',
    phone: record?.phone ?? '',
    subjectId: record?.subjectId ?? 'math',
    branchId: record?.branchId ?? branches[0]?.id ?? '',
  }
}

/** Yeni sınıf varsayılanları: ilk aktif kampüs ve danışman, 24 kontenjan. */
export function classDefaults(
  record: SchoolClass | undefined,
  assignments: readonly { subjectId: string; teacherId: string }[],
  branches: readonly Branch[],
  teachers: readonly Teacher[],
): ClassFormValues {
  return {
    grade: record?.grade ?? 7,
    section: record?.section ?? '',
    branchId: record?.branchId ?? branches[0]?.id ?? '',
    teacherId: record?.teacherId ?? teachers[0]?.id ?? '',
    capacity: record?.capacity ?? 24,
    room: record?.room ?? '',
    subjectTeachers: assignedTeachers(assignments),
  }
}

/** Ders → öğretmen eşlemesi: sınıfın kayıtlı atamaları (kimliğiyle) ders kimliğine göre. */
export function assignedTeachers(
  assignments: readonly { subjectId: string; teacherId: string }[],
): Record<string, string> {
  return Object.fromEntries(assignments.map((item) => [item.subjectId, item.teacherId]))
}

/**
 * Düzeyin her dersi için öğretmen önerir (Vue `fillTeachers`): geçerli seçim korunur; yoksa
 * önce seçili kampüsün, sonra herhangi bir kampüsün aynı branştaki aktif öğretmeni. Düzeyde
 * olmayan dersin eski seçimi atılır (düzey değişince gövdeye sızmaz).
 */
export function fillSubjectTeachers(
  grade: number,
  branchId: string,
  current: Readonly<Record<string, string>>,
  teachers: readonly Teacher[],
): Record<string, string> {
  const active = activeOf(teachers)
  const filled: Record<string, string> = {}
  for (const subject of subjectsForGrade(grade)) {
    const kept = active.find(
      (teacher) => teacher.id === current[subject.id] && teacher.subjectId === subject.id,
    )
    filled[subject.id] =
      kept?.id ??
      active.find((teacher) => teacher.subjectId === subject.id && teacher.branchId === branchId)
        ?.id ??
      active.find((teacher) => teacher.subjectId === subject.id)?.id ??
      ''
  }
  return filled
}

/** Seçilen düzeyin dersleri için öğretmeni eksik olanlar (ders kimliği → ders adı). */
export function missingTeachers(
  grade: number,
  subjectTeachers: Readonly<Record<string, string | undefined>>,
): { id: string; name: string }[] {
  return subjectsForGrade(grade)
    .filter((subject) => !subjectTeachers[subject.id])
    .map((subject) => ({ id: subject.id, name: subject.name }))
}

/** Sunucuya yalnız düzeyin dersleri gider. */
export function classBody(values: ClassPayload): ClassPayload {
  const allowed = new Set(subjectsForGrade(values.grade).map((subject) => subject.id))
  return {
    ...values,
    subjectTeachers: Object.fromEntries(
      Object.entries(values.subjectTeachers).filter(([id]) => allowed.has(id)),
    ),
  }
}

export type ClassStep = 0 | 1 | 2
export const CLASS_STEPS = ['Sınıf bilgileri', 'Öğretmen atamaları', 'Kontrol'] as const
export const CLASS_INFO_FIELDS = [
  'grade',
  'section',
  'branchId',
  'teacherId',
  'capacity',
  'room',
] as const satisfies readonly (keyof ClassFormValues)[]

/** Alan adı hangi adımda (hatalı alanı olan adıma dönülür). */
export function classStepOf(field: string): ClassStep {
  return field.startsWith('subjectTeachers') ? 1 : 0
}

/**
 * Sunucunun yolsuz (`path` taşımayan) iş kuralı hataları hangi alanın altında gösterilir.
 * Yollu hatalar (`subjectTeachers.<ders>`) olduğu gibi alana yazılır; burada olmayan kod toast
 * olarak kalır (çakışma, ileri tarihli etüt gibi).
 */
export const BRANCH_ERROR_FIELDS = { branch_name_taken: 'name' } as const
export const TEACHER_ERROR_FIELDS = {
  teacher_email_taken: 'email',
  campus_required: 'branchId',
  subject_invalid: 'subjectId',
  teacher_has_assignments: 'subjectId',
  teacher_has_future_tutoring: 'branchId',
  // Yeni branşın dışında kalan zümre başkanlığı (DOM-YTK-027): hata Branş alanının altındadır.
  coordinator_duty_outside_branch: 'subjectId',
} as const

/** Görevi kaldırmak için koordinatör görevleri sayfası (yönetici rotası, menü "Zümre & Koordinatörler"). */
export const COORDINATOR_DUTIES_PATH = '/yonetici/koordinator-gorevleri'
export const COORDINATOR_BRANCH_ERROR = 'coordinator_duty_outside_branch'

/**
 * Branş reddinde görev sayfasına bağlantı yalnız Akademik modül açıkken verilir (sayfa modül
 * kapalıyken kapalıdır); kapalıyken yönetici ne yapacağını metinden öğrenir.
 */
export function coordinatorBranchHint(
  modules: Readonly<Record<string, boolean>> | undefined,
): { kind: 'link'; to: string; label: string } | { kind: 'text'; text: string } {
  return modules?.academic === true
    ? {
        kind: 'link',
        to: COORDINATOR_DUTIES_PATH,
        label: 'Koordinatör görevlerini aç ve görevi kaldır',
      }
    : { kind: 'text', text: 'Görevi kaldırmak için önce Akademik modülünü açın.' }
}
export const CLASS_ERROR_FIELDS = {
  campus_required: 'branchId',
  advisor_required: 'teacherId',
  class_name_taken: 'section',
  classroom_in_use: 'room',
  classroom_has_future_tutoring: 'room',
  capacity_below_students: 'capacity',
  class_level_locked: 'grade',
} as const

/** Arşiv aktarım hedefi hatası (`replacementId` alanının altında). */
export const ARCHIVE_ERROR_CODES: ReadonlySet<string> = new Set([
  'transfer_campus_required',
  'transfer_class_required',
  'transfer_capacity_insufficient',
  'transfer_name_or_room_conflict',
  'transfer_menu_conflict',
  'transfer_target_invalid',
  'replacement_teacher_required',
  'replacement_schedule_conflict',
  'tutor_schedule_conflict',
  'club_teacher_campus_required',
])

export type ArchiveOption = { id: string; label: string }

/** Arşivlenecek kaydın adı ve açıklaması (Vue arşiv penceresi metinleriyle aynı). */
export const ARCHIVE_NOTES = {
  branch: 'Aktif sınıflar ve öğretmenler seçtiğiniz kampüse aktarılır.',
  class:
    'Aktif öğrenciler aynı düzeydeki seçili sınıfa aktarılır; bu sınıfın gelecek dersleri kapatılır.',
  teacher:
    'Aktif dersler, danışmanlıklar, bekleyen sorular ve görüşmeler aynı branştaki öğretmene devredilir.',
} as const satisfies Record<ManagedKind, string>

export const KIND_LABELS = {
  branch: 'Kampüs',
  class: 'Sınıf',
  teacher: 'Öğretmen',
} as const satisfies Record<ManagedKind, string>

/** Arşivlenecek kaydın adı; kayıt bulunamıyorsa `undefined`. */
export function recordName(
  kind: ManagedKind,
  id: string,
  lookups: ManagementLookups,
): string | undefined {
  const map: ReadonlyMap<string, { name: string }> = {
    branch: lookups.branches,
    class: lookups.classes,
    teacher: lookups.teachers,
  }[kind]
  return map.get(id)?.name
}

/** Bağlı kayıtların aktarılabileceği aktif hedefler (Vue `destinations`). */
export function archiveDestinations(
  kind: ManagedKind,
  id: string,
  lookups: ManagementLookups,
): ArchiveOption[] {
  const branchName = (branchId: string) => lookups.branches.get(branchId)?.name ?? '—'
  if (kind === 'branch')
    return activeOf(lookups.branches.values())
      .filter((branch) => branch.id !== id)
      .map((branch) => ({ id: branch.id, label: branch.name }))
  if (kind === 'class') {
    const source: SchoolClass | undefined = lookups.classes.get(id)
    return activeOf(lookups.classes.values())
      .filter((item) => item.id !== id && item.grade === source?.grade)
      .map((item) => {
        const free = item.capacity - (lookups.studentCounts.get(item.id) ?? 0)
        return {
          id: item.id,
          label: `${item.name} · ${branchName(item.branchId)} · ${free} boş yer`,
        }
      })
  }
  const source: Teacher | undefined = lookups.teachers.get(id)
  return activeOf(lookups.teachers.values())
    .filter((item) => item.id !== id && item.subjectId === source?.subjectId)
    .map((item) => ({ id: item.id, label: `${item.name} · ${branchName(item.branchId)}` }))
}

/**
 * Arşivlenecek kaydın ekranda bilinen bağlı aktif kayıtları (Vue arşiv kuralının görünür kısmı):
 * kampüste aktif sınıf, öğrenci ve öğretmen; sınıfta aktif öğrenci; öğretmende aktif sınıflardaki
 * ders atamaları ve danışmanlıklar. Liste boş değilse aktarım hedefi gerekir. Sunucu ayrıca ekranda
 * olmayan bağları da (aday, bekleyen soru, görüşme, kulüp…) denetler; boş liste "hedef gerekmez"
 * garantisi değildir, karar core `archiveRecord`'dadır.
 */
export function archiveDependents(
  kind: ManagedKind,
  id: string,
  lookups: ManagementLookups,
): string[] {
  const parts: string[] = []
  const add = (count: number, label: string) => {
    if (count > 0) parts.push(`${count} ${label}`)
  }
  if (kind === 'branch') {
    const classes = activeOf(lookups.classes.values()).filter((item) => item.branchId === id)
    add(classes.length, 'sınıf')
    add(
      classes.reduce((sum, item) => sum + (lookups.studentCounts.get(item.id) ?? 0), 0),
      'öğrenci',
    )
    add(
      activeOf(lookups.teachers.values()).filter((item) => item.branchId === id).length,
      'öğretmen',
    )
  } else if (kind === 'class') add(lookups.studentCounts.get(id) ?? 0, 'öğrenci')
  else {
    const lessons = (lookups.assignmentsByTeacher.get(id) ?? []).filter(
      (assignment) => lookups.classes.get(assignment.classId)?.isActive,
    )
    add(lessons.length, 'ders ataması')
    add(
      activeOf(lookups.classes.values()).filter((item) => item.teacherId === id).length,
      'sınıf danışmanlığı',
    )
  }
  return parts
}

/** Hedef seçilemiyorsa (aktif aday yok) kullanıcıya ne yapacağını söyleyen metin. */
export const NO_DESTINATION = {
  branch: 'Aktarım için başka aktif kampüs yok. Önce yeni bir kampüs ekleyin.',
  class: 'Aynı düzeyde başka aktif sınıf yok. Önce aynı düzeyde bir sınıf açın.',
  teacher: 'Aynı branşta başka aktif öğretmen yok. Önce aynı branştan bir öğretmen ekleyin.',
} as const satisfies Record<ManagedKind, string>

const COLLECTION_LABELS: Readonly<Record<string, string>> = {
  students: 'öğrenci',
  classes: 'sınıf',
  teachers: 'öğretmen',
  assignments: 'ders ataması',
  schedule: 'ders',
  homework: 'ödev',
  questions: 'soru',
  appointments: 'görüşme',
  prospects: 'aday',
  clubs: 'kulüp',
  transportRoutes: 'servis hattı',
  schoolEvents: 'etkinlik',
  mealMenus: 'yemek menüsü',
  guidanceCases: 'rehberlik dosyası',
  studyTasks: 'çalışma görevi',
  renewals: 'yenileme planı',
  contracts: 'sözleşme',
}

/**
 * Arşiv sonucunun kullanıcı metni: "24 öğrenci, 3 ders Ataşehir Kampüsü hedefine aktarıldı."
 * (hedef bilinmiyorsa "Aktarılan kayıtlar: 24 öğrenci, 3 ders."). Aktarım yoksa boş metin.
 * Bilinmeyen koleksiyon "diğer kayıt" sayılır (teknik ad gösterilmez).
 */
export function transferSummary(
  result: Parameters<typeof transferredCounts>[0],
  destination?: string,
): string {
  const counts = transferredCounts(result)
  const parts: string[] = []
  let other = 0
  for (const [collection, count] of Object.entries(counts)) {
    const label = COLLECTION_LABELS[collection]
    if (label) parts.push(`${count} ${label}`)
    else other += count
  }
  if (other) parts.push(`${other} diğer kayıt`)
  if (parts.length === 0) return ''
  return destination
    ? `${parts.join(', ')} ${destination} hedefine aktarıldı.`
    : `Aktarılan kayıtlar: ${parts.join(', ')}.`
}
