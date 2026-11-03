import { ApiError } from '@kampus/api-client/errors.ts'
import type { components, operations } from '@kampus/api-client/schema.d.ts'
import {
  canManage,
  OPEN_STATUSES,
  planResourceRemoval,
  planVersionTransition,
  requiresReview,
  publicationIssues,
  resourceLicenseSchema,
  resourceTagsSchema,
  resourceVersionInputSchema,
  RESOURCE_ACTIONS,
  EDITABLE_STATUSES,
  type ContentActor,
  type ItemVersionRef,
  type PublicationContext,
  type ResourceAction,
  type ResourceRecord,
  type ResourceStatus,
  type ResourceVersion,
} from '@kampus/school-core/content/resource.ts'
import { planCopy } from '@kampus/school-core/content/copy.ts'
import type { ContentType } from '@kampus/school-core/content/taxonomy.ts'
import { RESOURCE_FILE_MESSAGES } from '@kampus/school-core/content/resource-files.ts'
import { planShareChange } from '@kampus/school-core/content/visibility.ts'
import { DomainError } from '@kampus/school-core/lib/errors.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

import type { CommandMessages } from './commands.ts'
import { FILE_REJECTED_MESSAGE } from './files.ts'

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
 * (F3c1), materyal dosyası (`file`, OG-250; DOM-KYN-006) ve okuma parçasına bağlanabilen quiz ile
 * alıştırma seti (okuma-anlama etkinliği, OG-984; IST-042, DOM-BEC-006).
 */
export const AUTHORABLE_TYPES = [
  'reading_passage',
  'question',
  'file',
  'quiz',
  'exercise_set',
] as const
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

/**
 * Quiz/alıştırma setinin bağlı sürümlerine (sorular, okuma parçası) dayanan yayım kodları (core
 * `publicationIssues`; DOM-KYN-013, DOM-BEC-006). Bağlı sürümün durumunu yalnız sunucu bilir: istemci
 * bu kodları kuru çalıştırmada üretmez, ayrıntının `publicationIssues` listesinden okur.
 */
export const LINKED_CONTENT_MESSAGES = {
  passage_missing:
    'Seçilen okuma parçası bulunamadı ya da artık açılamıyor; başka bir parça seçin.',
  passage_not_reading: 'Bağlanan içerik okuma parçası değil; bir okuma parçası seçin.',
  passage_not_published:
    'Okuma parçası yayında değil; önce parçayı yayımlayın ya da yayındaki bir parça seçin.',
  quiz_item_missing: 'Seçilen soru bulunamadı ya da artık açılamıyor; listeden çıkarın.',
  quiz_item_not_question: 'Listeye yalnız soru eklenebilir.',
  quiz_item_not_published: 'Soru yayında değil; yayındaki bir soru seçin.',
  quiz_item_untagged: 'Kazanım veya beceri etiketi olmayan soru eklenemez.',
} as const satisfies CommandMessages
export type LinkedIssueCode = keyof typeof LINKED_CONTENT_MESSAGES

export const isLinkedIssueCode = (code: string): code is LinkedIssueCode =>
  Object.hasOwn(LINKED_CONTENT_MESSAGES, code)

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
  // Dosya taranırken (`processing`) ya da tarayıcı kapalı ortamda (`pending`, `FILE_SCANNER=off`)
  // eklenmek istenirse sakin ileti; form taranan dosyada kaydı zaten kilitler (OG-987). Taramada
  // reddedilen dosya (Sabah kararı 42) kaldırılıp başkası yüklenir.
  file_not_ready: RESOURCE_FILE_NOT_READY_MESSAGE,
  file_rejected: FILE_REJECTED_MESSAGE,
  // Okuma-anlama etkinliğinin bağlı parçası ve soruları (onaya gönderme, yayım, onay; OG-984).
  ...LINKED_CONTENT_MESSAGES,
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
  const status = error instanceof ApiError ? error.status : undefined
  const code = error instanceof ApiError ? error.code : undefined
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

/** Yayım denetiminden geçen geçişler (core `planVersionTransition` `assertPublishable`). */
const PUBLISHING_ACTIONS: ReadonlySet<ActionKind> = new Set(['submit', 'publish', 'approve'])

