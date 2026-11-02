import { z } from 'zod'

import {
  EXCLUSION_REASONS,
  EVIDENCE_SOURCES,
  LEVEL_DECISION_KINDS,
  SUGGESTION_CONTEXTS,
} from '@kampus/school-core/cefr/suggestion.ts'
import {
  LEARNER_KINDS,
  PLACEMENT_MODES,
  PLACEMENT_SECTIONS,
  placementDecisionInputSchema,
  placementScoreInputSchema,
  placementSessionInputSchema,
} from '@kampus/school-core/cefr/placement.ts'
import { CEFR_LEVELS, PRIMARY_SKILLS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'

import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

/**
 * Seviye tespiti ve CEFR profili (OG-054; IST-058, IST-060). Gövdeler core şemalarıdır (katı);
 * `version` oturumun satır sürümüdür (iyimser kilit). Yanıtta puan, öneri ve geçerlilik her
 * okumada hesaplanır, saklanmaz.
 */

const instant = z.iso.datetime()
const level = z.enum(enumKeys(CEFR_LEVELS))
const skill = z.enum(PRIMARY_SKILLS)
const section = z.enum(enumKeys(PLACEMENT_SECTIONS))
const learnerKind = z.enum(enumKeys(LEARNER_KINDS))
const rowVersion = z.number().int().min(1).max(2_147_483_647).describe('Oturumun satır sürümü')

export const placementSessionParamsSchema = z.object({
  sessionId: z.uuid().describe('Tespit oturumu kimliği'),
})
export const cefrProfileParamsSchema = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kaydı kimliği'),
})

export const placementSessionListQuerySchema = pageQuerySchema
  .extend({
    learnerKind: learnerKind.describe('Kişinin türü: öğrenci ya da aday'),
    learnerId: z.string().min(1).max(200).describe('Öğrenci ya da aday kaydı kimliği'),
  })
  .strict()

export const openPlacementSessionBodySchema = placementSessionInputSchema.strict()
export const scorePlacementSectionBodySchema = placementScoreInputSchema
export const completePlacementSessionBodySchema = z.strictObject({ version: rowVersion })
export const decidePlacementBodySchema = placementDecisionInputSchema
  .omit({ sessionId: true })
  .extend({ version: rowVersion })
  .strict()

const validitySchema = z.object({
  status: z.enum(['in_progress', 'valid', 'expired']),
  preliminary: z.boolean(),
  completedAt: instant.optional(),
  validUntil: instant.optional().describe('Geçerliliğin bittiği an (hariç)'),
})

const overallSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('suggested'), level }),
  z.object({ status: z.literal('insufficient'), missingSkills: z.array(skill) }),
])

const suggestionSchema = z.object({
  context: z.enum(enumKeys(SUGGESTION_CONTEXTS)),
  computedAt: instant,
  overall: overallSchema,
  skills: z.array(
    z.object({
      skill,
      label: z.string(),
      status: z.enum(['suggested', 'insufficient']),
      level: level.nullable(),
      plus: z.boolean(),
      demonstratedBy: z.enum(enumKeys(SUGGESTION_CONTEXTS)).nullable(),
      missingEvidence: z.number().int(),
      missingItems: z.number().int(),
      evidenceIds: z.array(z.string()),
    }),
  ),
})

const decisionSchema = z.object({
  id: z.uuid(),
  kind: z.enum(enumKeys(LEVEL_DECISION_KINDS)),
  skill: skill.nullable().describe('Boşsa genel seviye'),
  level,
  rationale: z.string(),
  decidedByUserId: z.string(),
  decidedAt: instant,
  placementSessionId: z.uuid().nullable(),
})

const sessionBase = {
  id: z.uuid(),
  learnerKind,
  learnerId: z.string(),
  formId: z.uuid(),
  formVersionId: z.uuid(),
  mode: z.enum(enumKeys(PLACEMENT_MODES)),
  startedAt: instant,
  completedAt: instant.nullable(),
  version: z.number().int(),
}

export const placementSessionSchema = z.object({
  ...sessionBase,
  updatedAt: instant,
  sections: z.array(
    z.object({
      section,
      label: z.string(),
      scoring: z.enum(['auto', 'rubric']),
      status: z.enum(['missing', 'pending', 'scored']),
      percent: z.number().int().nullable(),
      targetLevel: level.nullable(),
      enteredByUserId: z.string().nullable(),
      enteredAt: instant.nullable(),
    }),
  ),
  validity: validitySchema,
  preliminary: z.boolean(),
  suggestion: suggestionSchema,
  decisions: z.array(decisionSchema),
})

export const placementSessionResponseSchema = dataResponse(placementSessionSchema)
export const placementSessionListResponseSchema = pageResponse(
  z.object({ ...sessionBase, validity: validitySchema }),
)

export const cefrProfileResponseSchema = dataResponse(
  z.object({
    studentId: z.string(),
    title: z.string(),
    estimate: suggestionSchema.extend({
      label: z.string().describe('"Tahmini seviye": öneri karar değildir (DOM-BEC-034)'),
      evidence: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          source: z.enum(enumKeys(EVIDENCE_SOURCES)),
          skill,
          targetLevel: level,
          performedAt: instant,
          expiresAt: instant,
          successful: z.boolean(),
          percent: z.number().int(),
        }),
      ),
      excluded: z.array(
        z.object({
          id: z.string(),
          title: z.string(),
          reason: z.enum(enumKeys(EXCLUSION_REASONS)),
        }),
      ),
    }),
    current: z
      .array(
        z.object({
          skill: skill.nullable().describe('Boşsa genel seviye'),
          level,
          decisionId: z.uuid(),
          decidedAt: instant,
        }),
      )
      .describe('Beceri başına güncel seviye: en yeni insan kararı'),
    timeline: z.array(decisionSchema).describe('Kararların zaman çizelgesi, en yeniden eskiye'),
    placements: z.array(
      z.object({
        id: z.uuid(),
        mode: z.enum(enumKeys(PLACEMENT_MODES)),
        startedAt: instant,
        completedAt: instant.nullable(),
        validity: validitySchema,
      }),
    ),
  }),
)
