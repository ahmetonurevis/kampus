import {
  isContentStaff,
  learnerView,
  OPEN_STATUSES,
  publicationIssues,
  searchQueryTerms,
  seededRandom,
  type ContentActor,
  type LearnerResourceView,
  type PublicationIssue,
  type ResourceStatus,
} from '@kampus/school-core/content/resource.ts'
import { isResourceFileShown } from '@kampus/school-core/content/resource-files.ts'
import { CEFR_LEVELS, type CefrLevel } from '@kampus/school-core/content/taxonomy.ts'
import {
  canReadVersion,
  type ContentLearner,
  type ContentViewer,
} from '@kampus/school-core/content/visibility.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { Database } from '../db/client.ts'
import { loadFilesByIds, type StoredFile } from '../db/files.ts'
import {
  asCoreVersion,
  findResource,
  listResourceVersions,
  listVisibleResources,
  loadItemVersionRefs,
  type ResourceListQuery,
  type StoredResource,
  type StoredResourceVersion,
} from '../db/resources.ts'
import { ForbiddenError, NotFoundError, ValidationError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import type { ResourceFile } from '../routes/resources.schemas.ts'
import { readScope, readSource } from './read-scope.ts'

/**
 * İçerik havuzu okuma servisi (ADR 0004 karar 3, 9; docs/domain/kaynak-platformu.md). Kişi core
 * `ContentViewer`'a çevrilir: personel `staff`, öğrenci kendi kaydı, veli çocukları. Liste SQL'de
 * aynı koşullarla süzülür (`db/resources.ts`), sayfa satırları core `canReadVersion` ile yeniden
 * doğrulanır. Öğrenci ve veli yalnız yayındaki güncel sürümü, cevap anahtarı ve lisans ayrıntısı
 * olmadan görür (`learnerView`, DOM-KYN-024, 041).
 */

export interface ContentReader {
  viewer: ContentViewer
  institutionType: InstitutionType
}

const isCefrLevel = (value: string): value is CefrLevel => Object.hasOwn(CEFR_LEVELS, value)

/** Oturumdaki kişinin içerik görünümü; ön büro içerik havuzuna erişmez (DOM-YTK-021). */
export async function contentReader(ctx: ServiceContext): Promise<ContentReader> {
  const scope = await readScope(ctx)
  const institutionType = scope.institutionType
  const { role, userId } = ctx.actor
  if (isContentStaff(role)) {
    const actor: ContentActor = {
      role,
      userId,
      subjectIds: scope.teacher ? [scope.teacher.subjectId] : [],
      // TODO(content-reviewer): zümre başkanı/koordinatör verisi gelince `reviewer` dolar; o zamana
      // kadar onayı yalnız yönetici verir.
    }
    return { viewer: { kind: 'staff', actor }, institutionType }
  }
  if (role !== 'ogrenci' && role !== 'veli') throw new ForbiddenError()
  const source = await readSource(ctx)
  const classes = new Map(source.classes.map((item) => [item.id, item]))
  const learners: ContentLearner[] = source.students
    .filter((student) => scope.studentIds.has(student.id))
    .map((student) => {
      const room = classes.get(student.classId)
      return {
        studentId: student.id,
        classIds: [student.classId],
        grade: institutionType === 'school' ? (room?.grade ?? null) : null,
        // TODO(F-dil-okulu): kurun CEFR seviyesi ayrı alana taşınınca sınıf `level`'ı yerine o okunur.
        cefrLevel:
          institutionType === 'language_school' && room && isCefrLevel(room.level)
            ? room.level
            : null,
      }
    })
  const [own] = learners
  if (role === 'ogrenci' && own)
    return { viewer: { kind: 'student', learner: own }, institutionType }
  // Veli çocuklarının gördüğünü görür; kaydı bağlanmamış öğrenci hiçbir şey görmez.
  return { viewer: { kind: 'parent', children: role === 'veli' ? learners : [] }, institutionType }
}

// --- Yanıt biçimleri ----------------------------------------------------------------------

function versionSummary(version: StoredResourceVersion) {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    status: version.status,
    title: version.title,
    authorUserId: version.authorUserId,
    tags: version.tags,
    licenseKind: version.licenseKind,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    publishedAt: version.publishedAt,
    archivedAt: version.archivedAt,
    removedAt: version.removedAt,
  }
}

