import { z } from 'zod'

import {
  mealAllergyMealKindSchema,
  mealAllergyServiceDateSchema,
} from '@kampus/school-core/lib/finance-meal-allergy-checks.ts'
import { ALLERGENS, MEAL_KINDS } from '@kampus/school-core/lib/finance-meal-menus.ts'

import { dataResponse } from './common.schemas.ts'

/** Yemekhane alerji uyarısı şemaları (DOM-FIN-162; ON-151; K-541…K-543). */

const severity = z
  .enum(['mild', 'moderate', 'severe'])
  .describe('Alerji şiddeti: `mild` hafif, `moderate` orta, `severe` ağır (anafilaksi riski)')
const allergen = z.enum(ALLERGENS).describe('TGK Ek-1 alerjen anahtarı')
const mealKind = z.enum(MEAL_KINDS)

/**
 * Servis listesi sorgusu: gün (boşsa bugün), öğün ve sınıf **ya da** sınıf düzeyi (tam olarak
 * biri). Bilinmeyen parametre 400.
 */
export const mealAllergyRosterQuery = z
  .strictObject({
    serviceDate: mealAllergyServiceDateSchema
      .optional()
      .describe('Servis günü (YYYY-MM-DD, Europe/Istanbul); boşsa bugün. Bugün ile 7 gün sonrası'),
    mealKind: mealAllergyMealKindSchema,
    classId: z.string().trim().min(1).max(128).optional().describe('Sınıf (records classes)'),
    grade: z.coerce
      .number('Sınıf düzeyi sayı olmalı.')
      .int('Sınıf düzeyi tam sayı olmalı.')
      .min(1)
      .max(12)
      .optional()
      .describe('Sınıf düzeyi (ör. 7: bütün 7. sınıflar)'),
  })
  .refine((query) => (query.classId === undefined) !== (query.grade === undefined), {
    message: 'Sınıf ya da sınıf düzeyinden birini seçin.',
    path: ['classId'],
  })

const acknowledgement = z
  .object({
    id: z.string(),
    acknowledgedAt: z.string().describe('İşaret anı (ISO 8601)'),
    acknowledgedByMembershipId: z.string(),
    acknowledgedByName: z.string().nullable().describe('İşareti koyan görevli'),
  })
  .describe('"Uyarı görüldü, alternatif verildi" işareti')

const rosterStudent = z.object({
  studentId: z.string(),
  studentName: z.string(),
  classId: z.string().nullable(),
  className: z.string(),
  severity: severity.nullable().describe('Uyarıların en ağır şiddeti; profil okunamadıysa `null`'),
  profileUnreadable: z
    .boolean()
    .describe('Sağlık bilgisi okunamadı: menüyle karşılaştırılamadı, elle kontrol'),
  conflicts: z
    .array(
      z.object({
        itemName: z.string().describe('Yemek'),
        position: z.number().int().describe('Öğündeki sıra (0 tabanlı)'),
        allergens: z.array(allergen).describe('Yemekte olup öğrencinin alerjisine denk gelenler'),
        severity,
      }),
    )
    .describe('Yemek başına alerjen uyarısı'),
  unmatched: z
    .array(
      z.object({
        allergyName: z
          .string()
          .describe('Menüyle karşılaştırılamayan alerjinin profildeki adı (özel nitelikli)'),
        severity,
        partial: z.boolean().describe('Adın bir kısmı eşlendi; eşlenen kısım çakışmada görünür'),
      }),
    )
    .describe('Menüyle karşılaştırılamadı, elle kontrol'),
  acknowledgement: acknowledgement.nullable(),
})

export const mealAllergyRosterResponse = dataResponse(
  z.object({
    serviceDate: z.string(),
    mealKind,
    classId: z.string().nullable(),
    grade: z.number().int().nullable(),
    className: z.string().nullable(),
    studentCount: z.number().int().describe('Seçimdeki kayıtlı öğrenci sayısı'),
    studentsWithoutMenu: z
      .number()
      .int()
      .describe('Kampüsünde o gün ve öğünde yayımlanmış yemek olmayan öğrenci sayısı'),
    menus: z
      .array(
        z.object({
          menuId: z.string(),
          branchId: z.string().nullable(),
          branchName: z.string().nullable(),
        }),
      )
      .describe('Karşılaştırılan yayımlanmış menüler'),
    students: z.array(rosterStudent).describe('Yalnız uyarısı olan öğrenciler, sınıf ve ada göre'),
  }),
)

export const mealAllergyOptionsResponse = dataResponse(
  z.object({
    today: z.string().describe('Bugün (Europe/Istanbul)'),
    lastDate: z.string().describe('Açılabilen son gün'),
    mealKinds: z.array(mealKind).describe('Kurumun açık öğünleri'),
    classes: z.array(
      z.object({
        classId: z.string(),
        className: z.string(),
        grade: z.number().int().nullable(),
      }),
    ),
    grades: z.array(z.number().int()),
  }),
)

export const mealAllergyAcknowledgementResponse = dataResponse(
  acknowledgement.extend({
    studentId: z.string(),
    serviceDate: z.string(),
    mealKind,
    menuId: z.string(),
  }),
)