/**
 * Kuru çalıştırmada bağlı sürümler (sorular, okuma parçası) geçerli varsayılır: istemcide yüklü
 * değildirler ve verilmezse core her quiz'de `quiz_item_missing` üretirdi. Gerçek durumları
 * sunucunun ayrıntıda döndürdüğü yayım sorunlarındadır (`LINKED_CONTENT_MESSAGES`).
 */
export function assumedLinkedRefs(
  version: ResourceVersion,
): Pick<PublicationContext, 'itemVersions' | 'passageVersion'> {
  const { content } = version
  if (content.type !== 'quiz' && content.type !== 'exercise_set') return {}
  const tags = { ...version.tags, primarySkill: version.tags.primarySkill ?? 'reading' }
  const ref = (id: string, contentType: ContentType): ItemVersionRef => ({
    id,
    status: 'published',
    tags,
    contentType,
  })
  return {
    itemVersions: new Map(
      content.items.map((item) => [
        item.questionVersionId,
        ref(item.questionVersionId, 'question'),
      ]),
    ),
    passageVersion:
      content.passageVersionId === null
        ? undefined
        : ref(content.passageVersionId, 'reading_passage'),
  }
}

/**
 * Baş sürümde kullanıcıya sunulacak durum geçişleri. Core kuralı kuru çalıştırılır: izinsiz veya
 * geçersiz geçiş görünmez; yalnız yayım eksiği yüzünden uygulanamayan geçiş görünür ve nedeni
 * taşır. Bağlı sürümlerin eksiği (`LINKED_CONTENT_MESSAGES`) sunucunun yayım sorunlarından gelir.
 * Zümre başkanı/koordinatör verisi yanıtta olmadığından onay yöneticiye gösterilir
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
  const refs = assumedLinkedRefs(version)
  const issueCodes = new Set(
    publicationIssues({ institutionType, version, now, ...refs }).map((i) => i.code),
  )
  const linkedCode = detail.publicationIssues.map((issue) => issue.code).find(isLinkedIssueCode)
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
        ...refs,
      })
    } catch (error) {
      if (!(error instanceof DomainError) || HIDDEN_CODES.has(error.code)) continue
      if (!issueCodes.has(error.code)) continue
      // Onaysız yayın hakkı yoksa "Yayımla" hiç sunulmaz (yayım eksiği giderilince de çıkmazdı).
      if (action === 'publish' && requiresReview(version.license, resource.shareScope)) continue
      blockedReason = error.message
    }
    if (blockedReason === null && linkedCode && PUBLISHING_ACTIONS.has(action))
      blockedReason = LINKED_CONTENT_MESSAGES[linkedCode]
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

// --- Kaynak düzeyindeki eylemler: paylaş, kopyala, telif bildirimi, kaldır (OG-217) -------------

export type ResourceCommandState = {
  /** Paylaşım kapsamını değiştirebilir (DOM-KYN-040). */
  share: boolean
  /** Kopyalanabilir; `blockedReason` doluysa görünür ama lisans nedeniyle uygulanamaz (DOM-KYN-050). */
  copy: { blockedReason: string | null } | null
  /** Telif bildirimi yapılacak yayın sürümü (DOM-KYN-025); yoksa `null`. */
  report: { versionId: string; rowVersion: number | undefined } | null
  /** Kaynak kaldırılabilir (DOM-KYN-051; yalnız yönetici). */
  remove: boolean
}

/** Kopya yalnız lisans yüzünden engelliyse eylem görünür kalır, nedeni yazılır. */
const COPY_BLOCKED_CODES = new Set(['license_forbids_copy', 'license_expired'])

/**
 * Ayrıntıdaki sürüm geçmişi satırını core sürüm şekline çevirir. Kararın dayandığı alanlar (durum,
 * etiketler, lisans, onaylayan) satırın kendisinden gelir: baş sürüm açık taslakken kopya ve
 * yönetim kararı yayın sürümünün gerçek verisiyle verilir (DOM-KYN-050). Satır içerik taşımaz;
 * içerik baş sürümden doldurulur ve hiçbir eylem kararında kullanılmaz. Lisans çözülemezse
 * `undefined` döner: o sürüme bağlı kararı sunucu verir.
 */
