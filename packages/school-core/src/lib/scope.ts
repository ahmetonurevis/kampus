import type { State } from '../data/seed.ts'
import {
  ALWAYS_ON,
  collectionModule,
  collectionStatus,
  isCollectionName,
  type CollectionName,
  type InstitutionType,
} from '../modules/collection-modules.ts'
import { roles, type Role } from '../modules/navigation.ts'
import { schoolModules } from '../modules/school-workflows.ts'
import {
  ANNOUNCEMENT_HIDDEN_FIELDS,
  announcementVisible,
  narrowAnnouncement,
  type AnnouncementViewer,
} from './communication-access.ts'
import type { Session } from './domain.ts'
import { DomainError } from './errors.ts'

/**
 * Kişiye göre kayıt kapsamı (docs/domain/yetki-ve-kapsam.md). Rol işlem türünü, kapsam hangi
 * kayıtlarda geçerli olduğunu belirler; ikisi tek yerde, burada çözülür (DOM-YTK-001, -002).
 *
 * Aktör API'deki üyelik bağlantılarıyla aynı biçimdedir (`links: [{ kind, recordId }]`): öğrenci
 * kendi kaydına (`student`), veli çocuklarına (`child`), öğretmen öğretmen kaydına (`teacher`)
 * bağlanır. Kapsam istemcinin gönderdiği kimlikten değil bu bağlantılardan hesaplanır.
 *
 * Kullanım: `scopeFor(kaynak, aktör)` indeksleri bir kez kurar; `read(koleksiyon, satırlar)`
 * satırları süzer ve alan ayıklar. Bilinmeyen koleksiyon veya rol en dar varsayılandır (boş).
 */

export const ACTOR_LINK_KINDS = ['student', 'child', 'teacher'] as const
export type ActorLinkKind = (typeof ACTOR_LINK_KINDS)[number]
export type ActorLink = { kind: ActorLinkKind; recordId: string }
export type Actor = { role: Role; links: readonly ActorLink[] }

type Student = State['students'][number]
type Teacher = State['teachers'][number]
type Classroom = State['classes'][number]
type Assignment = State['assignments'][number]
type Club = State['clubs'][number]

/** Kapsamı hesaplamak için gereken koleksiyonlar; API bunları kurumdan bir kez yükler. */
export const SCOPE_SOURCE_COLLECTIONS = [
  'students',
  'teachers',
  'classes',
  'assignments',
  'clubs',
] as const satisfies readonly CollectionName[]
export type ScopeSource = {
  students: readonly Pick<Student, 'id' | 'classId'>[]
  teachers: readonly (Pick<Teacher, 'id' | 'subjectId' | 'branchId' | 'isActive' | 'deletedAt'> &
    Partial<Pick<Teacher, 'guidanceCounselor'>>)[]
  classes: readonly Pick<Classroom, 'id' | 'grade' | 'level' | 'branchId' | 'teacherId'>[]
  assignments: readonly Pick<Assignment, 'classId' | 'teacherId'>[]
  clubs: readonly Pick<Club, 'id' | 'teacherId'>[]
  /** Modül anahtarı → açık mı; haritada olmayan modül kapalıdır. */
  modules: Readonly<Record<string, boolean>>
}
export type ScopeOptions = { institutionType?: InstitutionType }

/** Kapsam sonucu alan ayıklamasıyla silinebilen alanlar (tip yalnız bu alanları isteğe bağlı yapar). */
export type HiddenField =
  | 'internalNote'
  | 'notes'
  | 'progress'
  | 'email'
  | 'phone'
  | 'attendanceRate'
  | 'homeworkRate'
  | 'corrections'
export type Redacted<T> = Omit<T, HiddenField> & Partial<Pick<T, Extract<keyof T, HiddenField>>>

export type ReadDenial =
  'unknown_collection' | 'module_unavailable' | 'module_disabled' | 'role_denied'
export type ReadDecision = { allowed: true } | { allowed: false; reason: ReadDenial }

