import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  LINKED_CONTENT_MESSAGES,
  type StaffResourceListItem,
  type StaffResourceVersion,
} from '@kampus/react-shared/resource-model.ts'
import {
  defaultDraft,
  draftFormSchema,
  draftFromHead,
  isItemSetType,
  patchFromDraft,
  previewFromHead,
  skillOptionsFor,
  type DraftFormValues,
} from '../src/pages/content/content-pool-model.ts'
import {
  appendItems,
  ITEMS_MAX,
  itemPointsId,
  linkedFieldMessage,
  linkedHints,
  linkedMeta,
  LINKED_DETAIL_UNKNOWN,
  moveTarget,
  overflowMessage,
  pickerQuery,
  pickerRows,
  PUBLISHED_VERSION_NOTE,
  questionSelection,
  summariesFrom,
} from '../src/pages/content/reading-activity-model.ts'

// Okuma etkinliği formu (OG-984; IST-042, DOM-BEC-006, DOM-KYN-013): quiz/alıştırma setinin form
// değeri, bağlı içerik seçicisinin sorgusu ve satırları, soru listesi işlemleri, hata eşlemesi.

const TAGS: StaffResourceVersion['tags'] = {
  subjectId: 'english',
  gradeLevels: [7],
  cefrLevel: 'A2',
  primarySkill: 'reading',
  skills: ['reading'],
  activityMode: null,
  subskill: null,
  interactionChannel: null,
  mediation: null,
  durationMinutes: null,
  difficulty: null,
  outcomes: [{ outcomeId: 'OKU.7.1', outcomeSource: 'institution' }],
}

function head(overrides: Partial<StaffResourceVersion> = {}): StaffResourceVersion {
  return {
    id: 'v-quiz',
    versionNumber: 1,
    status: 'draft',
    title: 'Feribot etkinliği',
    authorUserId: 'u1',
    tags: TAGS,
    licenseKind: 'institution_original',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    publishedAt: null,
    archivedAt: null,
    removedAt: null,
    content: {
      type: 'quiz',
      items: [
        { questionVersionId: 'q-1', points: 1 },
        { questionVersionId: 'q-2', points: 2 },
      ],
      timeLimitMinutes: 20,
      shuffleItems: true,
      passageVersionId: 'p-1',
      listeningVersionId: null,
    },
    answerKey: null,
    license: { kind: 'institution_original' },
    attributions: [],
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    removalReason: null,
    files: [],
    rowVersion: 2,
    ...overrides,
  } as StaffResourceVersion
}

function listItem(
  id: string,
  overrides: {
    currentVersionId?: string | null
    headId?: string
    title?: string
    tags?: Partial<StaffResourceVersion['tags']>
  } = {},
): StaffResourceListItem {
  return {
    view: 'staff',
    id,
    contentType: 'question',
    ownerUserId: 'u1',
    shareScope: 'private',
    currentVersionId:
      overrides.currentVersionId === undefined ? `${id}-v1` : overrides.currentVersionId,
    derivedFromVersionId: null,
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    version: {
      id: overrides.headId ?? `${id}-v1`,
      versionNumber: 1,
      status: 'published',
      title: overrides.title ?? `Başlık ${id}`,
      authorUserId: 'u1',
      tags: { ...TAGS, ...overrides.tags },
      licenseKind: 'institution_original',
      createdAt: '2026-10-30T08:00:00.000Z',
      updatedAt: '2026-10-30T08:00:00.000Z',
      publishedAt: '2026-10-30T08:00:00.000Z',
      archivedAt: null,
      removedAt: null,
    },
  } as StaffResourceListItem
}

/** Geçerli quiz formu; testler tek alanı bozar. */
function validQuiz(): DraftFormValues {
  const base = defaultDraft('quiz')
  return {
    ...base,
    title: 'Feribot etkinliği',
    content: {
      ...base.content,
      items: [{ questionVersionId: 'q-1', points: 1 }],
      passageVersionId: 'p-1',
    },
    tags: { ...base.tags, subjectId: 'english', gradeLevels: [7] },
    license: { kind: 'institution_original' },
  }
}

