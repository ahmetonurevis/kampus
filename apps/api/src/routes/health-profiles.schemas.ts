import { z } from 'zod'

import {
  ALLERGY_SEVERITIES,
  HEALTH_LEGAL_BASIS_KEYS,
  healthProfilePatchSchema,
  type AllergySeverity,
} from '@kampus/school-core/lib/health-profile.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Sağlık ve acil bilgi uçlarının şemaları (IST-020; DOM-ILT-035). Gövde core
 * `healthProfilePatchSchema`'dır (kısmi; katı, bilinmeyen alan ve gövdedeki `institutionId` 400). Yanıt
 * düzeye göre ayrılır: acil düzeyde (derse giren öğretmen) yalnız alerji ve acil talimat şemadadır,
 * tam alanlar serileştirmede de düşer. Bütün içerik özel nitelikli veridir (kvkk: Ö).
 */

export const healthProfileParamsSchema = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kimliği'),
})

export const updateHealthProfileBodySchema = healthProfilePatchSchema.meta({
  id: 'UpdateHealthProfileBody',
})

const SEVERITY_KEYS = Object.keys(ALLERGY_SEVERITIES) as [AllergySeverity, ...AllergySeverity[]]

const allergy = z.object({
  // kvkk: Ö
  name: z.string(),
  // kvkk: Ö
  severity: z.enum(SEVERITY_KEYS).describe('Şiddet: `mild`, `moderate`, `severe`'),
})
const named = z.object({
  // kvkk: Ö
  name: z.string(),
})

const emergencyProfile = z
  .object({
    // kvkk: Ö
    allergies: z.array(allergy),
    // kvkk: Ö
    emergencyInstructions: z.string().describe('Acil müdahale talimatı; yoksa boş'),
  })
  .meta({ id: 'HealthEmergencyProfile' })

const fullProfile = z
  .object({
    // kvkk: Ö
    allergies: z.array(allergy),
    // kvkk: Ö
    chronicConditions: z.array(named),
    // kvkk: Ö
    medications: z.array(
      z.object({
        // kvkk: Ö
        name: z.string(),
        // kvkk: Ö
        schedule: z.string().optional().describe('Kullanım düzeni'),
        // kvkk: Ö
        atSchool: z.boolean().describe('Okulda verilmesi gerekiyor mu'),
      }),
    ),
    // kvkk: Ö
    supportNeeds: z.array(named),
    // kvkk: Ö
    emergencyInstructions: z.string().describe('Acil müdahale talimatı; yoksa boş'),
    legalBasis: z
      .enum(HEALTH_LEGAL_BASIS_KEYS)
      .nullable()
      .describe('İşlemenin hukuki dayanağı (KVKK m.6/3); kayıt yoksa `null`'),
    updatedAt: z.iso.datetime().nullable().describe('Son güncelleme; kayıt yoksa `null`'),
  })
  .meta({ id: 'HealthFullProfile' })

const version = z.number().int().describe('Sonraki PATCH için sürüm; kayıt yoksa 1')

export const healthProfileResponseSchema = dataResponse(
  z
    .discriminatedUnion('level', [
      z.object({
        level: z.literal('full').describe('Tam görünüm'),
        profile: fullProfile,
        version,
      }),
      z.object({
        level: z.literal('emergency').describe('Yalnız acil müdahale bilgisi'),
        profile: emergencyProfile,
        version,
      }),
    ])
    .meta({ id: 'HealthProfile' }),
)
