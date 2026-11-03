import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import { scopeFor } from '../packages/school-core/src/lib/scope.ts'
import type { ResourceVersionInput } from '../packages/school-core/src/content/resource.ts'
import {
  canBrowseLibrary,
  canReadVersion,
  isAssignable,
  libraryVersionVisible,
  planShareChange,
  reachesBookOwner,
  shareTargetDelta,
  shareTargetsSchema,
  type ContentLearner,
  type ContentViewer,
  type ShareChangeInput,
} from '../packages/school-core/src/content/visibility.ts'
import {
  admin,
  author,
  build,
  colleague,
  coordinator,
  frontDesk,
  head,
  languagePassage,
  now,
  outsider,
  schoolText,
  student,
} from './support/content-fixtures.ts'
import { isDomainError } from './support/domain-error.ts'

const staff = (actor: typeof author): ContentViewer => ({ kind: 'staff', actor })
const deniz: ContentLearner = {
  studentId: 'test-s1',
  classIds: ['test-7a'],
  grade: 7,
  cefrLevel: null,
}
const ece: ContentLearner = {
  studentId: 'test-s2',
  classIds: ['test-5b'],
  grade: 5,
  cefrLevel: null,
}
const learnerB1: ContentLearner = {
  studentId: 'test-k1',
  classIds: ['test-g1'],
  grade: null,
  cefrLevel: 'B1',
}

const licensed = (restrictedToBookOwners: boolean, expiryDate = '2027-06-30') =>
  schoolText({
    license: {
      kind: 'licensed_publication',
      publisher: 'Örnek Yayınları',
      contractNumber: 'S-1',
      coverage: 'Kurum',
      expiryDate,
      restrictedToBookOwners,
    },
    attributions: [{ work: 'Matematik 7', author: 'Örnek Yayınları', source: 's. 40' }],
  })

function published(
  input: ResourceVersionInput = schoolText(),
  resource: NonNullable<Parameters<typeof build>[1]>['resource'] = {},
) {
  return build(input, { version: { status: 'published', publishedAt: now }, resource })
}

