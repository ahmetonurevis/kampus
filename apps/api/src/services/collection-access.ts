import type { Role } from '../auth.ts'
import { isRecordCollection, RECORD_COLLECTIONS, type CollectionName } from '../db/collections.ts'
import { ForbiddenError, NotFoundError } from '../errors.ts'
import { moduleAllowsRole } from './modules.ts'

/**
 * Koleksiyon okuma erişimi (DOM-YTK-001, -020…-026; docs/domain/yetki-ve-kapsam.md matrisi).
 *
 * Kapsam kayıt düzeyinde school-core'un kapsam fonksiyonlarıyla uygulanmalıdır; core bugün
 * yalnız sabit kimliklerle (`s1`, `t1`, `p1`) çalışan `workflowScope`'u veriyor, oturumdaki
 * kişiye göre kapsam hesaplayan fonksiyon yok. Bu yüzden kayıt düzeyinde kapsam gerektiren
 * rollerde (öğretmen kendi sınıfları/branşı, öğrenci kendisi, veli `links` ile çocukları)
 * kişisel veri taşıyan koleksiyonlar en dar varsayılanla kapalıdır (403). Açık olanlar:
 * - `institution`: rol kurumun bütün kayıtlarını okur (yönetici; ön büro yalnız idari
 *   koleksiyonlarda, DOM-YTK-021). Kişisel veri taşımayan kurum geneli başvuru verisi
 *   (`subjects`, `mealMenus`) ilgili modülü kullanan her role açıktır.
 * TODO(core-scope): core kişiye göre kapsam fonksiyonu (`scopeFor(state, { role, links })` gibi)
 * verince öğretmen/öğrenci/veli satırları o fonksiyonla açılır; API kapsamı yeniden yazmaz.
 *
 * Modül eşlemesi de core'da yok (komut→modül ve komut→koleksiyon tabloları dışa aktarılmıyor);
 * tek yer burasıdır ve anahtarlar core modül kaydına karşı test edilir.
 * TODO(core-collection-modules): core koleksiyon→modül eşlemesini dışa aktarınca oradan okunur.
 */
export type ReadScope = 'institution'

export interface CollectionAccess {
  /** school-core modül anahtarı; `null` çekirdek kayıt (her modül kullanır, kapatılamaz). */
  module: string | null
  read: Partial<Record<Role, ReadScope>>
  /** Alan kapsamı: rol bu alanları hiç görmez (yanıt, arama, filtre ve sıralama dahil). */
  omit?: Partial<Record<Role, readonly string[]>>
}

const ADMIN = { yonetici: 'institution' } as const satisfies CollectionAccess['read']
const ADMIN_FRONT_OFFICE = {
  yonetici: 'institution',
  onburo: 'institution',
} as const satisfies CollectionAccess['read']
const EVERYONE = {
  yonetici: 'institution',
  onburo: 'institution',
  ogretmen: 'institution',
  ogrenci: 'institution',
  veli: 'institution',
} as const satisfies CollectionAccess['read']

/** Rehberlik iç notu ve not geçmişi yalnız rehber öğretmenindir (DOM-YTK-020, DOM-ILT-040). */
const GUIDANCE_INTERNAL = ['internalNote', 'notes'] as const

/**
 * `null`: okuma uçlarında yok (404). `audit` core'un yerel denetim listesidir; sunucuda denetim
 * `audit_log` tablosundadır ve ayrı uçla açılır. `conversations` birebir yazışmadır; yöneticinin
 * okuması gerekçeli ve denetim kayıtlı ayrı işlemdir (DOM-YTK-052), genel okumaya açılmaz.
 */
