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
  ADMIN_FRONT_OFFICE,
  all,
  member,
  NONE,
  ownStudent,
  PERSONAL,
  text,
  texts,
  value,
  viewerOf,
  type Context,
  type FieldRules,
  type ReadRules,
  type Rule,
} from '../modules/scope-builders.ts'
import {
  PLATFORM_HIDDEN_FIELDS,
  PLATFORM_MASKED_FIELDS,
  PLATFORM_READ_BEYOND_MODULE_ROLES,
  PLATFORM_READ_RULES,
  PLATFORM_UNSEARCHABLE_FIELDS,
} from '../platform/scope.ts'
import { narrowAnnouncement } from './communication-access.ts'
import type { Session } from './domain.ts'
import { DomainError } from './errors.ts'
import { maskParentContact } from './parent-contact.ts'

/**
 * Kişiye göre kayıt kapsamı (docs/domain/yetki-ve-kapsam.md). Rol işlem türünü, kapsam hangi
 * kayıtlarda geçerli olduğunu belirler; ikisi tek yerde, burada çözülür (DOM-YTK-001, -002).
 *
 * Aktör API'deki üyelik bağlantılarıyla aynı biçimdedir (`links: [{ kind, recordId }]`): öğrenci
 * kendi kaydına (`student`), veli çocuklarına (`child`), öğretmen öğretmen kaydına (`teacher`)
 * bağlanır. Kapsam istemcinin gönderdiği kimlikten değil bu bağlantılardan hesaplanır. Ödeyici
 * veli ayrıca ödediği öğrenciye `payer` bağlantısı taşır (K-04; `lib/guardianship.ts`
 * `payerActorLinks`): yalnız `payerStudentIds` kümesine girer, `studentIds`/`classIds` ve onlara
 * dayanan akademik, iletişim ve rıza kapsamını değiştirmez; finans kuralı onu açıkça okur.
 *
 * Kullanım: `scopeFor(kaynak, aktör)` indeksleri bir kez kurar; `read(koleksiyon, satırlar)`
 * satırları süzer ve alan ayıklar. Bilinmeyen koleksiyon veya rol en dar varsayılandır (boş).
 */

export const ACTOR_LINK_KINDS = ['student', 'child', 'teacher', 'payer'] as const
export type ActorLinkKind = (typeof ACTOR_LINK_KINDS)[number]
export type ActorLink = { kind: ActorLinkKind; recordId: string }
export type Actor = {
  role: Role
  links: readonly ActorLink[]
  /**
   * Kalıcı kullanıcı kimliği (API: oturumun kullanıcısı). Kişiyle eşleşen kararlar için (ön büro
   * duyuru yayıncısı, DOM-ILT-004); yoksa o kararlar kapalı başarısızdır.
   */
  userId?: string | undefined
}

type Student = State['students'][number]
type Teacher = State['teachers'][number]
type Classroom = State['classes'][number]
type Assignment = State['assignments'][number]
type Club = State['clubs'][number]
type MockExam = State['mockExams'][number]
type Homework = State['homework'][number]
type Quiz = State['quizzes'][number]