/**
 * Sürüm dosyasının yanıttaki meta verisi; tip yanıt şemasından (`ResourceFile`) türer, ikinci
 * bir şekil yazılmaz. İçerik bağlantısı `GET /files/:id/url`.
 */
export type ResourceFileView = ResourceFile

/** Sürüm başına dosya meta verisi (sürüm kimliği → sıralı liste). */
export type VersionFiles = ReadonlyMap<string, readonly ResourceFileView[]>

function fileMeta(row: StoredFile): ResourceFileView | null {
  const status = row.status
  if (!isResourceFileShown(status)) return null
  return {
    id: row.id,
    name: row.originalName,
    contentType: row.contentType,
    byteSize: row.byteSize,
    purpose: row.purpose,
    durationMs: row.durationMs,
    status,
  }
}

/**
 * Sürümlerin dosyaları, `fileIds` sırasıyla (DOM-KYN-006). Kaldırılan sürümün içeriği gibi dosya
 * listesi de gösterilmez (DOM-KYN-051). Bağlanamayan durumdaki (`pending`, `rejected`) satır
 * listeye girmez; bağlama `ready` ister, bu yalnız güvencedir.
 */
export async function loadVersionFiles(
  db: Database,
  institutionId: string,
  versions: readonly StoredResourceVersion[],
): Promise<VersionFiles> {
  const shown = versions.filter((version) => version.status !== 'removed')
  const rows = await loadFilesByIds(
    db,
    institutionId,
    shown.flatMap((version) => version.fileIds),
  )
  const byId = new Map(rows.map((row) => [row.id, fileMeta(row)]))
  return new Map(
    shown.map((version) => [
      version.id,
      version.fileIds.flatMap((fileId) => byId.get(fileId) ?? []),
    ]),
  )
}

export function fullVersion(version: StoredResourceVersion, files: VersionFiles) {
  return {
    ...versionSummary(version),
    files: [...(files.get(version.id) ?? [])],
    content: version.content,
    answerKey: version.answerKey,
    license: version.license,
    attributions: version.attributions,
    submittedAt: version.submittedAt,
    reviewedByUserId: version.reviewedByUserId,
    reviewedAt: version.reviewedAt,
    rejectionReason: version.rejectionReason,
    removalReason: version.removalReason,
    rowVersion: version.rowVersion,
  }
}

function resourceSummary(resource: StoredResource) {
  return {
    id: resource.id,
    contentType: resource.contentType,
    ownerUserId: resource.ownerUserId,
    shareScope: resource.shareScope,
    currentVersionId: resource.currentVersionId,
    derivedFromVersionId: resource.derivedFromVersionId,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  }
}

/** Personel görünümündeki kaynak: paylaşım hedefleri, arşiv anı ve satır sürümüyle. */
export function staffResource(resource: StoredResource) {
  return {
    ...resourceSummary(resource),
    sharedStudentIds: [...resource.sharedStudentIds],
    sharedClassIds: [...resource.sharedClassIds],
    archivedAt: resource.archivedAt,
    rowVersion: resource.rowVersion,
  }
}

/** Öğrenci/veli görünümü; karıştırma kişi ve sürüm başına sabittir (yenilemede değişmez). */
function learnerVersion(
  ctx: ServiceContext,
  version: StoredResourceVersion,
  files: VersionFiles,
): LearnerResourceView & { files: ResourceFileView[] } {
  return {
    ...learnerView(asCoreVersion(version), {
      random: seededRandom(`${version.id}:${ctx.actor.userId}`),
    }),
    files: [...(files.get(version.id) ?? [])],
  }
}

