import { z } from 'zod'

import {
  birthDateSchema,
  ENROLLMENT_PAYERS,
  ENROLLMENT_TOTAL_CENTS,
  GUARDIAN_RELATIONS,
  nationalIdSchema,
} from '@kampus/school-core/lib/domain.ts'

import { commandResultSchema } from './commands.schemas.ts'

/** Aday uçlarının yol şemaları; gövde şemaları core'dadır (`lib/prospects.ts`). */

export const prospectParamsSchema = z.object({
  prospectId: z.string().min(1).max(200).describe('Aday kimliği'),
})

/** Kesin kayıt tutarının sınırları (kuruş, core `ENROLLMENT_TOTAL_CENTS`): 100–1.000.000 ₺. */
export const ENROLL_TOTAL_CENTS_MIN = ENROLLMENT_TOTAL_CENTS.min
export const ENROLL_TOTAL_CENTS_MAX = ENROLLMENT_TOTAL_CENTS.max

/**
 * Kesin kayıt gövdesi (DOM-KAY-035). Para kuruş cinsinden tamsayıdır (`totalCents`) ve core'a
 * olduğu gibi geçer; core demo form şeması (`registrationSchema`, tam lira ve `z.coerce`) API'ye
 * açılmaz. Sayısal alanlar zorlanmaz: `"36000"` gibi metin 400 olur. Aday kimliği yoldan gelir;
 * gövde katıdır (`prospectId`, `institutionId`, `total` veya bilinmeyen alan 400). DOM-KAY-012
 * alanları (kimlik no, doğum tarihi, yakınlık, ödeyici) şimdilik isteğe bağlıdır.
 */
export const enrollProspectBodySchema = z
  .object({
    classId: z
      .string()
      .trim()
      .min(2, 'Sınıf seçin.')
      .max(200, 'Sınıf kimliği çok uzun.')
      .describe('Öğrencinin yerleşeceği etkin sınıf'),
    totalCents: z
      .number('Tutar sayı olmalıdır.')
      .int('Tutar kuruş cinsinden tam sayı olmalıdır.')
      .min(ENROLL_TOTAL_CENTS_MIN, 'Tutar en az 100 ₺ olmalıdır.')
      .max(ENROLL_TOTAL_CENTS_MAX, 'Tutar en fazla 1.000.000 ₺ olabilir.')
      .describe('Eğitim bedeli, kuruş (tamsayı). 10.000–100.000.000 (100–1.000.000 ₺)'),
    count: z
      .number('Taksit sayısı sayı olmalıdır.')
      .int('Taksit sayısı tam sayı olmalıdır.')
      .min(1, 'En az 1 taksit seçin.')
      .max(12, 'En fazla 12 taksit seçilebilir.')
      .describe('Taksit sayısı (1–12)'),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'İlk ödeme tarihini seçin.')
      .describe('İlk taksitin vadesi (`YYYY-MM-DD`)'),
    allowOtherCampus: z
      .boolean('Kampüs onayı doğru/yanlış olmalıdır.')
      .optional()
      .describe(
        'Sınıf adayın kampüsünden değilse bilinçli seçim onayı; verilmezse 422 `class_campus_mismatch`',
      ),
    parentId: z
      .string()
      .trim()
      .min(2, 'Veli seçin.')
      .max(200, 'Veli kimliği çok uzun.')
      .optional()
      .describe(
        'Kardeş kaydında öğrencinin bağlanacağı mevcut veli (DOM-KAY-013); yalnız 18 yaş altı',
      ),
    // kvkk: Ç — T.C. veya yabancı uyruklu kimlik numarası; loglanmaz (`REDACTED_PATHS`).
    nationalId: nationalIdSchema
      .optional()
      .describe('Öğrencinin T.C. veya yabancı uyruklu kimlik numarası (11 hane, DOM-KAY-012)'),
    // kvkk: Ç — doğum tarihi; loglanmaz.
    birthDate: birthDateSchema
      .optional()
      .describe('Öğrencinin doğum tarihi (`YYYY-MM-DD`, DOM-KAY-012)'),
    guardianRelation: z
      .enum(GUARDIAN_RELATIONS, 'Yakınlık derecesini seçin.')
      .optional()
      .describe('Velinin öğrenciye yakınlığı (DOM-KAY-012); yalnız 18 yaş altı'),
    payer: z
      .enum(ENROLLMENT_PAYERS, 'Ödeyiciyi seçin.')
      .optional()
      .describe(
        'Sözleşmenin ödeyicisi (DOM-KAY-012); verilmezse 18 yaş altında `guardian`, üstünde `student`',
      ),
  })
  .strict()
export type EnrollProspectBody = z.infer<typeof enrollProspectBodySchema>

/** Kesin kayıt yanıtı: komut sonucu ve oluşturulan sözleşmenin kimliği. */
export const enrollProspectResponseSchema = z.object({
  data: commandResultSchema
    .extend({
      contractId: z.string().describe('Oluşturulan sözleşmenin kimliği (PDF ve okuma uçları için)'),
    })
    .meta({ id: 'EnrollProspectResult' }),
})