export type Scope = {
  readonly actor: Actor
  readonly institutionType: InstitutionType
  /** Öğretmen aktörün etkin öğretmen kaydı; bağlantı yoksa veya kayıt pasifse `undefined`. */
  readonly teacher: ScopeSource['teachers'][number] | undefined
  /** Öğretmen aktörün rehberlik görevi var mı (DOM-YTK-026); iç notları yalnız bu aktör görür. */
  readonly counselor: boolean
  /** Kapsamdaki öğrenciler (yönetici ve ön büroda kurumun tümü; pasif öğrenciler dahil). */
  readonly studentIds: ReadonlySet<string>
  /** Kapsamdaki sınıflar: öğretmende ders verdiği ve rehberi olduğu, öğrenci/velide kendi sınıfı. */
  readonly classIds: ReadonlySet<string>
  access(collection: string): ReadDecision
  canRead(collection: string, row: object): boolean
  hiddenFields(collection: string): readonly string[]
  redact<T extends object>(collection: string, row: T): Redacted<T>
  read<T extends object>(collection: string, rows: readonly T[]): Redacted<T>[]
}

// Kural fonksiyonlarının okuduğu, kapsam başına bir kez kurulan indeksler.
type Context = {
  role: Role | undefined
  teacher: ScopeSource['teachers'][number] | undefined
  counselor: boolean
  studentIds: ReadonlySet<string>
  classIds: ReadonlySet<string>
  homeroomIds: ReadonlySet<string>
  branchIds: ReadonlySet<string>
  grades: ReadonlySet<number>
  levels: ReadonlySet<string>
  clubIds: ReadonlySet<string>
  classTeacherIds: ReadonlySet<string>
  studentClass: ReadonlyMap<string, string>
}
type Rule = (context: Context, row: object) => boolean

// Satırlar API'den gelen JSON da olabilir; alanlar okunurken türü daraltılır.
const value = (row: object, key: string): unknown =>
  Object.hasOwn(row, key) ? Reflect.get(row, key) : undefined
