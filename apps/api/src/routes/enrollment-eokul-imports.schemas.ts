import { z } from 'zod'

import { GUARDIAN_MATCHES } from '@kampus/school-core/lib/enrollment-import.ts'
import {
  EOKUL_CHANGE_FIELDS,
  EOKUL_FIELDS,
  EOKUL_ROW_STATUSES,
  eokulMappingIssueSchema,
} from '@kampus/school-core/lib/enrollment-eokul-import.ts'

import { dataResponse } from './common.schemas.ts'
import {
  importIssueResponseSchema,
  importNoticeResponseSchema,
} from './enrollment-imports.schemas.ts'

/** e-Okul öğrenci listesi aktarımının yanıtı (IST-134, ON-062; DOM-KAY-042). */

const columnSchema = z.number().int().nullable()
const fullMappingSchema = z
  .object(Object.fromEntries(EOKUL_FIELDS.map((field) => [field, columnSchema])))
  .describe("Alan → başlıktaki sütun sırası (0'dan); eşlenmemiş alan `null`")
  .meta({ id: 'EokulMapping' })

const eokulChangeSchema = z
  .object({
    field: z.enum(EOKUL_CHANGE_FIELDS),
    before: z.string().nullable(),
    after: z
      .string()
      .nullable()
      .describe('Kimlik değişikliğinde iki değer de `null` (yalnız eklenir)'),
  })
  .meta({ id: 'EokulChange' })

const eokulRowSchema = z
  .object({
    line: z.number().int().describe('Dosyadaki satır'),
    status: z
      .enum(EOKUL_ROW_STATUSES)
      .describe(
        '`new` yeni öğrenci, `update` güncellenecek, `unchanged` değişiklik yok, `invalid` hatalı',
      ),
    schoolNumber: z.string(),
    name: z.string(),
    className: z.string().describe('Dosyadaki sınıf hücresi'),
    classLabel: z.string().describe('Eşleşen Kampüs sınıfı; bulunamadıysa boş'),
    // kvkk: Ç — maskeli; tam kimlik hiçbir yanıtta dönmez.
    identityMasked: z.string().describe('Kimlik numarasının yalnız son dört hanesi görünür'),
    guardianName: z.string().describe('Yalnız yeni öğrencide dolu'),
    guardianPhoneMasked: z.string().describe('Veli telefonu maskeli; yalnız yeni öğrencide dolu'),
    guardianMatch: z.enum(GUARDIAN_MATCHES).nullable(),
    changes: z.array(eokulChangeSchema),
    issues: z.array(importIssueResponseSchema),
    notices: z.array(importNoticeResponseSchema),
  })
  .meta({ id: 'EokulImportRow' })

/** Onay yanıtı saklanır (idempotency): `rows` boştur, kişisel veri taşımaz. */
export const eokulImportResultSchema = z
  .object({
    dryRun: z.boolean().describe('`true`: yalnız doğrulandı, hiçbir kayıt yazılmadı'),
    headerLine: z.number().int().describe('Başlık satırının dosyadaki yeri'),
    headers: z
      .array(z.object({ index: z.number().int(), label: z.string() }))
      .describe('Başlık hücreleri (sütun eşleme seçenekleri)'),
    suggestedMapping: fullMappingSchema,
    mapping: fullMappingSchema,
    mappingIssues: z
      .array(eokulMappingIssueSchema.meta({ id: 'EokulMappingIssue' }))
      .describe('Doluysa satırlar işlenmedi'),
    fileRowCount: z.number().int().describe('Başlıktan sonraki boş olmayan satır sayısı'),
    rowCount: z.number().int().describe('İşlenen öğrenci satırı (onayda seçilen satırlar)'),
    newCount: z.number().int(),
    updateCount: z.number().int(),
    unchangedCount: z.number().int(),
    invalidCount: z.number().int(),
    newGuardianCount: z.number().int().describe('Açılacak yeni veli kaydı sayısı'),
    existingGuardianCount: z.number().int().describe('Bağlanılacak mevcut veli kaydı sayısı'),
    rows: z.array(eokulRowSchema).describe('Yalnız önizlemede dolu; satırlar maskeli'),
  })
  .meta({ id: 'EokulImportResult' })

export const eokulImportResponseSchema = dataResponse(eokulImportResultSchema)
