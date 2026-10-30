import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  planCopy,
  type CopyInput,
  type PlatformResourceVersion,
} from '../packages/school-core/src/content/copy.ts'
import {
  planDraftUpdate,
  planVersionTransition,
  resourceVersionInputSchema,
  type ResourceVersionInput,
} from '../packages/school-core/src/content/resource.ts'
import {
  admin,
  author,
  build,
  colleague,
  frontDesk,
  languagePassage,
  multipleChoice,
  now,
  outsider,
  schoolText,
  student,
} from './support/content-fixtures.ts'
import { isDomainError } from './support/domain-error.ts'

const ids = { resourceId: 'test-copy', versionId: 'test-copy-v1' }
const attribution = { work: 'Nutuk', author: 'Mustafa Kemal Atatürk', source: 's. 12', year: null }

function institutionSource(
  input: ResourceVersionInput = schoolText(),
  shareScope: 'private' | 'department' | 'institution' = 'department',
) {
  const built = build(input, {
    version: { status: 'published', publishedAt: now, reviewedByUserId: admin.userId },
    resource: { shareScope },
  })
  return { origin: 'institution' as const, ...built }
}

function platformVersion(
  input: ResourceVersionInput = schoolText(),
  status: 'published' | 'archived' = 'published',
): PlatformResourceVersion {
  return {
    ...resourceVersionInputSchema.parse(input),
    id: 'test-pv1',
    resourceId: 'test-pr1',
    status,
  }
}

const copy = (source: CopyInput['source'], patch: Partial<CopyInput> = {}) =>
  planCopy({ actor: colleague, institutionType: 'school', source, ids, now, ...patch })

