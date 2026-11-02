import { z } from 'zod'
import type { InstitutionType } from '../modules/collection-modules.ts'
import type { Role } from '../modules/navigation.ts'
import { DomainError } from '../lib/errors.ts'
import {
  canManage,
  isContentStaff,
  requiresReview,
  staffCanReadVersion,
  type ContentActor,
  type ResourceRecord,
  type ResourceVersion,
} from './resource.ts'
import { SHARE_SCOPES, enumKeys, licenseExpired, type CefrLevel } from './taxonomy.ts'

/**
 * İçerik havuzunda kim neyi görür (DOM-KYN-030, 040…044; yetki-ve-kapsam.md matrisi).
 *
 * - Personel (yönetici, öğretmen) sürüm durumuna ve paylaşım kapsamına göre okur; ön büro içerik
 *   havuzuna erişmez (DOM-YTK-021).
 * - Öğrenci yalnız yayındaki güncel sürümü, kapsam kendisini içeriyor ve düzey/seviye eşleşiyorsa
 *   görür; veli çocuğunun gördüğünü salt okur görür (DOM-KYN-041).
 * - Kampüs kütüphanesini yalnız personel süzer; öğrenci ve veli görmez (ADR 0004 karar 9).
 *
 * Kapsam sunucuda uygulanır: API listeyi SQL'de aynı koşullarla süzer, sonucu bu fonksiyonlarla
 * doğrular; istemci süzgeci güvenlik sınırı değildir.
 */

z.config(z.locales.tr())

const identifier = z.string().trim().min(1, 'Bir kayıt seçin.').max(200)
const distinct = <T>(list: readonly T[]): T[] => [...new Set(list)]

/** Paylaşım hedefi (`resource_shares`; DOM-KYN-040). Hedef listesi kapsamla birlikte gelir. */
export const shareTargetsSchema = z
  .object({
    scope: z.enum(enumKeys(SHARE_SCOPES), 'Paylaşım kapsamını seçin.'),
    studentIds: z.array(identifier).max(500).default([]).transform(distinct),
    classIds: z.array(identifier).max(100).default([]).transform(distinct),
  })
  .superRefine((targets, ctx) => {
    const wantsStudents = targets.scope === 'students'
    const wantsClasses = targets.scope === 'classes'
    if (wantsStudents && targets.studentIds.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'En az bir öğrenci seçin.', path: ['studentIds'] })
    }
    if (wantsClasses && targets.classIds.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'En az bir sınıf seçin.', path: ['classIds'] })
    }
    if (!wantsStudents && targets.studentIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Öğrenci yalnız öğrenci kapsamında seçilir.',
        path: ['studentIds'],
      })
    }
    if (!wantsClasses && targets.classIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Sınıf yalnız sınıf/grup kapsamında seçilir.',
        path: ['classIds'],
      })
    }
  })
export type ShareTargetsInput = z.input<typeof shareTargetsSchema>
export type ShareTargets = z.output<typeof shareTargetsSchema>

/**
 * Öğretmenin ders verdiği sınıflar ve öğrenciler. `lib/scope.ts` `scopeFor(...)` sonucunun
 * `classIds`/`studentIds` alanlarıyla aynı biçimdedir; API kapsamı ikinci kez hesaplamaz.
 */
export type TeachingScope = {
  studentIds: ReadonlySet<string>
  classIds: ReadonlySet<string>
}

export type ShareChangeInput = {
  actor: ContentActor
  institutionType: InstitutionType
  resource: ResourceRecord
  /** Güncel yayındaki sürüm; hiç yayımlanmadıysa `null`. */
  currentVersion: ResourceVersion | null
  targets: ShareTargetsInput
  /** Öğretmen sınıf/öğrenci seçiyorsa zorunlu; yoksa seçim reddedilir. Yönetici kurumun tümüne paylaşır. */
  teaching?: TeachingScope | undefined
}

