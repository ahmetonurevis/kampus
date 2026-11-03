import { z } from 'zod'

import {
  ASSESSMENT_POINTS,
  PROGRESSION_DECISION_STATUSES,
  PROGRESSION_OUTCOMES,
  courseAssessmentInputSchema,
  progressionBasisSchema,
  progressionDecisionInputSchema,
} from '@kampus/school-core/cefr/progression.ts'
import { CEFR_LEVELS, enumKeys } from '@kampus/school-core/content/taxonomy.ts'
import { GROUP_MEMBER_STATUSES } from '@kampus/school-core/lib/language-groups.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Kur sonu değerlendirme ve geçiş kararı (OG-086; IST-062; DOM-DIL-013, DOM-DIL-060, DOM-DIL-070).
 * Gövdeler core şemalarıdır (katı); karar komutlarında sürüm `If-Match` başlığındadır. Devam özeti,
 * koşullar ve üst kur çıktısı her okumada hesaplanır, saklanmaz.
 */

const instant = z.iso.datetime()
const id = (description: string) => z.string().min(1).max(200).describe(description)
const level = z.enum(enumKeys(CEFR_LEVELS))
const outcome = z.enum(enumKeys(PROGRESSION_OUTCOMES))

export const courseAssessmentBodySchema = courseAssessmentInputSchema.strict()
export const progressionDecisionBodySchema = progressionDecisionInputSchema.strict()
export const approveProgressionBodySchema = z.strictObject({})
export const rejectProgressionBodySchema = z.strictObject({
  reason: z
    .string()
    .trim()
    .min(1, 'Reddetme gerekçesini yazın.')
    .max(2000, 'En fazla 2.000 karakter girebilirsiniz.'),
})

export const progressionDecisionParamsSchema = z.object({ decisionId: id('Karar kimliği') })
export const groupProgressionParamsSchema = z.object({ groupId: id('Dil grubu kimliği') })
export const studentProgressionParamsSchema = z.object({ studentId: id('Öğrenci kimliği') })

const assessmentSchema = z.object({
  id: z.string(),
  enrollmentId: z.string(),
  point: z.enum(enumKeys(ASSESSMENT_POINTS)),
  score: z.number(),
  skills: z.array(
    z.object({ skill: z.string(), score: z.number(), feedback: z.string().nullable() }),
  ),
  assessedAt: instant,
  assessedByUserId: z.string(),
})

const nextStepSchema = z
  .object({
    decisionId: z.string(),
    enrollmentId: z.string(),
    learnerId: z.string(),
    fromCourseId: z.string(),
    fromLevel: level,
    nextCourseId: z.string().nullable(),
    nextLevel: level.nullable(),
  })
  .nullable()
  .describe(
    'Onaylı ve geçerli `passed` kararının üst kur çıktısı (core `progressionNextStep`); yenileme teklifi bunu okur. Diğer kararlarda `null`.',
  )

const decisionSchema = z.object({
  id: z.string(),
  enrollmentId: z.string(),
  groupId: z.string(),
  learnerId: z.string(),
  courseId: z.string(),
  outcome,
  status: z.enum(enumKeys(PROGRESSION_DECISION_STATUSES)),
  rationale: z.string(),
  correctsDecisionId: z.string().nullable(),
  decidedByUserId: z.string(),
  decidedAt: instant,
  reviewedByUserId: z.string().nullable(),
  reviewedAt: instant.nullable(),
  rejectionReason: z.string().nullable(),
  basis: progressionBasisSchema,
  suggestedLevel: level.nullable().describe('Karar anının genel seviye önerisi (gerekçe)'),
  rowVersion: z.number().int().min(1).describe('Kararın satır sürümü (`If-Match`)'),
  next: nextStepSchema,
})

const learnerDecisionSchema = z.object({
  id: z.string(),
  courseId: z.string(),
  outcome,
  correctsDecisionId: z.string().nullable(),
  approvedAt: instant,
  basis: progressionBasisSchema,
  next: nextStepSchema,
})

export const courseAssessmentResponseSchema = dataResponse(assessmentSchema)
export const progressionDecisionResponseSchema = dataResponse(decisionSchema)

export const groupProgressionResponseSchema = dataResponse(
  z.object({
    groupId: z.string(),
    courseId: z.string(),
    level,
    canDecide: z.boolean().describe('Oturumdaki kişi grubun öğretmeni mi (ölçme ve karar)'),
    canReview: z.boolean().describe('Oturumdaki kişi kurun akademik koordinatörü mü (onay)'),
    learners: z.array(
      z.object({
        enrollmentId: z.string(),
        studentId: z.string(),
        memberStatus: z.enum(GROUP_MEMBER_STATUSES),
        attendance: z.object({
          totalHours: z.number().int(),
          recordedHours: z.number().int(),
          attendedHours: z.number().int(),
          absentHours: z.number().int(),
          unrecordedHours: z.number().int(),
          requiredHours: z.number().int(),
          status: z.enum(['eligible', 'ineligible', 'pending']),
        }),
        assessments: z.array(assessmentSchema),
        conditions: z.object({
          attendance: z.boolean(),
          finalScore: z.boolean(),
          skills: z.boolean(),
        }),
        failingSkills: z.array(z.string()),
        allowedOutcomes: z.array(outcome),
        blocker: z.enum(['attendance_pending', 'assessments_incomplete']).nullable(),
        decisions: z.array(decisionSchema.omit({ next: true })),
        next: nextStepSchema,
      }),
    ),
  }),
)

export const studentProgressionResponseSchema = dataResponse(
  z.object({
    studentId: z.string(),
    decisions: z.array(z.union([decisionSchema, learnerDecisionSchema])),
  }),
)
