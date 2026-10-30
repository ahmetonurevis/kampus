// Kampüs, sınıf ve kadro ekranlarının satır hesapları (Vue `SchoolManagement.vue`). Saf
// işlevlerdir: API satırları ve başvuru koleksiyonlarının eşlemeleri girer, tablo/CSV satırı çıkar.
import type { CoreRecord, CoreRow } from '@/hooks/use-core-collection.ts'

type Branch = CoreRecord<'branches'>
type Teacher = CoreRecord<'teachers'>
type SchoolClass = CoreRecord<'classes'>
type Student = CoreRecord<'students'>
type Assignment = CoreRecord<'assignments'>
type Subject = CoreRecord<'subjects'>

export type ManagementSources = {
  branches: readonly CoreRow<'branches'>[]
  classes: readonly CoreRow<'classes'>[]
  teachers: readonly CoreRow<'teachers'>[]
  students: readonly CoreRow<'students'>[]
  assignments: readonly CoreRow<'assignments'>[]
  subjects: readonly CoreRow<'subjects'>[]
}

/** Kimlik → kayıt eşlemeleri ve sayımlar; satır başına tam tarama yapılmaz (bir kez kurulur). */
export type ManagementLookups = {
  branches: ReadonlyMap<string, Branch>
  classes: ReadonlyMap<string, SchoolClass>
  teachers: ReadonlyMap<string, Teacher>
  subjects: ReadonlyMap<string, Subject>
  /** Sınıftaki aktif öğrenciler (okul numarası sırasıyla). */
  studentsByClass: ReadonlyMap<string, readonly Student[]>
  assignmentsByClass: ReadonlyMap<string, readonly Assignment[]>
  assignmentsByTeacher: ReadonlyMap<string, readonly Assignment[]>
}

function byId<T extends { id: string }>(rows: readonly { record: T }[]): Map<string, T> {
  return new Map(rows.map((row) => [row.record.id, row.record]))
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const value = key(item)
    const list = groups.get(value)
    if (list) list.push(item)
    else groups.set(value, [item])
  }
  return groups
}

export function managementLookups(sources: ManagementSources): ManagementLookups {
  const activeStudents = sources.students
    .map((row) => row.record)
    .filter((student) => student.isActive)
  const assignments = sources.assignments.map((row) => row.record)
  return {
    branches: byId(sources.branches),
    classes: byId(sources.classes),
    teachers: byId(sources.teachers),
    subjects: byId(sources.subjects),
    studentsByClass: groupBy(activeStudents, (student) => student.classId),
    assignmentsByClass: groupBy(assignments, (assignment) => assignment.classId),
    assignmentsByTeacher: groupBy(assignments, (assignment) => assignment.teacherId),
  }
}

/** Arşivlenen kayıt core'da `isActive: false` ile kalır (API `archivedAt` ayrı kavramdır). */
export const recordStatus = (record: { isActive?: boolean }) =>
  record.isActive === false ? 'Arşivde' : 'Aktif'

/** Kayıt durumu sekmesi: adreste `?durum=arsiv`; boşsa aktif kayıtlar (Vue "Aktif kayıtlar / Arşiv"). */
export const ARCHIVE_VIEW = 'arsiv'
export const archiveViewFilter = (archived: boolean) => (archived ? ARCHIVE_VIEW : '')
export const isArchiveView = (value: unknown): boolean => value === ARCHIVE_VIEW
/** Sekmenin sunucu karşılığı: etkin kayıtlar `isActive=true`, arşiv `isActive=false`. */
export const isActiveFilter = (archived: boolean): { isActive: 'true' | 'false' } => ({
  isActive: archived ? 'false' : 'true',
})
/** Kampüs kartları sekmeye göre süzülür (kartlar başvuru koleksiyonundan gelir). */
export const campusesInView = <T extends { status: string }>(
  campuses: readonly T[],
  archived: boolean,
): T[] => campuses.filter((campus) => (campus.status === 'Arşivde') === archived)

