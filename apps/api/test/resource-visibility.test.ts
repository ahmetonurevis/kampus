import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'

import { RESOURCE_STATUSES, type ResourceStatus } from '@kampus/school-core/content/resource.ts'
import { SHARE_SCOPES, type ShareScope } from '@kampus/school-core/content/taxonomy.ts'
import { canReadVersion, type ContentViewer } from '@kampus/school-core/content/visibility.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'

import type { App } from '../src/app.ts'
import type { Database } from '../src/db/client.ts'
import { insertMissingRecords } from '../src/db/records.ts'
import { listVisibleVersionIds } from '../src/db/resources.ts'
import {
  buildTestApp,
  createInstitution,
  createMember,
  createTestDatabase,
  createUser,
  FIXED_NOW,
} from './support/app.ts'
import { seedResource, type SampleResource } from './support/resources-sample.ts'

/**
 * Görünürlük SQL'i (`db/resources.ts` `versionVisibleSql`) ile core `canReadVersion` aynı kararı
 * verir: rol matrisi × durum × paylaşım kapsamı × lisans × düzey/seviye ızgarasında her kişinin
 * okuyabildiği sürüm kümesi iki yoldan eşittir (DOM-KYN-030, 040, 041, 042, 051, 052).
 */

const STATUSES = Object.keys(RESOURCE_STATUSES) as ResourceStatus[]
const SCOPES = Object.keys(SHARE_SCOPES) as ShareScope[]

const restrictedLicense = (expiryDate: string) => ({
  kind: 'licensed_publication' as const,
  publisher: 'Örnek Yayınevi',
  contractNumber: 'SZ-2026-01',
  coverage: 'Basılı kitap sahibi öğrenciler',
  expiryDate,
  restrictedToBookOwners: true,
})
const openLicense = (expiryDate: string) => ({
  ...restrictedLicense(expiryDate),
  restrictedToBookOwners: false,
})

function grid(
  type: InstitutionType,
  owners: { active: string; departed: string; passive: string; other: string },
) {
  const tags =
    type === 'school'
      ? { subjectId: 'matematik', gradeLevels: [9] }
      : { cefrLevel: 'B1' as const, gradeLevels: [] }
  const otherLevel =
    type === 'school'
      ? { subjectId: 'matematik', gradeLevels: [10] }
      : { cefrLevel: 'A2' as const, gradeLevels: [] }
  const shares = { sharedStudentIds: ['ogr-1'], sharedClassIds: ['9-A'] }
  const samples: SampleResource[] = []
  const scoped = (scope: ShareScope) => ({
    shareScope: scope,
    sharedStudentIds: scope === 'students' ? shares.sharedStudentIds : [],
    sharedClassIds: scope === 'classes' ? shares.sharedClassIds : [],
  })
  for (const owner of [owners.active, owners.departed, owners.passive])
    for (const status of STATUSES)
      for (const scope of SCOPES)
        samples.push({
          ownerUserId: owner,
          ...scoped(scope),
          versions: [{ status, input: { tags } }],
        })
  for (const scope of SCOPES) {
    samples.push(
      // Kitap sahibiyle sınırlı lisans (DOM-KYN-021), süresi dolmuş, bugün biten lisans.
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [
          { status: 'published', input: { tags, license: restrictedLicense('2027-06-30') } },
        ],
      },
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [{ status: 'published', input: { tags, license: openLicense('2026-10-05') } }],
      },
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [{ status: 'published', input: { tags, license: openLicense('2026-10-06') } }],
      },
      // Başka düzey/seviye; dersi olmayan zümre içeriği.
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [{ status: 'published', input: { tags: otherLevel } }],
      },
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [{ status: 'published', input: { tags: { gradeLevels: [9] } } }],
      },
      // Başka yazarın taslağı ve incelemesi; güncel olmayan yayın sürümü; arşiv + yeni taslak.
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [
          { status: 'published', input: { tags }, current: true },
          { status: 'draft', authorUserId: owners.other, input: { tags } },
        ],
      },
      {
        ownerUserId: owners.active,
        ...scoped(scope),
        versions: [
          { status: 'archived', input: { tags } },
          { status: 'published', input: { tags } },
          { status: 'in_review', authorUserId: owners.other, input: { tags } },
        ],
      },
      {
        ownerUserId: owners.departed,
        ...scoped(scope),
        versions: [
          { status: 'published', input: { tags } },
          { status: 'published', input: { tags }, current: false },
        ],
      },
    )
  }
  return samples
}

