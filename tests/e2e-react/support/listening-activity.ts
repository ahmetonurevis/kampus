import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './api.ts'
import { expect } from './fixtures.ts'
import type { Tenant, TenantOptions } from './tenant.ts'

/**
 * Dinleme etkinliğinin e2e kurulumu (OG-052; IST-045, DOM-BEC-005): öğretmen dinleme sesini
 * (`listening_audio`) API'den yükler, dosya işlenip `ready` olana kadar bekler (ses dönüşümü
 * `ffmpeg` ister; OG-987), dökümlü ve altyazılı ses kaydını, dinleme sorusunu ve kayda bağlı quiz'i
 * yayımlar (kurum özgün, kendi kapsamlı içerik onaya girmez; DOM-KYN-031) ve 7-A'ya atar.
 * UI'dan kurulum yok.
 */

export type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

export const hasFfmpeg = (() => {
  try {
    for (const tool of ['ffmpeg', 'ffprobe'])
      execFileSync(tool, ['-version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
})()

export const RECORDING_TITLE = "Tom's week"
export const TRANSCRIPT = 'Tom swims on Mondays. On Sundays he reads a book in the park.'
const CAPTIONS = 'WEBVTT\n\n00:00.000 --> 00:02.000\nTom swims on Mondays.\n'
export const QUIZ_TITLE = 'Tom dinleme sınavı'
export const QUESTION = {
  stem: 'What does Tom do on Sundays?',
  options: ['He swims.', 'He reads.', 'He cooks.', 'He sleeps.'],
} as const

/** Seed'de 7-A'nın İngilizcesini başka öğretmen verir; t1 de versin ki atayabilsin. */
export const TEACHES_ENGLISH = [
  {
    collection: 'assignments' as const,
    data: { id: 'assign-c1-english-t1', classId: 'c1', subjectId: 'english', teacherId: 't1' },
  },
]

const TAGS = {
  subjectId: 'english',
  gradeLevels: [7],
  primarySkill: 'listening',
  cefrLevel: 'A2',
  outcomes: [{ outcomeId: 'DIN.7.1', outcomeSource: 'institution' }],
}
const LICENSE = { kind: 'institution_original' }

const idempotent = () => ({ 'idempotency-key': randomUUID() })
const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

export async function expectOk(result: { status: number; body: unknown }, status = 201) {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Json }).data
}

/** 48 kHz, 16 bit, tek kanallı `seconds` saniyelik 440 Hz sinüs (WAV); sessizlik reddine takılmaz. */
function sineWav(seconds: number): Buffer {
  const rate = 48_000
  const samples = rate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** Sesi yükler ve dönüşüm bitip dosya `ready` olana kadar bekler; dosya kimliği döner. */
async function uploadListeningAudio(teacher: ApiClient): Promise<string> {
  const response = await teacher.context.fetch('/api/v1/files', {
    method: 'POST',
    multipart: {
      purpose: 'listening_audio',
      file: { name: 'tom.wav', mimeType: 'audio/wav', buffer: sineWav(3) },
    },
    headers: idempotent(),
    failOnStatusCode: false,
  })
  const body = (await response.json()) as { data: { id: string } }
  expect(response.status(), JSON.stringify(body)).toBe(201)
  const fileId = body.data.id
  await expect
    .poll(
      async () =>
        ((await teacher.get(`/api/v1/files/${fileId}`)).body as { data?: { status?: string } }).data
          ?.status,
      { timeout: 30_000 },
    )
    .toBe('ready')
  return fileId
}

async function publish(author: ApiClient, body: Json): Promise<string> {
  const created = await expectOk(await author.post('/api/v1/resources', body, idempotent()))
  const draft = created.version as Json
  const published = await expectOk(
    await author.post(
      `/api/v1/resources/${created.resource.id}/versions/${draft.id}/publish`,
      {},
      versioned(draft.rowVersion),
    ),
    200,
  )
  return (published.version as Json).id as string
}

/** Dökümlü, altyazılı ses kaydı; ses sürümü döner. */
export async function publishRecording(teacher: ApiClient): Promise<string> {
  const fileId = await uploadListeningAudio(teacher)
  return publish(teacher, {
    title: RECORDING_TITLE,
    content: { type: 'audio', fileId, transcript: TRANSCRIPT, captionsVtt: CAPTIONS },
    fileIds: [fileId],
    license: LICENSE,
    attributions: [
      { work: RECORDING_TITLE, author: 'Kampüs yazarları', source: 'Kurum ses arşivi', year: 2026 },
    ],
    tags: TAGS,
  })
}

/** Dinleme sorusu (çoktan seçmeli); soru sürümü döner. */
export async function publishQuestion(teacher: ApiClient): Promise<string> {
  return publish(teacher, {
    title: `Soru: ${QUESTION.stem}`,
    content: {
      type: 'question',
      question: {
        questionType: 'multiple_choice',
        stem: QUESTION.stem,
        options: QUESTION.options.map((text, index) => ({ id: 'abcd'[index], text })),
      },
    },
    answerKey: {
      questionType: 'multiple_choice',
      correctOptionId: 'b',
      explanation: 'Pazar günleri okur.',
    },
    license: LICENSE,
    tags: TAGS,
  })
}

/** Tek sorulu quiz; `listeningVersionId` verilirse kayda bağlıdır. Quiz sürümü döner. */
export async function publishQuiz(
  teacher: ApiClient,
  title: string,
  questionVersionId: string,
  listeningVersionId: string | null,
): Promise<string> {
  return publish(teacher, {
    title,
    content: {
      type: 'quiz',
      items: [{ questionVersionId, points: 1 }],
      ...(listeningVersionId === null ? {} : { listeningVersionId }),
    },
    license: LICENSE,
    tags: TAGS,
  })
}

/** Dökümlü, altyazılı ses kaydı, dinleme sorusu ve kayda bağlı quiz; quiz sürümü döner. */
export async function publishListeningQuiz(teacher: ApiClient): Promise<string> {
  const listeningVersionId = await publishRecording(teacher)
  const questionVersionId = await publishQuestion(teacher)
  return publishQuiz(teacher, QUIZ_TITLE, questionVersionId, listeningVersionId)
}

/** 7-A'ya tek denemelik değerlendirme; `listeningPlays` dinleme hakkıdır. Atama kimliği döner. */
export async function assignListening(
  teacher: ApiClient,
  resourceVersionId: string,
  listeningPlays: 1 | 2 | null,
): Promise<string> {
  const assignment = await expectOk(
    await teacher.post(
      '/api/v1/task-assignments',
      {
        resourceVersionId,
        targets: [{ kind: 'class', id: 'c1' }],
        settings: {
          attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
          deadline: { dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString() },
          listeningPlays,
        },
      },
      idempotent(),
    ),
  )
  return assignment.id as string
}

export async function setUp(
  tenantFactory: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal) => Promise<ApiClient>,
  options: { listeningPlays?: 1 | 2 | null; roles?: TenantOptions['roles'] } = {},
) {
  const school = await tenantFactory({
    classes: ['c1'],
    roles: ['ogretmen', 'ogrenci', ...(options.roles ?? [])],
    records: TEACHES_ENGLISH,
  })
  const teacher = await api(school.user('ogretmen'))
  const quiz = await publishListeningQuiz(teacher)
  const assignmentId = await assignListening(teacher, quiz, options.listeningPlays ?? 1)
  return { school, teacher, quiz, assignmentId, student: await api(school.user('ogrenci')) }
}

/** Dinleme bölümü (başlığıyla adlanan bölge). */
export const recordingOf = (page: Page) =>
  page.getByRole('region', { name: RECORDING_TITLE, exact: true })

/** Kaydın imzalı bağlantı yanıtı (yalnız dinleme dosyası). */
export const fileUrlResponse = (page: Page) =>
  page.waitForResponse(
    (response) =>
      /\/api\/v1\/files\/[^/]+\/url/.test(response.url()) && response.request().method() === 'GET',
  )
