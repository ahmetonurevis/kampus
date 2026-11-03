import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { ApiError } from '@kampus/api-client/errors.ts'

import { createCommandSession, runCommand } from '../src/commands.ts'
import {
  availableActions,
  canEditDraft,
  canOpenNewVersion,
  coreVersion,
  isVersionConflict,
  RESOURCE_FILE_GONE_MESSAGE,
  RESOURCE_FILE_NOT_READY_MESSAGE,
  RESOURCE_MESSAGES,
  resourceFileName,
  resourceFileOpenFailure,
  resourceFileSize,
  resourceCommands,
  resourceListQuery,
  versionFromSummary,
  type StaffResourceDetail,
} from '../src/resource-model.ts'

const NOW = new Date('2026-10-30T09:00:00.000Z')
const TEACHER = { role: 'ogretmen', userId: 'u-teacher' } as const
const ADMIN = { role: 'yonetici', userId: 'u-admin' } as const
const STUDENT = { role: 'ogrenci', userId: 'u-student' } as const

const TAGS = {
  subjectId: 'english',
  gradeLevels: [7],
  cefrLevel: 'B1',
  primarySkill: 'reading',
  skills: ['reading'],
  activityMode: null,
  interactionChannel: null,
  mediation: null,
  durationMinutes: null,
  difficulty: null,
  outcomes: [{ outcomeId: 'ENG.7.1', outcomeSource: 'institution' }],
} as const

/** Personel ayrıntısı: yalnız ilgili alan değişir. */
function detail(
  head: Partial<StaffResourceDetail['head']> = {},
  resource: Partial<StaffResourceDetail['resource']> = {},
): StaffResourceDetail {
  const version = {
    id: 'v1',
    versionNumber: 1,
    status: 'draft',
    title: 'Okuma parçası',
    authorUserId: TEACHER.userId,
    tags: TAGS,
    licenseKind: 'institution_original',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    removedAt: null,
    content: { type: 'reading_passage', body: 'Bir metin.' },
    answerKey: null,
    license: { kind: 'institution_original' },
    attributions: [],
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    removalReason: null,
    rowVersion: 1,
    ...head,
  } as StaffResourceDetail['head']
  return {
    view: 'staff',
    resource: {
      id: 'r1',
      contentType: 'reading_passage',
      ownerUserId: TEACHER.userId,
      shareScope: 'private',
      currentVersionId: null,
      derivedFromVersionId: null,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      sharedStudentIds: [],
      sharedClassIds: [],
      archivedAt: null,
      rowVersion: 1,
      ...resource,
    },
    versions: [version],
    head: version,
    publicationIssues: [],
  }
}

const labels = (actions: ReturnType<typeof availableActions>) =>
  actions.map((a) => `${a.action}${a.blockedReason ? '!' : ''}`)