describe('içerik görünürlüğü: SQL ↔ core eşitliği', () => {
  let db: Database
  let close: () => Promise<void>
  let app: App

  before(async () => {
    ;({ db, close } = await createTestDatabase())
    app = await buildTestApp(db)
  })
  after(async () => {
    await app.close()
    await close()
  })

  for (const type of ['school', 'language_school'] as const) {
    test(`DOM-KYN-030/040/041/042/051/052: ${type} rol matrisinde her kişinin sürüm kümesi core ile aynı`, async () => {
      const institution = await createInstitution(app, { type })
      await insertMissingRecords(
        db,
        institution.id,
        [
          { collection: 'teachers', id: 't-etkin', data: { id: 't-etkin', isActive: true } },
          { collection: 'teachers', id: 't-pasif', data: { id: 't-pasif', isActive: false } },
        ],
        FIXED_NOW,
      )
      const owner = await createMember(app, institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-etkin' },
      ])
      // Kadrosu pasifleşen sahip: üyeliği var, bağlı öğretmen kaydı pasif (DOM-KYN-052).
      const passive = await createMember(app, institution.id, 'ogretmen', [
        { kind: 'teacher', recordId: 't-pasif' },
      ])
      const other = await createMember(app, institution.id, 'ogretmen')
      // Kurumdan ayrılan sahip: üyeliği yok (DOM-KYN-052).
      const departed = await createUser(app)
      const samples = grid(type, {
        active: owner.id,
        departed: departed.id,
        passive: passive.id,
        other: other.id,
      })
      const seeded = []
      for (const sample of samples) seeded.push(await seedResource(db, institution.id, sample))

      const level = (grade: number, cefr: 'B1' | 'A2') =>
        type === 'school' ? { grade, cefrLevel: null } : { grade: null, cefrLevel: cefr }
      const viewers: Record<string, ContentViewer> = {
        yonetici: { kind: 'staff', actor: { role: 'yonetici', userId: institution.admin.id } },
        sahip: {
          kind: 'staff',
          actor: { role: 'ogretmen', userId: owner.id, subjectIds: ['matematik'] },
        },
        yazar: {
          kind: 'staff',
          actor: { role: 'ogretmen', userId: other.id, subjectIds: ['fizik'] },
        },
        zumre: {
          kind: 'staff',
          actor: { role: 'ogretmen', userId: 'ogretmen-zumre', subjectIds: ['matematik'] },
        },
        baskaBrans: {
          kind: 'staff',
          actor: { role: 'ogretmen', userId: 'ogretmen-fizik', subjectIds: ['fizik'] },
        },
        inceleyici: {
          kind: 'staff',
          actor: {
            role: 'ogretmen',
            userId: 'ogretmen-baskan',
            subjectIds: [],
            reviewer: { subjectIds: ['matematik'], cefrLevels: ['B1'] },
          },
        },
        onburo: { kind: 'staff', actor: { role: 'onburo', userId: 'onburo-1' } },
        ogrenciPaylasilan: {
          kind: 'student',
          learner: { studentId: 'ogr-1', classIds: ['9-A'], ...level(9, 'B1') },
        },
        ogrenciSinif: {
          kind: 'student',
          learner: { studentId: 'ogr-2', classIds: ['9-A'], ...level(9, 'B1') },
        },
        ogrenciBaskaSinif: {
          kind: 'student',
          learner: { studentId: 'ogr-3', classIds: ['9-B'], ...level(9, 'B1') },
        },
        ogrenciSeviyesiz: {
          kind: 'student',
          learner: { studentId: 'ogr-4', classIds: ['9-A'], grade: null, cefrLevel: null },
        },
        veli: {
          kind: 'parent',
          children: [
            { studentId: 'ogr-3', classIds: ['9-B'], ...level(9, 'B1') },
            { studentId: 'ogr-5', classIds: ['10-A'], ...level(10, 'A2') },
          ],
        },
        veliCocuksuz: { kind: 'parent', children: [] },
      }

      for (const [name, viewer] of Object.entries(viewers)) {
        const expected = seeded
          .flatMap(({ resource, versions }) =>
            versions.filter((version) =>
              canReadVersion(viewer, {
                institutionType: type,
                resource: { ...resource, ownerActive: resource.ownerUserId === owner.id },
                version,
                now: FIXED_NOW,
              }),
            ),
          )
          .map((version) => version.id)
          .sort()
        const actual = await listVisibleVersionIds(db, institution.id, viewer, type, FIXED_NOW)
        assert.deepEqual(actual, expected, `${type} · ${name}`)
        if (['onburo', 'veliCocuksuz', 'ogrenciSeviyesiz'].includes(name))
          assert.equal(actual.length, 0, name)
        else assert.ok(actual.length > 0, `${type} · ${name}: ızgara boş küme vermemeli`)
      }

      // Başka kurumun kişisi aynı kimliklerle hiçbir sürüm görmez.
      const stranger = await createInstitution(app, { type })
      assert.deepEqual(
        await listVisibleVersionIds(db, stranger.id, viewers.yonetici!, type, FIXED_NOW),
        [],
      )
    })
  }
})
