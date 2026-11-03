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
  patchFromDraft,
  previewFromHead,
  type DraftFormValues,
} from '../src/pages/content/content-pool-model.ts'
import {
  LINKED_DETAIL_UNKNOWN,
  LINKED_KINDS,
  linkedFieldMessage,
  linkedHints,
  pickerQuery,
  pickerRows,
  recordingFacts,
  recordingIssue,
  recordingLine,
  summariesFrom,
  TRANSCRIPT_LABEL,
} from '../src/pages/content/reading-activity-model.ts'

// Dinleme etkinliği formu (OG-052; IST-045, DOM-BEC-005): quiz/alıştırma setinin dinleme kaydı bağı,
// kayıt seçicisinin sorgusu, seçilen kaydın künyesi (döküm var/yok) ve `listening_*` hata eşlemesi.

const TAGS: StaffResourceVersion['tags'] = {
  subjectId: 'english',
  gradeLevels: [9],
  cefrLevel: 'A2',
  primarySkill: 'listening',
  skills: ['listening'],
  activityMode: null,
  subskill: null,
  interactionChannel: null,
  mediation: null,
  durationMinutes: null,
  difficulty: null,
  outcomes: [{ outcomeId: 'E9.1.L1', outcomeSource: 'platform' }],
}

function version(overrides: Partial<StaffResourceVersion> = {}): StaffResourceVersion {
  return {
    id: 'a-1',
    versionNumber: 1,
    status: 'published',
    title: "Tom's week",
    authorUserId: 'u1',
    tags: TAGS,
    licenseKind: 'institution_original',
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    publishedAt: '2026-10-30T08:00:00.000Z',
    archivedAt: null,
    removedAt: null,
    content: { type: 'audio', fileId: 'f-1', transcript: 'Tom reads.', captionsVtt: null },
    answerKey: null,
    license: { kind: 'institution_original' },
    attributions: [],
    submittedAt: null,
    reviewedByUserId: null,
    reviewedAt: null,
    rejectionReason: null,
    removalReason: null,
    files: [],
    rowVersion: 1,
    ...overrides,
  } as StaffResourceVersion
}

const quizHead = (content: Record<string, unknown>) =>
  version({
    id: 'v-quiz',
    status: 'draft',
    title: 'Tom dinleme etkinliği',
    tags: { ...TAGS, primarySkill: 'listening' },
    content: {
      type: 'quiz',
      items: [{ questionVersionId: 'q-1', points: 1 }],
      timeLimitMinutes: null,
      shuffleItems: false,
      passageVersionId: null,
      listeningVersionId: null,
      ...content,
    },
  })

function audioItem(id: string, currentVersionId: string | null = `${id}-v1`) {
  return {
    view: 'staff',
    id,
    contentType: 'audio',
    ownerUserId: 'u1',
    shareScope: 'private',
    currentVersionId,
    derivedFromVersionId: null,
    createdAt: '2026-10-30T08:00:00.000Z',
    updatedAt: '2026-10-30T08:00:00.000Z',
    version: {
      id: currentVersionId ?? `${id}-v1`,
      versionNumber: 1,
      status: currentVersionId ? 'published' : 'draft',
      title: `Kayıt ${id}`,
      authorUserId: 'u1',
      tags: TAGS,
      licenseKind: 'institution_original',
      createdAt: '2026-10-30T08:00:00.000Z',
      updatedAt: '2026-10-30T08:00:00.000Z',
      publishedAt: currentVersionId ? '2026-10-30T08:00:00.000Z' : null,
      archivedAt: null,
      removedAt: null,
    },
  } as StaffResourceListItem
}

function listeningQuiz(listeningVersionId: string | null, passageVersionId: string | null) {
  const base = defaultDraft('quiz')
  return {
    ...base,
    title: 'Tom dinleme etkinliği',
    content: {
      ...base.content,
      items: [{ questionVersionId: 'q-1', points: 1 }],
      listeningVersionId,
      passageVersionId,
    },
    tags: { ...base.tags, subjectId: 'english', gradeLevels: [9], primarySkill: 'listening' },
    license: { kind: 'institution_original' },
  } satisfies DraftFormValues
}