describe('Kurum kaynağının kopyası (DOM-KYN-050)', () => {
  test('kopya yeni kaynaktır: sahibi kopyalayan, taslak başlar, soy ve menşe taşır', () => {
    const source = institutionSource(
      schoolText({ license: { kind: 'contains_quotation' }, attributions: [attribution] }),
    )
    const before = structuredClone(source)
    const plan = copy(source)
    assert.equal(plan.resource.ownerUserId, colleague.userId)
    assert.equal(plan.resource.shareScope, 'private')
    assert.equal(plan.resource.derivedFromVersionId, source.version.id)
    assert.equal(plan.resource.derivedFromPlatformVersionId, null)
    assert.equal(plan.resource.currentVersionId, null)
    assert.equal(plan.version.status, 'draft')
    assert.equal(plan.version.authorUserId, colleague.userId)
    assert.equal(plan.version.versionNumber, 1)
    assert.deepEqual(plan.version.license, { kind: 'contains_quotation' })
    assert.deepEqual(plan.version.attributions, [attribution])
    assert.deepEqual(plan.lineage, {
      license: { kind: 'contains_quotation' },
      attributions: [attribution],
    })
    assert.deepEqual(plan.issues, [])
    assert.deepEqual(source, before, 'asıl kaynak değişmez')
  })

  test('kopyanın düzenlemesi kaynak gösterimini ve menşeyi silemez', () => {
    const source = institutionSource(
      schoolText({ license: { kind: 'contains_quotation' }, attributions: [attribution] }),
    )
    const plan = copy(source)
    assert.throws(
      () =>
        planDraftUpdate({
          actor: colleague,
          resource: plan.resource,
          version: plan.version,
          input: schoolText({
            license: { kind: 'institution_original' },
            attributions: [attribution],
          }),
          lineage: plan.lineage,
        }),
      isDomainError('license_inherited'),
    )
  })

  test('görülemeyen kaynak bulunamaz; yalnız yayındaki güncel sürüm kopyalanır', () => {
    assert.throws(
      () => copy(institutionSource(schoolText(), 'private')),
      isDomainError('resource_not_found', 'not_found'),
    )
    assert.throws(
      () => copy(institutionSource(), { actor: outsider }),
      isDomainError('resource_not_found', 'not_found'),
      'başka branş zümre kaynağını görmez',
    )
    const draft = {
      origin: 'institution' as const,
      ...build(schoolText(), { resource: { shareScope: 'department' } }),
    }
    assert.throws(
      () => copy(draft, { actor: author }),
      isDomainError('copy_source_not_published', 'conflict'),
    )
    const source = institutionSource()
    const superseded = {
      ...source,
      resource: { ...source.resource, currentVersionId: 'test-r1-v2' },
    }
    assert.throws(() => copy(superseded), isDomainError('copy_source_not_published', 'conflict'))
  })

  test('DOM-KYN-021: uyarlama izni olmayan lisanslı yayın kopyalanamaz', () => {
    const licensed = (allowsAdaptation: boolean) =>
      institutionSource(
        schoolText({
          license: {
            kind: 'licensed_publication',
            publisher: 'Örnek Yayınları',
            contractNumber: 'S-1',
            coverage: 'Kurum',
            expiryDate: '2027-06-30',
            allowsAdaptation,
          },
          attributions: [attribution],
        }),
      )
    assert.throws(() => copy(licensed(false)), isDomainError('license_forbids_copy', 'forbidden'))
    assert.equal(copy(licensed(true)).version.license?.kind, 'licensed_publication')
  })

  test('DOM-KYN-021: süresi dolmuş lisanslı yayın kopyalanamaz', () => {
    const licensed = (expiryDate: string) =>
      institutionSource(
        schoolText({
          license: {
            kind: 'licensed_publication',
            publisher: 'Örnek Yayınları',
            contractNumber: 'S-1',
            coverage: 'Kurum',
            expiryDate,
            allowsAdaptation: true,
          },
          attributions: [attribution],
        }),
      )
    const expired = licensed('2026-01-01')
    const before = structuredClone(expired)
    assert.throws(() => copy(expired), isDomainError('license_expired', 'conflict'))
    assert.deepEqual(expired, before)
    // Bitiş günü İstanbul saatiyle dahildir: 6 Ekim'de 6 Ekim bitişli lisans geçerlidir.
    assert.equal(copy(licensed('2026-10-06')).version.status, 'draft')
    assert.throws(
      () => copy(licensed('2026-10-06'), { now: '2026-10-06T21:30:00.000Z' }),
      isDomainError('license_expired', 'conflict'),
    )
  })

  test('DOM-KYN-050: miras lisansın hiçbir alanı kopyada değiştirilemez', () => {
    const license = {
      kind: 'licensed_publication' as const,
      publisher: 'Örnek Yayınları',
      contractNumber: 'S-1',
      coverage: 'Kurum',
      expiryDate: '2027-06-30',
      allowsAdaptation: true,
      restrictedToBookOwners: true,
    }
    const plan = copy(institutionSource(schoolText({ license, attributions: [attribution] })))
    const edit = (patch: Record<string, unknown>) =>
      planDraftUpdate({
        actor: colleague,
        resource: plan.resource,
        version: plan.version,
        input: schoolText({
          license: { ...license, ...patch } as ResourceVersionInput['license'],
          attributions: [attribution],
        }),
        lineage: plan.lineage,
      })
    assert.equal(edit({}).status, 'draft', 'aynı lisans kabul edilir')
    for (const patch of [
      { expiryDate: '2030-12-31' },
      { restrictedToBookOwners: false },
      { allowsAdaptation: false },
      { contractNumber: 'S-2' },
      { publisher: 'Başka Yayınları' },
      { coverage: 'Bütün şubeler' },
    ]) {
      assert.throws(() => edit(patch), isDomainError('license_inherited'), JSON.stringify(patch))
    }
    assert.throws(
      () =>
        planDraftUpdate({
          actor: colleague,
          resource: plan.resource,
          version: plan.version,
          input: schoolText({ license: null, attributions: [attribution] }),
          lineage: plan.lineage,
        }),
      isDomainError('license_inherited'),
      'lisans boşaltılamaz',
    )

    const open = copy(
      institutionSource(
        schoolText({
          license: { kind: 'open_license', license: 'CC-BY-SA-4.0' },
          attributions: [attribution],
        }),
      ),
    )
    assert.throws(
      () =>
        planDraftUpdate({
          actor: colleague,
          resource: open.resource,
          version: open.version,
          input: schoolText({
            license: { kind: 'open_license', license: 'CC0-1.0' },
            attributions: [attribution],
          }),
          lineage: open.lineage,
        }),
      isDomainError('license_inherited'),
      'açık lisans adı değişmez',
    )
  })

  test('öğrenci, veli ve ön büro kopyalayamaz', () => {
    for (const actor of [student, frontDesk, { role: 'veli' as const, userId: 'test-u-parent' }]) {
      assert.throws(
        () => copy(institutionSource(schoolText(), 'institution'), { actor }),
        isDomainError('resource_action_forbidden', 'forbidden'),
        actor.role,
      )
    }
  })
})