describe('İçerik havuzu eylemleri (DOM-KYN-030, 031, 025)', () => {
  test('DOM-KYN-031: yazar taslağı onaya gönderir veya (kurum özgün, kendi kapsamı) yayımlar; onay ve ret görünmez', () => {
    const actions = availableActions({
      detail: detail(),
      actor: TEACHER,
      institutionType: 'school',
      now: NOW,
    })
    assert.deepEqual(labels(actions), ['submit', 'publish', 'archive'])
  })

  test('DOM-KYN-031: zümre kapsamında yayımla görünmez; onay gerekir', () => {
    const actions = availableActions({
      detail: detail({}, { shareScope: 'institution' }),
      actor: TEACHER,
      institutionType: 'school',
      now: NOW,
    })
    assert.deepEqual(labels(actions), ['submit', 'archive'])
  })

  test('DOM-KYN-020: lisansı olmayan taslakta gönder eksik nedeniyle engelli görünür; yayımla çıkmaz', () => {
    const actions = availableActions({
      detail: detail({ license: null, licenseKind: null }),
      actor: TEACHER,
      institutionType: 'school',
      now: NOW,
    })
    assert.deepEqual(labels(actions), ['submit!', 'archive'])
    assert.equal(actions[0]?.blockedReason, 'Menşe ve lisans türünü seçin.')
  })

  test('DOM-KYN-031: incelemedeki sürümde yazar geri çeker, kendi içeriğini onaylayamaz', () => {
    const inReview = detail({ status: 'in_review', submittedAt: '2026-10-30T08:30:00.000Z' })
    assert.deepEqual(
      labels(
        availableActions({ detail: inReview, actor: TEACHER, institutionType: 'school', now: NOW }),
      ),
      ['withdraw'],
    )
  })

  test('DOM-KYN-031: yönetici incelemedeki sürümü onaylar veya reddeder; ret gerekçe ister', () => {
    const inReview = detail({ status: 'in_review', submittedAt: '2026-10-30T08:30:00.000Z' })
    const actions = availableActions({
      detail: inReview,
      actor: ADMIN,
      institutionType: 'school',
      now: NOW,
    })
    assert.deepEqual(labels(actions), ['approve', 'reject'])
    assert.deepEqual(
      actions.map((a) => a.needsReason),
      [false, true],
    )
  })

  test('DOM-KYN-030: reddedilen sürümü yazar taslağa döndürür; yayındaki sürüm yalnız arşivlenir', () => {
    assert.deepEqual(
      labels(
        availableActions({
          detail: detail({ status: 'rejected', rejectionReason: 'Kaynak eksik' }),
          actor: TEACHER,
          institutionType: 'school',
          now: NOW,
        }),
      ),
      ['reopen', 'archive'],
    )
    assert.deepEqual(
      labels(
        availableActions({
          detail: detail({ status: 'published', publishedAt: '2026-10-30T08:40:00.000Z' }),
          actor: TEACHER,
          institutionType: 'school',
          now: NOW,
        }),
      ),
      ['archive'],
    )
  })

  test('DOM-KYN-051: başka öğretmen eylem görmez; kaldırılmış (içeriksiz) sürümde eylem yok', () => {
    const other = { role: 'ogretmen', userId: 'u-other' } as const
    assert.deepEqual(
      availableActions({ detail: detail(), actor: other, institutionType: 'school', now: NOW }),
      [],
    )
    assert.deepEqual(
      availableActions({
        detail: detail({ status: 'removed', content: null, removedAt: '2026-10-30T08:50:00.000Z' }),
        actor: ADMIN,
        institutionType: 'school',
        now: NOW,
      }),
      [],
    )
  })

  test('DOM-KYN-032: düzenleme yalnız yazara ve taslak/reddedilmiş sürüme açık; yeni sürüm yalnız yayında ve açık sürüm yokken', () => {
    const draft = detail()
    assert.equal(canEditDraft(draft.head, TEACHER.userId), true)
    assert.equal(canEditDraft(draft.head, 'u-other'), false)
    assert.equal(canEditDraft(detail({ status: 'in_review' }).head, TEACHER.userId), false)
    const published = detail({ status: 'published', publishedAt: '2026-10-30T08:40:00.000Z' })
    assert.equal(
      canOpenNewVersion({ detail: published, actor: TEACHER, institutionType: 'school' }),
      true,
    )
    assert.equal(
      canOpenNewVersion({
        detail: { ...published, versions: [...published.versions, { ...draft.head, id: 'v2' }] },
        actor: TEACHER,
        institutionType: 'school',
      }),
      false,
    )
    assert.equal(
      canOpenNewVersion({ detail: draft, actor: TEACHER, institutionType: 'school' }),
      false,
    )
  })
})

describe('İçerik listesi sorgusu', () => {
  const base = {
    page: 2,
    pageSize: 10,
    q: '',
    filters: {},
    sortKey: '',
    sortDirection: 1 as const,
    userId: 'u1',
  }

  test('boş süzgeç ve kısa arama gönderilmez; sıralama alan eşlemesinden gelir', () => {
    assert.deepEqual(resourceListQuery({ ...base, q: 'a' }), { page: 2, pageSize: 10 })
    assert.deepEqual(resourceListQuery({ ...base, sortKey: 'title', sortDirection: -1 }), {
      page: 2,
      pageSize: 10,
      sort: '-title',
    })
    assert.equal(resourceListQuery({ ...base, sortKey: 'bilinmeyen' }).sort, undefined)
  })

  test('süzgeçler ve "yalnız benimkiler" API alanlarına çevrilir', () => {
    assert.deepEqual(
      resourceListQuery({
        ...base,
        q: ' ışık ',
        filters: {
          contentType: 'question',
          cefrLevel: 'B1',
          primarySkill: 'reading',
          subjectId: 'english',
          gradeLevel: '7',
          status: 'draft',
          mine: 'yes',
        },
      }),
      {
        page: 2,
        pageSize: 10,
        q: 'ışık',
        contentType: 'question',
        cefrLevel: 'B1',
        primarySkill: 'reading',
        subjectId: 'english',
        gradeLevel: 7,
        status: 'draft',
        ownerUserId: 'u1',
      },
    )
  })
})

