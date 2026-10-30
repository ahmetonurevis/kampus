import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  not,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'

import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import {
  isContentStaff,
  normalizeSearchText,
  searchDocument,
  type ContentActor,
  type ResourceContent,
  type ResourceLicense,
  type ResourceRecord,
  type ResourceStatus,
  type ResourceTags,
  type ResourceVersion,
} from '@kampus/school-core/content/resource.ts'
import type { ContentLearner, ContentViewer } from '@kampus/school-core/content/visibility.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import type { Database } from './client.ts'
import {
  resources,
  resourceShares,
  resourceVersionItems,
  resourceVersionOutcomes,
  resourceVersions,
  type ResourceRow,
  type ResourceVersionRow,
} from './schema/resources.ts'

/**
 * İçerik havuzu deposu (ADR 0004 karar 3; veritabani.md §6). Her fonksiyonun ilk parametresi
 * `institutionId`'dir ve yalnız servis bağlamından gelir; sorgular onu her zaman süzer.
 *
 * Görünürlük SQL'i core `canReadVersion` (`content/visibility.ts`, `staffCanReadVersion`)
 * kararının çevirisidir ve yalnız adayları daraltır: servis sayfa satırlarını core ile yeniden
 * doğrular. `test/resource-visibility.test.ts` iki kararın rol matrisinde eşit olduğunu sınar.
 */

type ResourcesTable = typeof resources
type VersionsTable = typeof resourceVersions

/** Kaynak satırı, core kaydı ve sistem kolonları. */
export type StoredResource = ResourceRecord & {
  createdAt: string
  updatedAt: string
  archivedAt: string | null
  /** Satır sürümü (iyimser kilit). */
  rowVersion: number
}

/**
 * Sürüm satırı. Kaldırılan sürümde içerik ve cevap anahtarı yoktur (`content` boş, DOM-KYN-051);
 * core'a giderken `asCoreVersion` kullanılır.
 */
export type StoredResourceVersion = Omit<ResourceVersion, 'content'> & {
  content: ResourceContent | null
  licenseKind: ResourceLicense['kind'] | null
  updatedAt: string
  rowVersion: number
}

const iso = (value: Date) => value.toISOString()
const isoOrNull = (value: Date | null) => (value === null ? null : value.toISOString())
const dateOrNull = (value: string | null) => (value === null ? null : new Date(value))

/**
 * Core'un `ResourceVersion` tipi içerik taşır. Kaldırılan sürümün içeriği silinmiştir; core
 * görünürlük ve durum kararları içeriğe bakmaz, bu yüzden boş bir metin yer tutucusu verilir.
 * Yer tutucu yanıta gitmez: yanıt `StoredResourceVersion.content`'i (boş) kullanır.
 */
const REMOVED_PLACEHOLDER: ResourceContent = { type: 'text', body: null, fileId: null }
export function asCoreVersion(version: StoredResourceVersion): ResourceVersion {
  // Fazla alanlar (`licenseKind`, `updatedAt`, `rowVersion`) core kararlarını etkilemez.
  return { ...version, content: version.content ?? REMOVED_PLACEHOLDER }
}

// --- Satır dönüşümleri --------------------------------------------------------------------

function toStoredResource(
  row: ResourceRow,
  ownerActive: boolean,
  shares: readonly { targetKind: string; targetId: string }[],
): StoredResource {
  return {
    id: row.id,
    contentType: row.contentType,
    ownerUserId: row.ownerUserId,
    ownerActive,
    shareScope: row.shareScope,
    sharedStudentIds: shares.filter((s) => s.targetKind === 'student').map((s) => s.targetId),
    sharedClassIds: shares.filter((s) => s.targetKind === 'class').map((s) => s.targetId),
    currentVersionId: row.currentVersionId,
    derivedFromVersionId: row.derivedFromVersionId,
    derivedFromPlatformVersionId: row.derivedFromPlatformVersionId,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    archivedAt: isoOrNull(row.archivedAt),
    rowVersion: row.version,
  }
}

