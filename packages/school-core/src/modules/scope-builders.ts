import { announcementVisible, type AnnouncementViewer } from '../lib/communication-access.ts'
import type { ScopeSource } from '../lib/scope.ts'
import type { CollectionName } from './collection-modules.ts'
import type { Role } from './navigation.ts'

/**
 * Kapsam tablolarının ortak yapı taşları (`lib/scope.ts`). Satır kuralları ve rol kısaltmaları
 * hem `lib/scope.ts`'teki birleşim ve Onur bloğunda hem `platform/scope.ts`'teki Oğuzhan
 * girdilerinde kullanılır; döngüsel içe aktarma olmasın diye ayrı dosyadadır.
 */

// Kural fonksiyonlarının okuduğu, kapsam başına bir kez kurulan indeksler.
export type Context = {
  role: Role | undefined
  userId: string | undefined
  teacher: ScopeSource['teachers'][number] | undefined
  counselor: boolean
  studentIds: ReadonlySet<string>
  classIds: ReadonlySet<string>
  homeroomIds: ReadonlySet<string>
  branchIds: ReadonlySet<string>
  grades: ReadonlySet<number>
  levels: ReadonlySet<string>
  clubIds: ReadonlySet<string>
  /** Öğretmenin verdiği ödevler (kapsam kaynağında ödev varsa; DOM-AKD-074). */
  homeworkIds: ReadonlySet<string>
  /** Öğretmenin hazırladığı quizler (kapsam kaynağında quiz varsa; DOM-AKD-079). */
  quizIds: ReadonlySet<string>
  classTeacherIds: ReadonlySet<string>
  studentClass: ReadonlyMap<string, string>
  examGrade: ReadonlyMap<string, number>
}
export type Rule = (context: Context, row: object) => boolean
/** Rol × koleksiyon okuma kuralı tablosunun bir parçası; tabloda olmayan rol okuyamaz. */
export type ReadRules = Partial<Record<CollectionName, Partial<Record<Role, Rule>>>>
/** Koleksiyon başına role göre ayıklanan veya maskelenen alanlar. */
export type FieldRules = Partial<Record<CollectionName, (context: Context) => readonly string[]>>

// Satırlar API'den gelen JSON da olabilir; alanlar okunurken türü daraltılır.
export const value = (row: object, key: string): unknown =>
  Object.hasOwn(row, key) ? Reflect.get(row, key) : undefined