export type ClassRow = {
  id: string
  name: string
  /** "Ortaokul · Derslik 101" */
  detail: string
  room: string
  grade: number
  branch: string
  teacher: string
  count: number
  capacity: number
  lessons: number
  status: string
}

export function classRow(item: CoreRow<'classes'>, lookups: ManagementLookups): ClassRow {
  const record = item.record
  return {
    id: item.id,
    name: record.name,
    detail: `${record.grade < 9 ? 'Ortaokul' : 'Lise'} · Derslik ${record.room}`,
    room: record.room,
    grade: record.grade,
    branch: lookups.branches.get(record.branchId)?.name ?? '',
    teacher: lookups.teachers.get(record.teacherId)?.name ?? '',
    count: lookups.studentsByClass.get(record.id)?.length ?? 0,
    capacity: record.capacity,
    lessons: lookups.assignmentsByClass.get(record.id)?.length ?? 0,
    status: recordStatus(record),
  }
}

/** CSV hücreleri: ekrandaki metinle aynı ("12 / 24"). */
export function classCsvRow(row: ClassRow) {
  return { ...row, count: `${row.count} / ${row.capacity}` }
}

export type TeacherRow = {
  id: string
  name: string
  email: string
  phone: string
  subject: string
  branch: string
  classes: string
  attendanceRate: number
  homeworkRate: number
  status: string
}

const NO_LESSONS = 'Henüz ders atanmamış'

/** Öğretmenin aktif sınıflardaki ders atamaları (Vue ile aynı sıra: atama sırası). */
export function teacherClasses(teacherId: string, lookups: ManagementLookups): SchoolClass[] {
  return (lookups.assignmentsByTeacher.get(teacherId) ?? []).flatMap((assignment) => {
    const schoolClass = lookups.classes.get(assignment.classId)
    return schoolClass?.isActive ? [schoolClass] : []
  })
}

export function teacherRow(item: CoreRow<'teachers'>, lookups: ManagementLookups): TeacherRow {
  const record = item.record
  const classes = teacherClasses(record.id, lookups)
  return {
    id: item.id,
    name: record.name,
    email: record.email,
    phone: record.phone,
    subject: lookups.subjects.get(record.subjectId)?.name ?? record.subject,
    branch: lookups.branches.get(record.branchId)?.name ?? '',
    classes: classes.map((schoolClass) => schoolClass.name).join(', ') || NO_LESSONS,
    attendanceRate: record.attendanceRate,
    homeworkRate: record.homeworkRate,
    status: recordStatus(record),
  }
}

export function teacherCsvRow(row: TeacherRow) {
  return { ...row, attendanceRate: `%${row.attendanceRate}`, homeworkRate: `%${row.homeworkRate}` }
}

export type CampusSummary = {
  id: string
  name: string
  address: string
  status: string
  classes: SchoolClass[]
  students: number
  teachers: number
}

/** Kampüs kartı: yalnız aktif sınıf, öğrenci ve öğretmenler sayılır (Vue ile aynı). */
export function campusSummaries(
  sources: Pick<ManagementSources, 'branches' | 'classes' | 'teachers'>,
  lookups: ManagementLookups,
): CampusSummary[] {
  const classes = groupBy(
    sources.classes.map((row) => row.record).filter((schoolClass) => schoolClass.isActive),
    (schoolClass) => schoolClass.branchId,
  )
  const teachers = groupBy(
    sources.teachers.map((row) => row.record).filter((teacher) => teacher.isActive),
    (teacher) => teacher.branchId,
  )
  return sources.branches.map(({ record }) => {
    const own = classes.get(record.id) ?? []
    return {
      id: record.id,
      name: record.name,
      address: record.address,
      status: recordStatus(record),
      classes: own,
      students: own.reduce(
        (sum, schoolClass) => sum + (lookups.studentsByClass.get(schoolClass.id)?.length ?? 0),
        0,
      ),
      teachers: teachers.get(record.id)?.length ?? 0,
    }
  })
}
