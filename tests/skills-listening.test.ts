import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  listeningView,
  planResourceRemoval,
  planVersionTransition,
  publicationIssues,
  resourceContentSchema,
  resourceVersionInputSchema,
  type ItemVersionRef,
  type ListeningVersionRef,
  type ResourceVersionInput,
} from '../packages/school-core/src/content/resource.ts'
import {
  assignmentSettingsSchema,
  isListeningTask,
  recordingVersionId,
  resolveAssignmentSettings,
  transcriptShown,
} from '../packages/school-core/src/skills/assignment.ts'
import { admin, build, languagePassage, now } from './support/content-fixtures.ts'
import { isDomainError } from './support/domain-error.ts'

/**
 * Dinleme etkinliği (IST-045; DOM-BEC-005): quiz/alıştırma seti yayındaki, birincil becerisi
 * dinleme olan ve dökümü bulunan bir ses sürümüne bağlanır; döküm kursiyere görev kapanmadan
 * gösterilmez, dinleme hakkı yalnız dinleme görevinde sabitlenir.
 */

const parse = (input: ResourceVersionInput) => resourceVersionInputSchema.parse(input)

const listeningQuiz = (
  listeningVersionId: string | null,
  type: 'quiz' | 'exercise_set' = 'quiz',
): ResourceVersionInput => ({
  title: 'At the station',
  content: { type, items: [{ questionVersionId: 'test-q1-v1' }], listeningVersionId },
  tags: { cefrLevel: 'B1', primarySkill: 'listening' },
  license: { kind: 'institution_original' },
})

const audioInput = (overrides: Partial<ResourceVersionInput> = {}): ResourceVersionInput => ({
  title: 'Station announcement',
  content: {
    type: 'audio',
    fileId: 'test-file-1',
    transcript: 'The train to Ankara leaves at nine.',
  },
  tags: { cefrLevel: 'B1', primarySkill: 'listening' },
  license: { kind: 'institution_original' },
  ...overrides,
})

const questionRef: ItemVersionRef = {
  id: 'test-q1-v1',
  status: 'published',
  contentType: 'question',
  tags: parse(languagePassage()).tags,
}

const recordingRef = (overrides: Partial<ListeningVersionRef> = {}): ListeningVersionRef => ({
  id: 'test-a1-v1',
  status: 'published',
  contentType: 'audio',
  tags: parse(audioInput()).tags,
  hasTranscript: true,
  ...overrides,
})

const issues = (input: ResourceVersionInput, listeningVersion?: ListeningVersionRef) =>
  publicationIssues({
    institutionType: 'language_school',
    version: parse(input),
    now,
    itemVersions: new Map([[questionRef.id, questionRef]]),
    listeningVersion,
  })