/**
 * Paylaşım kapsamını değiştirir (DOM-KYN-021, 031, 040). Yalnız kaynağı yönetebilen kişi; öğretmen
 * yalnız kendi sınıf ve öğrencilerine paylaşır. Onaysız yayımlanmış içerik zümre veya kuruma
 * açılırken onaylı bir sürüm gerekir. Kitap sahibiyle sınırlı lisans öğrenci kapsamını aşamaz.
 */
export function planShareChange(
  input: ShareChangeInput,
): Pick<ResourceRecord, 'shareScope' | 'sharedStudentIds' | 'sharedClassIds'> {
  const { actor, institutionType, resource, currentVersion } = input
  const forbidden = (code: string, message: string): never => {
    throw new DomainError(code, message, { kind: 'forbidden' })
  }
  // Yayında sürüm yoksa zümre başkanının ders/seviye eşleşmesi yoktur; sahip ve yönetici kalır.
  const manageable = currentVersion
    ? canManage(actor, resource, currentVersion, institutionType)
    : isContentStaff(actor.role) &&
      (actor.userId === resource.ownerUserId || actor.role === 'yonetici')
  if (!manageable) {
    forbidden(
      'resource_action_forbidden',
      'Paylaşımı yalnız sahibi, zümre başkanı veya yönetici değiştirir.',
    )
  }
  const targets = shareTargetsSchema.parse(input.targets)

  if (actor.role !== 'yonetici') {
    const teaching = input.teaching
    const outside =
      targets.classIds.some((id) => !teaching?.classIds.has(id)) ||
      targets.studentIds.some((id) => !teaching?.studentIds.has(id))
    if (outside) {
      forbidden(
        'share_target_out_of_scope',
        'Yalnız ders verdiğiniz sınıf ve öğrencilerle paylaşabilirsiniz.',
      )
    }
  }

  const license = currentVersion?.license ?? null
  if (
    license?.kind === 'licensed_publication' &&
    license.restrictedToBookOwners &&
    (targets.scope === 'classes' || targets.scope === 'institution')
  ) {
    throw new DomainError(
      'license_restricts_share',
      'Bu lisans yalnız kitap sahibi öğrencileri kapsar; öğrencileri tek tek seçin.',
    )
  }

  const widening =
    currentVersion !== null &&
    currentVersion.status === 'published' &&
    !requiresReview(license, resource.shareScope) &&
    requiresReview(license, targets.scope)
  if (widening && currentVersion.reviewedByUserId === null) {
    throw new DomainError(
      'share_scope_review_required',
      'Zümre veya kurumla paylaşmak için içeriğin onaylı bir sürümü gerekir; yeni sürümü onaya gönderin.',
      { kind: 'conflict' },
    )
  }
  return {
    shareScope: targets.scope,
    sharedStudentIds: targets.studentIds,
    sharedClassIds: targets.classIds,
  }
}

// --- Okuma kararları ----------------------------------------------------------------------

/** Öğrencinin içerik kapsamı için gereken bilgisi (API öğrenci ve sınıf kaydından kurar). */
export type ContentLearner = {
  studentId: string
  /** Etkin sınıf/şube ve dil grubu kimlikleri. */
  classIds: readonly string[]
  /** `school` sınıf düzeyi. */
  grade: number | null
  /** `language_school` kurunun CEFR seviyesi. */
  cefrLevel: CefrLevel | null
}

export type ContentViewer =
  | { kind: 'staff'; actor: ContentActor }
  | { kind: 'student'; learner: ContentLearner }
  | { kind: 'parent'; children: readonly ContentLearner[] }

export type VisibilityContext = {
  institutionType: InstitutionType
  resource: ResourceRecord
  version: ResourceVersion
  now: Date | string
}

