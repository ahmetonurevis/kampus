import { randomUUID } from 'node:crypto'

import {
  resourceVersionInputSchema,
  type ResourceRecord,
  type ResourceVersion,
  type ResourceVersionInput,
  type ResourceVersionMeta,
} from '@kampus/school-core/content/resource.ts'

import type { Database } from '../../src/db/client.ts'
import { insertResourceWithVersions } from '../../src/db/resources.ts'
import { FIXED_NOW } from './app.ts'

/**
 * İçerik havuzu test kayıtları. Yazma ucu bu dilimde yok; kayıtlar depo fonksiyonuyla eklenir
 * (`insertResourceWithVersions`), içerik core `resourceVersionInputSchema` ile doğrulanır.
 */

export type SampleVersion = Partial<ResourceVersionMeta> & {
  input?: Partial<ResourceVersionInput>
}

export function sampleVersion(
  resourceId: string,
  authorUserId: string,
  overrides: SampleVersion = {},
): ResourceVersion {
  const { input, ...meta } = overrides
  const data = resourceVersionInputSchema.parse({
    title: 'Okuma metni',
    content: { type: 'text', body: 'Kısa bir okuma metni.' },
    license: { kind: 'institution_original' },
    tags: { gradeLevels: [9] },
    ...input,
  })
  const status = meta.status ?? 'draft'
  const at = FIXED_NOW.toISOString()
  return {
    id: randomUUID(),
    resourceId,
    versionNumber: 1,
    status,
    authorUserId,
    createdAt: at,
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    publishedAt: status === 'published' || status === 'archived' ? at : null,
    archivedAt: status === 'archived' ? at : null,
    removedAt: status === 'removed' ? at : null,
    removalReason: status === 'removed' ? 'Telif bildirimi kabul edildi.' : null,
    ...data,
    ...meta,
  }
}

export type SampleResource = Partial<Omit<ResourceRecord, 'ownerActive' | 'id'>> & {
  ownerUserId: string
  /** Sürümler; verilmezse tek taslak. Güncel sürüm `current: true` olan, yoksa son yayındaki. */
  versions?: (SampleVersion & { current?: boolean })[]
}

/** Kaynağı sürümleriyle ekler; kaynak ve sürüm kimliklerini döndürür. */
export async function seedResource(
  db: Database,
  institutionId: string,
  sample: SampleResource,
  now = FIXED_NOW,
): Promise<{ resource: Omit<ResourceRecord, 'ownerActive'>; versions: ResourceVersion[] }> {
  const id = randomUUID()
  const specs = sample.versions ?? [{}]
  const versions = specs.map((spec, index) => {
    const meta: SampleVersion & { current?: boolean } = { versionNumber: index + 1, ...spec }
    delete meta.current
    return sampleVersion(id, spec.authorUserId ?? sample.ownerUserId, meta)
  })
  // Güncel sürüm: açıkça işaretlenen, yoksa son yayındaki sürüm.
  const marked = specs.findIndex((spec) => spec.current === true)
  const current =
    marked >= 0 ? versions[marked] : versions.findLast((version) => version.status === 'published')
  const resource: Omit<ResourceRecord, 'ownerActive'> = {
    id,
    contentType: sample.contentType ?? versions[0]?.content.type ?? 'text',
    ownerUserId: sample.ownerUserId,
    shareScope: sample.shareScope ?? 'private',
    sharedStudentIds: sample.sharedStudentIds ?? [],
    sharedClassIds: sample.sharedClassIds ?? [],
    currentVersionId: sample.currentVersionId ?? current?.id ?? null,
    derivedFromVersionId: sample.derivedFromVersionId ?? null,
    derivedFromPlatformVersionId: sample.derivedFromPlatformVersionId ?? null,
  }
  await insertResourceWithVersions(db, institutionId, resource, versions, now)
  return { resource, versions }
}
