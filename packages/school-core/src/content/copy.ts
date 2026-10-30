import type { InstitutionType } from '../modules/collection-modules.ts'
import { DomainError } from '../lib/errors.ts'
import {
  isContentStaff,
  publicationIssues,
  versionData,
  type ContentActor,
  type Lineage,
  type PublicationIssue,
  type ResourceRecord,
  type ResourceVersion,
  type ResourceVersionData,
  type ResourceVersionMeta,
} from './resource.ts'
import { licenseExpired } from './taxonomy.ts'
import { canBrowseLibrary, canReadVersion, libraryVersionVisible } from './visibility.ts'

/**
 * Kopya ve uyarlama (DOM-KYN-044, DOM-KYN-050; ADR 0004 karar 3, 9). Kopya yeni bir kaynaktır:
 * sahibi kopyalayan kişidir, kapsamı `Yalnız ben` başlar, türetildiği sürümün bağını, menşesini
 * ve kaynak gösterimlerini taşır. Asıl kaynağın yeni sürümü kopyayı değiştirmez.
 *
 * Kural `resource.ts`'in değil bu dosyanın içindedir: okuma kararı `visibility.ts`'tedir ve o da
 * `resource.ts`'e bağlıdır; aynı dosyada döngüsel içe aktarma doğardı.
 */

/** Kampüs kütüphanesi sürümü (`platform_resource_versions`): kurum kimliği yoktur. */
export type PlatformResourceVersion = ResourceVersionData &
  Pick<ResourceVersionMeta, 'id' | 'resourceId'> & { status: 'published' | 'archived' }

export type CopySource =
  | { origin: 'institution'; resource: ResourceRecord; version: ResourceVersion }
  | { origin: 'platform'; version: PlatformResourceVersion }

export type CopyInput = {
  actor: ContentActor
  institutionType: InstitutionType
  source: CopySource
  ids: { resourceId: string; versionId: string }
  now: Date | string
}

export type CopyPlan = {
  resource: ResourceRecord
  version: ResourceVersion
  /** Kopyanın kaynak sürümünden miras aldığı menşe; sonraki taslak düzenlemeleri korur. */
  lineage: Lineage
  /** Kütüphane kopyası kurumun yayım koşullarını karşılamıyorsa eksikleri; kopya taslak başlar. */
  issues: PublicationIssue[]
}

/**
 * Kopyanın miras aldığı menşe (DOM-KYN-024, 044, 050). Kurum kopyası lisansı aynen alır; kütüphane
 * kopyasının menşesi "Kampüs örnek içeriğinden türetildi"dir. Kaynak gösterimleri her durumda kalır.
 */
export function copyLineage(source: CopySource): Lineage {
  return source.origin === 'institution'
    ? { license: source.version.license, attributions: source.version.attributions }
    : {
        license: { kind: 'platform_derived', platformVersionId: source.version.id },
        attributions: source.version.attributions,
      }
}

/**
 * Kopyayı planlar. Kurum kaynağının kopyası `Taslak` başlar (DOM-KYN-050). Değiştirilmemiş
 * kütüphane kopyası kurumun yayım koşullarını karşılıyorsa doğrudan `Yayında` başlar
 * (ADR 0004 açık soru 1a: platform içeriği gözden geçirilmiştir); karşılamıyorsa taslaktır ve
 * eksikler döner. Düzenleme yeni sürüm açar ve olağan onaya girer.
 */
export function planCopy(input: CopyInput): CopyPlan {
  const { actor, institutionType, source, ids, now } = input
  const notFound = (): never => {
    throw new DomainError('resource_not_found', 'İçerik bulunamadı.', { kind: 'not_found' })
  }
  if (!isContentStaff(actor.role)) {
    throw new DomainError('resource_action_forbidden', 'İçerik kopyalama yetkiniz yok.', {
      kind: 'forbidden',
    })
  }

  let data: ResourceVersionData
  if (source.origin === 'institution') {
    const { resource, version } = source
    // Görülemeyen kaynak var olmamış gibi davranır; varlığı sızmaz.
    if (!canReadVersion({ kind: 'staff', actor }, { institutionType, resource, version, now })) {
      notFound()
    }
    if (version.status !== 'published' || resource.currentVersionId !== version.id) {
      throw new DomainError('copy_source_not_published', 'Yalnız yayındaki içerik kopyalanır.', {
        kind: 'conflict',
      })
    }
    const license = version.license
    if (license?.kind === 'licensed_publication' && !license.allowsAdaptation) {
      throw new DomainError(
        'license_forbids_copy',
        'Lisans uyarlamaya izin vermediği için bu içerik kopyalanamaz.',
        { kind: 'forbidden' },
      )
    }
    // DOM-KYN-021: süresi dolan lisans yayından kalkar; kopyası da yeni kullanım açamaz.
    if (licenseExpired(license, now)) {
      throw new DomainError('license_expired', 'Lisans süresi dolmuş içerik kopyalanamaz.', {
        kind: 'conflict',
        path: ['license', 'expiryDate'],
      })
    }
    data = versionData(version)
  } else {
    if (!canBrowseLibrary(actor.role) || !libraryVersionVisible(source.version)) notFound()
    // Kütüphane sorusu kurumda yoktur; quiz kopyası sorularını kurumda bulamaz.
    const type = source.version.content.type
    if (type === 'quiz' || type === 'exercise_set') {
      throw new DomainError(
        'copy_items_unsupported',
        'Kütüphane quiz ve alıştırma setleri henüz kopyalanamaz; soruları tek tek kopyalayın.',
        { kind: 'conflict' },
      )
    }
    // TODO(F3b): platform `fileId`'leri kurumun dosyası değildir; servis kopyada dosyaları kurum
    // deposuna kopyalayıp yeni kimliklerle değiştirmeli (ADR 0003 karar 3, kurum kapsamı).
    data = { ...versionData(source.version), license: copyLineage(source).license }
  }

  const issues =
    source.origin === 'platform' ? publicationIssues({ institutionType, version: data, now }) : []
  const published = source.origin === 'platform' && issues.length === 0
  const at = new Date(now).toISOString()
  const version: ResourceVersion = {
    ...data,
    id: ids.versionId,
    resourceId: ids.resourceId,
    versionNumber: 1,
    status: published ? 'published' : 'draft',
    authorUserId: actor.userId,
    createdAt: at,
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    publishedAt: published ? at : null,
    archivedAt: null,
    removedAt: null,
    removalReason: null,
  }
  const resource: ResourceRecord = {
    id: ids.resourceId,
    contentType: data.content.type,
    ownerUserId: actor.userId,
    ownerActive: true,
    shareScope: 'private',
    sharedStudentIds: [],
    sharedClassIds: [],
    currentVersionId: published ? ids.versionId : null,
    derivedFromVersionId: source.origin === 'institution' ? source.version.id : null,
    derivedFromPlatformVersionId: source.origin === 'platform' ? source.version.id : null,
  }
  return { resource, version, lineage: copyLineage(source), issues }
}