describe('Paylaşım hedefleri', () => {
  test('hedef listesi kapsamla uyumlu olmalıdır', () => {
    assert.equal(shareTargetsSchema.safeParse({ scope: 'private' }).success, true)
    assert.equal(
      shareTargetsSchema.safeParse({ scope: 'classes', classIds: ['c1', 'c1'] }).data?.classIds
        .length,
      1,
    )
    assert.equal(shareTargetsSchema.safeParse({ scope: 'students' }).success, false)
    assert.equal(shareTargetsSchema.safeParse({ scope: 'classes' }).success, false)
    assert.equal(
      shareTargetsSchema.safeParse({ scope: 'institution', studentIds: ['s1'] }).success,
      false,
    )
    assert.equal(
      shareTargetsSchema.safeParse({ scope: 'students', studentIds: ['s1'], classIds: ['c1'] })
        .success,
      false,
    )
    assert.equal(shareTargetsSchema.safeParse({ scope: 'everyone' }).success, false)
  })

  const teaching = { classIds: new Set(['test-7a']), studentIds: new Set(['test-s1']) }
  const change = (patch: Partial<ShareChangeInput> = {}) => {
    const built = published()
    return planShareChange({
      actor: author,
      institutionType: 'school',
      resource: built.resource,
      currentVersion: built.version,
      targets: { scope: 'classes', classIds: ['test-7a'] },
      teaching,
      ...patch,
    })
  }

  test('DOM-KYN-040: öğretmen yalnız kendi sınıf ve öğrencilerine paylaşır', () => {
    assert.deepEqual(change(), {
      shareScope: 'classes',
      sharedStudentIds: [],
      sharedClassIds: ['test-7a'],
    })
    assert.throws(
      () => change({ targets: { scope: 'classes', classIds: ['test-8c'] } }),
      isDomainError('share_target_out_of_scope', 'forbidden'),
    )
    assert.throws(
      () => change({ targets: { scope: 'students', studentIds: ['test-s9'] } }),
      isDomainError('share_target_out_of_scope', 'forbidden'),
    )
    assert.throws(
      () => change({ teaching: undefined }),
      isDomainError('share_target_out_of_scope', 'forbidden'),
    )
    assert.equal(
      change({
        actor: admin,
        teaching: undefined,
        targets: { scope: 'classes', classIds: ['test-8c'] },
      }).shareScope,
      'classes',
      'yönetici kurumun bütün sınıflarına paylaşır',
    )
  })

  test('DOM-KYN-040: kapsam yalnız eklenen ve çıkarılan hedefe uygulanır; kapsam dışı kayıtlı hedef korunur', () => {
    const built = published(schoolText(), { shareScope: 'classes', sharedClassIds: ['test-7b'] })
    const base = {
      actor: author,
      institutionType: 'school' as const,
      resource: built.resource,
      currentVersion: built.version,
      teaching,
    }
    assert.deepEqual(
      planShareChange({ ...base, targets: { scope: 'classes', classIds: ['test-7b', 'test-7a'] } }),
      { shareScope: 'classes', sharedStudentIds: [], sharedClassIds: ['test-7b', 'test-7a'] },
      'yöneticinin eklediği 7-B değişmeden kalır, öğretmen kendi 7-A sınıfını ekler',
    )
    assert.equal(
      planShareChange({ ...base, targets: { scope: 'classes', classIds: ['test-7b'] } })
        .sharedClassIds[0],
      'test-7b',
      'hedef değişmeden yeniden kaydedilebilir',
    )
    for (const targets of [
      { scope: 'classes' as const, classIds: ['test-7a'] },
      { scope: 'private' as const },
      { scope: 'students' as const, studentIds: ['test-s1'] },
    ]) {
      assert.throws(
        () => planShareChange({ ...base, targets }),
        isDomainError('share_target_out_of_scope', 'forbidden'),
        `kapsam dışı 7-B kaldırılamaz (${targets.scope})`,
      )
    }
    assert.deepEqual(
      shareTargetDelta(
        { sharedStudentIds: ['a', 'b'], sharedClassIds: ['c'] },
        { studentIds: ['b', 'd'], classIds: ['c'] },
      ),
      { addedStudentIds: ['d'], removedStudentIds: ['a'], addedClassIds: [], removedClassIds: [] },
    )
  })

  test('öğretmen kapsamı core scopeFor sonucundan gelir', () => {
    const state = createSeed(new Date(now))
    const scope = scopeFor(state, {
      role: 'ogretmen',
      links: [{ kind: 'teacher', recordId: 't1' }],
    })
    const [own] = [...scope.classIds]
    assert.ok(own)
    const foreign = state.classes.find((c) => !scope.classIds.has(c.id))
    assert.ok(foreign)
    assert.equal(
      change({ teaching: scope, targets: { scope: 'classes', classIds: [own] } }).shareScope,
      'classes',
    )
    assert.throws(
      () => change({ teaching: scope, targets: { scope: 'classes', classIds: [foreign.id] } }),
      isDomainError('share_target_out_of_scope', 'forbidden'),
    )
  })

  test('paylaşımı yalnız sahip, zümre başkanı ve yönetici değiştirir', () => {
    assert.throws(
      () => change({ actor: colleague }),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.throws(
      () => change({ actor: frontDesk }),
      isDomainError('resource_action_forbidden', 'forbidden'),
    )
    assert.equal(change({ actor: head, targets: { scope: 'private' } }).shareScope, 'private')
    const draft = build(schoolText())
    const input = {
      institutionType: 'school' as const,
      resource: draft.resource,
      currentVersion: null,
      targets: { scope: 'private' as const },
    }
    assert.equal(planShareChange({ ...input, actor: author }).shareScope, 'private')
    assert.throws(
      () => planShareChange({ ...input, actor: head }),
      isDomainError('resource_action_forbidden', 'forbidden'),
      'yayında sürüm yokken zümre başkanı eşleşmez',
    )
  })

  test('DOM-KYN-031: onaysız yayın zümre veya kuruma açılırken onaylı sürüm ister', () => {
    assert.throws(
      () => change({ targets: { scope: 'department' } }),
      isDomainError('share_scope_review_required', 'conflict'),
    )
    const reviewed = build(schoolText(), {
      version: { status: 'published', publishedAt: now, reviewedByUserId: head.userId },
    })
    assert.equal(
      change({
        resource: reviewed.resource,
        currentVersion: reviewed.version,
        targets: { scope: 'institution' },
      }).shareScope,
      'institution',
    )
    const draft = build(schoolText())
    assert.equal(
      change({ resource: draft.resource, currentVersion: null, targets: { scope: 'department' } })
        .shareScope,
      'department',
      'yayında sürüm yoksa yayım onayı ayrıca denetler',
    )
  })

  test('DOM-KYN-021: kitap sahibiyle sınırlı lisans sınıf veya kuruma paylaşılmaz', () => {
    const built = published(licensed(true))
    const base = {
      actor: admin,
      institutionType: 'school' as const,
      resource: built.resource,
      currentVersion: { ...built.version, reviewedByUserId: head.userId },
    }
    for (const scope of ['classes', 'institution'] as const) {
      assert.throws(
        () =>
          planShareChange({
            ...base,
            targets: scope === 'classes' ? { scope, classIds: ['test-7a'] } : { scope },
          }),
        isDomainError('license_restricts_share'),
      )
    }
    assert.equal(
      planShareChange({ ...base, targets: { scope: 'students', studentIds: ['test-s1'] } })
        .shareScope,
      'students',
    )
  })
})

describe('Personelin gördüğü kaynak', () => {
  test('DOM-KYN-030: taslak yalnız sahibine, incelemedeki onaylayıcıya da görünür', () => {
    const draft = build(schoolText())
    const context = { institutionType: 'school' as const, ...draft, now }
    assert.equal(canReadVersion(staff(author), context), true)
    for (const actor of [colleague, head, admin, frontDesk]) {
      assert.equal(canReadVersion(staff(actor), context), false, actor.userId)
    }
    const orphan = { ...context, resource: { ...draft.resource, ownerActive: false } }
    assert.equal(
      canReadVersion(staff(admin), orphan),
      true,
      'ayrılan öğretmenin taslağı yöneticiye açılır',
    )

    const review = build(schoolText(), { version: { status: 'in_review' } })
    const reviewContext = { institutionType: 'school' as const, ...review, now }
    assert.equal(canReadVersion(staff(head), reviewContext), true)
    assert.equal(canReadVersion(staff(admin), reviewContext), true)
    assert.equal(canReadVersion(staff(colleague), reviewContext), false)
    const authored = {
      ...reviewContext,
      version: { ...review.version, authorUserId: colleague.userId },
    }
    assert.equal(canReadVersion(staff(colleague), authored), true, 'sürümün yazarı görür')
  })

  test('DOM-KYN-040, 042: yayın kapsamına göre zümre ve kurum öğretmenleri okur', () => {
    const read = (
      actor: typeof author,
      scope: 'private' | 'classes' | 'department' | 'institution',
    ) =>
      canReadVersion(staff(actor), {
        institutionType: 'school',
        ...published(schoolText(), { shareScope: scope }),
        now,
      })
    assert.equal(read(colleague, 'department'), true)
    assert.equal(read(outsider, 'department'), false, 'başka branş zümreyi görmez')
    assert.equal(read(outsider, 'institution'), true)
    assert.equal(read(colleague, 'classes'), false)
    assert.equal(read(head, 'classes'), true, 'zümre başkanı branşının kaynağını okur')
    assert.equal(read(head, 'private'), false)
    assert.equal(read(admin, 'private'), true)
    assert.equal(read(author, 'private'), true)
    assert.equal(read(frontDesk, 'institution'), false, 'ön büro içerik havuzuna erişmez')
  })

  test('dersi olmayan dil okulu içeriğinde zümre kurumun öğretmenleridir', () => {
    const built = published(languagePassage(), { shareScope: 'department' })
    const context = { institutionType: 'language_school' as const, ...built, now }
    assert.equal(canReadVersion(staff(outsider), context), true)
    assert.equal(canReadVersion(staff(coordinator), context), true)
  })

  test('kaldırılan içeriğin kalıntısını yalnız sahip ve yönetici görür; arşiv geçmiş için okunur', () => {
    const removed = build(schoolText(), {
      version: { status: 'removed' },
      resource: { shareScope: 'institution' },
    })
    const context = { institutionType: 'school' as const, ...removed, now }
    assert.equal(canReadVersion(staff(author), context), true)
    assert.equal(canReadVersion(staff(admin), context), true)
    assert.equal(canReadVersion(staff(colleague), context), false)
    const archived = build(schoolText(), {
      version: { status: 'archived' },
      resource: { shareScope: 'institution' },
    })
    assert.equal(
      canReadVersion(staff(colleague), { institutionType: 'school', ...archived, now }),
      true,
    )
  })

  test('başka kaynağın sürümü hiçbir role görünmez', () => {
    const built = published(schoolText(), { shareScope: 'institution' })
    const context = {
      institutionType: 'school' as const,
      resource: { ...built.resource, id: 'test-r2', currentVersionId: built.version.id },
      version: built.version,
      now,
    }
    assert.equal(canReadVersion(staff(admin), context), false)
    assert.equal(canReadVersion({ kind: 'student', learner: deniz }, context), false)
  })
})

describe('Öğrencinin ve velinin gördüğü kaynak', () => {
  const visible = (
    viewer: ContentViewer,
    built: ReturnType<typeof build>,
    institutionType: 'school' | 'language_school' = 'school',
    at: string = now,
  ) => canReadVersion(viewer, { institutionType, ...built, now: at })
  const asStudent = (learner: ContentLearner): ContentViewer => ({ kind: 'student', learner })

  test('DOM-KYN-041: yayında, kapsamda ve düzeyi eşleşen kaynak görünür', () => {
    const toClass = published(schoolText(), { shareScope: 'classes', sharedClassIds: ['test-7a'] })
    assert.equal(visible(asStudent(deniz), toClass), true)
    assert.equal(
      visible(asStudent({ ...deniz, classIds: ['test-7b'] }), toClass),
      false,
      'kapsam dışı sınıf',
    )
    assert.equal(visible(asStudent({ ...deniz, grade: 8 }), toClass), false, 'düzey eşleşmeli')
    assert.equal(visible(asStudent({ ...deniz, grade: null }), toClass), false)

    const direct = published(schoolText(), {
      shareScope: 'students',
      sharedStudentIds: ['test-s1'],
    })
    assert.equal(visible(asStudent(deniz), direct), true)
    assert.equal(visible(asStudent(ece), direct), false)

    const institution = published(schoolText(), { shareScope: 'institution' })
    assert.equal(visible(asStudent(deniz), institution), true)
    assert.equal(visible(asStudent(ece), institution), false, 'kurum kapsamında da düzey eşleşir')

    for (const shareScope of ['private', 'department'] as const) {
      assert.equal(
        visible(asStudent(deniz), published(schoolText(), { shareScope })),
        false,
        shareScope,
      )
    }
  })

  test('öğrenci taslağı, incelemedekini, eski ve arşiv sürümü görmez', () => {
    const resource = { shareScope: 'institution' as const }
    for (const status of ['draft', 'in_review', 'rejected', 'archived', 'removed'] as const) {
      const built = build(schoolText(), { version: { status }, resource })
      assert.equal(visible(asStudent(deniz), built), false, status)
    }
    const superseded = published(schoolText(), { ...resource, currentVersionId: 'test-r1-v2' })
    assert.equal(visible(asStudent(deniz), superseded), false, 'eski sürüm kütüphanede görünmez')
  })

  test('dil okulunda öğrenci kendi CEFR seviyesindeki kaynağı görür', () => {
    const passage = published(languagePassage(), { shareScope: 'institution' })
    assert.equal(visible(asStudent(learnerB1), passage, 'language_school'), true)
    assert.equal(
      visible(asStudent({ ...learnerB1, cefrLevel: 'A2' }), passage, 'language_school'),
      false,
    )
    assert.equal(
      visible(asStudent({ ...learnerB1, cefrLevel: null }), passage, 'language_school'),
      false,
    )
  })

  test('DOM-KYN-021: lisansı dolan ve kitap sahibiyle sınırlı içerik', () => {
    const expired = published(licensed(false, '2026-10-05'), { shareScope: 'institution' })
    assert.equal(visible(asStudent(deniz), expired), false)
    const restricted = published(licensed(true), { shareScope: 'institution' })
    assert.equal(visible(asStudent(deniz), restricted), false, 'paylaşım öğrenci kapsamını aşamaz')
    const owners = published(licensed(true), {
      shareScope: 'students',
      sharedStudentIds: ['test-s1'],
    })
    assert.equal(visible(asStudent(deniz), owners), true)
  })

  test('DOM-KYN-021: kitap sahibi sınırı yalnız seçilmiş öğrencileri geçirir', () => {
    const owners = published(licensed(true), {
      shareScope: 'students',
      sharedStudentIds: ['test-s1'],
    })
    assert.equal(reachesBookOwner(owners.resource, owners.version, 'test-s1'), true)
    assert.equal(reachesBookOwner(owners.resource, owners.version, 'test-s2'), false)
    const toClass = published(licensed(true), { shareScope: 'classes', sharedStudentIds: [] })
    assert.equal(reachesBookOwner(toClass.resource, toClass.version, 'test-s1'), false)
    const open = published(licensed(false), { shareScope: 'classes' })
    assert.equal(reachesBookOwner(open.resource, open.version, 'test-s2'), true)
    const original = published(schoolText(), { shareScope: 'private' })
    assert.equal(reachesBookOwner(original.resource, original.version, 'test-s2'), true)
  })

  test('veli çocuklarının gördüğünü görür, fazlasını görmez', () => {
    const toClass = published(schoolText(), { shareScope: 'classes', sharedClassIds: ['test-7a'] })
    assert.equal(visible({ kind: 'parent', children: [deniz, ece] }, toClass), true)
    assert.equal(visible({ kind: 'parent', children: [ece] }, toClass), false)
    assert.equal(visible({ kind: 'parent', children: [] }, toClass), false)
  })
})

describe('Kampüs kütüphanesi ve atama', () => {
  test('kütüphaneyi yalnız kurum personeli süzer', () => {
    assert.equal(canBrowseLibrary('yonetici'), true)
    assert.equal(canBrowseLibrary('ogretmen'), true)
    for (const role of ['onburo', 'ogrenci', 'veli'] as const) {
      assert.equal(canBrowseLibrary(role), false, role)
    }
    assert.equal(student.role, 'ogrenci')
  })

  test('lisanslı yayın ve yayında olmayan sürüm kütüphanede bulunmaz', () => {
    const platform = build(schoolText()).version
    assert.equal(libraryVersionVisible({ ...platform, status: 'published' }), true)
    assert.equal(libraryVersionVisible({ ...platform, status: 'archived' }), false)
    assert.equal(libraryVersionVisible(published(licensed(false)).version), false)
  })

  test('yeni atamaya yalnız güncel, yayında ve lisansı geçerli sürüm girer', () => {
    const current = published()
    assert.equal(isAssignable(current.resource, current.version, now), true)
    assert.equal(
      isAssignable({ ...current.resource, currentVersionId: 'test-r1-v2' }, current.version, now),
      false,
    )
    const archived = build(schoolText(), { version: { status: 'archived' } })
    assert.equal(
      isAssignable(
        { ...archived.resource, currentVersionId: archived.version.id },
        archived.version,
        now,
      ),
      false,
    )
    const expired = published(licensed(false, '2026-10-05'))
    assert.equal(isAssignable(expired.resource, expired.version, now), false)
    assert.equal(isAssignable(expired.resource, expired.version, '2026-10-05T10:00:00.000Z'), true)
  })
})