function toStoredVersion(
  row: ResourceVersionRow,
  outcomes: ResourceTags['outcomes'],
): StoredResourceVersion {
  return {
    id: row.id,
    resourceId: row.resourceId,
    versionNumber: row.versionNumber,
    status: row.status,
    authorUserId: row.authorUserId,
    createdAt: iso(row.createdAt),
    submittedAt: isoOrNull(row.submittedAt),
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: isoOrNull(row.reviewedAt),
    rejectionReason: row.rejectionReason,
    publishedAt: isoOrNull(row.publishedAt),
    archivedAt: isoOrNull(row.archivedAt),
    removedAt: isoOrNull(row.removedAt),
    removalReason: row.removalReason,
    title: row.title,
    content: row.content,
    answerKey: row.answerKey ?? null,
    license: row.license ?? null,
    licenseKind: row.licenseKind,
    attributions: row.attributions,
    tags: {
      subjectId: row.subjectId,
      gradeLevels: row.gradeLevels,
      cefrLevel: row.cefrLevel,
      primarySkill: row.primarySkill,
      skills: row.skills,
      activityMode: row.activityMode,
      interactionChannel: row.interactionChannel,
      mediation: row.mediation ?? null,
      durationMinutes: row.durationMinutes,
      difficulty: row.difficulty,
      outcomes,
    },
    updatedAt: iso(row.updatedAt),
    rowVersion: row.version,
  }
}

// --- Yazma --------------------------------------------------------------------------------

function versionValues(institutionId: string, version: ResourceVersion, now: Date) {
  // Kaldırılan sürümde yalnız başlık aranır (içerik silinmiştir, DOM-KYN-051).
  const document =
    version.status === 'removed' ? normalizeSearchText(version.title) : searchDocument(version)
  return {
    institutionId,
    id: version.id,
    resourceId: version.resourceId,
    versionNumber: version.versionNumber,
    status: version.status,
    authorUserId: version.authorUserId,
    title: version.title,
    content: version.status === 'removed' ? null : version.content,
    answerKey: version.status === 'removed' ? null : version.answerKey,
    license: version.license,
    attributions: version.attributions,
    subjectId: version.tags.subjectId,
    gradeLevels: version.tags.gradeLevels,
    cefrLevel: version.tags.cefrLevel,
    primarySkill: version.tags.primarySkill,
    skills: version.tags.skills,
    activityMode: version.tags.activityMode,
    interactionChannel: version.tags.interactionChannel,
    mediation: version.tags.mediation,
    durationMinutes: version.tags.durationMinutes,
    difficulty: version.tags.difficulty,
    searchVector: sql`to_tsvector('simple', ${document})`,
    submittedAt: dateOrNull(version.submittedAt),
    reviewedByUserId: version.reviewedByUserId,
    reviewedAt: dateOrNull(version.reviewedAt),
    rejectionReason: version.rejectionReason,
    publishedAt: dateOrNull(version.publishedAt),
    archivedAt: dateOrNull(version.archivedAt),
    removedAt: dateOrNull(version.removedAt),
    removalReason: version.removalReason,
    createdAt: new Date(version.createdAt),
    updatedAt: now,
  }
}

/** Sürümü kazanım ve soru bağlantılarıyla ekler. */
export async function insertResourceVersion(
  db: Database,
  institutionId: string,
  version: ResourceVersion,
  now: Date,
): Promise<void> {
  await db.insert(resourceVersions).values(versionValues(institutionId, version, now))
  const outcomes = version.tags.outcomes.map((outcome, position) => ({
    institutionId,
    versionId: version.id,
    outcomeSource: outcome.outcomeSource,
    outcomeId: outcome.outcomeId,
    position,
    createdAt: now,
    updatedAt: now,
  }))
  if (outcomes.length > 0) await db.insert(resourceVersionOutcomes).values(outcomes)
  const content = version.content
  if (
    version.status !== 'removed' &&
    (content.type === 'quiz' || content.type === 'exercise_set')
  ) {
    await db.insert(resourceVersionItems).values(
      content.items.map((item, position) => ({
        institutionId,
        versionId: version.id,
        position,
        itemVersionId: item.questionVersionId,
        points: item.points,
        createdAt: now,
        updatedAt: now,
      })),
    )
  }
}