describe('Hata gösterimi: alan altında ya da toast, ikisi birden değil', () => {
  const fieldError = () =>
    new ApiError({
      status: 400,
      code: 'validation_failed',
      message: 'İstek geçersiz.',
      issues: [
        { path: ['title'], code: 'too_small', message: 'Başlık en az 3 karakter olmalıdır.' },
      ],
    })

  async function run(error: ApiError, exclusive: boolean, withForm = true) {
    const fields: string[] = []
    const toasts: string[] = []
    const outcome = await runCommand(
      createCommandSession(() => 'k1'),
      {
        execute: () => Promise.reject(error),
        refresh: () => Promise.resolve(),
        exclusive,
      },
      {},
      {
        ...(withForm ? { setError: (name: string) => void fields.push(name) } : {}),
        notifyError: (message) => void toasts.push(message),
      },
    )
    assert.equal(outcome.status, 'failed')
    return { fields, toasts }
  }

  test('exclusive: alan maddesi varsa yalnız alana yazılır', async () => {
    assert.deepEqual(await run(fieldError(), true), { fields: ['title'], toasts: [] })
  })

  test('exclusive: yollu 422 iş kuralı hatası da yalnız alana yazılır', async () => {
    const error = new ApiError({
      status: 422,
      code: 'subject_required',
      message: 'Ders seçin.',
      issues: [{ path: ['tags', 'subjectId'], code: 'custom', message: 'Ders seçin.' }],
    })
    assert.deepEqual(await run(error, true), { fields: ['tags.subjectId'], toasts: [] })
    assert.deepEqual(await run(error, false), { fields: [], toasts: ['Ders seçin.'] })
  })

  test('exclusive: alan yolu olmayan hata toast olur', async () => {
    const error = new ApiError({ status: 422, code: 'license_required', message: 'Lisans seçin.' })
    assert.deepEqual(await run(error, true), { fields: [], toasts: ['Lisans seçin.'] })
  })

  test('exclusive: alan hatasını yazacak form yoksa toast gösterilir; varsayılan davranış değişmez', async () => {
    assert.deepEqual((await run(fieldError(), true, false)).toasts, ['İstek geçersiz.'])
    assert.deepEqual(await run(fieldError(), false), {
      fields: ['title'],
      toasts: ['İstek geçersiz.'],
    })
  })
})

test('409 version_conflict yenileme seçeneğini tetikler; diğer 409 tetiklemez', () => {
  assert.equal(
    isVersionConflict(new ApiError({ status: 409, code: 'version_conflict', message: 'x' })),
    true,
  )
  assert.equal(
    isVersionConflict(new ApiError({ status: 409, code: 'open_version_exists', message: 'x' })),
    false,
  )
  assert.equal(isVersionConflict(new Error('x')), false)
})

