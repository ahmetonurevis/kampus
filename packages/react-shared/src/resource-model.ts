import type { components, operations } from '@kampus/api-client/schema.d.ts'
import {
  canManage,
  OPEN_STATUSES,
  planVersionTransition,
  requiresReview,
  publicationIssues,
  resourceVersionInputSchema,
  RESOURCE_ACTIONS,
  EDITABLE_STATUSES,
  type ContentActor,
  type ResourceAction,
  type ResourceRecord,
  type ResourceStatus,
  type ResourceVersion,
} from '@kampus/school-core/content/resource.ts'
import { RESOURCE_FILE_MESSAGES } from '@kampus/school-core/content/resource-files.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

import type { CommandMessages } from './commands.ts'

/**
 * İçerik havuzu ekranının saf mantığı (docs/domain/kaynak-platformu.md): liste sorgusu, personel
 * görünümü ayrımı ve düğmelerin core'un izin verdiği eylemlere göre belirlenmesi. Eylem kararı
 * burada yeniden yazılmaz; core `planVersionTransition` kuru çalıştırılır (sunucu aynı işlevi
 * yazarken çalıştırır). Hook'lar `use-resources.ts`'tedir.
 */

type Schemas = components['schemas']
export type ResourceListQuery = NonNullable<operations['listResources']['parameters']['query']>
export type StaffResourceListItem = Schemas['StaffResourceListItem']
export type StaffResourceDetail = Schemas['StaffResourceDetail']
export type ResourceVersionSummary = Schemas['ResourceVersionSummary']
export type StaffResourceVersion = Schemas['ResourceVersion']
export type StaffResource = Schemas['StaffResource']
export type ResourceWriteResult = Schemas['ResourceWriteResult']
export type PublicationIssueView = StaffResourceDetail['publicationIssues'][number]
/** Sürümün dosya meta verisi (`files`, `fileIds` sırasıyla; DOM-KYN-006). */
export type ResourceFile = Schemas['ResourceFile']
export type LearnerResourceListItem = Schemas['LearnerResourceListItem']
export type LearnerResourceDetail = Schemas['LearnerResourceDetail']

/**
 * Web formunda oluşturulup düzenlenebilen içerik türleri: okuma parçası, çoktan seçmeli soru
 * (F3c1) ve materyal dosyası (`file`, OG-250; DOM-KYN-006).
 */
export const AUTHORABLE_TYPES = ['reading_passage', 'question', 'file'] as const
export type AuthorableType = (typeof AUTHORABLE_TYPES)[number]

export function isAuthorableType(type: string): type is AuthorableType {
  return (AUTHORABLE_TYPES as readonly string[]).includes(type)
}

/** Personel satırı mı (öğrenci/veli görünümü bu ekranda yoktur). */
export function isStaffItem(
  item: Schemas['StaffResourceListItem'] | Schemas['LearnerResourceListItem'],
): item is StaffResourceListItem {
  return item.view === 'staff'
}

export function isStaffDetail(
  detail: StaffResourceDetail | Schemas['LearnerResourceDetail'],
): detail is StaffResourceDetail {
  return detail.view === 'staff'
}

export const SORT_FIELDS = { title: 'title', updatedAt: 'updatedAt' } as const
export type ResourceSortKey = keyof typeof SORT_FIELDS