describe('Dinleme etkinliği form değeri (IST-045, DOM-BEC-005)', () => {
  test('IST-045: quiz ve alıştırma seti kayıtsız başlar; seçilen kayıt gövdeye sürüm kimliğiyle gider', () => {
    for (const type of ['quiz', 'exercise_set'] as const) {
      const draft = defaultDraft(type)
      assert.equal(draft.content.listeningVersionId, null)
    }
    const patch = patchFromDraft(draftFormSchema.parse(listeningQuiz('a-1', null)))
    assert.equal(patch.content.type === 'quiz' && patch.content.listeningVersionId, 'a-1')
  })

  test('IST-045: core parça ve kaydı dışlamaz; ikisi birlikte bağlanır', () => {
    const patch = patchFromDraft(draftFormSchema.parse(listeningQuiz('a-1', 'p-1')))
    assert.ok(patch.content.type === 'quiz')
    assert.equal(patch.content.listeningVersionId, 'a-1')
    assert.equal(patch.content.passageVersionId, 'p-1')
  })

  test('IST-045: düzenlemede kayıt bağı forma gelir ve gövdede aynen geri gider; kaldırılınca null olur', () => {
    const head = quizHead({ listeningVersionId: 'a-1', passageVersionId: 'p-1' })
    const values = draftFromHead(head)
    assert.ok(values)
    assert.equal(values.content.listeningVersionId, 'a-1')
    assert.deepEqual(patchFromDraft(draftFormSchema.parse(values)).content, head.content)
    const cleared = patchFromDraft(
      draftFormSchema.parse({
        ...values,
        content: { ...values.content, listeningVersionId: null },
      }),
    )
    assert.equal(cleared.content.type === 'quiz' && cleared.content.listeningVersionId, null)
  })

  test('IST-045: panel önizlemesi dinleme bağını verir', () => {
    const preview = previewFromHead(quizHead({ listeningVersionId: 'a-1' }))
    assert.deepEqual(preview, {
      kind: 'set',
      itemCount: 1,
      reading: false,
      listening: true,
      timeLimitMinutes: null,
    })
  })
})

describe('Dinleme kaydı seçicisi (OG-052, DOM-BEC-005)', () => {
  test('DOM-BEC-005: sorgu ses türünde ve dinleme becerisiyle süzülür; diğer türlerde beceri süzgeci yok', () => {
    assert.equal(LINKED_KINDS.audio.title, 'Dinleme kaydı seç')
    assert.deepEqual(
      pickerQuery({ kind: 'audio', q: ' tom ', cefrLevel: 'A2', gradeLevel: '', page: 2 }),
      {
        page: 2,
        pageSize: 10,
        contentType: 'audio',
        sort: 'title',
        primarySkill: 'listening',
        q: 'tom',
        cefrLevel: 'A2',
      },
    )
    const passage = pickerQuery({
      kind: 'reading_passage',
      q: '',
      cefrLevel: '',
      gradeLevel: '',
      page: 1,
    })
    assert.equal('primarySkill' in passage, false)
  })

  test('DOM-BEC-005: yayımlanmamış kayıt seçilemez; seçili kayıt "Zaten seçili"; satır yayındaki sürümü seçer', () => {
    const rows = pickerRows([audioItem('r1'), audioItem('r2', null), audioItem('r3')], {
      versionIds: new Set(['r3-v1']),
      resourceIds: new Set(),
    })
    assert.deepEqual(
      rows.map((row) => [row.versionId, row.disabledReason]),
      [
        ['r1-v1', null],
        ['', 'Yayında değil'],
        ['r3-v1', 'Zaten seçili'],
      ],
    )
    // Kayıtlı bağın kaynağı listeden çözülür (sürüm künyesi bunun üzerinden okunur).
    assert.equal(summariesFrom([audioItem('r1')]).get('r1-v1')?.resourceId, 'r1')
    assert.equal(LINKED_DETAIL_UNKNOWN.audio, 'Bağlı dinleme kaydının ayrıntısı yüklenemedi.')
  })
})

