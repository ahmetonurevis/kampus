import type { State } from '@kampus/school-core/data/seed.ts'

/**
 * `records.collection` değerleri: school-core State'inin dizi anahtarları (veritabani.md §3).
 * Liste derleme anında State'le karşılaştırılır; core'a yeni koleksiyon eklenince burada
 * eklenmeden tip denetimi geçmez.
 * TODO(C2-record-schemas): liste ve kayıt şemaları school-core'a taşınınca oradan okunur.
 */
type ArrayKeys<T> = {
  [K in keyof T]-?: T[K] extends readonly unknown[] ? K : never
}[keyof T]

export type CollectionName = ArrayKeys<State> & string

/** Dizi olmayan State anahtarları (`modules`, `academicYear` …); `records`'ta tutulmaz. */
export type ScalarStateKey = Exclude<keyof State, CollectionName> & string

const COLLECTION_FLAGS = {
  subjects: true,
  assignments: true,
  branches: true,
  teachers: true,
  classes: true,
  students: true,
  parents: true,
  grades: true,
  attendance: true,
  invoices: true,
  prospects: true,
  bank: true,
  quizzes: true,
  homework: true,
  submissions: true,
  questions: true,
  videos: true,
  videoProgress: true,
  materials: true,
  announcements: true,
  conversations: true,
  conversationMessages: true,
  appointments: true,
  requests: true,
  schedule: true,
  availability: true,
  quizAttempts: true,
  absences: true,
  notifications: true,
  notificationReads: true,
  contracts: true,
  audit: true,
  guidanceCases: true,
  mockExams: true,
  mockResults: true,
  studentGoals: true,
  renewals: true,
  enrollmentHistory: true,
  studyTasks: true,
  schoolEvents: true,
  eventConsents: true,
  transportRoutes: true,
  transportAssignments: true,
  mealMenus: true,
  clubs: true,
  clubMemberships: true,
  clubAttendance: true,
  socialAchievements: true,
  opticalProfiles: true,
  opticalEvaluations: true,
  tutorSessions: true,
} as const satisfies Record<CollectionName, true>

const SCALAR_FLAGS = {
  version: true,
  createdAt: true,
  preferences: true,
  modules: true,
  academicYear: true,
} as const satisfies Record<ScalarStateKey, true>

const COLLECTION_SET: ReadonlySet<string> = new Set(Object.keys(COLLECTION_FLAGS))
const SCALAR_SET: ReadonlySet<string> = new Set(Object.keys(SCALAR_FLAGS))

export function isRecordCollection(value: string): value is CollectionName {
  return COLLECTION_SET.has(value)
}

export function isScalarStateKey(value: string): value is ScalarStateKey {
  return SCALAR_SET.has(value)
}

export const RECORD_COLLECTIONS: readonly CollectionName[] =
  Object.keys(COLLECTION_FLAGS).filter(isRecordCollection)

/**
 * Core'un kendi tuttuğu ama sunucuda kalıcı yazılmayan koleksiyonlar. `audit`: core işlem
 * başına değerleri maskesiz (rehberlik iç notu, sağlık) ve sabit demo kullanıcısıyla (`t1`,
 * `s1`) ekler, 200 kayda kırpar. Sunucuda denetim yalnız `audit_log`'a gerçek aktör ve alan
 * adlarıyla yazılır (veritabani.md §8); işlem çalıştırıcı bu koleksiyonu boş verir ve
 * değişikliklerini yok sayar. Mevcut satırlar `0005_archive_core_audit_records` ile arşivlendi.
 */
export type EphemeralCollection = 'audit'
const EPHEMERAL_SET: ReadonlySet<string> = new Set<EphemeralCollection>(['audit'])

export function isEphemeralCollection(value: string): value is EphemeralCollection {
  return EPHEMERAL_SET.has(value)
}

/** `records`'a yazılan koleksiyonlar (geçici olanlar hariç). */
export const STORED_COLLECTIONS: readonly CollectionName[] = RECORD_COLLECTIONS.filter(
  (collection) => !isEphemeralCollection(collection),
)

/** Kayıt verisi: düz JSON nesnesi. Kolonlar (`version`, `archived_at` …) içine yazılmaz. */
export type RecordData = Record<string, unknown>

/**
 * Kaydın koleksiyon içindeki kimliği. `videoProgress` öğelerinin `id` alanı yoktur; anahtar
 * öğrenci + video çiftinden türetilir ve veri olduğu gibi saklanır.
 * TODO(C2-record-schemas): core `videoProgress` kayıtlarına `id` verince bu istisna kalkar.
 */
export function recordKey(collection: CollectionName, data: RecordData): string | null {
  if (collection === 'videoProgress') {
    const { studentId, videoId } = data
    return typeof studentId === 'string' && typeof videoId === 'string'
      ? `${studentId}:${videoId}`
      : null
  }
  return typeof data.id === 'string' && data.id.length > 0 ? data.id : null
}