export const text = (row: object, key: string) => {
  const v = value(row, key)
  return typeof v === 'string' ? v : undefined
}
export const texts = (row: object, key: string) => {
  const v = value(row, key)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
export const member = (set: ReadonlySet<string>, id: string | undefined) =>
  id !== undefined && set.has(id)

export const all: Rule = () => true
export const ownStudent: Rule = (c, r) => member(c.studentIds, text(r, 'studentId'))
export const ownTeacher: Rule = (c, r) => !!c.teacher && text(r, 'teacherId') === c.teacher.id
export const ownClass: Rule = (c, r) => member(c.classIds, text(r, 'classId'))
export const ownBranch: Rule = (c, r) => member(c.branchIds, text(r, 'branchId'))
export const ownLevel: Rule = (c, r) => member(c.levels, text(r, 'level'))
export const ownGrade: Rule = (c, r) => {
  const grade = value(r, 'grade')
  return typeof grade === 'number' && c.grades.has(grade)
}
// Deneme düzeyi kapsamdaysa görünür (`mockExams` kuralıyla aynı sonuç); denemesi bulunamayan
// kayıt kapalı başarısızdır.
export const ownExam: Rule = (c, r) => {
  const grade = c.examGrade.get(text(r, 'examId') ?? '')
  return grade !== undefined && c.grades.has(grade)
}
export const ownClub: Rule = (c, r) => member(c.clubIds, text(r, 'clubId'))
// Sınıfa özel kayıt kendi sınıfında, sınıfsız kayıt kendi kampüsünde görünür.
export const classOrBranch: Rule = (c, r) => (text(r, 'classId') ? ownClass(c, r) : ownBranch(c, r))
export const classOrEveryone: Rule = (c, r) => !text(r, 'classId') || ownClass(c, r)
// Öğrencinin güncel sınıfının rehber öğretmeni (DOM-YTK-022).
export const homeroomStudent: Rule = (c, r) =>
  ownStudent(c, r) && member(c.homeroomIds, c.studentClass.get(text(r, 'studentId') ?? ''))
/**
 * Öğretmenin kendi işine (ödev, quiz) bağlı öğrenci kaydını işin öğretmeni ve öğrencinin sınıf
 * rehber öğretmeni okur. İşin öğretmeni, ataması sona erse ya da öğrenci sınıf değiştirse de okur
 * (`ids`: kapsam kaynağındaki kendi işleri); aynı sınıfa başka dersle giren öğretmen okumaz.
 */
export const ownWorkOrHomeroom =
  (ids: (context: Context) => ReadonlySet<string>, field: string): Rule =>
  (c, r) =>
    member(ids(c), text(r, field)) || homeroomStudent(c, r)
// Teslim: ödevin öğretmeni ve rehber öğretmen (DOM-AKD-074).
export const submissionReader = ownWorkOrHomeroom((c) => c.homeworkIds, 'homeworkId')
// Quiz denemesi: quizin öğretmeni ve rehber öğretmen (DOM-AKD-079).
export const quizAttemptReader = ownWorkOrHomeroom((c) => c.quizIds, 'quizId')
export const subjectOrHomeroom: Rule = (c, r) => {
  const classId = c.studentClass.get(text(r, 'studentId') ?? '')
  return (
    ownStudent(c, r) &&
    (text(r, 'subjectId') === c.teacher?.subjectId || member(c.homeroomIds, classId))
  )
}
// Not, verildiği sınıfı (`classId`) taşır: o sınıfın branş veya rehber öğretmeni öğrenci sınıf
// değiştirdikten sonra da notu görür (düzeltme yetkisi `authorize('grade.update')`). Sınıfı
// saklanmamış eski notta yalnız öğrencinin güncel sınıfı geçerlidir.
export const gradeReader: Rule = (c, r) => {
  const classId = text(r, 'classId')
  const givenInOwnClass =
    member(c.classIds, classId) &&
    (text(r, 'subjectId') === c.teacher?.subjectId || member(c.homeroomIds, classId))
  return givenInOwnClass || subjectOrHomeroom(c, r)
}

export const viewerOf = (c: Context): AnnouncementViewer => ({
  role: c.role,
  userId: c.userId,
  teacherId: c.teacher?.id,
  studentIds: c.studentIds,
})
export const announcementRule =
  (legacy: Rule): Rule =>
  (c, r) =>
    announcementVisible(viewerOf(c), r, () => legacy(c, r))

// Randevuyu açan kişi (`requestedBy`, lib/appointments.ts); eski kayıtta yoktur.
const requester = (row: object): object | undefined => {
  const by = value(row, 'requestedBy')
  return typeof by === 'object' && by !== null ? by : undefined
}
export const requesterId = (row: object) => {
  const by = requester(row)
  return by ? text(by, 'userId') : undefined
}
// Velinin açtığı görüşme; açanı bilinmeyen eski kayıtta türden anlaşılır (DOM-ILT-103).
export const parentMeeting = (row: object) => {
  const by = requester(row)
  return by ? text(by, 'role') === 'veli' : text(row, 'type') === 'Veli görüşmesi'
}

/** Öğrenci kendi, veli çocuğunun kaydını okur (DOM-YTK-024, DOM-YTK-025). */
export const PERSONAL = { ogrenci: ownStudent, veli: ownStudent } as const
export const ADMIN = { yonetici: all } as const
export const ADMIN_FRONT_OFFICE = { yonetici: all, onburo: all } as const

export const NONE: readonly string[] = []
export const personal = (c: Context) => c.role === 'ogrenci' || c.role === 'veli'
