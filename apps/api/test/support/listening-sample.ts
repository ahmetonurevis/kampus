import { randomUUID } from 'node:crypto'

import type { ResourceVersionInput } from '@kampus/school-core/content/resource.ts'

import type { Database } from '../../src/db/client.ts'
import type { StoredFile } from '../../src/db/files.ts'
import { files } from '../../src/db/schema/files.ts'
import { resourceVersionFiles } from '../../src/db/schema/resources.ts'
import { RESOURCE_VERSION_ATTACHMENT } from '../../src/services/listening-plays.ts'
import { FIXED_NOW } from './app.ts'
import { seedResource } from './resources-sample.ts'

/**
 * Dinleme etkinliği test kayıtları (OG-052; IST-045, DOM-BEC-005): yayındaki ses sürümü, sesin
 * `listening_audio` dosyası (ilk bağı ve `resource_version_files` bağı ses sürümünde), yayındaki
 * dinleme sorusu ve kaydı `listeningVersionId` ile bağlayan yayındaki quiz. Ses ve soru sahibinde
 * özel kalır: kursiyer kaydı yalnız quiz'in atamasıyla açar.
 */

export const LISTENING_TRANSCRIPT = 'GIZLI-DOKUM: Tom reads on Sundays.'

/** Okul kurumunda yayımlanabilir dinleme etiketleri (İngilizce, tek düzey, kazanımlı). */
export const LISTENING_TAGS = {
  subjectId: 'english',
  gradeLevels: [9],
  primarySkill: 'listening' as const,
  cefrLevel: 'A2' as const,
  outcomes: [{ outcomeId: 'E9.1.L1', outcomeSource: 'platform' as const }],
}

export const listeningAudio = (
  fileId: string,
  transcript: string | null = LISTENING_TRANSCRIPT,
): Partial<ResourceVersionInput> => ({
  title: "Tom's week",
  content: {
    type: 'audio',
    fileId,
    transcript,
    captionsVtt: transcript === null ? 'WEBVTT\n\n00:00.000 --> 00:02.000\nTom reads.' : null,
  },
  license: { kind: 'institution_original' },
  tags: LISTENING_TAGS,
})

export const listeningQuestion = (): Partial<ResourceVersionInput> => ({
  title: 'Dinleme sorusu',
  content: {
    type: 'question',
    question: {
      questionType: 'multiple_choice',
      stem: 'What does Tom do on Sundays?',
      options: [
        { id: 'a', text: 'He swims.' },
        { id: 'b', text: 'He reads.' },
        { id: 'c', text: 'He cooks.' },
        { id: 'd', text: 'He sleeps.' },
      ],
    },
  },
  answerKey: {
    questionType: 'multiple_choice',
    correctOptionId: 'b',
    explanation: 'Pazar günleri okur.',
  },
  license: { kind: 'institution_original' },
  tags: LISTENING_TAGS,
})

export const listeningQuiz = (
  questionVersionId: string,
  listeningVersionId: string | null,
): Partial<ResourceVersionInput> => ({
  title: 'Dinleme etkinliği',
  content: { type: 'quiz', items: [{ questionVersionId, points: 1 }], listeningVersionId },
  license: { kind: 'institution_original' },
  tags: LISTENING_TAGS,
})

/** Dosya satırı ve ses sürümüne bağı (yükleme ve bağlama uçları dosya testlerindedir). */
export async function seedListeningFile(
  db: Database,
  institutionId: string,
  input: {
    uploadedByUserId: string
    versionId: string
    fileId?: string
    purpose?: StoredFile['purpose']
  },
): Promise<string> {
  const fileId = input.fileId ?? randomUUID()
  const purpose = input.purpose ?? 'listening_audio'
  await db.insert(files).values({
    institutionId,
    id: fileId,
    purpose,
    status: 'ready',
    storageKey: `${institutionId}/${purpose}/2026/10/${fileId}`,
    contentType: 'audio/mpeg',
    byteSize: 2048,
    sha256: 'b'.repeat(64),
    uploadedByUserId: input.uploadedByUserId,
    attachedType: RESOURCE_VERSION_ATTACHMENT,
    attachedId: input.versionId,
    attachedAt: FIXED_NOW,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  })
  await linkVersionFile(db, institutionId, input.versionId, fileId)
  return fileId
}

/** Sesin sonraki sürümünün dosyayı taşıyan bağı (DOM-KYN-006). */
export async function linkVersionFile(
  db: Database,
  institutionId: string,
  versionId: string,
  fileId: string,
) {
  await db.insert(resourceVersionFiles).values({
    institutionId,
    versionId,
    fileId,
    position: 0,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  })
}

/** Ses, dosyası, soru ve kayda bağlı quiz; dosya kimliği sesin içeriğindeki kimliktir. */
export async function seedListeningActivity(
  db: Database,
  institutionId: string,
  input: {
    ownerUserId: string
    transcript?: string | null
    purpose?: StoredFile['purpose']
  },
) {
  const fileId = randomUUID()
  const audio = await seedResource(db, institutionId, {
    ownerUserId: input.ownerUserId,
    versions: [
      {
        status: 'published',
        input: listeningAudio(
          fileId,
          input.transcript === undefined ? LISTENING_TRANSCRIPT : input.transcript,
        ),
      },
    ],
  })
  const audioVersionId = audio.versions[0]!.id
  await seedListeningFile(db, institutionId, {
    uploadedByUserId: input.ownerUserId,
    versionId: audioVersionId,
    fileId,
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
  })
  const question = await seedResource(db, institutionId, {
    ownerUserId: input.ownerUserId,
    versions: [{ status: 'published', input: listeningQuestion() }],
  })
  const questionVersionId = question.versions[0]!.id
  const quiz = await seedResource(db, institutionId, {
    ownerUserId: input.ownerUserId,
    versions: [{ status: 'published', input: listeningQuiz(questionVersionId, audioVersionId) }],
  })
  return {
    fileId,
    audio: { resourceId: audio.resource.id, versionId: audioVersionId },
    questionVersionId,
    quiz: { resourceId: quiz.resource.id, versionId: quiz.versions[0]!.id },
  }
}