describe('Kaynak dosyası iletileri (DOM-KYN-006, 051)', () => {
  test('DOM-KYN-006: dosya bağlama kodları Türkçe iletiyle eşlenir; eski "desteklenmiyor" iletisi yok', () => {
    const messages: Readonly<Record<string, string | undefined>> = RESOURCE_MESSAGES
    for (const code of [
      'resource_file_unlinked',
      'file_unavailable',
      'file_already_attached',
      'file_not_ready',
      'file_purpose_mismatch',
      'resource_files_not_allowed',
    ])
      assert.ok(messages[code], code)
    assert.equal(messages.resource_files_unsupported, undefined)
    // Dosya taranırken (`pending`) eklenmek istenirse sakin ve yönlendiren ileti.
    assert.equal(messages.file_not_ready, RESOURCE_FILE_NOT_READY_MESSAGE)
    assert.match(RESOURCE_FILE_NOT_READY_MESSAGE, /güvenlik denetiminden geçince eklenebilir/)
    // Sınırı taşıyan iletiler sunucudan gelir.
    assert.equal(messages.resource_files_limit, undefined)
  })

  test('DOM-KYN-051: erişilemeyen dosya (404) sakin ve teknik ayrıntısız ileti alır', () => {
    const gone = resourceFileOpenFailure(
      new ApiError({ status: 404, code: 'not_found', message: 'Not found: files/abc' }),
    )
    assert.deepEqual(gone, { kind: 'gone', message: RESOURCE_FILE_GONE_MESSAGE })
    assert.doesNotMatch(gone.message, /404|not_found|abc/)
  })

  test('işlenen dosya ve diğer hatalar ayrı iletilir', () => {
    assert.equal(
      resourceFileOpenFailure(new ApiError({ status: 409, code: 'file_processing', message: 'x' }))
        .kind,
      'processing',
    )
    assert.equal(resourceFileOpenFailure(new Error('ağ')).kind, 'failed')
    assert.equal(
      resourceFileOpenFailure(new ApiError({ status: 409, code: 'version_conflict', message: 'x' }))
        .kind,
      'failed',
    )
  })

  test('dosya adı ve boyutu okunur gösterilir', () => {
    assert.equal(resourceFileName({ name: '  ders.pdf ' }, 0), 'ders.pdf')
    assert.equal(resourceFileName({ name: null }, 1), 'Dosya 2')
    assert.equal(resourceFileSize(512), '512 B')
    assert.equal(resourceFileSize(2048), '2 KB')
    assert.equal(resourceFileSize(2.5 * 1024 * 1024), '2,5 MB')
  })
})

