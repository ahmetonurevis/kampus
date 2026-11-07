import { z } from 'zod'

import { GUARDIAN_RELATIONSHIPS } from '@kampus/school-core/lib/enrollment.ts'
import { GUARDIAN_MATCHES } from '@kampus/school-core/lib/enrollment-import.ts'
import {
  IMPORT_ROW_STATUSES,
  importIssueSchema,
  importNoticeSchema,
} from '@kampus/school-core/lib/enrollment-import-cells.ts'

import { dataResponse } from './common.schemas.ts'

/** Aktarımların ortak satır sorunu ve bilgisi; istemci adlı şemayla okur (IST-007). */
export const importIssueResponseSchema = importIssueSchema.meta({ id: 'ImportIssue' })
export const importNoticeResponseSchema = importNoticeSchema.meta({ id: 'ImportNotice' })

const studentImportRowSchema = z
  .object({
    line: z.number().int().describe('Dosyadaki satır (başlık 1. satırdır)'),
    status: z.enum(IMPORT_ROW_STATUSES).describe('`ready` yazılacak, `skipped` zaten kayıtlı'),
    name: z.string(),
    className: z.string(),
    campus: z.string(),
    identityMasked: z.string().describe('Kimlik numarasının yalnız son dört hanesi görünür'),
    guardianName: z.string(),
    guardianPhoneMasked: z.string().describe('Veli telefonu maskeli'),
    relationship: z.enum(GUARDIAN_RELATIONSHIPS).nullable(),
    guardianMatch: z
      .enum(GUARDIAN_MATCHES)
      .nullable()
      .describe(
        '`new` yeni veli, `file` dosyanın önceki satırıyla aynı veli, `existing` kurumda kayıtlı veli (DOM-KAY-013), `self` yetişkin kursiyerin kendisi',
      ),
    issues: z.array(importIssueResponseSchema),
    notices: z.array(importNoticeResponseSchema),
  })
  .meta({ id: 'StudentImportRow' })

/** Onay yanıtı saklanır (idempotency): `rows` boştur, kişisel veri taşımaz. */
export const studentImportResultSchema = z
  .object({
    dryRun: z.boolean().describe('`true`: yalnız doğrulandı, hiçbir kayıt yazılmadı'),
    rowCount: z.number().int().describe('Dosyadaki veri satırı sayısı'),
    readyCount: z.number().int().describe('Yazılacak (onayda yazılan) öğrenci sayısı'),
    skippedCount: z.number().int().describe('Kimliği kayıtlı olduğu için atlanan satır sayısı'),
    invalidCount: z.number().int().describe('Hatalı satır sayısı'),
    newGuardianCount: z.number().int().describe('Açılacak yeni veli kaydı sayısı'),
    existingGuardianCount: z.number().int().describe('Bağlanılacak mevcut veli kaydı sayısı'),
    rows: z.array(studentImportRowSchema).describe('Yalnız önizlemede dolu; satırlar maskeli'),
  })
  .meta({ id: 'StudentImportResult' })

export const studentImportResponseSchema = dataResponse(studentImportResultSchema)