export function versionFromSummary(
  base: ResourceVersion,
  summary: StaffResourceDetail['versions'][number],
): ResourceVersion | undefined {
  const license = resourceLicenseSchema.nullable().safeParse(summary.license)
  const tags = resourceTagsSchema.safeParse(summary.tags)
  if (!license.success || !tags.success) return undefined
  return {
    ...base,
    id: summary.id,
    versionNumber: summary.versionNumber,
    status: summary.status,
    authorUserId: summary.authorUserId,
    tags: tags.data,
    license: license.data,
    reviewedByUserId: summary.reviewedByUserId,
    publishedAt: summary.publishedAt,
    archivedAt: summary.archivedAt,
    removedAt: summary.removedAt,
  }
}

const passes = (plan: () => unknown): boolean => {
  try {
    plan()
    return true
  } catch (error) {
    if (error instanceof DomainError) return false
    throw error
  }
}

/**
 * Panelde sunulacak kaynak düzeyindeki eylemler. Karar istemcide yeniden yazılmaz: core
 * `planShareChange`, `planCopy`, `planVersionTransition` (`report`) ve `planResourceRemoval` kuru
 * çalıştırılır; sunucu aynı işlevleri yazarken gerçek kayıtla yeniden uygular. Kaldırılmış
 * (içeriksiz) kaynakta hiçbir eylem yoktur.
 */
export function resourceCommands({
  detail,
  actor,
  institutionType,
  now,
}: ActionContext): ResourceCommandState {
  const none: ResourceCommandState = { share: false, copy: null, report: null, remove: false }
  const head = coreVersion(detail.head, detail.resource.id)
  if (!head || detail.versions.some((v) => v.status === 'removed')) return none
  const resource = coreResource(detail)
  const contentActor = asActor(actor)
  const converted = detail.versions.map((summary) =>
    summary.id === head.id ? head : versionFromSummary(head, summary),
  )
  const versions = converted.filter((v): v is ResourceVersion => v !== undefined)
  const currentSummary = detail.versions.find((v) => v.id === resource.currentVersionId)
  const current = versions.find((v) => v.id === resource.currentVersionId) ?? null
  // Yayın sürümü çözülemediyse (beklenmez) kopya ve bildirim açık kalır; kararı sunucu verir.
  const currentUnknown = currentSummary !== undefined && current === null

  // Mevcut hedeflerle kuru çalıştırma yalnız "paylaşımı yönetebilir mi" sorusunu sınar; seçilen
  // yeni hedefin kapsamını (öğretmenin sınıfları) sunucu denetler.
  const share = passes(() =>
    planShareChange({
      actor: contentActor,
      institutionType,
      resource,
      currentVersion: current,
      targets: {
        scope: resource.shareScope,
        studentIds: [...resource.sharedStudentIds],
        classIds: [...resource.sharedClassIds],
      },
      teaching: {
        studentIds: new Set(resource.sharedStudentIds),
        classIds: new Set(resource.sharedClassIds),
      },
    }),
  )

  let copy: ResourceCommandState['copy'] = currentUnknown ? { blockedReason: null } : null
  if (current) {
    try {
      planCopy({
        actor: contentActor,
        institutionType,
        source: { origin: 'institution', resource, version: current },
        ids: { resourceId: 'kuru-kaynak', versionId: 'kuru-surum' },
        now,
      })
      copy = { blockedReason: null }
    } catch (error) {
      if (!(error instanceof DomainError)) throw error
      if (COPY_BLOCKED_CODES.has(error.code)) copy = { blockedReason: error.message }
    }
  }

  const report =
    current &&
    passes(() =>
      planVersionTransition({
        action: 'report',
        actor: contentActor,
        institutionType,
        resource,
        version: current,
        now,
        reason: 'gerekçe',
      }),
    )
      ? {
          versionId: current.id,
          rowVersion: current.id === detail.head.id ? detail.head.rowVersion : undefined,
        }
      : null

  const remove = passes(() =>
    planResourceRemoval({ actor: contentActor, resource, versions, reason: 'gerekçe', now }),
  )
  return { share, copy, report, remove }
}