const text = (row: object, key: string) => {
  const v = value(row, key)
  return typeof v === 'string' ? v : undefined
}
const texts = (row: object, key: string) => {
  const v = value(row, key)
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
const member = (set: ReadonlySet<string>, id: string | undefined) => id !== undefined && set.has(id)

const all: Rule = () => true
const ownStudent: Rule = (c, r) => member(c.studentIds, text(r, 'studentId'))
const ownTeacher: Rule = (c, r) => !!c.teacher && text(r, 'teacherId') === c.teacher.id
const ownClass: Rule = (c, r) => member(c.classIds, text(r, 'classId'))
const ownBranch: Rule = (c, r) => member(c.branchIds, text(r, 'branchId'))
const ownLevel: Rule = (c, r) => member(c.levels, text(r, 'level'))
const ownGrade: Rule = (c, r) => {
  const grade = value(r, 'grade')
  return typeof grade === 'number' && c.grades.has(grade)
}
const ownClub: Rule = (c, r) => member(c.clubIds, text(r, 'clubId'))
// Sınıfa özel kayıt kendi sınıfında, sınıfsız kayıt kendi kampüsünde görünür.
const classOrBranch: Rule = (c, r) => (text(r, 'classId') ? ownClass(c, r) : ownBranch(c, r))
const classOrEveryone: Rule = (c, r) => !text(r, 'classId') || ownClass(c, r)
const subjectOrHomeroom: Rule = (c, r) => {
  const classId = c.studentClass.get(text(r, 'studentId') ?? '')
  return (
    ownStudent(c, r) &&
    (text(r, 'subjectId') === c.teacher?.subjectId || member(c.homeroomIds, classId))
  )
}
// Not, verildiği sınıfı (`classId`) taşır: o sınıfın branş veya rehber öğretmeni öğrenci sınıf
// değiştirdikten sonra da notu görür (düzeltme yetkisi `authorize('grade.update')`). Sınıfı
// saklanmamış eski notta yalnız öğrencinin güncel sınıfı geçerlidir.
const gradeReader: Rule = (c, r) => {
  const classId = text(r, 'classId')
  const givenInOwnClass =
    member(c.classIds, classId) &&
    (text(r, 'subjectId') === c.teacher?.subjectId || member(c.homeroomIds, classId))
  return givenInOwnClass || subjectOrHomeroom(c, r)
}

const viewerOf = (c: Context): AnnouncementViewer => ({
  role: c.role,
  teacherId: c.teacher?.id,
  studentIds: c.studentIds,
})
const announcementRule =
  (legacy: Rule): Rule =>
  (c, r) =>
    announcementVisible(viewerOf(c), r, () => legacy(c, r))

/** Öğrenci kendi, veli çocuğunun kaydını okur (DOM-YTK-024, DOM-YTK-025). */
const PERSONAL = { ogrenci: ownStudent, veli: ownStudent } as const
const ADMIN = { yonetici: all } as const
const ADMIN_FRONT_OFFICE = { yonetici: all, onburo: all } as const

/**
 * Rol × koleksiyon okuma kuralları. Tabloda olmayan rol koleksiyonu okuyamaz (DOM-YTK-001).
 * Ön büro yalnız idari koleksiyonları okur; akademik veri, rehberlik, hedef ve etüt kapalıdır
 * (DOM-YTK-021). Öğretmen kendi sınıfları ve branşıyla sınırlıdır (DOM-YTK-022). Okul iş akışı
 * modüllerinde ayrıca modül kaydının rol listesi uygulanır.
 */
const READ_RULES: Record<CollectionName, Partial<Record<Role, Rule>>> = {
  subjects: { yonetici: all, onburo: all, ogretmen: all, ogrenci: all, veli: all },
  // Kampüs, sınıf, kadro: ön büro sınıf ve kontenjanı okur; diğerleri kendi kampüs/sınıfını.
  branches: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => member(c.branchIds, text(r, 'id')),
    ogrenci: (c, r) => member(c.branchIds, text(r, 'id')),
    veli: (c, r) => member(c.branchIds, text(r, 'id')),
  },
  classes: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => member(c.classIds, text(r, 'id')),
    ogrenci: (c, r) => member(c.classIds, text(r, 'id')),
    veli: (c, r) => member(c.classIds, text(r, 'id')),
  },
  // Öğretmen kendi kaydını; öğrenci ve veli sınıfında ders veren öğretmenleri (iletişimsiz) görür.
  teachers: {
    ...ADMIN,
    ogretmen: (c, r) => !!c.teacher && text(r, 'id') === c.teacher.id,
    ogrenci: (c, r) => member(c.classTeacherIds, text(r, 'id')),
    veli: (c, r) => member(c.classTeacherIds, text(r, 'id')),
  },
  students: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => member(c.studentIds, text(r, 'id')),
    ogrenci: (c, r) => member(c.studentIds, text(r, 'id')),
    veli: (c, r) => member(c.studentIds, text(r, 'id')),
  },
  parents: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    ogrenci: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    veli: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
  },
  assignments: { ...ADMIN, ogretmen: ownClass, ogrenci: ownClass, veli: ownClass },
  // Branş öğretmeni kendi dersini, sınıf rehber öğretmeni şubesinin bütün notlarını okur; notun
  // verildiği sınıf da kapsam verir (`gradeReader`).
  grades: { ...ADMIN, ogretmen: gradeReader, ...PERSONAL },
  attendance: { ...ADMIN, ogretmen: ownClass, ...PERSONAL },
  absences: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  schedule: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: (c, r) =>
      !!c.teacher &&
      (text(r, 'teacherId') === c.teacher.id || text(r, 'originalTeacherId') === c.teacher.id),
    ogrenci: ownClass,
    veli: ownClass,
  },
  invoices: { ...ADMIN_FRONT_OFFICE, ...PERSONAL },
  contracts: { ...ADMIN_FRONT_OFFICE, veli: ownStudent },
  prospects: ADMIN_FRONT_OFFICE,
  // Soru bankası cevapları içerir; öğrenci ve veliye açılmaz.
  bank: { ...ADMIN, ogretmen: all },
  quizzes: {
    ...ADMIN,
    ogretmen: (c, r) => ownClass(c, r) || ownTeacher(c, r),
    ogrenci: ownClass,
    veli: ownClass,
  },
  quizAttempts: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  homework: {
    ...ADMIN,
    ogretmen: (c, r) => ownClass(c, r) || ownTeacher(c, r),
    ogrenci: ownClass,
    veli: ownClass,
  },
  submissions: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  questions: { ...ADMIN, ogretmen: ownTeacher, ...PERSONAL },
  videos: { ...ADMIN, ogretmen: all, ogrenci: ownLevel, veli: ownLevel },
  videoProgress: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  materials: { ...ADMIN, ogretmen: all, ogrenci: ownLevel, veli: ownLevel },
  // Yayında çözülen alıcı listesi varsa yalnız alıcılar ve yayınlayan, geri çekileni yalnız
  // yayınlayan ve yönetici görür; listesi olmayan eski kayıt sınıfa özel veya genel kalır
  // (DOM-ILT-001, DOM-ILT-004; lib/communication-access.ts).
  announcements: {
    yonetici: announcementRule(all),
    onburo: announcementRule(all),
    ogretmen: announcementRule(classOrEveryone),
    ogrenci: announcementRule(classOrEveryone),
    veli: announcementRule(classOrEveryone),
  },
  // Birebir yazışma yalnız taraflarındır; yöneticinin okuması gerekçeli ayrı işlemdir (DOM-YTK-052).
  conversations: {
    ogretmen: ownTeacher,
    ogrenci: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'student',
    veli: (c, r) => ownStudent(c, r) && text(r, 'audience') === 'parent',
  },
  appointments: { ...ADMIN, ogretmen: ownTeacher, ...PERSONAL },
  requests: { ...ADMIN_FRONT_OFFICE, ...PERSONAL },
  availability: { ...ADMIN, ogretmen: ownTeacher },
  // Denetim kaydını yalnız yönetici görür (DOM-YTK-053).
  audit: ADMIN,
  // Rehberlik: rehberlik görevli öğretmen kurumun bütün dosyalarını okur (DOM-YTK-026); diğer
  // öğretmen sorumlusu olduğu dosyanın ve sınıflarındaki öğrencilerin paylaşılan planını görür.
  // Yönetici paylaşılan planı okur. Ön büro hiç okumaz (DOM-YTK-021). İç not alanları
  // `HIDDEN_FIELDS` ile ayıklanır (DOM-ILT-040).
  guidanceCases: {
    ...ADMIN,
    ogretmen: (c, r) => c.counselor || ownTeacher(c, r) || ownStudent(c, r),
    ...PERSONAL,
  },
  mockExams: { ...ADMIN, ogretmen: ownGrade, ogrenci: ownGrade, veli: ownGrade },
  mockResults: { ...ADMIN, ogretmen: ownStudent, ...PERSONAL },
  // Branş öğretmeni kendi dersinin ve genel net hedeflerini görür.
  studentGoals: {
    ...ADMIN,
    ogretmen: (c, r) =>
      ownStudent(c, r) && (!text(r, 'subjectId') || text(r, 'subjectId') === c.teacher?.subjectId),
    ...PERSONAL,
  },
  renewals: { ...ADMIN_FRONT_OFFICE, veli: ownStudent },
  enrollmentHistory: { ...ADMIN_FRONT_OFFICE, veli: ownStudent },
  studyTasks: { ...ADMIN, ogretmen: ownTeacher, ...PERSONAL },
  schoolEvents: {
    ...ADMIN_FRONT_OFFICE,
    ogretmen: classOrBranch,
    ogrenci: classOrBranch,
    veli: classOrBranch,
  },
  eventConsents: { ...ADMIN_FRONT_OFFICE, ogretmen: ownStudent, ...PERSONAL },
  transportRoutes: { ...ADMIN_FRONT_OFFICE, ogrenci: ownBranch, veli: ownBranch },
  transportAssignments: { ...ADMIN_FRONT_OFFICE, ...PERSONAL },
  mealMenus: { ...ADMIN_FRONT_OFFICE, ogrenci: ownBranch, veli: ownBranch },
  clubs: { ...ADMIN, ogretmen: ownTeacher, ogrenci: ownBranch, veli: ownBranch },
  clubMemberships: { ...ADMIN, ogretmen: ownClub, ...PERSONAL },
  clubAttendance: { ...ADMIN, ogretmen: ownClub, ...PERSONAL },
  socialAchievements: { ...ADMIN, ogretmen: ownClub, ...PERSONAL },
  opticalProfiles: { ...ADMIN, ogretmen: all },
  opticalEvaluations: {
    ...ADMIN,
    ogretmen: (c, r) => ownStudent(c, r) && text(r, 'subjectId') === c.teacher?.subjectId,
    ...PERSONAL,
  },
  tutorSessions: {
    ...ADMIN,
    ogretmen: ownTeacher,
    ogrenci: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
    veli: (c, r) => texts(r, 'studentIds').some((id) => c.studentIds.has(id)),
  },
}
const RULES: Readonly<Record<string, Partial<Record<Role, Rule>>>> = READ_RULES