/** Liste durumundan API sorgusu: boş süzgeç gönderilmez, kısa arama (<2) gönderilmez. */
export function resourceListQuery(input: {
  page: number
  pageSize: number
  q: string
  filters: Readonly<Record<string, unknown>>
  sortKey: string
  sortDirection: 1 | -1
  userId: string
}): ResourceListQuery {
  const { filters } = input
  const text = (key: string) => {
    const value = filters[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const q = input.q.trim()
  const sortField = (SORT_FIELDS as Record<string, string | undefined>)[input.sortKey]
  const sort = sortField
    ? ((input.sortDirection === -1 ? `-${sortField}` : sortField) as ResourceListQuery['sort'])
    : undefined
  const grade = Number(text('gradeLevel'))
  return {
    page: input.page,
    pageSize: input.pageSize,
    ...(q.length >= 2 ? { q } : {}),
    ...(text('contentType') ? { contentType: text('contentType') as never } : {}),
    ...(text('cefrLevel') ? { cefrLevel: text('cefrLevel') as never } : {}),
    ...(text('primarySkill') ? { primarySkill: text('primarySkill') as never } : {}),
    ...(text('subjectId') ? { subjectId: text('subjectId') as string } : {}),
    ...(Number.isInteger(grade) && grade > 0 ? { gradeLevel: grade } : {}),
    ...(text('status') ? { status: text('status') as never } : {}),
    ...(text('mine') === 'yes' ? { ownerUserId: input.userId } : {}),
    ...(sort ? { sort } : {}),
  }
}

export const RESOURCE_CHANGED_MESSAGE =
  'İçerik siz bakarken başkası tarafından değiştirildi. Güncel hali yüklendi; değişikliğinizi gözden geçirip yeniden deneyin.'

export const RESOURCE_FILE_NOT_READY_MESSAGE =
  'Dosya güvenlik denetiminden geçince eklenebilir; birkaç dakika sonra yeniden deneyin.'

/** Koda özgü metinler; olmayan kodda sunucunun Türkçe mesajı gösterilir. */
export const RESOURCE_MESSAGES = {
  version_conflict: RESOURCE_CHANGED_MESSAGE,
  version_immutable: 'Yayımlanmış veya incelemedeki sürüm değiştirilemez; yeni sürüm açın.',
  open_version_exists: 'Bu içeriğin üzerinde çalışılan bir sürümü zaten var.',
  review_required: 'Bu içerik onaydan geçmeden yayımlanamaz; onaya gönderin.',
  resource_not_found: 'İçerik bulunamadı.',
  not_found: 'İçerik bulunamadı.',
  // Sürüm dosyası kuralı (DOM-KYN-006): core iletileri. Sayı sınırı (`resource_files_limit`),
  // boyut ve tür (`file_too_large`, `file_type_not_allowed`) sınırı taşıdığından sunucunun
  // Türkçe iletisi gösterilir.
  ...RESOURCE_FILE_MESSAGES,
  // Dosya taranırken (`pending`) eklenmek istenirse; ödev ve soru ekindeki gibi sakin ileti.
  // TODO(F3c2-scan): dosya tarama işi (OG-092) gelene kadar dosya `ready` olmaz.
  file_not_ready: RESOURCE_FILE_NOT_READY_MESSAGE,
} as const satisfies CommandMessages

export const RESOURCE_FILE_GONE_MESSAGE =
  'Bu dosyaya artık erişilemiyor. İçerik kaldırılmış ya da kullanım süresi dolmuş olabilir.'
export const RESOURCE_FILE_PROCESSING_MESSAGE =
  'Dosya henüz hazırlanıyor. Biraz sonra yeniden deneyin.'
export const RESOURCE_FILE_OPEN_FAILED_MESSAGE = 'Dosya açılamadı. Biraz sonra yeniden deneyin.'

export type ResourceFileOpenFailure = {
  /** `gone`: dosya bu kişiye artık açılmıyor (404); satır sakin bir notla kapanır. */
  kind: 'gone' | 'processing' | 'failed'
  message: string
}

/**
 * Sürüm dosyası açılamadığında kullanıcıya gösterilecek ileti (DOM-KYN-006, 051). 404 kaldırılan
 * kaynağın (kopyası dahil) ya da lisansı dolmuş, artık görünmeyen sürümün dosyasıdır; nedeni
 * ayırt edilmez ve teknik ayrıntı gösterilmez.
 */
export function resourceFileOpenFailure(error: unknown): ResourceFileOpenFailure {
  const status = (error as { status?: unknown } | null)?.status
  const code = (error as { code?: unknown } | null)?.code
  if (status === 404) return { kind: 'gone', message: RESOURCE_FILE_GONE_MESSAGE }
  if (status === 409 && code === 'file_processing')
    return { kind: 'processing', message: RESOURCE_FILE_PROCESSING_MESSAGE }
  return { kind: 'failed', message: RESOURCE_FILE_OPEN_FAILED_MESSAGE }
}

/** Dosyanın gösterim adı: temizlenmiş özgün ad, yoksa sıra numarası. */
export const resourceFileName = (file: Pick<ResourceFile, 'name'>, index: number) =>
  file.name?.trim() || `Dosya ${index + 1}`

/** Okunur boyut: "320 KB", "2,4 MB" (Türkçe ondalık). */
export function resourceFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`
  return `${(kb / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`
}

/** Learner görünümü satırı mı (öğrenci ve veli). */
export function isLearnerItem(
  item: StaffResourceListItem | LearnerResourceListItem,
): item is LearnerResourceListItem {
  return item.view === 'learner'
}

export function isLearnerDetail(
  detail: StaffResourceDetail | LearnerResourceDetail,
): detail is LearnerResourceDetail {
  return detail.view === 'learner'
}

/** 409 sürüm çakışması: ekran güncel kaydı yeniden okuyup yenileme seçeneği sunar. */
export function isVersionConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 409 &&
    (error as { code?: unknown }).code === 'version_conflict'
  )
}

export type ActionKind = Extract<
  ResourceAction,
  'submit' | 'publish' | 'withdraw' | 'approve' | 'reject' | 'reopen' | 'archive'
>
export const SHOWN_ACTIONS = [
  'submit',
  'publish',
  'withdraw',
  'approve',
  'reject',
  'reopen',
  'archive',
] as const satisfies readonly ActionKind[]

export type ActionState = {
  action: ActionKind
  label: string
  /** Eylem görünür ama yayım eksikleri nedeniyle şimdilik uygulanamaz. */
  blockedReason: string | null
  /** Gerekçe ister (ret). */
  needsReason: boolean
}

const HIDDEN_CODES = new Set([
  'resource_action_forbidden',
  'resource_transition_invalid',
  'version_immutable',
  'resource_not_found',
  'resource_version_not_found',
  'review_required',
])

type ActionContext = {
  detail: StaffResourceDetail
  actor: { role: Role; userId: string }
  institutionType: InstitutionType
  now: Date
}

const asActor = (actor: ActionContext['actor']): ContentActor => ({
  role: actor.role,
  userId: actor.userId,
})

/** Sunucunun döndürdüğü baş sürümü core sürüm şekline çevirir; kaldırılmış (içeriksiz) sürümde `null`. */
export function coreVersion(
  head: StaffResourceVersion,
  resourceId: string,
): ResourceVersion | null {
  const parsed = resourceVersionInputSchema.safeParse({
    title: head.title,
    content: head.content,
    answerKey: head.answerKey,
    tags: head.tags,
    license: head.license,
    attributions: head.attributions,
  })
  if (!parsed.success) return null
  return {
    ...parsed.data,
    id: head.id,
    resourceId,
    versionNumber: head.versionNumber,
    status: head.status,
    authorUserId: head.authorUserId,
    createdAt: head.createdAt,
    submittedAt: head.submittedAt,
    reviewedByUserId: head.reviewedByUserId,
    reviewedAt: head.reviewedAt,
    rejectionReason: head.rejectionReason,
    publishedAt: head.publishedAt,
    archivedAt: head.archivedAt,
    removedAt: head.removedAt,
    removalReason: head.removalReason,
  }
}

function coreResource(detail: StaffResourceDetail): ResourceRecord {
  const { resource } = detail
  return {
    id: resource.id,
    contentType: resource.contentType,
    ownerUserId: resource.ownerUserId,
    // Sahibin kadro durumu yanıtta yok; yalnız `report` ve okuma kararında kullanılır.
    ownerActive: true,
    shareScope: resource.shareScope,
    sharedStudentIds: resource.sharedStudentIds,
    sharedClassIds: resource.sharedClassIds,
    currentVersionId: resource.currentVersionId,
    derivedFromVersionId: resource.derivedFromVersionId,
    derivedFromPlatformVersionId: null,
  }
}

/**
 * Baş sürümde kullanıcıya sunulacak durum geçişleri. Core kuralı kuru çalıştırılır: izinsiz veya
 * geçersiz geçiş görünmez; yalnız yayım eksiği yüzünden uygulanamayan geçiş görünür ve nedeni
 * taşır. Zümre başkanı/koordinatör verisi yanıtta olmadığından onay yöneticiye gösterilir
 * (`TODO(content-reviewer)`); sunucu aynı kuralı yeniden uygular.
 */
export function availableActions({
  detail,
  actor,
  institutionType,
  now,
}: ActionContext): ActionState[] {
  const version = coreVersion(detail.head, detail.resource.id)
  if (!version) return []
  const resource = coreResource(detail)
  const issueCodes = new Set(
    publicationIssues({ institutionType, version, now }).map((i) => i.code),
  )
  const states: ActionState[] = []
  for (const action of SHOWN_ACTIONS) {
    let blockedReason: string | null = null
    try {
      planVersionTransition({
        action,
        actor: asActor(actor),
        institutionType,
        resource,
        version,
        now,
        // Ret gerekçesi formda alınır; kuru çalıştırmada geçerli bir metin verilir.
        reason: 'gerekçe',
      })
    } catch (error) {
      if (!(error instanceof DomainError) || HIDDEN_CODES.has(error.code)) continue
      if (!issueCodes.has(error.code)) continue
      // Onaysız yayın hakkı yoksa "Yayımla" hiç sunulmaz (yayım eksiği giderilince de çıkmazdı).
      if (action === 'publish' && requiresReview(version.license, resource.shareScope)) continue
      blockedReason = error.message
    }
    states.push({
      action,
      label: RESOURCE_ACTIONS[action].label,
      blockedReason,
      needsReason: action === 'reject',
    })
  }
  return states
}

/** Taslak düzenlenebilir mi (core `planDraftUpdate` koşulu: yazar + taslak/reddedildi). */
export function canEditDraft(
  head: Pick<StaffResourceVersion, 'status' | 'authorUserId' | 'publishedAt'>,
  userId: string,
): boolean {
  return (
    (EDITABLE_STATUSES as readonly ResourceStatus[]).includes(head.status) &&
    head.publishedAt === null &&
    head.authorUserId === userId
  )
}

/** Yayındaki sürümden yeni taslak açılabilir mi (core `planNewVersion` koşulları). */
export function canOpenNewVersion({
  detail,
  actor,
  institutionType,
}: Omit<ActionContext, 'now'>): boolean {
  if (detail.head.status !== 'published') return false
  if (detail.versions.some((v) => (OPEN_STATUSES as readonly ResourceStatus[]).includes(v.status)))
    return false
  if (detail.versions.some((v) => v.status === 'removed')) return false
  return canManage(
    asActor(actor),
    { ownerUserId: detail.resource.ownerUserId },
    { tags: detail.head.tags },
    institutionType,
  )
}