describe('Okuma etkinliği form değeri (IST-042, DOM-BEC-006)', () => {
  test('IST-042: quiz ve alıştırma seti boş soru listesi, parçasız ve okuma becerisiyle başlar', () => {
    for (const type of ['quiz', 'exercise_set'] as const) {
      const draft = defaultDraft(type)
      assert.equal(isItemSetType(type), true)
      assert.deepEqual(draft.content, {
        type,
        items: [],
        passageVersionId: null,
        timeLimitMinutes: null,
        shuffleItems: false,
      })
      assert.equal(draft.tags?.primarySkill, 'reading')
    }
    assert.equal(isItemSetType('reading_passage'), false)
  })

  test('DOM-KYN-013: soru listesi boşsa core iletisiyle listenin altında reddedilir; aynı soru iki kez eklenemez', () => {
    const empty = draftFormSchema.safeParse({
      ...validQuiz(),
      content: { ...validQuiz().content, items: [] },
    })
    assert.equal(empty.success, false)
    assert.deepEqual(
      empty.error?.issues.map((issue) => [issue.path.join('.'), issue.message]),
      [['content.items', 'En az bir soru ekleyin.']],
    )
    const twice = draftFormSchema.safeParse({
      ...validQuiz(),
      content: {
        ...validQuiz().content,
        items: [
          { questionVersionId: 'q-1', points: 1 },
          { questionVersionId: 'q-1', points: 2 },
        ],
      },
    })
    assert.equal(twice.error?.issues[0]?.message, 'Aynı soru iki kez eklenemez.')
    assert.equal(draftFormSchema.safeParse(validQuiz()).success, true)
  })

  test('DOM-BEC-006: parça bağı ve puanlar gövdeye gider; parçasız set de geçerlidir', () => {
    const parsed = draftFormSchema.parse(validQuiz())
    const patch = patchFromDraft(parsed)
    assert.deepEqual(patch.content, {
      type: 'quiz',
      items: [{ questionVersionId: 'q-1', points: 1 }],
      passageVersionId: 'p-1',
      // Dinleme kaydı bağı (IST-045) formda yazılmaz; verilmeyince core `null` yapar.
      listeningVersionId: null,
      timeLimitMinutes: null,
      shuffleItems: false,
    })
    assert.equal('fileIds' in patch, false)
    const plain = draftFormSchema.parse({
      ...validQuiz(),
      content: { ...validQuiz().content, passageVersionId: null },
    })
    assert.equal(plain.content.type === 'quiz' && plain.content.passageVersionId, null)
  })

  test('DOM-BEC-006: baş sürüm forma bütün olarak gelir ve gövdede aynen geri gider (parça, sıra, puan, ayar)', () => {
    const values = draftFromHead(head())
    assert.ok(values)
    assert.deepEqual(values.content, head().content)
    const patch = patchFromDraft(draftFormSchema.parse(values))
    assert.deepEqual(patch.content, head().content)
    // Formun yazmadığı dinleme kaydı bağı (IST-045) düzenlemede kaybolmaz.
    const listening = head({
      content: {
        ...(head().content as object),
        passageVersionId: null,
        listeningVersionId: 'a-1',
      } as never,
    })
    const kept = patchFromDraft(draftFormSchema.parse(draftFromHead(listening)))
    assert.equal(kept.content.type === 'quiz' && kept.content.listeningVersionId, 'a-1')
    const exercise = draftFromHead(
      head({ content: { ...(head().content as object), type: 'exercise_set' } as never }),
    )
    assert.equal(exercise?.content.type, 'exercise_set')
  })

  test('DOM-KYN-012: dil kullanımı quiz ve alıştırma setinde birincil beceri olabilir', () => {
    for (const type of ['quiz', 'exercise_set'] as const)
      assert.ok(skillOptionsFor(type).some((option) => option.value === 'language_use'))
  })

  test('IST-042: panel önizlemesi soru sayısını, okuma bağını ve süreyi verir', () => {
    assert.deepEqual(previewFromHead(head()), {
      kind: 'set',
      itemCount: 2,
      reading: true,
      timeLimitMinutes: 20,
    })
  })
})