const NONE: readonly string[] = []
const GUIDANCE_INTERNAL: readonly string[] = ['internalNote', 'notes']
const TEACHER_PRIVATE: readonly string[] = ['email', 'phone', 'attendanceRate', 'homeworkRate']
const CORRECTION_HISTORY: readonly string[] = ['corrections']
const personal = (c: Context) => c.role === 'ogrenci' || c.role === 'veli'
/**
 * Alan ayıklama: rol satırı görse de bu alanları hiç almaz (yanıt, arama, sıralama dahil).
 * Ön büro öğrencinin akademik ilerlemesini görmez (DOM-YTK-021); öğrenci ve veli öğretmenin
 * iletişim ve performans alanlarını görmez; rehberlik iç notu yalnız rehberlik görevli
 * öğretmene döner (DOM-ILT-040, DOM-ILT-041). Not ve yoklamanın düzeltme geçmişi (gerekçe,
 * düzelten kişi) öğrenci ve veliye dönmez; onlar yalnız güncel değeri görür (DOM-AKD-035,
 * DOM-AKD-051).
 */
const HIDDEN_FIELDS: Partial<Record<CollectionName, (context: Context) => readonly string[]>> = {
  students: (c) => (c.role === 'onburo' ? ['progress'] : NONE),
  teachers: (c) => (personal(c) ? TEACHER_PRIVATE : NONE),
  grades: (c) => (personal(c) ? CORRECTION_HISTORY : NONE),
  attendance: (c) => (personal(c) ? CORRECTION_HISTORY : NONE),
  // İç not yalnız rehberlik görevli öğretmene döner; yönetici, ön büro, görevsiz öğretmen, öğrenci
  // ve veli görmez (DOM-ILT-040, DOM-YTK-020).
  // TODO(IST-020): yöneticinin adli/idari soruşturma gerekçesiyle, denetim kaydına düşen erişimi.
  guidanceCases: (c) => (c.counselor ? NONE : GUIDANCE_INTERNAL),
  // Okundu ayrıntısı ve alıcı listesi ham dönmez; sayı olarak eklenir (DOM-ILT-003).
  announcements: () => ANNOUNCEMENT_HIDDEN_FIELDS,
}
const HIDDEN: Readonly<Record<string, ((context: Context) => readonly string[]) | undefined>> =
  HIDDEN_FIELDS