/** Kişi bu sürümü görebilir mi (DOM-KYN-030, 040, 041, 042, 052). */
export function canReadVersion(viewer: ContentViewer, context: VisibilityContext): boolean {
  switch (viewer.kind) {
    case 'staff':
      return staffCanReadVersion(viewer.actor, context)
    case 'student':
      return learnerCanRead(viewer.learner, context)
    case 'parent':
      return viewer.children.some((child) => learnerCanRead(child, context))
    default:
      return viewer satisfies never
  }
}

/**
 * Kitap sahibi sınırı (DOM-KYN-021): lisans "basılı kitap sahibi öğrenciler" ile sınırlıysa içerik
 * yalnız kaynağın tek tek seçilmiş öğrencilerine (kitap sahipleri) açılır; sınıf veya kurum
 * paylaşımı ve görev ataması bu sınırı aşamaz. Sınırsız lisansta her öğrenci için doğrudur.
 * İçerik havuzu okuması ve atanmış görevin içeriği (API) aynı kuralı kullanır.
 */
export function reachesBookOwner(
  resource: Pick<ResourceRecord, 'shareScope' | 'sharedStudentIds'>,
  version: Pick<ResourceVersion, 'license'>,
  studentId: string,
): boolean {
  const license = version.license
  if (license?.kind !== 'licensed_publication' || !license.restrictedToBookOwners) return true
  return resource.shareScope === 'students' && resource.sharedStudentIds.includes(studentId)
}

function learnerCanRead(learner: ContentLearner, context: VisibilityContext): boolean {
  const { institutionType, resource, version, now } = context
  // Öğrenci kütüphanesinde yalnız güncel yayın sürümü; atanmış eski sürüm görev üzerinden açılır.
  if (version.status !== 'published' || resource.currentVersionId !== version.id) return false
  if (version.resourceId !== resource.id || licenseExpired(version.license, now)) return false
  if (!reachesBookOwner(resource, version, learner.studentId)) return false
  let inScope: boolean
  switch (resource.shareScope) {
    case 'students':
      inScope = resource.sharedStudentIds.includes(learner.studentId)
      break
    case 'classes':
      inScope = learner.classIds.some((id) => resource.sharedClassIds.includes(id))
      break
    case 'institution':
      inScope = true
      break
    case 'department':
    case 'private':
      inScope = false
      break
    default:
      return resource.shareScope satisfies never
  }
  if (!inScope) return false
  return institutionType === 'school'
    ? learner.grade !== null && version.tags.gradeLevels.includes(learner.grade)
    : learner.cefrLevel !== null && version.tags.cefrLevel === learner.cefrLevel
}

// --- Kütüphane ve atama -------------------------------------------------------------------

/** Kampüs kütüphanesini süzebilen roller: yalnız kurum personeli (karar 9, DOM-KYN-044). */
export function canBrowseLibrary(role: Role): boolean {
  return isContentStaff(role)
}

/**
 * Kütüphane sürümü kurumlara sunulabilir mi: yalnız yayındaki ve lisanslı yayın olmayan içerik
 * (karar 9: `Lisanslı yayın` hiçbir koşulda kurum dışına çıkmaz).
 */
export function libraryVersionVisible(
  version: Pick<ResourceVersion, 'status' | 'license'>,
): boolean {
  return version.status === 'published' && version.license?.kind !== 'licensed_publication'
}

/**
 * Sürüm yeni atamaya girebilir mi (DOM-KYN-021, 032, 051): yayında, kaynağın güncel sürümü ve
 * lisansı geçerli. Arşivlenmiş, eski ve lisansı dolmuş sürüm geçmiş görevlerde kalır.
 */
export function isAssignable(
  resource: Pick<ResourceRecord, 'id' | 'currentVersionId'>,
  version: Pick<ResourceVersion, 'id' | 'resourceId' | 'status' | 'license'>,
  now: Date | string,
): boolean {
  return (
    version.status === 'published' &&
    version.resourceId === resource.id &&
    resource.currentVersionId === version.id &&
    !licenseExpired(version.license, now)
  )
}