// --- Liste --------------------------------------------------------------------------------

export type ResourceListInput = Omit<ResourceListQuery, 'terms'> & {
  q?: string | undefined
  studentId?: string | undefined
}

/** Personele özgü süzgeçler: öğrenci ve veli taslak görmez, sahip kimliğini bilmez. */
const STAFF_FILTERS = ['status', 'ownerUserId'] as const

/**
 * Seçili öğrencinin gördüğü (DOM-KYN-041): velide görünüm o çocuğa daralır, öğrencide yalnız
 * kendi kaydı geçerlidir. Çocuklar `contentReader`'dan, yani okuma kapsamından (velayetli ve
 * kısıtsız bağ) gelir; kapsam dışı öğrenci 404 (varlık sızdırılmaz, DOM-YTK-011). Personelde 400.
 */
function narrowToStudent(viewer: ContentViewer, studentId: string): ContentViewer {
  if (viewer.kind === 'staff')
    throw new ValidationError([
      {
        path: ['studentId'],
        code: 'learner_only_filter',
        message: 'Öğrenci seçimi yalnız öğrenci ve veli için kullanılabilir.',
      },
    ])
  if (viewer.kind === 'student') {
    if (viewer.learner.studentId !== studentId) throw new NotFoundError()
    return viewer
  }
  const children = viewer.children.filter((child) => child.studentId === studentId)
  if (children.length === 0) throw new NotFoundError()
  return { kind: 'parent', children }
}

export async function listResources(ctx: ServiceContext, input: ResourceListInput) {
  const reader = await contentReader(ctx)
  const { institutionType } = reader
  if (reader.viewer.kind !== 'staff') {
    const issues = STAFF_FILTERS.filter((field) => input[field] !== undefined).map((field) => ({
      path: [field],
      code: 'staff_only_filter',
      message: 'Bu süzgeç yalnız öğretmen ve yönetici için kullanılabilir.',
    }))
    if (issues.length > 0) throw new ValidationError(issues)
  }
  const { q, studentId, ...rest } = input
  const viewer = studentId === undefined ? reader.viewer : narrowToStudent(reader.viewer, studentId)
  // Normalleşince terim kalmayan arama (`q=!!!`) boş sonuçtur, 400 değil: kullanıcı yazarken
  // hata görmez (`ResourceListQuery.terms`).
  const terms = q === undefined ? null : searchQueryTerms(q)
  const page = await listVisibleResources(
    ctx.db,
    ctx.institutionId,
    viewer,
    institutionType,
    ctx.now,
    {
      ...rest,
      terms,
    },
  )
  // SQL yalnız adayları daraltır; karar core'undur. Uyuşmazlık SQL çevirisinde hatadır.
  const rows = page.rows.filter(({ resource, version }) =>
    canReadVersion(viewer, {
      institutionType,
      resource,
      version: asCoreVersion(version),
      now: ctx.now,
    }),
  )
  if (rows.length !== page.rows.length)
    ctx.log.warn({ event: 'resource.visibility_mismatch', dropped: page.rows.length - rows.length })
  const items = rows.map(({ resource, version }) =>
    viewer.kind === 'staff'
      ? { view: 'staff' as const, ...resourceSummary(resource), version: versionSummary(version) }
      : {
          view: 'learner' as const,
          id: resource.id,
          contentType: resource.contentType,
          version: {
            id: version.id,
            title: version.title,
            tags: version.tags,
            licenseKind: version.licenseKind,
          },
        },
  )
  return { items, total: page.total }
}

// --- Ayrıntı ------------------------------------------------------------------------------