/**
 * Değer daraltma: grup kaydında öğrenci ve veli yalnız kendi satırını görür (DOM-YTK-024);
 * etüt grubundaki diğer öğrencilerin kimliği, puanı ve yoklaması çıkarılır.
 */
function narrowTutorSession(context: Context, row: Record<string, unknown>) {
  if (context.role !== 'ogrenci' && context.role !== 'veli') return row
  const own = (id: unknown) => typeof id === 'string' && context.studentIds.has(id)
  const scores = row.scores,
    attendance = row.attendance
  return {
    ...row,
    studentIds: texts(row, 'studentIds').filter(own),
    ...(Array.isArray(scores)
      ? {
          scores: scores.filter(
            (s: unknown) => typeof s === 'object' && s && own(value(s, 'studentId')),
          ),
        }
      : {}),
    ...(typeof attendance === 'object' && attendance
      ? { attendance: Object.fromEntries(Object.entries(attendance).filter(([id]) => own(id))) }
      : {}),
  }
}

const MODULE_ROLES: ReadonlyMap<string, readonly Role[]> = new Map(
  schoolModules.map((module) => [module.key, module.roles]),
)
const isRole = (role: unknown): role is Role =>
  typeof role === 'string' && Object.hasOwn(roles, role)

function buildContext(source: ScopeSource, actor: Actor, role: Role | undefined): Context {
  const linked = (kind: ActorLinkKind) =>
    new Set(actor.links.filter((link) => link.kind === kind).map((link) => link.recordId))
  const admin = role === 'yonetici' || role === 'onburo'
  const teacherIds = role === 'ogretmen' ? linked('teacher') : new Set<string>()
  // Atama sona erince yetki biter: pasif veya silinmiş öğretmen kaydı kapsam vermez.
  const teacher = source.teachers.find(
    (t) => teacherIds.has(t.id) && t.isActive !== false && !t.deletedAt,
  )
  const classById = new Map(source.classes.map((c) => [c.id, c]))
  const studentClass = new Map(source.students.map((s) => [s.id, s.classId]))
  const classIds = new Set<string>(),
    homeroomIds = new Set<string>(),
    studentIds = new Set<string>()
  if (admin) {
    for (const c of source.classes) classIds.add(c.id)
    for (const s of source.students) studentIds.add(s.id)
  } else if (teacher) {
    for (const a of source.assignments) if (a.teacherId === teacher.id) classIds.add(a.classId)
    for (const c of source.classes)
      if (c.teacherId === teacher.id) {
        classIds.add(c.id)
        homeroomIds.add(c.id)
      }
    for (const s of source.students) if (classIds.has(s.classId)) studentIds.add(s.id)
  } else if (role === 'ogrenci' || role === 'veli') {
    // Bağlantı yalnız var olan öğrenci kaydına kapsam verir.
    for (const id of linked(role === 'ogrenci' ? 'student' : 'child')) {
      const classId = studentClass.get(id)
      if (classId === undefined) continue
      studentIds.add(id)
      classIds.add(classId)
    }
  }
  const branchIds = new Set<string>(),
    grades = new Set<number>(),
    levels = new Set<string>(),
    classTeacherIds = new Set<string>()
  if (teacher) branchIds.add(teacher.branchId)
  for (const id of admin ? [] : classIds) {
    const c = classById.get(id)
    if (!c) continue
    if (!teacher) branchIds.add(c.branchId)
    grades.add(c.grade)
    levels.add(c.level)
    if (!teacher) classTeacherIds.add(c.teacherId)
  }
  if (role === 'ogrenci' || role === 'veli')
    for (const a of source.assignments)
      if (classIds.has(a.classId)) classTeacherIds.add(a.teacherId)
  const clubIds = new Set(
    teacher ? source.clubs.filter((c) => c.teacherId === teacher.id).map((c) => c.id) : [],
  )
  return {
    role,
    teacher,
    counselor: teacher?.guidanceCounselor === true,
    studentIds,
    classIds,
    homeroomIds,
    branchIds,
    grades,
    levels,
    clubIds,
    classTeacherIds,
    studentClass,
  }
}