const COLLECTION_ACCESS = {
  subjects: { module: null, read: EVERYONE },
  branches: { module: null, read: ADMIN_FRONT_OFFICE },
  classes: { module: null, read: ADMIN_FRONT_OFFICE },
  teachers: { module: null, read: ADMIN },
  // Ön büro kimlik, iletişim, sınıf ve finans bilgisini görür; akademik ilerleme görmez.
  students: { module: null, read: ADMIN_FRONT_OFFICE, omit: { onburo: ['progress'] } },
  parents: { module: null, read: ADMIN_FRONT_OFFICE },
  assignments: { module: 'academic', read: ADMIN },
  grades: { module: 'academic', read: ADMIN },
  attendance: { module: 'academic', read: ADMIN },
  absences: { module: 'academic', read: ADMIN },
  schedule: { module: 'academic', read: ADMIN },
  invoices: { module: 'finance', read: ADMIN_FRONT_OFFICE },
  contracts: { module: 'finance', read: ADMIN_FRONT_OFFICE },
  prospects: { module: 'crm', read: ADMIN_FRONT_OFFICE },
  bank: { module: 'learning', read: ADMIN },
  quizzes: { module: 'learning', read: ADMIN },
  quizAttempts: { module: 'learning', read: ADMIN },
  homework: { module: 'learning', read: ADMIN },
  submissions: { module: 'learning', read: ADMIN },
  questions: { module: 'learning', read: ADMIN },
  videos: { module: 'learning', read: ADMIN },
  videoProgress: { module: 'learning', read: ADMIN },
  materials: { module: 'learning', read: ADMIN },
  announcements: { module: 'communication', read: ADMIN_FRONT_OFFICE },
  conversations: null,
  appointments: { module: 'communication', read: ADMIN },
  requests: { module: 'communication', read: ADMIN_FRONT_OFFICE },
  availability: { module: 'communication', read: ADMIN },
  audit: null,
  guidanceCases: {
    module: 'guidance',
    read: ADMIN,
    omit: { yonetici: GUIDANCE_INTERNAL },
  },
  mockExams: { module: 'exams', read: ADMIN },
  mockResults: { module: 'exams', read: ADMIN },
  studentGoals: { module: 'goals', read: ADMIN },
  renewals: { module: 'renewal', read: ADMIN_FRONT_OFFICE },
  enrollmentHistory: { module: 'renewal', read: ADMIN_FRONT_OFFICE },
  studyTasks: { module: 'study', read: ADMIN },
  schoolEvents: { module: 'calendar', read: ADMIN_FRONT_OFFICE },
  eventConsents: { module: 'calendar', read: ADMIN_FRONT_OFFICE },
  transportRoutes: { module: 'transport', read: ADMIN_FRONT_OFFICE },
  transportAssignments: { module: 'transport', read: ADMIN_FRONT_OFFICE },
  // Menü kişisel veri taşımaz; yemek modülünün core rol listesindeki rollere açıktır.
  mealMenus: {
    module: 'meals',
    read: {
      yonetici: 'institution',
      onburo: 'institution',
      ogrenci: 'institution',
      veli: 'institution',
    },
  },
  clubs: { module: 'clubs', read: ADMIN },
  clubMemberships: { module: 'clubs', read: ADMIN },
  clubAttendance: { module: 'clubs', read: ADMIN },
  socialAchievements: { module: 'clubs', read: ADMIN },
  opticalProfiles: { module: 'optical', read: ADMIN },
  opticalEvaluations: { module: 'optical', read: ADMIN },
  tutorSessions: { module: 'tutoring', read: ADMIN },
} as const satisfies Record<CollectionName, CollectionAccess | null>

const ACCESS: Readonly<Record<CollectionName, CollectionAccess | null>> = COLLECTION_ACCESS

/** Okuma uçlarında görünen koleksiyonlar (OpenAPI açıklaması ve testler için). */
export const READABLE_COLLECTIONS: readonly CollectionName[] = RECORD_COLLECTIONS.filter(
  (name) => ACCESS[name] !== null,
)

export function collectionAccessTable(): Readonly<Record<CollectionName, CollectionAccess | null>> {
  return ACCESS
}

/** Okunabilir koleksiyon ve erişim kaydı; bilinmeyen veya açılmamış ad 404 (varlık sızdırılmaz). */
export function readableCollection(name: string): {
  collection: CollectionName
  access: CollectionAccess
} {
  if (!isRecordCollection(name)) throw new NotFoundError()
  const access = ACCESS[name]
  if (!access) throw new NotFoundError()
  return { collection: name, access }
}

export interface RoleReadAccess {
  scope: ReadScope
  omit: readonly string[]
}

/** Rolün koleksiyonu okuma kapsamı; yoksa 403 (varsayılan ret, DOM-YTK-001). */
export function roleReadAccess(access: CollectionAccess, role: Role): RoleReadAccess {
  const scope = access.read[role]
  if (!scope || (access.module !== null && !moduleAllowsRole(access.module, role)))
    throw new ForbiddenError()
  return { scope, omit: access.omit?.[role] ?? [] }
}