describe('Seçili dinleme kaydının künyesi ve hataları (DOM-BEC-005)', () => {
  test('DOM-BEC-005: künye bağlanan sürümden okunur: başlık, CEFR ve döküm var', () => {
    const facts = recordingFacts(version())
    assert.deepEqual(facts, {
      title: "Tom's week",
      meta: 'A2 · 9. sınıf',
      hasTranscript: true,
      audio: true,
      listeningSkill: true,
      published: true,
    })
    assert.equal(recordingLine(facts), `A2 · 9. sınıf · ${TRANSCRIPT_LABEL.yes}`)
    assert.equal(recordingIssue(facts), null)
  })

  test('DOM-BEC-005: dökümsüz (yalnız altyazılı) kayıt seçilince sunucuyla aynı Türkçe alan hatası', () => {
    const facts = recordingFacts(
      version({
        content: {
          type: 'audio',
          fileId: 'f-1',
          transcript: null,
          captionsVtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nTom reads.',
        },
      }),
    )
    assert.equal(facts.hasTranscript, false)
    assert.equal(recordingLine(facts), `A2 · 9. sınıf · ${TRANSCRIPT_LABEL.no}`)
    assert.equal(recordingIssue(facts), LINKED_CONTENT_MESSAGES.listening_transcript_required)
    assert.equal(recordingIssue(null), null)
  })

  test('DOM-BEC-005: kaldırılan ya da ses olmayan sürümde döküm bilinmez; künye boşsa "Etiket yok"; hata core sırasıyla', () => {
    const removed = recordingFacts(
      version({
        status: 'removed',
        content: null,
        tags: { ...TAGS, cefrLevel: null, gradeLevels: [] },
      }),
    )
    assert.equal(removed.hasTranscript, null)
    assert.equal(removed.audio, null)
    assert.equal(recordingLine(removed), 'Etiket yok')
    assert.equal(recordingIssue(removed), LINKED_CONTENT_MESSAGES.listening_not_published)
    const passage = recordingFacts(version({ content: { type: 'reading_passage', body: 'x' } }))
    assert.equal(passage.hasTranscript, null)
    assert.equal(recordingIssue(passage), LINKED_CONTENT_MESSAGES.listening_not_audio)
  })

  test('IST-045, DOM-BEC-005: seçici baş sürümü süzer; bağlanan (yayındaki) sürüm dinleme becerili değilse ya da yayında değilse anlık Türkçe hata', () => {
    // Yayındaki v1 okuma becerili, baş sürüm v2 dinleme becerili taslak: seçicide görünür, bağ v1'e
    // kurulur; v1 okunduğunda hata alanın altına yazılır.
    const readingV1 = recordingFacts(version({ tags: { ...TAGS, primarySkill: 'reading' } }))
    assert.equal(readingV1.listeningSkill, false)
    assert.equal(recordingIssue(readingV1), LINKED_CONTENT_MESSAGES.listening_skill_required)
    // Beceri hatası döküm hatasından önce gelir (core `listeningIssue` sırası).
    const both = recordingFacts(
      version({
        tags: { ...TAGS, primarySkill: null },
        content: { type: 'audio', fileId: 'f-1', transcript: null, captionsVtt: 'WEBVTT' },
      }),
    )
    assert.equal(recordingIssue(both), LINKED_CONTENT_MESSAGES.listening_skill_required)
    for (const status of ['archived', 'draft', 'in_review'] as const) {
      const facts = recordingFacts(version({ status }))
      assert.equal(facts.published, false)
      assert.equal(recordingIssue(facts), LINKED_CONTENT_MESSAGES.listening_not_published, status)
    }
    // Yayında değil hatası döküm hatasından önce gelir.
    const archivedNoTranscript = recordingFacts(
      version({
        status: 'archived',
        content: { type: 'audio', fileId: 'f-1', transcript: null, captionsVtt: 'WEBVTT' },
      }),
    )
    assert.equal(
      recordingIssue(archivedNoTranscript),
      LINKED_CONTENT_MESSAGES.listening_not_published,
    )
  })

  test('DOM-BEC-005: listening_* kodları ortak Türkçe iletiyi alır', () => {
    for (const code of [
      'listening_missing',
      'listening_not_audio',
      'listening_skill_required',
      'listening_not_published',
      'listening_transcript_required',
    ] as const)
      assert.equal(linkedFieldMessage(code, 'sunucu'), LINKED_CONTENT_MESSAGES[code])
  })

  test('DOM-BEC-005: kayıtlı sürümün yayım sorunu kayıtlı kayda bağlanır; kayıt yoksa atlanır', () => {
    const issues = [
      {
        code: 'listening_not_published',
        message: 'Dinleme kaydı yayında olmalıdır.',
        path: ['content', 'listeningVersionId'],
      },
      {
        code: 'listening_transcript_required',
        message: 'x',
        path: ['content', 'listeningVersionId'],
      },
    ]
    const hints = linkedHints(issues, {
      passageVersionId: null,
      listeningVersionId: 'a-1',
      itemIds: [],
    })
    // İlk sorun alınır.
    assert.deepEqual(hints.listening, {
      versionId: 'a-1',
      message: LINKED_CONTENT_MESSAGES.listening_not_published,
    })
    assert.equal(hints.passage, null)
    assert.equal(
      linkedHints(issues, { passageVersionId: null, listeningVersionId: null, itemIds: [] })
        .listening,
      null,
    )
  })
})