describe('Bağlı içerik seçicisi (OG-984)', () => {
  test('sorgu tür sabit, başlığa göre, kısa sayfa; kısa arama ve boş süzgeç gönderilmez', () => {
    assert.deepEqual(
      pickerQuery({ kind: 'reading_passage', q: ' a ', cefrLevel: '', gradeLevel: '', page: 1 }),
      { page: 1, pageSize: 10, contentType: 'reading_passage', sort: 'title' },
    )
    assert.deepEqual(
      pickerQuery({ kind: 'question', q: ' ferry ', cefrLevel: 'A2', gradeLevel: '7', page: 3 }),
      {
        page: 3,
        pageSize: 10,
        contentType: 'question',
        sort: 'title',
        q: 'ferry',
        cefrLevel: 'A2',
        gradeLevel: 7,
      },
    )
  })

  test('DOM-BEC-006: satır yayındaki sürümü seçer; yayımlanmamış ve zaten seçili içerik nedeniyle kapalıdır', () => {
    const rows = pickerRows(
      [
        listItem('r1', { tags: { subskill: 'main_idea' } }),
        // Baş sürüm yeni taslak: etkinlik yine yayındaki sürüme bağlanır.
        listItem('r2', { headId: 'r2-v2' }),
        listItem('r3', { currentVersionId: null }),
        listItem('r4'),
      ],
      { versionIds: new Set(['r4-v1']), resourceIds: new Set() },
    )
    assert.deepEqual(
      rows.map((row) => [row.versionId, row.subskill, row.disabledReason]),
      [
        ['r1-v1', 'Ana fikir', null],
        ['r2-v1', null, null],
        ['', null, 'Yayında değil'],
        ['r4-v1', null, 'Zaten seçili'],
      ],
    )
    assert.equal(rows[0]?.meta, 'A2 · 7. sınıf')
    assert.equal(linkedMeta({ ...TAGS, cefrLevel: null, gradeLevels: [] }), '')
  })

  test('kayıtlı bağ özeti hem yayındaki hem baş sürümle eşlenir; listede olmayan sürüm eşlenmez', () => {
    const map = summariesFrom([listItem('r1'), listItem('r2', { headId: 'r2-v2' })])
    assert.equal(map.get('r1-v1')?.title, 'Başlık r1')
    assert.equal(map.get('r2-v1')?.versionId, 'r2-v1')
    assert.equal(map.get('r2-v2')?.versionId, 'r2-v2')
    assert.equal(map.has('eski-surum'), false)
    assert.notEqual(LINKED_DETAIL_UNKNOWN.reading_passage, '')
    assert.doesNotMatch(LINKED_DETAIL_UNKNOWN.reading_passage, /önceki/)
  })

  test('DOM-BEC-006: baş sürüm yeni taslakken yayındaki sürümün künyesi ve alt becerisi baş sürümden alınmaz; not düşülür', () => {
    const draftHead = listItem('r2', {
      headId: 'r2-v2',
      tags: { subskill: 'inference', cefrLevel: 'B1' },
    })
    const [row] = pickerRows([draftHead], { versionIds: new Set(), resourceIds: new Set() })
    assert.equal(row?.versionId, 'r2-v1')
    assert.equal(row?.subskill, null)
    assert.equal(row?.meta, '')
    assert.equal(row?.note, PUBLISHED_VERSION_NOTE)
    const map = summariesFrom([draftHead, listItem('r1', { tags: { subskill: 'main_idea' } })])
    assert.deepEqual(
      [map.get('r2-v1')?.subskill, map.get('r2-v1')?.meta, map.get('r2-v1')?.note],
      [null, '', PUBLISHED_VERSION_NOTE],
    )
    // Baş sürümün kendi özeti kendi etiketiyle; baş sürüm yayındaysa not yok.
    assert.equal(map.get('r2-v2')?.subskill, 'Çıkarım')
    assert.equal(map.get('r2-v2')?.note, null)
    assert.equal(map.get('r1-v1')?.subskill, 'Ana fikir')
    assert.equal(map.get('r1-v1')?.note, null)
  })

  test('DOM-KYN-013: aynı sorunun başka sürümü listedeyse güncel sürümü seçicide kapalıdır; kaynağı bilinmeyen soru seçimi kapatmaz', () => {
    // Soru r1'in eski sürümü (r1-v0) listede, güncel sürümü r1-v1; özet bu oturumda seçimden gelir.
    const known = new Map([
      [
        'r1-v0',
        {
          versionId: 'r1-v0',
          resourceId: 'r1',
          title: 'Başlık r1',
          meta: '',
          subskill: null,
          note: null,
        },
      ],
    ])
    const selection = questionSelection(['r1-v0', 'bilinmeyen'], (id) => known.get(id))
    assert.deepEqual([...selection.resourceIds], ['r1'])
    const rows = pickerRows([listItem('r1'), listItem('r2')], selection)
    assert.deepEqual(
      rows.map((row) => [row.versionId, row.disabledReason]),
      [
        ['r1-v1', 'Zaten seçili'],
        ['r2-v1', null],
      ],
    )
  })
})