describe('Kaynak düzeyindeki eylemler (DOM-KYN-025, 040, 050, 051)', () => {
  const PUBLISHED_AT = '2026-10-30T08:40:00.000Z'
  const published = (
    head: Partial<StaffResourceDetail['head']> = {},
    resource: Partial<StaffResourceDetail['resource']> = {},
  ) =>
    detail(
      { status: 'published', publishedAt: PUBLISHED_AT, ...head },
      { currentVersionId: 'v1', ...resource },
    )
  const other = { role: 'ogretmen', userId: 'u-other' } as const
  const commands = (
    item: StaffResourceDetail,
    actor: { role: 'ogretmen' | 'yonetici' | 'ogrenci'; userId: string },
  ) => resourceCommands({ detail: item, actor, institutionType: 'school', now: NOW })

  test('DOM-KYN-040: sahip öğretmen yayındaki içeriğini paylaşır, kopyalar ve bildirir; kaldıramaz', () => {
    assert.deepEqual(commands(published(), TEACHER), {
      share: true,
      copy: { blockedReason: null },
      report: { versionId: 'v1', rowVersion: 1 },
      remove: false,
    })
  })

  test('DOM-KYN-050: kurumla paylaşılan içeriği başka öğretmen kopyalar ve bildirir; paylaşımı değiştiremez', () => {
    assert.deepEqual(commands(published({}, { shareScope: 'institution' }), other), {
      share: false,
      copy: { blockedReason: null },
      report: { versionId: 'v1', rowVersion: 1 },
      remove: false,
    })
  })

  test('DOM-KYN-025: görülemeyen (özel) içerikte başka öğretmene eylem yok', () => {
    assert.deepEqual(commands(published(), other), {
      share: false,
      copy: null,
      report: null,
      remove: false,
    })
  })

  test('DOM-KYN-051: yönetici paylaşır ve kaldırır; öğrenci hiçbir eylem görmez', () => {
    const state = commands(published({}, { shareScope: 'institution' }), ADMIN)
    assert.equal(state.share, true)
    assert.equal(state.remove, true)
    assert.notEqual(state.report, null)
    assert.deepEqual(commands(published({}, { shareScope: 'institution' }), STUDENT), {
      share: false,
      copy: null,
      report: null,
      remove: false,
    })
  })

  test('DOM-KYN-050: hiç yayımlanmamış taslak kopyalanmaz ve bildirilmez; sahip paylaşımı ayarlar', () => {
    assert.deepEqual(commands(detail(), TEACHER), {
      share: true,
      copy: null,
      report: null,
      remove: false,
    })
    assert.equal(commands(detail(), ADMIN).remove, true)
  })

  test('DOM-KYN-050: uyarlamaya izin vermeyen lisansta kopya görünür ama nedeniyle engellidir', () => {
    const licensed = published(
      {
        licenseKind: 'licensed_publication',
        license: {
          kind: 'licensed_publication',
          publisher: 'Örnek Yayınevi',
          contractNumber: 'S-1',
          coverage: 'Okul içi kullanım',
          expiryDate: '2027-06-30',
          allowsAdaptation: false,
          restrictedToBookOwners: false,
        },
      },
      { shareScope: 'institution' },
    )
    assert.deepEqual(commands(licensed, other).copy, {
      blockedReason: 'Lisans uyarlamaya izin vermediği için bu içerik kopyalanamaz.',
    })
  })

  test('DOM-KYN-025: baş sürüm yeni taslaksa bildirim güncel yayın sürümüne gider, If-Match bilinmez', () => {
    const base = published()
    const draftHead = { ...base.head, id: 'v2', versionNumber: 2, status: 'draft' as const }
    const item: StaffResourceDetail = {
      ...base,
      head: { ...draftHead, publishedAt: null },
      versions: [base.head, { ...draftHead, publishedAt: null }],
    }
    assert.deepEqual(commands(item, TEACHER).report, { versionId: 'v1', rowVersion: undefined })
  })

  test('DOM-KYN-050: baş sürüm açık taslakken kopya kararı yayın sürümünün lisansıyla verilir', () => {
    const licenseOf = (allowsAdaptation: boolean) => ({
      kind: 'licensed_publication',
      publisher: 'Örnek Yayınevi',
      contractNumber: 'S-1',
      coverage: 'Okul içi kullanım',
      expiryDate: '2027-06-30',
      allowsAdaptation,
      restrictedToBookOwners: false,
    })
    const withDraft = (publishedAllows: boolean): StaffResourceDetail => {
      const base = published(
        { licenseKind: 'licensed_publication', license: licenseOf(publishedAllows) },
        { shareScope: 'institution' },
      )
      const draft = {
        ...base.head,
        id: 'v2',
        versionNumber: 2,
        status: 'draft' as const,
        publishedAt: null,
        tags: { ...base.head.tags, gradeLevels: [8] },
        license: licenseOf(!publishedAllows),
        reviewedByUserId: null,
      }
      return {
        ...base,
        head: draft,
        versions: [{ ...base.head, reviewedByUserId: 'u-admin' }, draft],
      }
    }
    assert.deepEqual(commands(withDraft(false), TEACHER).copy, {
      blockedReason: 'Lisans uyarlamaya izin vermediği için bu içerik kopyalanamaz.',
    })
    assert.deepEqual(commands(withDraft(true), TEACHER).copy, { blockedReason: null })

    const item = withDraft(false)
    const head = coreVersion(item.head, item.resource.id)
    assert.ok(head)
    const current = versionFromSummary(head, item.versions[0]!)
    assert.equal(current?.id, 'v1')
    assert.deepEqual(current?.tags.gradeLevels, [7], 'etiketler yayın sürümünden')
    assert.equal(current?.reviewedByUserId, 'u-admin')
    assert.equal(current?.license?.kind, 'licensed_publication')
    assert.equal(
      versionFromSummary(head, { ...item.versions[0]!, license: { kind: 'bilinmeyen' } }),
      undefined,
      'çözülemeyen lisansta karar sunucuya kalır',
    )
  })

  test('DOM-KYN-051: kaldırılmış kaynakta hiçbir eylem yok', () => {
    const removed = published({
      status: 'removed',
      content: null,
      removedAt: '2026-10-30T08:50:00.000Z',
    })
    assert.deepEqual(commands(removed, ADMIN), {
      share: false,
      copy: null,
      report: null,
      remove: false,
    })
  })
})