describe('IST-045 dinleme etkinliği: içerik', () => {
  test('DOM-BEC-005: quiz ve alıştırma seti dinleme kaydına bağlanabilir; bağ yoksa null, eski kayıt bağsız okunur', () => {
    const quiz = parse(listeningQuiz('test-a1-v1'))
    assert.ok(quiz.content.type === 'quiz')
    assert.equal(quiz.content.listeningVersionId, 'test-a1-v1')
    assert.equal(quiz.content.passageVersionId, null)
    const set = parse(listeningQuiz('test-a1-v1', 'exercise_set'))
    assert.equal(recordingVersionId(set.content), 'test-a1-v1')
    const bare = resourceContentSchema.parse({
      type: 'quiz',
      items: [{ questionVersionId: 'test-q1-v1' }],
    })
    assert.ok(bare.type === 'quiz')
    assert.equal(bare.listeningVersionId, null)
    assert.equal(recordingVersionId(bare), null)
    assert.equal(recordingVersionId(parse(audioInput()).content), null, 'ses kendisi bağ değildir')
    assert.equal(recordingVersionId(null), null, 'kaldırılmış içerik bağ taşımaz')
  })

  test('DOM-BEC-005: bağlı kayıt bulunmalı, ses olmalı, birincil becerisi dinleme olmalı, yayında olmalı ve dökümü bulunmalı', () => {
    const codes = (ref?: ListeningVersionRef) =>
      issues(listeningQuiz('test-a1-v1'), ref).map((issue) => issue.code)
    assert.deepEqual(codes(recordingRef()), [])
    assert.deepEqual(
      issues(listeningQuiz(null)).map((issue) => issue.code),
      [],
      'bağsız quiz kayıt istemez',
    )
    assert.deepEqual(codes(), ['listening_missing'])
    assert.deepEqual(codes(recordingRef({ id: 'test-other-v1' })), ['listening_missing'])
    assert.deepEqual(codes(recordingRef({ contentType: 'video' })), ['listening_not_audio'])
    assert.deepEqual(
      codes(recordingRef({ tags: { ...recordingRef().tags, primarySkill: 'reading' } })),
      ['listening_skill_required'],
    )
    assert.deepEqual(codes(recordingRef({ status: 'draft' })), ['listening_not_published'])
    assert.deepEqual(codes(recordingRef({ hasTranscript: false })), [
      'listening_transcript_required',
    ])
    const [issue] = issues(listeningQuiz('test-a1-v1'), recordingRef({ hasTranscript: false }))
    assert.deepEqual(issue?.path, ['content', 'listeningVersionId'])
  })

  test('DOM-BEC-005: dökümsüz kayda bağlı etkinlik onaya gönderilemez; geçiş hata verir ve hiçbir şey döndürmez', () => {
    const quiz = build(listeningQuiz('test-a1-v1'), { id: 'test-lq1' })
    const transition = (listeningVersion: ListeningVersionRef) =>
      planVersionTransition({
        action: 'submit',
        actor: { role: 'ogretmen', userId: 'test-u-author', subjectIds: ['english'] },
        institutionType: 'language_school',
        resource: quiz.resource,
        version: quiz.version,
        now,
        itemVersions: new Map([[questionRef.id, questionRef]]),
        listeningVersion,
      })
    const before = structuredClone(quiz)
    assert.throws(
      () => transition(recordingRef({ hasTranscript: false })),
      isDomainError('listening_transcript_required'),
    )
    assert.deepEqual(quiz, before, 'başarısız geçiş kaydı değiştirmez')
    assert.equal(transition(recordingRef()).status, 'in_review')
  })

  test('DOM-KYN-051: kaldırılan dinleme kaydına bağlı quiz etkilenen içerik olarak bildirilir', () => {
    const audio = build(audioInput(), { id: 'test-a1', version: { status: 'published' } })
    const plan = planResourceRemoval({
      actor: admin,
      resource: audio.resource,
      versions: [audio.version],
      containers: [
        { id: 'test-lq-v1', content: parse(listeningQuiz(audio.version.id)).content },
        { id: 'test-lq2-v1', content: parse(listeningQuiz(null)).content },
      ],
      reason: 'Telif bildirimi doğrulandı.',
      now,
    })
    assert.deepEqual(plan.affectedContainerVersionIds, ['test-lq-v1'])
    assert.deepEqual(plan.fileIds, ['test-file-1'], 'kaydın dosyası ses sürümündedir')
  })

  test('DOM-BEC-005, DOM-KYN-003: kayıt görünümü dosya, seviye ve kaynak gösterimini verir; döküm ve altyazı yalnız açıkken gelir', () => {
    const audio = build(
      audioInput({
        content: {
          type: 'audio',
          fileId: 'test-file-1',
          transcript: 'The train leaves at nine.',
          captionsVtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\nThe train leaves at nine.',
        },
        attributions: [{ work: 'Station Sounds', author: 'A. Voice', source: 'Kurum' }],
      }),
      { id: 'test-a1' },
    )
    const hidden = listeningView(audio.version, { showTranscript: false })
    assert.deepEqual(hidden, {
      versionId: 'test-a1-v1',
      title: 'Station announcement',
      fileId: 'test-file-1',
      cefrLevel: 'B1',
      transcript: null,
      captionsVtt: null,
      transcriptShown: false,
      attributions: [{ work: 'Station Sounds', author: 'A. Voice', source: 'Kurum', year: null }],
    })
    const shown = listeningView(audio.version, { showTranscript: true })
    assert.equal(shown?.transcript, 'The train leaves at nine.')
    assert.match(shown?.captionsVtt ?? '', /^WEBVTT/)
    assert.equal(shown?.transcriptShown, true)
    const passage = build(languagePassage())
    assert.equal(listeningView(passage.version, { showTranscript: true }), null)
  })
})