/** Personel listesindeki "baş" sürüm kuralı: arşivli olmayan önce, en yüksek numara. */
function headOf(versions: readonly StoredResourceVersion[]): StoredResourceVersion | undefined {
  return [...versions].sort(
    (a, b) =>
      Number(a.status === 'archived') - Number(b.status === 'archived') ||
      b.versionNumber - a.versionNumber,
  )[0]
}

const OPEN: readonly ResourceStatus[] = OPEN_STATUSES

async function issuesOf(
  ctx: ServiceContext,
  institutionType: InstitutionType,
  version: StoredResourceVersion,
): Promise<(PublicationIssue & { path: string[] })[]> {
  if (!OPEN.includes(version.status) || version.content === null) return []
  const content = version.content
  const list = content.type === 'quiz' || content.type === 'exercise_set'
  const itemIds = list ? content.items.map((item) => item.questionVersionId) : []
  // Okuma-anlama etkinliğinin parçası da yayım denetimine girer (IST-042); verilmezse core her
  // parçalı etkinlikte `passage_missing` sayardı (OG-984).
  const passageId = list ? content.passageVersionId : null
  const refs = await loadItemVersionRefs(
    ctx.db,
    ctx.institutionId,
    passageId === null ? itemIds : [...itemIds, passageId],
  )
  return publicationIssues({
    institutionType,
    version: asCoreVersion(version),
    now: ctx.now,
    itemVersions: refs,
    passageVersion: passageId === null ? undefined : refs.get(passageId),
  }).map((issue) => ({ ...issue, path: [...issue.path] }))
}

async function loadReadable(ctx: ServiceContext, resourceId: string, versionIds?: string[]) {
  const reader = await contentReader(ctx)
  const resource = await findResource(ctx.db, ctx.institutionId, resourceId)
  if (!resource) throw new NotFoundError()
  const versions = await listResourceVersions(ctx.db, ctx.institutionId, resourceId, versionIds)
  const readable = versions.filter((version) =>
    canReadVersion(reader.viewer, {
      institutionType: reader.institutionType,
      resource,
      version: asCoreVersion(version),
      now: ctx.now,
    }),
  )
  return { ...reader, resource, readable }
}

/**
 * Kaynak ayrıntısı. Personel okuyabildiği sürümlerin listesini, baş sürümün tamamını, paylaşım
 * hedeflerini ve açık sürümde yayım eksiklerini alır. Öğrenci/veli yalnız güncel yayın sürümünü
 * görür. Okunabilir sürüm yoksa kaynak yok sayılır (404).
 */
export async function getResource(ctx: ServiceContext, resourceId: string) {
  const { viewer, institutionType, resource, readable } = await loadReadable(ctx, resourceId)
  const head = headOf(readable)
  if (!head) throw new NotFoundError()
  const files = await loadVersionFiles(ctx.db, ctx.institutionId, [head])
  if (viewer.kind !== 'staff') {
    return {
      view: 'learner' as const,
      resource: { id: resource.id, contentType: resource.contentType },
      version: learnerVersion(ctx, head, files),
    }
  }
  return {
    view: 'staff' as const,
    resource: staffResource(resource),
    versions: readable.map((version) => ({
      ...versionSummary(version),
      license: version.license,
      reviewedByUserId: version.reviewedByUserId,
    })),
    head: fullVersion(head, files),
    publicationIssues: await issuesOf(ctx, institutionType, head),
  }
}

/** Tek sürüm: personel okuyabildiği her sürümü, öğrenci/veli yalnız güncel yayın sürümünü görür. */
export async function getResourceVersion(
  ctx: ServiceContext,
  resourceId: string,
  versionId: string,
) {
  const { viewer, readable } = await loadReadable(ctx, resourceId, [versionId])
  const [version] = readable
  if (!version) throw new NotFoundError()
  const files = await loadVersionFiles(ctx.db, ctx.institutionId, [version])
  return viewer.kind === 'staff'
    ? { view: 'staff' as const, version: fullVersion(version, files) }
    : { view: 'learner' as const, version: learnerVersion(ctx, version, files) }
}