/**
 * Kaynağı sürümleri ve paylaşım hedefleriyle tek transaction'da ekler. Kaynak ↔ sürüm yabancı
 * anahtarları döngüsel olduğundan kaynak önce güncel sürümsüz yazılır, sürümlerden sonra
 * `current_version_id` bağlanır.
 */
export async function insertResourceWithVersions(
  db: Database,
  institutionId: string,
  record: Omit<ResourceRecord, 'ownerActive'>,
  versions: readonly ResourceVersion[],
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(resources).values({
      institutionId,
      id: record.id,
      contentType: record.contentType,
      ownerUserId: record.ownerUserId,
      shareScope: record.shareScope,
      currentVersionId: null,
      derivedFromVersionId: record.derivedFromVersionId,
      derivedFromPlatformVersionId: record.derivedFromPlatformVersionId,
      createdAt: now,
      updatedAt: now,
    })
    const shares = [
      ...record.sharedStudentIds.map((targetId) => ({ targetKind: 'student' as const, targetId })),
      ...record.sharedClassIds.map((targetId) => ({ targetKind: 'class' as const, targetId })),
    ].map((share) => ({
      institutionId,
      resourceId: record.id,
      ...share,
      createdAt: now,
      updatedAt: now,
    }))
    if (shares.length > 0) await tx.insert(resourceShares).values(shares)
    for (const version of versions) await insertResourceVersion(tx, institutionId, version, now)
    if (record.currentVersionId !== null) {
      await tx
        .update(resources)
        .set({ currentVersionId: record.currentVersionId })
        .where(and(eq(resources.institutionId, institutionId), eq(resources.id, record.id)))
    }
  })
}

// --- Görünürlük SQL'i ---------------------------------------------------------------------

/**
 * Sahip kurumda etkin mi (DOM-KYN-052): üyeliği var ve bağlı kişi kayıtlarının hepsi pasif veya
 * arşivli değil (`services/institution-members.ts` pasiflik kuralı).
 */