/** Kapsamı hesaplamak için gereken koleksiyonlar; API bunları kurumdan bir kez yükler. */
export const SCOPE_SOURCE_COLLECTIONS = [
  'students',
  'teachers',
  'classes',
  'assignments',
  'clubs',
  'mockExams',
] as const satisfies readonly CollectionName[]
export type ScopeSource = {
  students: readonly Pick<Student, 'id' | 'classId'>[]
  teachers: readonly (Pick<Teacher, 'id' | 'subjectId' | 'branchId' | 'isActive' | 'deletedAt'> &
    Partial<Pick<Teacher, 'guidanceCounselor'>>)[]
  classes: readonly Pick<Classroom, 'id' | 'grade' | 'level' | 'branchId' | 'teacherId'>[]
  assignments: readonly Pick<Assignment, 'classId' | 'teacherId'>[]
  clubs: readonly Pick<Club, 'id' | 'teacherId'>[]
  /** Optik profilinin hangi düzeyin denemesine ait olduğunu bulmak için (deneme → düzey). */
  mockExams: readonly Pick<MockExam, 'id' | 'grade'>[]
  /**
   * Teslim kapsamı için ödev → öğretmen (DOM-AKD-074): öğretmen kendi verdiği ödevin teslimlerini
   * okur. İsteğe bağlıdır ve `SCOPE_SOURCE_COLLECTIONS`'ta değildir: API yalnız öğretmenin kendi
   * ödevlerini yükler; verilmezse öğretmen yalnız rehberi olduğu sınıfın teslimlerini görür.
   */
  homework?: readonly Pick<Homework, 'id' | 'teacherId'>[]
  /**
   * Deneme kapsamı için quiz → öğretmen (DOM-AKD-079): öğretmen kendi hazırladığı quizin
   * denemelerini okur. `homework` gibi isteğe bağlıdır; verilmezse öğretmen yalnız rehberi olduğu
   * sınıfın denemelerini görür.
   */
  quizzes?: readonly Pick<Quiz, 'id' | 'teacherId'>[]
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
  | 'senderUserId'
  | 'parentUserId'
  | 'keyCsv'
  | 'keys'
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
  /**
   * Velinin ödeyicisi olduğu öğrenciler (`payer` bağlantısı; K-04, DOM-ILT-074). Yalnız finans
   * kapsamıdır: `studentIds`'e girmez; velayetli ödeyicide ikisinde de bulunur. Veli dışı rolde boş.
   */
  readonly payerStudentIds: ReadonlySet<string>
  /** Öğretmen aktörün verdiği ödevler (kaynaktaki `homework`; teslim kapsamı, DOM-AKD-074). */
  readonly homeworkIds: ReadonlySet<string>
  /** Öğretmen aktörün hazırladığı quizler (kaynaktaki `quizzes`; deneme kapsamı, DOM-AKD-079). */
  readonly quizIds: ReadonlySet<string>
  access(collection: string): ReadDecision
  /**
   * Rol bu koleksiyonu satır ayrımı olmadan bütünüyle okur (erişim açık ve satır kuralı koşulsuz).
   * Yalnız performans için: API süzgeçsiz liste sayfalamasını buna dayanarak SQL'e indirir; alan
   * ayıklaması (`hiddenFields`) yine uygulanır ve kararı satır kuralı vermeye devam eder.
   */
  readsWhole(collection: string): boolean
  canRead(collection: string, row: object): boolean
  hiddenFields(collection: string): readonly string[]
  /**
   * Serbest metin aramasına girmeyen üst düzey alanlar: ayıklananlar (`hiddenFields`) ve görünse
   * de aranmayan kişisel kimlik alanları (`UNSEARCHABLE_FIELDS`; ör. kimlik no istek adresine ve
   * loga düşmesin diye aranamaz).
   */
  searchExcludedFields(collection: string): readonly string[]
  redact<T extends object>(collection: string, row: T): Redacted<T>
  read<T extends object>(collection: string, rows: readonly T[]): Redacted<T>[]
}

/**
 * Rol × koleksiyon okuma kuralları; iki kaynağın birleşimi. Tabloda olmayan rol koleksiyonu
 * okuyamaz (DOM-YTK-001). Oğuzhan'ın girdileri `platform/scope.ts` (`PLATFORM_READ_RULES`),
 * kayıt ve finans koleksiyonları aşağıdaki `// Onur: kayıt ve finans` bloğu; bir koleksiyon
 * yalnız bir kaynakta bulunur (`tests/scope.test.ts`). Yapı taşları `modules/scope-builders.ts`.
 * Okul iş akışı modüllerinde ayrıca modül kaydının rol listesi uygulanır.
 */
// Onur: kayıt ve finans
// Denemesi olan aday, deneme dersinin grubu öğretmenin kapsamındaysa görünür.
const ownTrialClass: Rule = (c, r) => {
  const trial = value(r, 'trialLesson')
  return typeof trial === 'object' && trial !== null && member(c.classIds, text(trial, 'classId'))
}

/**
 * Aday alanlarının öğretmene görünürlüğü. `Record<keyof …>` her yeni alanda burada karar vermeyi
 * zorlar: gizlenen alanlar öğretmene dönmez, `true` olanlar dönür (DOM-DIL-031, DOM-YTK-021).
 */
const PROSPECT_TEACHER_VISIBLE = {
  id: true,
  name: true,
  branchId: true,
  interest: true,
  stage: true,
  minor: true,
  trialLesson: true,
  createdAt: true,
  updatedAt: true,
  phone: false,
  email: false,
  source: false,
  studentId: false,
  trialAt: false,
  notes: false,
  guardianName: false,
  referrerStudentId: false,
  siblingOfId: false,
  privacyNotice: false,
  marketingConsent: false,
  marketingConsentHistory: false,
  profileEdits: false,
  lostReason: false,
  lostAt: false,
  meeting: false,
  stageReverts: false,
  createdBy: false,
} as const satisfies Record<keyof State['prospects'][number], boolean>
const PROSPECT_TEACHER_HIDDEN = Object.entries(PROSPECT_TEACHER_VISIBLE)
  .filter(([, visible]) => !visible)
  .map(([field]) => field)
