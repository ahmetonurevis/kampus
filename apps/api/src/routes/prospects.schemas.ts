import { z } from 'zod'

/** Aday uçlarının yol şemaları; gövde şemaları core'dadır (`lib/prospects.ts`). */

export const prospectParamsSchema = z.object({
  prospectId: z.string().min(1).max(200).describe('Aday kimliği'),
})

/** Kesin kayıt tutarının sınırları (kuruş): core `registrationSchema`'nın 100–1.000.000 ₺'si. */
export const ENROLL_TOTAL_CENTS_MIN = 10_000
export const ENROLL_TOTAL_CENTS_MAX = 100_000_000

/**
 * Kesin kayıt gövdesi (DOM-KAY-035). API'nin kendi şemasıdır: para kuruş cinsinden tamsayıdır
 * (`totalCents`), core form şeması (`registrationSchema`, tam lira ve `z.coerce`) API'ye açılmaz.
 * Sayısal alanlar zorlanmaz: `"36000"` gibi metin 400 olur. Aday kimliği yoldan gelir; gövde
 * katıdır (`prospectId`, `institutionId`, `total` veya bilinmeyen alan 400). 100'ün katı olmayan
 * tutar şemayı geçer ama serviste 422 `amount_not_whole_lira` olur (core şimdilik tam lira
 * çalışır, `TODO(core-kurus)`).
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
      .describe(
        'Eğitim bedeli, kuruş (tamsayı). 10.000–100.000.000 (100–1.000.000 ₺); şimdilik 100’ün katı olmalı (tam lira), değilse 422 `amount_not_whole_lira`',
      ),
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
  })
  .strict()
export type EnrollProspectBody = z.infer<typeof enrollProspectBodySchema>
