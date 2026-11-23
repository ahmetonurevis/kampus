import { randomUUID } from 'node:crypto'

import {
  rubricVersionInputSchema,
  type RubricVersionData,
} from '@kampus/school-core/skills/rubric.ts'

import type { Database } from '../../src/db/client.ts'
import {
  rubrics,
  rubricVersions,
  submissionVersions,
  taskAssignments,
  taskSubmissions,
} from '../../src/db/schema/skills.ts'
import { FIXED_NOW } from './app.ts'
import { seedResource } from './resources-sample.ts'

/**
 * Beceri görevi test satırları (ADR 0004 karar 4–7). Yazma ucu bu dilimde yok; satırlar doğrudan
 * tablolara eklenir. Varsayılanlar geçerlidir: yayındaki içerik ve rubrik sürümü, öğretmen puanlı
 * yazma ataması, bir kursiyerin teslimi ve ilk sürümü.
 */

const bands = (aspect: string) =>
  [0, 1, 2, 3, 4, 5].map((band) => ({
    band,
    description: `${aspect} bant ${band}`,
    alignment: {
      kind: 'cefr' as const,
      scale: 'Overall written production',
      level: 'B1',
      index: 1,
    },
  }))

/** Analitik yazma rubriği (iki kriter), core şemasıyla doğrulanmış. */
export function sampleRubricData(): RubricVersionData {
  return rubricVersionInputSchema.parse({
    title: 'Yazma rubriği',
    kind: 'analytic',
    skill: 'writing',
    criteria: [
      { id: 'task', aspect: 'task_fulfilment', bands: bands('Görev') },
      { id: 'grammar', aspect: 'grammatical_accuracy', bands: bands('Dilbilgisi') },
    ],
  })
}

export const LEARNER = 'test-s-beceri'
export const DUE_AT = new Date('2026-10-20T20:59:00.000Z')

export type SkillChain = {
  resourceId: string
  resourceVersionId: string
  rubricId: string
  rubricVersionId: string
  assignmentId: string
  submissionId: string
  submissionVersionId: string
}

/** Kurumda içerikten teslim sürümüne kadar geçerli bir zincir kurar. */
export async function seedSkillChain(
  db: Database,
  institutionId: string,
  ownerUserId: string,
): Promise<SkillChain> {
  const { resource, versions } = await seedResource(db, institutionId, {
    ownerUserId,
    versions: [{ status: 'published' }],
  })
  const resourceVersionId = versions[0]!.id
  const rubricId = randomUUID()
  const rubricVersionId = randomUUID()
  const assignmentId = randomUUID()
  const submissionId = randomUUID()
  const submissionVersionId = randomUUID()
  const at = { createdAt: FIXED_NOW, updatedAt: FIXED_NOW }
  const rubric = sampleRubricData()

  await db.insert(rubrics).values({ institutionId, id: rubricId, ownerUserId, ...at })
  await db.insert(rubricVersions).values({
    institutionId,
    id: rubricVersionId,
    rubricId,
    versionNumber: 1,
    status: 'published',
    ...rubric,
    publishedAt: FIXED_NOW,
    ...at,
  })
  await db.insert(taskAssignments).values({
    institutionId,
    id: assignmentId,
    ...teacherAssignment(resource.id, resourceVersionId, rubricVersionId),
    assignedByUserId: ownerUserId,
    ...at,
  })
  await db
    .insert(taskSubmissions)
    .values({ institutionId, id: submissionId, assignmentId, learnerId: LEARNER, ...at })
  await db.insert(submissionVersions).values({
    institutionId,
    id: submissionVersionId,
    submissionId,
    versionNumber: 1,
    submittedAt: FIXED_NOW,
    body: 'My weekend was busy.',
    ...at,
  })
  return {
    resourceId: resource.id,
    resourceVersionId,
    rubricId,
    rubricVersionId,
    assignmentId,
    submissionId,
    submissionVersionId,
  }
}

/** Öğretmen puanlı yazma atamasının kolonları (`resolveAssignmentSettings` çıktısının karşılığı). */
export function teacherAssignment(
  resourceId: string,
  resourceVersionId: string,
  rubricVersionId: string | null,
) {
  return {
    resourceId,
    resourceVersionId,
    scoringVersionId: resourceVersionId,
    rubricVersionId,
    scoringMode: 'teacher' as const,
    kind: 'evaluation' as const,
    maxAttempts: 1,
    countPolicy: 'first' as const,
    dueAt: DUE_AT,
    lateAcceptanceDays: 0,
    timeLimitMinutes: null,
    listeningPlays: null,
    showTranscript: false,
    submissionSettings: {
      submissionKind: 'text' as const,
      maxVersions: 3,
      minWords: null,
      maxWords: null,
    },
    highStakes: false,
    secondRatingPercent: 0,
  }
}

/** Otomatik puanlı değerlendirme atamasının kolonları. */
export function autoAssignment(resourceId: string, resourceVersionId: string) {
  return {
    ...teacherAssignment(resourceId, resourceVersionId, null),
    scoringMode: 'auto' as const,
    maxAttempts: 2,
    countPolicy: 'highest' as const,
    timeLimitMinutes: 30,
    submissionSettings: null,
  }
}
