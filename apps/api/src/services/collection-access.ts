import { ALWAYS_ON, collectionModule } from '@kampus/school-core/modules/collection-modules.ts'

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
 * Koleksiyon → modül eşlemesi ve kurum türü kısıtı core'dandır (`COLLECTION_MODULES`,
 * DOM-YTK-012); burada tutulmaz.
 */
export type ReadScope = 'institution'

export interface CollectionAccess {
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
  subjects: { read: EVERYONE },
  branches: { read: ADMIN_FRONT_OFFICE },
  classes: { read: ADMIN_FRONT_OFFICE },
  teachers: { read: ADMIN },
  // Ön büro kimlik, iletişim, sınıf ve finans bilgisini görür; akademik ilerleme görmez.
  students: { read: ADMIN_FRONT_OFFICE, omit: { onburo: ['progress'] } },
  parents: { read: ADMIN_FRONT_OFFICE },
  assignments: { read: ADMIN },
  grades: { read: ADMIN },
  attendance: { read: ADMIN },
  absences: { read: ADMIN },
  schedule: { read: ADMIN },
  invoices: { read: ADMIN_FRONT_OFFICE },
  contracts: { read: ADMIN_FRONT_OFFICE },
  prospects: { read: ADMIN_FRONT_OFFICE },
  bank: { read: ADMIN },
  quizzes: { read: ADMIN },
  quizAttempts: { read: ADMIN },
  homework: { read: ADMIN },
  submissions: { read: ADMIN },
  questions: { read: ADMIN },
  videos: { read: ADMIN },
  videoProgress: { read: ADMIN },
  materials: { read: ADMIN },
  announcements: { read: ADMIN_FRONT_OFFICE },
  conversations: null,
  appointments: { read: ADMIN },
  requests: { read: ADMIN_FRONT_OFFICE },
  availability: { read: ADMIN },
  audit: null,
  guidanceCases: {
    read: ADMIN,
    omit: { yonetici: GUIDANCE_INTERNAL },
  },
  mockExams: { read: ADMIN },
  mockResults: { read: ADMIN },
  studentGoals: { read: ADMIN },
  renewals: { read: ADMIN_FRONT_OFFICE },
  enrollmentHistory: { read: ADMIN_FRONT_OFFICE },
  studyTasks: { read: ADMIN },
  schoolEvents: { read: ADMIN_FRONT_OFFICE },
  eventConsents: { read: ADMIN_FRONT_OFFICE },
  transportRoutes: { read: ADMIN_FRONT_OFFICE },
  transportAssignments: { read: ADMIN_FRONT_OFFICE },
  // Menü kişisel veri taşımaz; yemek modülünün core rol listesindeki rollere açıktır.
  mealMenus: {
    read: {
      yonetici: 'institution',
      onburo: 'institution',
      ogrenci: 'institution',
      veli: 'institution',
    },
  },
  clubs: { read: ADMIN },
  clubMemberships: { read: ADMIN },
  clubAttendance: { read: ADMIN },
  socialAchievements: { read: ADMIN },
  opticalProfiles: { read: ADMIN },
  opticalEvaluations: { read: ADMIN },
  tutorSessions: { read: ADMIN },
} as const satisfies Record<CollectionName, CollectionAccess | null>

const ACCESS: Readonly<Record<CollectionName, CollectionAccess | null>> = COLLECTION_ACCESS

/** Okuma uçlarında görünen koleksiyonlar (OpenAPI açıklaması ve testler için). */
export const READABLE_COLLECTIONS: readonly CollectionName[] = RECORD_COLLECTIONS.filter(
  (name) => ACCESS[name] !== null,
)

export function collectionAccessTable(): Readonly<Record<CollectionName, CollectionAccess | null>> {
  return ACCESS
}

/** Koleksiyonun core modül anahtarı; `null` çekirdek kayıt (her modül kullanır, kapatılamaz). */
export function moduleOfCollection(collection: CollectionName): string | null {
  const module = collectionModule(collection)
  return module === undefined || module === ALWAYS_ON ? null : module
}

/** Okunabilir koleksiyon ve erişim kaydı; bilinmeyen veya açılmamış ad 404 (varlık sızdırılmaz). */
export function readableCollection(name: string): {
  collection: CollectionName
  access: CollectionAccess
  module: string | null
} {
  if (!isRecordCollection(name)) throw new NotFoundError()
  const access = ACCESS[name]
  if (!access) throw new NotFoundError()
  return { collection: name, access, module: moduleOfCollection(name) }
}

export interface RoleReadAccess {
  scope: ReadScope
  omit: readonly string[]
}

/** Rolün koleksiyonu okuma kapsamı; yoksa 403 (varsayılan ret, DOM-YTK-001). */
export function roleReadAccess(
  access: CollectionAccess,
  module: string | null,
  role: Role,
): RoleReadAccess {
  const scope = access.read[role]
  if (!scope || (module !== null && !moduleAllowsRole(module, role))) throw new ForbiddenError()
  return { scope, omit: access.omit?.[role] ?? [] }
}