/** Aktörün kapsamı; indeksler bir kez kurulur, satır başına tam tarama yapılmaz. */
export function scopeFor(source: ScopeSource, actor: Actor, options: ScopeOptions = {}): Scope {
  const institutionType = options.institutionType ?? 'school'
  const role = isRole(actor.role) ? actor.role : undefined
  const context = buildContext(source, actor, role)
  const decisions = new Map<string, ReadDecision>()
  const deny = (reason: ReadDenial): ReadDecision => ({ allowed: false, reason })
  function decide(collection: string): ReadDecision {
    const status = collectionStatus(collection, source.modules, institutionType)
    if (status === 'unknown') return deny('unknown_collection')
    if (status === 'unavailable') return deny('module_unavailable')
    if (status === 'disabled') return deny('module_disabled')
    const module = collectionModule(collection)
    const moduleRoles = module && module !== ALWAYS_ON ? MODULE_ROLES.get(module) : undefined
    if (!role || !RULES[collection]?.[role] || (moduleRoles && !moduleRoles.includes(role)))
      return deny('role_denied')
    return { allowed: true }
  }
  function access(collection: string) {
    let decision = decisions.get(collection)
    if (!decision) decisions.set(collection, (decision = decide(collection)))
    return decision
  }
  function canRead(collection: string, row: object) {
    if (!access(collection).allowed || !role) return false
    const rule = RULES[collection]?.[role]
    return !!rule && rule(context, row)
  }
  function hiddenFields(collection: string) {
    return (isCollectionName(collection) && HIDDEN[collection]?.(context)) || NONE
  }
  function redact<T extends object>(collection: string, row: T): Redacted<T> {
    const hidden = hiddenFields(collection)
    let copy: Record<string, unknown> = Object.fromEntries(
      Object.entries(row).filter(([key]) => !hidden.includes(key)),
    )
    if (collection === 'tutorSessions') copy = narrowTutorSession(context, copy)
    if (collection === 'announcements') copy = narrowAnnouncement(viewerOf(context), row, copy)
    // Kopya yalnız gizli alanları eksik, diğer alanları aynı kayıttır.
    return copy as Redacted<T>
  }
  return {
    actor,
    institutionType,
    teacher: context.teacher,
    counselor: context.counselor,
    studentIds: context.studentIds,
    classIds: context.classIds,
    access,
    canRead,
    hiddenFields,
    redact,
    read<T extends object>(collection: string, rows: readonly T[]) {
      if (!access(collection).allowed) return []
      return rows.filter((row) => canRead(collection, row)).map((row) => redact(collection, row))
    },
  }
}