/**
 * Yalnız dil okulunda okuyabilen roller: öğretmenin deneme adayı okuması dil okuluna özgüdür
 * (DOM-DIL-030); okulda deneme dersi yoktur ve öğretmen aday koleksiyonuna hiç erişemez (403).
 */
const ONUR_LANGUAGE_SCHOOL_ONLY_READS: Readonly<Record<string, readonly Role[]>> = {
  prospects: ['ogretmen'],
}
const ONUR_HIDDEN_FIELDS: FieldRules = {
  prospects: (context) => (context.role === 'ogretmen' ? PROSPECT_TEACHER_HIDDEN : NONE),
}

export const ONUR_READ_RULES = {
  invoices: { ...ADMIN_FRONT_OFFICE, ...PERSONAL },
  contracts: { ...ADMIN_FRONT_OFFICE, veli: ownStudent },
  // Öğretmen yalnız kendi gruplarındaki deneme dersine katılan adayı okur (DOM-DIL-031); iletişim,
  // veli, not, rıza ve satış bilgisi `ONUR_HIDDEN_FIELDS` ile ayıklanır.
  prospects: { ...ADMIN_FRONT_OFFICE, ogretmen: ownTrialClass },
  renewals: { ...ADMIN_FRONT_OFFICE, veli: ownStudent },
  enrollmentHistory: { ...ADMIN_FRONT_OFFICE, veli: ownStudent },
} as const satisfies ReadRules
// Onur: kayıt ve finans sonu

const READ_RULES: Record<CollectionName, Partial<Record<Role, Rule>>> = {
  ...PLATFORM_READ_RULES,
  ...ONUR_READ_RULES,
}
const RULES: Readonly<Record<string, Partial<Record<Role, Rule>>>> = READ_RULES

/**
 * Alan ayıklama, maske ve aramadan çıkarılan alanlar: girdiler `platform/scope.ts`'tedir; kayıt
 * ve finans koleksiyonlarında bu tabloların girdisi yoktur. Onur'a gerekirse yukarıdaki bloğunda
 * kendi tablosunu açar ve buradaki birleşime ekler. Aynı koleksiyon iki kaynakta olamaz: sonra
 * yayılan tablo öncekini sessizce ezer (ör. `parents` ayıklaması düşer, öğrenci velinin
 * telefonunu görür). Davranış güvencesi `tests/parent-contact.test.ts` ve `tests/scope.test.ts`.
 */
const HIDDEN_FIELDS: FieldRules = { ...PLATFORM_HIDDEN_FIELDS, ...ONUR_HIDDEN_FIELDS }
const HIDDEN: Readonly<Record<string, ((context: Context) => readonly string[]) | undefined>> =
  HIDDEN_FIELDS

const MASKED_FIELDS: FieldRules = { ...PLATFORM_MASKED_FIELDS }
const MASKED: Readonly<Record<string, ((context: Context) => readonly string[]) | undefined>> =
  MASKED_FIELDS

/** Rol görse de serbest metin aramasına girmeyen alanlar (`Scope.searchExcludedFields`). */
export const UNSEARCHABLE_FIELDS: Partial<Record<CollectionName, readonly string[]>> = {
  ...PLATFORM_UNSEARCHABLE_FIELDS,
}

/** Listelerde gösterilen kimlik no: yalnız son dört hane (`*******1234`, guvenlik-kvkk.md §8). */
export function maskNationalId(value: string): string {
  return `${'*'.repeat(Math.max(value.length - 4, 0))}${value.slice(-4)}`
}

/** Yönetici ve ön büroya dönen öğrencide kimlik no maskelenir; tam değer hiçbir okumada dönmez. */
function maskStudent(row: Record<string, unknown>) {
  return typeof row.nationalId === 'string'
    ? { ...row, nationalId: maskNationalId(row.nationalId) }
    : row
}

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