describe('Kampüs kütüphanesinin kopyası (DOM-KYN-044, açık soru 1a)', () => {
  test('değiştirilmemiş kopya kurum koşullarını karşılıyorsa yayında başlar', () => {
    const plan = copy({
      origin: 'platform',
      version: platformVersion(schoolText({ attributions: [attribution] })),
    })
    assert.equal(plan.version.status, 'published')
    assert.equal(plan.version.publishedAt, now)
    assert.equal(plan.version.reviewedByUserId, null)
    assert.equal(plan.resource.currentVersionId, ids.versionId)
    assert.equal(plan.resource.derivedFromPlatformVersionId, 'test-pv1')
    assert.equal(plan.resource.derivedFromVersionId, null)
    assert.deepEqual(plan.version.license, {
      kind: 'platform_derived',
      platformVersionId: 'test-pv1',
    })
    assert.deepEqual(plan.version.attributions, [attribution], 'kaynak gösterimi korunur')
    assert.deepEqual(plan.issues, [])
  })

  test('kurumun etiket koşullarını karşılamayan kopya taslak başlar ve eksikleri döner', () => {
    const plan = copy({ origin: 'platform', version: platformVersion(languagePassage()) })
    assert.equal(plan.version.status, 'draft')
    assert.equal(plan.resource.currentVersionId, null)
    assert.deepEqual(
      plan.issues.map((i) => i.code),
      ['subject_required', 'grade_required', 'outcome_required'],
    )
    const languageSchool = copy(
      { origin: 'platform', version: platformVersion(languagePassage()) },
      { institutionType: 'language_school' },
    )
    assert.equal(languageSchool.version.status, 'published')
  })

  test('kopyanın düzenlemesi yeni sürüm olarak onaya girer', () => {
    const plan = copy({ origin: 'platform', version: platformVersion() })
    assert.throws(
      () =>
        planVersionTransition({
          action: 'publish',
          actor: colleague,
          institutionType: 'school',
          resource: plan.resource,
          version: {
            ...plan.version,
            id: 'test-copy-v2',
            versionNumber: 2,
            status: 'draft',
            publishedAt: null,
          },
          now,
        }),
      isDomainError('review_required', 'forbidden'),
    )
  })

  test('öğrenci ve veli kütüphaneye erişemez; arşivdeki ve lisanslı sürüm kopyalanamaz', () => {
    assert.throws(
      () => copy({ origin: 'platform', version: platformVersion() }, { actor: student }),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.throws(
      () => copy({ origin: 'platform', version: platformVersion(schoolText(), 'archived') }),
      isDomainError('resource_not_found', 'not_found'),
    )
    const licensed = platformVersion(
      schoolText({
        license: {
          kind: 'licensed_publication',
          publisher: 'Örnek',
          contractNumber: 'S-1',
          coverage: 'Kurum',
          expiryDate: '2027-06-30',
          allowsAdaptation: true,
        },
      }),
    )
    assert.throws(
      () => copy({ origin: 'platform', version: licensed }),
      isDomainError('resource_not_found', 'not_found'),
      'lisanslı yayın kurum dışına çıkmaz',
    )
  })

  test('kütüphane quiz ve alıştırma seti henüz kopyalanmaz', () => {
    for (const type of ['quiz', 'exercise_set'] as const) {
      const version = platformVersion(
        multipleChoice({
          answerKey: null,
          content: { type, items: [{ questionVersionId: 'test-pq1' }] },
        }),
      )
      assert.throws(
        () => copy({ origin: 'platform', version }),
        isDomainError('copy_items_unsupported', 'conflict'),
        type,
      )
    }
  })
})
