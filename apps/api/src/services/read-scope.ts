import { z } from 'zod'

import {
  scopeFor,
  SCOPE_SOURCE_COLLECTIONS,
  type Actor,
  type Scope,
  type ScopeSource,
} from '@kampus/school-core/lib/scope.ts'

import type { Role } from '../auth.ts'
import type { CollectionName, RecordData } from '../db/collections.ts'
import { loadRecords, type RecordFilter } from '../db/records.ts'
import { ForbiddenError, NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { ModuleDisabledError } from '../plugins/modules.ts'
import { listMembershipLinks } from './memberships.ts'
import { getInstitutionModules } from './modules.ts'

/**
 * Okuma kapsamı (DOM-YTK-001, -020…-026): oturumdaki rol ve üyelik bağlantıları (`links`) core
 * aktörüne çevrilir, kapsam kaynağı kurum kayıtlarından yüklenir ve `scopeFor` ile hesaplanır.
 * Satır süzme ve alan ayıklama core'dadır; API kapsamı ikinci kez yazmaz.
 *
 * Kaynak arşivlenmemiş kayıtlardır (işlemlerin gördüğü State ile aynı): arşivlenen öğrenci veya
 * öğretmen kaydı kapsam vermez. Kurum kaydı yoksa kapsam en dar varsayılandır (modüller kapalı).
 */

// Kapsamın okuduğu alanlar; tür tutmayan satır kapsam vermez (en dar varsayılan).
const studentSource = z.object({ id: z.string(), classId: z.string() }) satisfies z.ZodType<
  ScopeSource['students'][number]
>
const teacherSource = z
  .object({
    id: z.string(),
    subjectId: z.string(),
    branchId: z.string(),
    // Alanı olmayan öğretmen core'da etkindir (`isActive !== false`, `deletedAt` boş).
    isActive: z.boolean().optional(),
    deletedAt: z.string().nullable().optional(),
    guidanceCounselor: z.boolean().optional(),
  })
  .transform(({ isActive, deletedAt, guidanceCounselor, ...rest }) => ({
    ...rest,
    isActive: isActive ?? true,
    deletedAt: deletedAt ?? null,
    ...(guidanceCounselor === undefined ? {} : { guidanceCounselor }),
  })) satisfies z.ZodType<ScopeSource['teachers'][number]>
const classSource = z.object({
  id: z.string(),
  grade: z.number(),
  level: z.string(),
  branchId: z.string(),
  teacherId: z.string(),
}) satisfies z.ZodType<ScopeSource['classes'][number]>
const assignmentSource = z.object({
  classId: z.string(),
  teacherId: z.string(),
}) satisfies z.ZodType<ScopeSource['assignments'][number]>
const clubSource = z.object({ id: z.string(), teacherId: z.string() }) satisfies z.ZodType<
  ScopeSource['clubs'][number]
>

type SourceCollection = (typeof SCOPE_SOURCE_COLLECTIONS)[number]

function parseRows<T>(
  ctx: ServiceContext,
  collection: CollectionName,
  rows: readonly RecordData[],
  schema: z.ZodType<T>,
): T[] {
  const parsed: T[] = []
  let skipped = 0
  for (const row of rows) {
    const result = schema.safeParse(row)
    if (result.success) parsed.push(result.data)
    else skipped += 1
  }
  // Yalnız sayı loglanır; satır içeriği kişisel veri taşır.
  if (skipped > 0) ctx.log.warn({ event: 'scope.source_invalid', collection, skipped })
  return parsed
}

interface ScopeState {
  scope: Scope
  source: ScopeSource
}

async function buildScope(ctx: ServiceContext): Promise<ScopeState> {
  const [institution, links, rows] = await Promise.all([
    getInstitutionModules(ctx.db, ctx.institutionId),
    listMembershipLinks(ctx.db, ctx.institutionId, ctx.actor.membershipId),
    loadRecords(ctx.db, ctx.institutionId, SCOPE_SOURCE_COLLECTIONS),
  ])
  const byCollection = new Map<string, RecordData[]>(
    SCOPE_SOURCE_COLLECTIONS.map((name) => [name, []]),
  )
  for (const row of rows) byCollection.get(row.collection)?.push(row.data)
  const data = (name: SourceCollection) => byCollection.get(name) ?? []
  const source: ScopeSource = {
    students: parseRows(ctx, 'students', data('students'), studentSource),
    teachers: parseRows(ctx, 'teachers', data('teachers'), teacherSource),
    classes: parseRows(ctx, 'classes', data('classes'), classSource),
    assignments: parseRows(ctx, 'assignments', data('assignments'), assignmentSource),
    clubs: parseRows(ctx, 'clubs', data('clubs'), clubSource),
    modules: institution?.modules ?? {},
  }
  const actor: Actor = { role: ctx.actor.role, links, userId: ctx.actor.userId }
  return {
    scope: scopeFor(source, actor, { institutionType: institution?.type ?? 'school' }),
    source,
  }
}

// Servis bağlamı istek başına bir kez kurulur; kapsam aynı istekte yeniden hesaplanmaz.
const states = new WeakMap<
  ServiceContext,
  { scope: Promise<Scope>; source: Promise<ScopeSource> }
>()

function scopeState(ctx: ServiceContext) {
  let state = states.get(ctx)
  if (!state) {
    const built = buildScope(ctx)
    state = { scope: built.then((item) => item.scope), source: built.then((item) => item.source) }
    states.set(ctx, state)
    // Başarısız yükleme önbellekte kalmaz.
    built.catch(() => states.delete(ctx))
    state.source.catch(() => {})
  }
  return state
}

/** İsteğin okuma kapsamı; aynı bağlamda ikinci çağrı önbellekten döner. */
export function readScope(ctx: ServiceContext): Promise<Scope> {
  return scopeState(ctx).scope
}

/** Kapsamın kurduğu kaynak (öğrenci, öğretmen, sınıf, atama); ek sorgu yok. */
export function readSource(ctx: ServiceContext): Promise<ScopeSource> {
  return scopeState(ctx).source
}

/**
 * Sınıfların (arşivlenmemiş) öğrencileri, kapsam kaynağından (ek sorgu yok). Kurumun bütün
 * öğrencileri arasından seçilir: sonuç yalnız aday süzgecidir, her satır yine core `canRead`
 * ile süzülür. Sınıf öğrencinin güncel sınıfıdır (`students.classId`).
 */
export async function studentsOfClasses(
  ctx: ServiceContext,
  classIds: readonly string[],
): Promise<string[]> {
  const source = await scopeState(ctx).source
  const wanted = new Set(classIds)
  return source.students.filter((student) => wanted.has(student.classId)).map((s) => s.id)
}

/**
 * Öğrenci → güncel sınıf eşlemesi, kapsam kaynağından (ek sorgu yok). Yalnız kapsamdan geçmiş
 * satırları etiketlemek (sınıfa göre gruplama) için kullanılır; kapsam kararı vermez.
 */
export async function studentClasses(ctx: ServiceContext): Promise<ReadonlyMap<string, string>> {
  const source = await scopeState(ctx).source
  return new Map(source.students.map((student) => [student.id, student.classId]))
}

/**
 * Koleksiyon bu aktöre açık mı; değilse API hatası: bilinmeyen koleksiyon veya kurum türünde
 * olmayan modül 404 (DOM-YTK-012), kapalı modül 403 `module_disabled` (DOM-YTK-040), rolün
 * okuyamadığı koleksiyon 403 `forbidden` (varsayılan ret, DOM-YTK-001).
 */
export function assertReadable(ctx: ServiceContext, scope: Scope, collection: CollectionName) {
  const decision = scope.access(collection)
  if (decision.allowed) return
  ctx.log.info({ event: 'collection.read_denied', collection, reason: decision.reason })
  switch (decision.reason) {
    case 'unknown_collection':
    case 'module_unavailable':
      throw new NotFoundError()
    case 'module_disabled':
      throw new ModuleDisabledError()
    case 'role_denied':
      throw new ForbiddenError()
    default:
      throw decision.reason satisfies never
  }
}

/**
 * Okuyabildiği her koleksiyonu bütünüyle okuyan roller: core kurallarında yönetici ve ön büro
 * için satır kuralı her koleksiyonda koşulsuzdur (`all`); kapsam yalnız koleksiyon erişimi ve
 * alan ayıklamasıdır. Bu bilgiyle süzgeçsiz liste sayfalaması SQL'e iner (`collection-reads.ts`).
 * Testler her okunabilir koleksiyonda bu rollerin rastgele kimlikli satırı da okuduğunu doğrular;
 * çalışma anında sayfadaki her satır yine `canRead`'den geçer, geçmeyen olursa bellek yoluna
 * dönülür.
 * TODO(core-full-scope): core "rol koleksiyonun tamamını okur" bilgisini verince tablo kalkar.
 */
const WHOLE_COLLECTION_ROLES: ReadonlySet<Role> = new Set<Role>(['yonetici', 'onburo'])

export function readsWholeCollection(scope: Scope, collection: CollectionName): boolean {
  return WHOLE_COLLECTION_ROLES.has(scope.actor.role) && scope.access(collection).allowed
}

type ScopeKey = 'studentId' | 'classId'

/**
 * SQL ön süzgeci (performans): büyük kişisel koleksiyonlarda rolün core kuralı satırın öğrencisinin
 * veya sınıfının kapsamda olmasını gerektirir (`ownStudent`, `ownClass`, `subjectOrHomeroom`,
 * `gradeReader`). Veritabanı yalnız bu kimliklerin satırlarını döndürür; her satır yine core
 * `canRead` ile süzülür. Süzgeç gerekli koşuldur: yalnız adayları daraltır, kararı core verir;
 * core'un görünür saydığı hiçbir satırı dışlamamalıdır. Birden çok anahtar "biri yeter" demektir:
 * öğretmen notu, verildiği sınıf (`classId`) kapsamdaysa (öğrenci sonradan sınıf değiştirmiş olsa
 * da) ya da öğrenci güncel sınıfındaysa görür (`gradeReader`). Testler örnek verideki her demo
 * aktörü ve sınıf değiştiren öğrenci için core sonucunun süzgecin alt kümesi olduğunu doğrular.
 * TODO(perf): core kapsamı koleksiyon başına SQL'e çevrilebilir anahtar tanımı verince
 * (`scope.keys(collection)` gibi) bu tablo kalkar; yönetici listesinde de sayfalama ve sıralama
 * SQL'e iner. O zamana kadar yönetici ve ön büro büyük koleksiyonu tümüyle yükler.
 */
const PREFILTER: Partial<Record<CollectionName, Partial<Record<Role, readonly ScopeKey[]>>>> = {
  grades: { ogretmen: ['studentId', 'classId'], ogrenci: ['studentId'], veli: ['studentId'] },
  attendance: { ogretmen: ['classId'], ogrenci: ['studentId'], veli: ['studentId'] },
  invoices: { ogrenci: ['studentId'], veli: ['studentId'] },
  contracts: { veli: ['studentId'] },
  submissions: { ogretmen: ['studentId'], ogrenci: ['studentId'], veli: ['studentId'] },
  quizAttempts: { ogretmen: ['studentId'], ogrenci: ['studentId'], veli: ['studentId'] },
  schedule: { ogrenci: ['classId'], veli: ['classId'] },
}

/** Koleksiyonun bu aktör için SQL ön süzgeci; tabloda yoksa `null` (bütün koleksiyon yüklenir). */
export function scopePrefilter(scope: Scope, collection: CollectionName): RecordFilter | null {
  const keys = PREFILTER[collection]?.[scope.actor.role]
  if (!keys) return null
  const matches = keys.map((field) => ({
    field,
    values: [...(field === 'studentId' ? scope.studentIds : scope.classIds)],
  }))
  const [only] = matches
  return matches.length === 1 && only ? only : { kind: 'any', matches }
}