/** Modül rol listesi dışında satır kuralıyla okuyan roller (`PLATFORM_READ_BEYOND_MODULE_ROLES`). */
const READ_BEYOND_MODULE_ROLES: Readonly<Record<string, readonly Role[]>> = {
  ...PLATFORM_READ_BEYOND_MODULE_ROLES,
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
    studentIds = new Set<string>(),
    payerStudentIds = new Set<string>()
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
    // Ödeyici bağlantısı sınıf ya da öğrenci kapsamı açmaz; yalnız finans kuralının kümesidir.
    if (role === 'veli')
      for (const id of linked('payer')) if (studentClass.has(id)) payerStudentIds.add(id)
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
  // Tembel: yalnız teslim ya da deneme kuralı sorulunca okunur. Ödevi ya da quizi yüklemeyen
  // işlemler (komut tablosunda koleksiyon yok) kaynağın bu anahtarına hiç dokunmaz.
  const ownWork = (items: () => readonly { id: string; teacherId: string }[] | undefined) => {
    let ids: ReadonlySet<string> | undefined
    return () =>
      (ids ??= new Set(
        teacher ? (items() ?? []).filter((w) => w.teacherId === teacher.id).map((w) => w.id) : [],
      ))
  }
  const ownHomework = ownWork(() => source.homework)
  const ownQuizzes = ownWork(() => source.quizzes)
  return {
    role,
    userId: actor.userId,
    teacher,
    counselor: teacher?.guidanceCounselor === true,
    studentIds,
    payerStudentIds,
    classIds,
    homeroomIds,
    branchIds,
    grades,
    levels,
    clubIds,
    get homeworkIds() {
      return ownHomework()
    },
    get quizIds() {
      return ownQuizzes()
    },
    classTeacherIds,
    studentClass,
    examGrade: new Map(source.mockExams.map((e) => [e.id, e.grade])),
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
    if (
      role &&
      institutionType !== 'language_school' &&
      ONUR_LANGUAGE_SCHOOL_ONLY_READS[collection]?.includes(role) === true
    )
      return deny('role_denied')
    const module = collectionModule(collection)
    const moduleRoles = module && module !== ALWAYS_ON ? MODULE_ROLES.get(module) : undefined
    const viaRule = !!role && READ_BEYOND_MODULE_ROLES[collection]?.includes(role) === true
    if (
      !role ||
      !RULES[collection]?.[role] ||
      (moduleRoles && !moduleRoles.includes(role) && !viaRule)
    )
      return deny('role_denied')
    return { allowed: true }
  }
  function access(collection: string) {
    let decision = decisions.get(collection)
    if (!decision) decisions.set(collection, (decision = decide(collection)))
    return decision
  }
  function readsWhole(collection: string) {
    return !!role && access(collection).allowed && RULES[collection]?.[role] === all
  }
  function canRead(collection: string, row: object) {
    if (!access(collection).allowed || !role) return false
    const rule = RULES[collection]?.[role]
    return !!rule && rule(context, row)
  }
  function hiddenFields(collection: string) {
    return (isCollectionName(collection) && HIDDEN[collection]?.(context)) || NONE
  }
  function maskedFields(collection: string) {
    return (isCollectionName(collection) && MASKED[collection]?.(context)) || NONE
  }
  function redact<T extends object>(collection: string, row: T): Redacted<T> {
    const hidden = hiddenFields(collection)
    let copy: Record<string, unknown> = Object.fromEntries(
      Object.entries(row).filter(([key]) => !hidden.includes(key)),
    )
    if (collection === 'tutorSessions') copy = narrowTutorSession(context, copy)
    if (collection === 'students') copy = maskStudent(copy)
    if (collection === 'parents' && maskedFields(collection).length > 0)
      copy = maskParentContact(copy)
    if (collection === 'announcements') copy = narrowAnnouncement(viewerOf(context), row, copy)
    // Kopya gizli alanları eksik, maskeli alanları (kimlik no, öğretmene veli iletişimi)
    // değiştirilmiş aynı kayıttır.
    return copy as Redacted<T>
  }
  return {
    actor,
    institutionType,
    teacher: context.teacher,
    counselor: context.counselor,
    studentIds: context.studentIds,
    payerStudentIds: context.payerStudentIds,
    classIds: context.classIds,
    get homeworkIds() {
      return context.homeworkIds
    },
    get quizIds() {
      return context.quizIds
    },
    access,
    readsWhole,
    canRead,
    hiddenFields,
    searchExcludedFields(collection: string) {
      const unsearchable = [
        ...((isCollectionName(collection) && UNSEARCHABLE_FIELDS[collection]) || NONE),
        ...maskedFields(collection),
      ]
      const hidden = hiddenFields(collection)
      return [...hidden, ...unsearchable.filter((field) => !hidden.includes(field))]
    },
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

/**
 * Finans kapsamındaki öğrenciler: kapsamdaki öğrenciler ve ödeyicisi olunan öğrenciler (K-04,
 * DOM-ILT-074). Yalnız finans okuması (bakiye, ekstre, tahsilat) içindir; akademik veya iletişim
 * kararında `studentIds` kullanılır.
 */
export function financeStudentIds(scope: Pick<Scope, 'studentIds' | 'payerStudentIds'>) {
  return new Set([...scope.studentIds, ...scope.payerStudentIds])
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