const DENIAL_ERRORS: Record<ReadDenial, () => DomainError> = {
  unknown_collection: () =>
    new DomainError('collection_not_found', 'İlgili kayıt bulunamadı.', { kind: 'not_found' }),
  // Kurum türünde olmayan modül bulunmaz gibi davranır (DOM-YTK-012).
  module_unavailable: () =>
    new DomainError('collection_not_found', 'İlgili kayıt bulunamadı.', { kind: 'not_found' }),
  module_disabled: () =>
    new DomainError('module_disabled', 'Bu modül kullanıma kapalı.', { kind: 'forbidden' }),
  role_denied: () =>
    new DomainError('permission_denied', 'Bu işlem için yetkiniz bulunmuyor.', {
      kind: 'forbidden',
    }),
}

/** Okuma uçları için: koleksiyon kapalıysa DomainError fırlatır (API 404 veya 403). */
export function requireReadable(scope: Scope, collection: string) {
  const decision = scope.access(collection)
  if (!decision.allowed) throw DENIAL_ERRORS[decision.reason]()
}

/** State'teki koleksiyonun aktöre görünen, alanları ayıklanmış satırları. */
export function visibleRecords<C extends CollectionName>(
  state: State,
  actor: Actor,
  collection: C,
  options?: ScopeOptions,
): Redacted<State[C][number]>[] {
  if (!isCollectionName(collection)) return []
  const rows: readonly State[C][number][] = state[collection]
  return scopeFor(state, actor, options).read(collection, rows)
}

/** Tek kaydın aktöre dönecek biçimi; görünmeyen kayıt `undefined`. */
export function redactRecord<T extends object>(
  state: State,
  actor: Actor,
  collection: string,
  record: T,
  options?: ScopeOptions,
): Redacted<T> | undefined {
  const scope = scopeFor(state, actor, options)
  return scope.canRead(collection, record) ? scope.redact(collection, record) : undefined
}

/** Aktörün verilen türdeki ilk bağlantısı (öğretmen kaydı, öğrencinin kendi kaydı). */
export function linkedRecordId(actor: Actor, kind: ActorLinkKind): string | undefined {
  return actor.links.find((link) => link.kind === kind)?.recordId
}

/** İşlemi yapan öğretmenin kayıt kimliği; öğretmen olmayan rolde `undefined`. */
export function sessionTeacherId(state: Pick<State, 'parents'>, session: Session) {
  return session.role === 'ogretmen'
    ? linkedRecordId(sessionActor(state, session), 'teacher')
    : undefined
}

// Çevrimdışı demonun sabit oturumu: öğretmen Selin Kaya, öğrenci Deniz Yılmaz, veli Ayşe Yılmaz.
export const DEMO_TEACHER_ID = 't1'
export const DEMO_STUDENT_ID = 's1'
export const DEMO_PARENT_ID = 'p1'

/**
 * Oturumun aktörü. API oturumu `links` taşır ve doğrudan kullanılır; çevrimdışı demo oturumu
 * yalnız rol taşır ve bugünkü sabit kimliklere eşlenir.
 */
export function sessionActor(state: Pick<State, 'parents'>, session: Session): Actor {
  const role = session.role
  if (session.links) return { role, links: session.links }
  switch (role) {
    case 'ogretmen':
      return { role, links: [{ kind: 'teacher', recordId: DEMO_TEACHER_ID }] }
    case 'ogrenci':
      return { role, links: [{ kind: 'student', recordId: DEMO_STUDENT_ID }] }
    case 'veli':
      return {
        role,
        links: (state.parents.find((p) => p.id === DEMO_PARENT_ID)?.studentIds ?? []).map(
          (recordId) => ({ kind: 'child', recordId }),
        ),
      }
    case 'yonetici':
    case 'onburo':
      return { role, links: [] }
    default:
      // Çalışma anında bilinmeyen rol bağlantısız aktör olur; kapsamı boştur.
      role satisfies never
      return { role, links: [] }
  }
}