describe('IST-045 dinleme etkinliği: atama', () => {
  const due = '2026-10-20T20:59:00.000Z'
  const settings = (input: Record<string, unknown> = {}) =>
    assignmentSettingsSchema.parse({ deadline: { dueAt: due }, ...input })
  const assigned = (input: ResourceVersionInput) => {
    const version = parse(input)
    return {
      resource: { id: 'test-lq', contentType: 'quiz' as const, currentVersionId: 'test-lq-v1' },
      version: {
        id: 'test-lq-v1',
        resourceId: 'test-lq',
        status: 'published' as const,
        tags: version.tags,
        content: version.content,
      },
    }
  }
  const resolve = (input: ResourceVersionInput, s = settings()) =>
    resolveAssignmentSettings({ ...assigned(input), settings: s, rubricVersion: null, now })

  test('DOM-BEC-005: dinleme kaydına bağlı quiz dinleme görevidir; birincil becerisi başka olsa da hak sabitlenir, varsayılan 2', () => {
    const recorded = listeningQuiz('test-a1-v1')
    const readingTagged: ResourceVersionInput = {
      ...recorded,
      tags: { cefrLevel: 'B1', primarySkill: 'language_use' },
    }
    assert.equal(isListeningTask(parse(readingTagged)), true)
    assert.equal(resolve(readingTagged).listeningPlays, 2)
    assert.equal(resolve(readingTagged, settings({ listeningPlays: 1 })).listeningPlays, 1)
    assert.equal(resolve(readingTagged, settings({ listeningPlays: null })).listeningPlays, null)
    const plain: ResourceVersionInput = {
      ...listeningQuiz(null),
      tags: { cefrLevel: 'B1', primarySkill: 'language_use' },
    }
    assert.equal(isListeningTask(parse(plain)), false)
    assert.equal(resolve(plain, settings({ listeningPlays: 1 })).listeningPlays, null)
    assert.equal(isListeningTask(parse(listeningQuiz(null))), true, 'dinleme etiketi yeter')
  })

  test('DOM-BEC-005: kursiyer dökümü görev kapanınca ya da alıştırmada açık ayarla görür; değerlendirmede ayar açılamaz', () => {
    const deadline = { dueAt: due, lateAcceptanceDays: 0 }
    const before = '2026-10-20T20:58:00.000Z'
    const after = '2026-10-20T21:00:00.000Z'
    assert.equal(transcriptShown({ showTranscript: false, deadline }, before), false)
    assert.equal(transcriptShown({ showTranscript: false, deadline }, after), true)
    assert.equal(transcriptShown({ showTranscript: true, deadline }, before), true)
    // Geç kabul süresi bitmeden görev kapanmış sayılmaz.
    const late = { dueAt: due, lateAcceptanceDays: 2 }
    assert.equal(transcriptShown({ showTranscript: false, deadline: late }, after), false)
    // Son tarihsiz alıştırma kapanmaz; döküm yalnız ayarla açılır.
    const open = { dueAt: null, lateAcceptanceDays: 0 }
    assert.equal(transcriptShown({ showTranscript: false, deadline: open }, after), false)
    assert.throws(() => settings({ showTranscript: true }), { name: 'ZodError' })
    assert.equal(
      settings({ attempts: { kind: 'practice' }, showTranscript: true }).showTranscript,
      true,
    )
  })
})