describe('Soru listesi işlemleri (DOM-KYN-013)', () => {
  const items = [
    { questionVersionId: 'q-1', points: 1 },
    { questionVersionId: 'q-2', points: 3 },
  ]

  test('seçilenler sona eklenir; listede olan ve yinelenen atlanır, puan 1 başlar', () => {
    const next = appendItems(items, ['q-2', 'q-3', 'q-3', '', 'q-4'])
    assert.deepEqual(
      next.items.map((item) => `${item.questionVersionId}:${item.points}`),
      ['q-1:1', 'q-2:3', 'q-3:1', 'q-4:1'],
    )
    assert.equal(next.added, 2)
    assert.equal(next.overflow, 0)
  })

  test(`sınır (${ITEMS_MAX}) aşılmaz; taşan sayı bildirilir`, () => {
    const full = Array.from({ length: ITEMS_MAX - 1 }, (_, index) => ({
      questionVersionId: `q-${index}`,
      points: 1,
    }))
    const next = appendItems(full, ['x-1', 'x-2', 'x-3'])
    assert.equal(next.items.length, ITEMS_MAX)
    assert.equal(next.added, 1)
    assert.equal(next.overflow, 2)
    assert.equal(
      overflowMessage(next.overflow),
      `2 soru eklenmedi: bir sette en çok ${ITEMS_MAX} soru olabilir.`,
    )
    assert.equal(overflowMessage(0), null)
  })

  test('sıra düğmesi sınırda kapalıdır; puan alanı kimliği sıradan türer', () => {
    assert.equal(moveTarget(0, -1, 3), null)
    assert.equal(moveTarget(0, 1, 3), 1)
    assert.equal(moveTarget(2, 1, 3), null)
    assert.equal(moveTarget(2, -1, 3), 1)
    assert.equal(itemPointsId(2), 'icerik-soru-puan-2')
  })
})

describe('Bağlı içerik hataları (IST-042, DOM-BEC-006)', () => {
  test('DOM-BEC-006: passage_* ve quiz_item_* kodları ortak Türkçe iletiyi alır; diğer kodda sunucu iletisi kalır', () => {
    assert.equal(
      linkedFieldMessage('passage_missing', 'Seçilen okuma parçası bulunamadı.'),
      LINKED_CONTENT_MESSAGES.passage_missing,
    )
    assert.equal(
      linkedFieldMessage('quiz_item_missing', 'x'),
      LINKED_CONTENT_MESSAGES.quiz_item_missing,
    )
    assert.equal(
      linkedFieldMessage('too_small', 'En az bir soru ekleyin.'),
      'En az bir soru ekleyin.',
    )
  })

  test('DOM-BEC-006: yayım sorunları kayıtlı parça ve soru kimliğine bağlanır; bağlı olmayan kod ve yol atlanır', () => {
    const hints = linkedHints(
      [
        {
          code: 'passage_not_published',
          message: 'Okuma parçası yayında olmalıdır.',
          path: ['content', 'passageVersionId'],
        },
        { code: 'quiz_item_not_published', message: 'x', path: ['content', 'items', '1'] },
        { code: 'quiz_item_missing', message: 'x', path: ['content', 'items', '9'] },
        { code: 'license_required', message: 'x', path: ['license'] },
      ],
      { passageVersionId: 'p-1', itemIds: ['q-1', 'q-2'] },
    )
    assert.deepEqual(hints.passage, {
      versionId: 'p-1',
      message: LINKED_CONTENT_MESSAGES.passage_not_published,
    })
    assert.deepEqual([...hints.items], [['q-2', LINKED_CONTENT_MESSAGES.quiz_item_not_published]])
    assert.deepEqual(linkedHints([], { passageVersionId: null, itemIds: [] }), {
      passage: null,
      items: new Map(),
    })
  })
})