export function ownerActiveSql(r: ResourcesTable = resources): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from memberships m
    where m.institution_id = ${r.institutionId} and m.user_id = ${r.ownerUserId}
      and not (
        exists (select 1 from membership_links ml
          where ml.institution_id = m.institution_id and ml.membership_id = m.id
            and ml.archived_at is null)
        and not exists (select 1 from membership_links ml
          join records rec on rec.institution_id = ml.institution_id
            and rec.collection = (case ml.kind when 'teacher' then 'teachers' else 'students' end)
            and rec.id = ml.record_id
          where ml.institution_id = m.institution_id and ml.membership_id = m.id
            and ml.archived_at is null and rec.archived_at is null
            and coalesce(rec.data->>'isActive', 'true') <> 'false'
            and rec.data->>'deletedAt' is null)
      )
  )`
}

const TRUE = sql`true`
const FALSE = sql`false`
const any = (conditions: readonly (SQL | undefined)[]): SQL => or(...conditions) ?? FALSE
const all = (conditions: readonly (SQL | undefined)[]): SQL => and(...conditions) ?? TRUE

/** Core `canReview` (DOM-KYN-031, DOM-YTK-027). */
function canReviewSql(
  actor: ContentActor,
  institutionType: InstitutionType,
  r: ResourcesTable,
  v: VersionsTable,
): SQL {
  const notOwn = sql`(${v.authorUserId} <> ${actor.userId} and ${r.ownerUserId} <> ${actor.userId})`
  if (actor.role === 'yonetici') return notOwn
  if (actor.role !== 'ogretmen' || !actor.reviewer) return FALSE
  const match =
    institutionType === 'school'
      ? inArray(v.subjectId, [...actor.reviewer.subjectIds])
      : inArray(v.cefrLevel, [...actor.reviewer.cefrLevels])
  return all([notOwn, match])
}

/** Core `staffCanReadVersion` (DOM-KYN-030, 040, 042, 051, 052). */
function staffVisibleSql(
  actor: ContentActor,
  institutionType: InstitutionType,
  r: ResourcesTable,
  v: VersionsTable,
): SQL {
  if (!isContentStaff(actor.role)) return FALSE
  const owner = sql`${r.ownerUserId} = ${actor.userId}`
  const author = sql`${v.authorUserId} = ${actor.userId}`
  const admin = actor.role === 'yonetici' ? TRUE : FALSE
  const reviewable = canReviewSql(actor, institutionType, r, v)
  const shared = any([
    all([sql`${r.shareScope} <> 'private'`, reviewable]),
    sql`${r.shareScope} = 'institution'`,
    all([
      sql`${r.shareScope} = 'department'`,
      any([isNull(v.subjectId), inArray(v.subjectId, [...(actor.subjectIds ?? [])])]),
    ]),
  ])
  const status = (...values: ResourceStatus[]) => inArray(v.status, values)
  return all([
    eq(v.resourceId, r.id),
    any([
      all([status('removed'), any([owner, admin])]),
      all([
        status('draft', 'rejected'),
        any([owner, author, all([admin, not(ownerActiveSql(r))])]),
      ]),
      all([status('in_review'), any([owner, author, reviewable])]),
      all([status('published', 'archived'), any([owner, admin, shared])]),
    ]),
  ])
}

/** Core `learnerCanRead` (DOM-KYN-021, 040, 041). */
function learnerVisibleSql(
  learner: ContentLearner,
  institutionType: InstitutionType,
  today: string,
  r: ResourcesTable,
  v: VersionsTable,
): SQL {
  const licensed = sql`${v.licenseKind} = 'licensed_publication'`
  const expired = sql`coalesce(${licensed} and (${v.license} ->> 'expiryDate') < ${today}, false)`
  const restricted = sql`coalesce(${licensed} and (${v.license} ->> 'restrictedToBookOwners')::boolean, false)`
  const sharedWith = (kind: 'student' | 'class', ids: readonly string[]) =>
    ids.length === 0
      ? FALSE
      : sql`exists (select 1 from ${resourceShares}
          where ${resourceShares.institutionId} = ${r.institutionId}
            and ${resourceShares.resourceId} = ${r.id}
            and ${resourceShares.targetKind} = ${kind}
            and ${inArray(resourceShares.targetId, [...ids])}
            and ${resourceShares.archivedAt} is null)`
  const inScope = any([
    all([sql`${r.shareScope} = 'students'`, sharedWith('student', [learner.studentId])]),
    all([
      sql`${r.shareScope} = 'classes'`,
      sql`not ${restricted}`,
      sharedWith('class', learner.classIds),
    ]),
    all([sql`${r.shareScope} = 'institution'`, sql`not ${restricted}`]),
  ])
  const level =
    institutionType === 'school'
      ? learner.grade === null
        ? FALSE
        : sql`${learner.grade}::integer = any(${v.gradeLevels})`
      : learner.cefrLevel === null
        ? FALSE
        : eq(v.cefrLevel, learner.cefrLevel)
  return all([
    eq(v.status, 'published'),
    eq(r.currentVersionId, v.id),
    eq(v.resourceId, r.id),
    sql`not ${expired}`,
    inScope,
    level,
  ])
}

/** Core `canReadVersion`'ın SQL çevirisi; `r` ve `v` aynı kurumun satırlarıdır. */
export function versionVisibleSql(
  viewer: ContentViewer,
  institutionType: InstitutionType,
  now: Date,
  r: ResourcesTable = resources,
  v: VersionsTable = resourceVersions,
): SQL {
  const today = dayKey(now)
  switch (viewer.kind) {
    case 'staff':
      return staffVisibleSql(viewer.actor, institutionType, r, v)
    case 'student':
      return learnerVisibleSql(viewer.learner, institutionType, today, r, v)
    case 'parent':
      return any(
        viewer.children.map((child) => learnerVisibleSql(child, institutionType, today, r, v)),
      )
    default:
      return viewer satisfies never
  }
}

/** Kişinin okuyabildiği bütün sürüm kimlikleri (eşitlik testi ve tanılama). */
export async function listVisibleVersionIds(
  db: Database,
  institutionId: string,
  viewer: ContentViewer,
  institutionType: InstitutionType,
  now: Date,
): Promise<string[]> {
  const rows = await db
    .select({ id: resourceVersions.id })
    .from(resourceVersions)
    .innerJoin(
      resources,
      and(
        eq(resources.institutionId, resourceVersions.institutionId),
        eq(resources.id, resourceVersions.resourceId),
      ),
    )
    .where(
      and(
        eq(resourceVersions.institutionId, institutionId),
        versionVisibleSql(viewer, institutionType, now),
      ),
    )
  return rows.map((row) => row.id).sort()
}

// --- Okuma --------------------------------------------------------------------------------

export const RESOURCE_SORTS = ['-updatedAt', 'updatedAt', 'title', '-title'] as const
export type ResourceSort = (typeof RESOURCE_SORTS)[number]

export interface ResourceListQuery {
  page: number
  pageSize: number
  /** `searchQueryTerms` çıktısı: yalnız harf ve rakam; boşsa arama yok. */
  terms: readonly string[]
  contentType?: ResourceRecord['contentType'] | undefined
  cefrLevel?: ResourceTags['cefrLevel'] | undefined
  primarySkill?: ResourceTags['primarySkill'] | undefined
  skill?: ResourceTags['skills'][number] | undefined
  subjectId?: string | undefined
  gradeLevel?: number | undefined
  status?: ResourceStatus | undefined
  ownerUserId?: string | undefined
  sort: ResourceSort
}

export interface ResourceListRow {
  resource: StoredResource
  version: StoredResourceVersion
}

function listFilters(query: ResourceListQuery, v: VersionsTable): SQL[] {
  const filters: SQL[] = []
  if (query.terms.length > 0) {
    // Terimler yalnız harf ve rakamdır (`searchQueryTerms`); sorgu metni parametredir.
    const tsquery = query.terms.map((term) => `${term}:*`).join(' & ')
    filters.push(sql`${v.searchVector} @@ to_tsquery('simple', ${tsquery})`)
  }
  if (query.contentType) filters.push(eq(resources.contentType, query.contentType))
  if (query.cefrLevel) filters.push(eq(v.cefrLevel, query.cefrLevel))
  if (query.primarySkill) filters.push(eq(v.primarySkill, query.primarySkill))
  if (query.skill) filters.push(sql`${query.skill}::text = any(${v.skills})`)
  if (query.subjectId) filters.push(eq(v.subjectId, query.subjectId))
  if (query.gradeLevel !== undefined)
    filters.push(sql`${query.gradeLevel}::integer = any(${v.gradeLevels})`)
  if (query.status) filters.push(eq(v.status, query.status))
  if (query.ownerUserId) filters.push(eq(resources.ownerUserId, query.ownerUserId))
  return filters
}

/** Başlık sıralaması Türkçe harfleri ASCII'ye katlar (`institution-members.ts` ad sırasıyla aynı). */
const FOLD_FROM = 'ıİğĞüÜşŞöÖçÇ'
const FOLD_TO = 'iigguussoocc'
const foldedTitle = (v: VersionsTable) =>
  sql`translate(lower(translate(${v.title}, ${FOLD_FROM}, ${FOLD_TO})), ${FOLD_FROM}, ${FOLD_TO})`

function listOrder(sort: ResourceSort, v: VersionsTable): SQL[] {
  const direction = sort.startsWith('-') ? desc : asc
  const key = sort === 'title' || sort === '-title' ? foldedTitle(v) : v.updatedAt
  return [direction(key), asc(resources.id)]
}

/**
 * Kişinin kütüphane listesi. Personel satırı kaynağın okunabilir "baş" sürümüdür: arşivli
 * olmayanlar önce, en yüksek sürüm numarası (`resource_versions_resource_number_key` ile kaynak
 * başına tek indeks erişimi). Öğrenci ve velide yalnız güncel yayındaki sürüm. Süzgeçler baş
 * sürüme uygulanır; sayım aynı koşulla ayrı sorgudur.
 */
export async function listVisibleResources(
  db: Database,
  institutionId: string,
  viewer: ContentViewer,
  institutionType: InstitutionType,
  now: Date,
  query: ResourceListQuery,
): Promise<{ rows: ResourceListRow[]; total: number }> {
  const v = resourceVersions
  let join: SQL
  if (viewer.kind === 'staff') {
    // Takma ad aynı kolonları taşır; yalnız tablo adı tipi farklıdır (`head`).
    const head = alias(resourceVersions, 'head') as unknown as VersionsTable
    join = sql`${v.id} = (select ${head.id} from ${resourceVersions} as ${sql.identifier('head')}
      where ${head.institutionId} = ${resources.institutionId} and ${head.resourceId} = ${resources.id}
        and ${versionVisibleSql(viewer, institutionType, now, resources, head)}
      order by (${head.status} = 'archived'), ${head.versionNumber} desc
      limit 1)`
  } else {
    join = all([
      eq(v.id, resources.currentVersionId),
      versionVisibleSql(viewer, institutionType, now, resources, v),
    ])
  }
  const where = all([
    eq(resources.institutionId, institutionId),
    eq(v.institutionId, institutionId),
    eq(v.resourceId, resources.id),
    join,
    ...listFilters(query, v),
  ])
  const from = () =>
    db
      .select({
        resource: getTableColumns(resources),
        version: getTableColumns(resourceVersions),
        ownerActive: ownerActiveSql(resources),
      })
      .from(resources)
      .innerJoin(resourceVersions, eq(resourceVersions.institutionId, resources.institutionId))
  const [rows, [totals]] = await Promise.all([
    from()
      .where(where)
      .orderBy(...listOrder(query.sort, v))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ total: count() })
      .from(resources)
      .innerJoin(resourceVersions, eq(resourceVersions.institutionId, resources.institutionId))
      .where(where),
  ])
  const [shares, outcomes] = await Promise.all([
    loadShares(
      db,
      institutionId,
      rows.map((row) => row.resource.id),
    ),
    loadOutcomes(
      db,
      institutionId,
      rows.map((row) => row.version.id),
    ),
  ])
  return {
    rows: rows.map((row) => ({
      resource: toStoredResource(row.resource, row.ownerActive, shares.get(row.resource.id) ?? []),
      version: toStoredVersion(row.version, outcomes.get(row.version.id) ?? []),
    })),
    total: totals?.total ?? 0,
  }
}

async function loadShares(
  db: Database,
  institutionId: string,
  resourceIds: readonly string[],
): Promise<Map<string, { targetKind: string; targetId: string }[]>> {
  const map = new Map<string, { targetKind: string; targetId: string }[]>()
  if (resourceIds.length === 0) return map
  const rows = await db
    .select({
      resourceId: resourceShares.resourceId,
      targetKind: resourceShares.targetKind,
      targetId: resourceShares.targetId,
    })
    .from(resourceShares)
    .where(
      and(
        eq(resourceShares.institutionId, institutionId),
        inArray(resourceShares.resourceId, [...new Set(resourceIds)]),
        isNull(resourceShares.archivedAt),
      ),
    )
    .orderBy(
      asc(resourceShares.targetKind),
      asc(resourceShares.createdAt),
      asc(resourceShares.targetId),
    )
  for (const row of rows) {
    const list = map.get(row.resourceId) ?? []
    list.push(row)
    map.set(row.resourceId, list)
  }
  return map
}

async function loadOutcomes(
  db: Database,
  institutionId: string,
  versionIds: readonly string[],
): Promise<Map<string, ResourceTags['outcomes']>> {
  const map = new Map<string, ResourceTags['outcomes']>()
  if (versionIds.length === 0) return map
  const rows = await db
    .select({
      versionId: resourceVersionOutcomes.versionId,
      outcomeId: resourceVersionOutcomes.outcomeId,
      outcomeSource: resourceVersionOutcomes.outcomeSource,
    })
    .from(resourceVersionOutcomes)
    .where(
      and(
        eq(resourceVersionOutcomes.institutionId, institutionId),
        inArray(resourceVersionOutcomes.versionId, [...new Set(versionIds)]),
        isNull(resourceVersionOutcomes.archivedAt),
      ),
    )
    .orderBy(asc(resourceVersionOutcomes.position))
  for (const row of rows) {
    const list = map.get(row.versionId) ?? []
    list.push({ outcomeId: row.outcomeId, outcomeSource: row.outcomeSource })
    map.set(row.versionId, list)
  }
  return map
}

/** Kaynak, sahibin etkinliği ve paylaşım hedefleriyle; yoksa veya başka kurumdaysa `null`. */
export async function findResource(
  db: Database,
  institutionId: string,
  resourceId: string,
): Promise<StoredResource | null> {
  const [row] = await db
    .select({ resource: getTableColumns(resources), ownerActive: ownerActiveSql(resources) })
    .from(resources)
    .where(and(eq(resources.institutionId, institutionId), eq(resources.id, resourceId)))
  if (!row) return null
  const shares = await loadShares(db, institutionId, [resourceId])
  return toStoredResource(row.resource, row.ownerActive, shares.get(resourceId) ?? [])
}

/**
 * Kaynağın sürümleri, sürüm numarasına göre artan. Arşivli sürümler dahildir: arşivlenen sürüm
 * sürüm geçmişinde okunur (DOM-KYN-032); görünürlüğü durum belirler.
 */
export async function listResourceVersions(
  db: Database,
  institutionId: string,
  resourceId: string,
  versionIds?: readonly string[],
): Promise<StoredResourceVersion[]> {
  if (versionIds !== undefined && versionIds.length === 0) return []
  const rows = await db
    .select()
    .from(resourceVersions)
    .where(
      and(
        eq(resourceVersions.institutionId, institutionId),
        eq(resourceVersions.resourceId, resourceId),
        versionIds === undefined ? undefined : inArray(resourceVersions.id, [...versionIds]),
      ),
    )
    .orderBy(asc(resourceVersions.versionNumber))
  const outcomes = await loadOutcomes(
    db,
    institutionId,
    rows.map((row) => row.id),
  )
  return rows.map((row) => toStoredVersion(row, outcomes.get(row.id) ?? []))
}

/** Sürüm kimliklerinin denetim alanları (quiz/alıştırma setinin soruları, DOM-KYN-013). */
export async function loadItemVersionRefs(
  db: Database,
  institutionId: string,
  versionIds: readonly string[],
): Promise<
  Map<
    string,
    Pick<ResourceVersion, 'id' | 'status' | 'tags'> & { contentType: ResourceRecord['contentType'] }
  >
> {
  const map = new Map<
    string,
    Pick<ResourceVersion, 'id' | 'status' | 'tags'> & { contentType: ResourceRecord['contentType'] }
  >()
  if (versionIds.length === 0) return map
  const rows = await db
    .select({ version: getTableColumns(resourceVersions), contentType: resources.contentType })
    .from(resourceVersions)
    .innerJoin(
      resources,
      and(
        eq(resources.institutionId, resourceVersions.institutionId),
        eq(resources.id, resourceVersions.resourceId),
      ),
    )
    .where(
      and(
        eq(resourceVersions.institutionId, institutionId),
        inArray(resourceVersions.id, [...new Set(versionIds)]),
      ),
    )
  const outcomes = await loadOutcomes(
    db,
    institutionId,
    rows.map((row) => row.version.id),
  )
  for (const row of rows) {
    const stored = toStoredVersion(row.version, outcomes.get(row.version.id) ?? [])
    map.set(stored.id, {
      id: stored.id,
      status: stored.status,
      tags: stored.tags,
      contentType: row.contentType,
    })
  }
  return map
}
