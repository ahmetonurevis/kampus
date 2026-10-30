import { z } from 'zod'

import { READABLE_COLLECTIONS } from '../services/collection-access.ts'
import { ARCHIVED_MODES, FILTER_FIELDS, SORT_FIELDS } from '../services/collection-reads.ts'
import { dataResponse, pageQuerySchema, pageResponse } from './common.schemas.ts'

const collectionDescription = `school-core koleksiyon adı (State anahtarı). Okunabilir olanlar: ${READABLE_COLLECTIONS.map((name) => `\`${name}\``).join(', ')}. Bilinmeyen ad 404.`

export const collectionParamsSchema = z.object({
  collection: z.string().min(1).max(64).describe(collectionDescription),
})

export const collectionRecordParamsSchema = collectionParamsSchema.extend({
  id: z.string().min(1).max(200).describe('Kayıt kimliği'),
})

const SORT_PATTERN = new RegExp(
  `^-?(${SORT_FIELDS.join('|')})(,-?(${SORT_FIELDS.join('|')})){0,2}$`,
)

const filterValue = z
  .union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).min(1).max(20)])
  .optional()

const filterShape = Object.fromEntries(
  FILTER_FIELDS.map((field) => [
    field,
    filterValue.describe(
      field === 'classId'
        ? '`classId` eşitlik filtresi; çoklu değer parametre tekrarıyla. Kaydında sınıf olmayan öğrenci koleksiyonlarında (`grades`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`) öğrencinin güncel sınıfıdır'
        : `\`${field}\` eşitlik filtresi; çoklu değer parametre tekrarıyla`,
    ),
  ]),
) as Record<(typeof FILTER_FIELDS)[number], typeof filterValue>

const dayValue = (edge: string) =>
  z.iso
    .date()
    .optional()
    .describe(
      `\`date\` alanının Europe/Istanbul günü için ${edge} (\`YYYY-MM-DD\`, dahil). Gün (\`YYYY-MM-DD\`) veya an (ISO UTC) değerli kayıtlar eşlenir`,
    )

export const collectionListQuerySchema = pageQuerySchema
  .extend({
    q: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .optional()
      .describe('Serbest arama; Türkçe büyük/küçük harf ve aksan duyarsız'),
    sort: z
      .string()
      .regex(SORT_PATTERN)
      .optional()
      .describe(
        `En çok üç alan, virgülle; eksi azalan (ör. \`-createdAt,name\`). Alanlar: ${SORT_FIELDS.join(', ')}. Verilmezse deponun sırası`,
      ),
    archived: z
      .enum(ARCHIVED_MODES)
      .optional()
      .describe('Arşivliler varsayılan olarak dönmez; `include` ekler, `only` yalnız onları verir'),
    isActive: z
      .enum(['true', 'false'])
      .optional()
      .describe(
        'Etkinlik süzgeci (kampüs, sınıf, kadro arşivi `isActive: false` yapar): `true` etkin kayıtlar (alanı olmayan kayıt etkindir), `false` arşivdekiler. Verilmezse ikisi birlikte döner. Sistem arşivi (`archived`) ayrıdır',
      ),
    dateFrom: dayValue('başlangıç'),
    dateTo: dayValue('bitiş'),
    ...filterShape,
  })
  .strict()
  .refine((query) => !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo, {
    path: ['dateTo'],
    message: 'Bitiş günü başlangıç gününden önce olamaz.',
  })

export const collectionRecordQuerySchema = z
  .object({
    archived: z
      .enum(['include'])
      .optional()
      .describe('Arşivlenmiş kayıt varsayılan olarak 404; `include` ile döner'),
  })
  .strict()

export const collectionItemSchema = z
  .object({
    id: z.string().describe('Kayıt kimliği'),
    version: z
      .number()
      .int()
      .min(1)
      .describe('Kayıt sürümü; sonraki yazmada iyimser kilit için geri gönderilir'),
    createdAt: z.iso.datetime().describe('Kaydın sunucuda oluştuğu an (UTC; kayıt kolonu)'),
    updatedAt: z.iso.datetime().describe('Kaydın sunucuda son değiştiği an (UTC; kayıt kolonu)'),
    archivedAt: z.iso.datetime().nullable().describe('Arşivlendiği an; arşivde değilse `null`'),
    record: z
      .record(z.string(), z.unknown())
      .describe(
        'school-core kaydı; rolün göremediği alanlar çıkarılmıştır. İçindeki `createdAt`/`updatedAt` core iş alanıdır, sistem zamanı üst alanlardır',
      ),
  })
  .meta({ id: 'CollectionItem' })

export const collectionListResponseSchema = pageResponse(collectionItemSchema)
export const collectionItemResponseSchema = dataResponse(collectionItemSchema)
