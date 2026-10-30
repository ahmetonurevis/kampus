import type { State } from '../data/seed.ts'

/**
 * Koleksiyon → modül eşlemesi ve kurum türü kısıtı (docs/domain/yetki-ve-kapsam.md).
 *
 * - DOM-YTK-040: kapalı modülün koleksiyonu okuma dahil kapanır; eşleme bu kararın tek yeridir.
 * - DOM-YTK-012: kurum türüne uymayan modül açılamaz; o kurumda bulunmaz gibi davranır.
 *
 * Web, mobil ve API aynı tabloyu okur; API kendi kopyasını tutmaz.
 */

export const INSTITUTION_TYPES = ['school', 'language_school'] as const
export type InstitutionType = (typeof INSTITUTION_TYPES)[number]

const BOTH = INSTITUTION_TYPES
const SCHOOL_ONLY = ['school'] as const satisfies readonly InstitutionType[]

/**
 * Bilinen her modül ve açılabildiği kurum türleri. Temel modüller (`crm` … `communication`) menü
 * sayfalarından, okul iş akışı modülleri `modules/school-workflows.ts` kaydından gelir; testler
 * anahtar kümesinin bu iki kaynakla aynı kaldığını doğrular.
 */
export const MODULE_INSTITUTION_TYPES = {
  crm: BOTH,
  finance: BOTH,
  academic: BOTH,
  learning: BOTH,
  communication: BOTH,
  // Optik değerlendirme, otomatik etüt ve hedefler LGS/YKS denemesine dayanır (DOM-YTK-012).
  optical: SCHOOL_ONLY,
  tutoring: SCHOOL_ONLY,
  // Rehberlik yalnız `school` için tanımlıdır (DOM-YTK-026, DOM-ILT-040).
  guidance: SCHOOL_ONLY,
  exams: SCHOOL_ONLY,
  goals: SCHOOL_ONLY,
  // Kayıt yenileme bir üst sınıf düzeyine geçirir; sınıf geçme yalnız `school` (DOM-YTK-012).
  renewal: SCHOOL_ONLY,
  planning: BOTH,
  study: BOTH,
  calendar: BOTH,
  transport: BOTH,
  meals: BOTH,
  clubs: BOTH,
} as const satisfies Record<string, readonly InstitutionType[]>

export type ModuleKey = keyof typeof MODULE_INSTITUTION_TYPES
export const MODULE_KEYS = Object.keys(MODULE_INSTITUTION_TYPES) as readonly ModuleKey[]

type ArrayKeys<T> = {
  [K in keyof T]-?: T[K] extends readonly unknown[] ? K : never
}[keyof T]
/** Kayıt koleksiyonları: State'in dizi anahtarları (`records.collection` değerleri). */
export type CollectionName = ArrayKeys<State> & string

/** Modüle bağlı olmayan, kapatılamayan çekirdek koleksiyon. */
export const ALWAYS_ON = 'always-on'
export type CollectionModule = ModuleKey | typeof ALWAYS_ON

/**
 * Her koleksiyon tek modüle bağlıdır ya da açıkça her zaman açıktır. Birden çok modülün okuduğu
 * koleksiyon (ör. `mockExams`: deneme, optik, etüt) sahibi olan modüle bağlanır. Yeni koleksiyon
 * eklenince burada eşlenmeden tip denetimi geçmez.
 */
export const COLLECTION_MODULES = {
  subjects: ALWAYS_ON,
  branches: ALWAYS_ON,
  classes: ALWAYS_ON,
  teachers: ALWAYS_ON,
  students: ALWAYS_ON,
  parents: ALWAYS_ON,
  // Core'un yerel denetim listesi; görünürlüğü kapsam tablosu daraltır (DOM-YTK-053).
  audit: ALWAYS_ON,
  assignments: 'academic',
  grades: 'academic',
  attendance: 'academic',
  absences: 'academic',
  schedule: 'academic',
  invoices: 'finance',
  contracts: 'finance',
  prospects: 'crm',
  bank: 'learning',
  quizzes: 'learning',
  quizAttempts: 'learning',
  homework: 'learning',
  submissions: 'learning',
  questions: 'learning',
  videos: 'learning',
  videoProgress: 'learning',
  materials: 'learning',
  announcements: 'communication',
  conversations: 'communication',
  appointments: 'communication',
  requests: 'communication',
  availability: 'communication',
  guidanceCases: 'guidance',
  mockExams: 'exams',
  mockResults: 'exams',
  studentGoals: 'goals',
  renewals: 'renewal',
  enrollmentHistory: 'renewal',
  studyTasks: 'study',
  schoolEvents: 'calendar',
  eventConsents: 'calendar',
  transportRoutes: 'transport',
  transportAssignments: 'transport',
  mealMenus: 'meals',
  clubs: 'clubs',
  clubMemberships: 'clubs',
  clubAttendance: 'clubs',
  socialAchievements: 'clubs',
  opticalProfiles: 'optical',
  opticalEvaluations: 'optical',
  tutorSessions: 'tutoring',
} as const satisfies Record<CollectionName, CollectionModule>

const COLLECTION_TABLE: Readonly<Record<string, CollectionModule>> = COLLECTION_MODULES
const MODULE_TABLE: Readonly<Record<string, readonly InstitutionType[]>> = MODULE_INSTITUTION_TYPES

export const COLLECTION_NAMES = Object.keys(COLLECTION_MODULES) as readonly CollectionName[]

/** Ad dışarıdan gelir; `toString` gibi yerleşik özellikler koleksiyon sayılmaz. */
export function isCollectionName(name: string): name is CollectionName {
  return Object.hasOwn(COLLECTION_TABLE, name)
}

export function isModuleKey(key: string): key is ModuleKey {
  return Object.hasOwn(MODULE_TABLE, key)
}

/** Koleksiyonun modülü; bilinmeyen koleksiyon `undefined`. */
export function collectionModule(name: string): CollectionModule | undefined {
  return isCollectionName(name) ? COLLECTION_TABLE[name] : undefined
}

/** Modül bu kurum türünde açılabilir mi (DOM-YTK-012); bilinmeyen modül hiçbir türde açılmaz. */
export function moduleAvailableFor(key: string, type: InstitutionType): boolean {
  return isModuleKey(key) && (MODULE_TABLE[key] ?? []).includes(type)
}

/** Kurum türünde bulunan modüller (ayar ekranı ve API modül haritası için). */
export function modulesFor(type: InstitutionType): ModuleKey[] {
  return MODULE_KEYS.filter((key) => moduleAvailableFor(key, type))
}

/**
 * Koleksiyonun bu kurumda kullanılabilirliği: kurum türünde yoksa `unavailable` (API 404),
 * modül kapalıysa `disabled` (API 403 `module_disabled`), değilse `enabled`. Modül haritasında
 * bulunmayan modül kapalı sayılır (varsayılan ret).
 */
export function collectionStatus(
  name: string,
  modules: Readonly<Record<string, boolean>>,
  type: InstitutionType,
): 'unknown' | 'unavailable' | 'disabled' | 'enabled' {
  const module = collectionModule(name)
  if (module === undefined) return 'unknown'
  if (module === ALWAYS_ON) return 'enabled'
  if (!moduleAvailableFor(module, type)) return 'unavailable'
  return modules[module] === true ? 'enabled' : 'disabled'
}
