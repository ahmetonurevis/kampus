import { z } from 'zod'

import { INVOICE_STATUS_LABELS } from '../db/records.ts'
import { READABLE_COLLECTIONS } from '../services/collection-access.ts'
import {
  ARCHIVED_MODES,
  DATE_FIELD_NAMES,
  FILTER_FIELDS,
  GROUP_FIELDS,
  SORT_FIELDS,
  SUM_FIELDS,
} from '../services/collection-reads.ts'
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

const FILTER_DESCRIPTIONS: Partial<Record<(typeof FILTER_FIELDS)[number], string>> = {
  classId:
    '`classId` eşitlik filtresi; çoklu değer parametre tekrarıyla. Kaydında sınıf olmayan öğrenci koleksiyonlarında (`grades`, `absences`, `submissions`, `quizAttempts`, `mockResults`, `studentGoals`) öğrencinin güncel sınıfıdır',
  status: `\`status\` eşitlik filtresi; çoklu değer parametre tekrarıyla. \`invoices\`'ta durum saklanmaz, core \`invoiceStatus\` ile ödeme, vade ve isteğin saatinden (Europe/Istanbul günü) türetilir: ${INVOICE_STATUS_LABELS.map((label) => `\`${label}\``).join(', ')}; başka değer 400`,
}

const filterValue = z
  .union([z.string().min(1).max(200), z.array(z.string().min(1).max(200)).min(1).max(20)])
  .optional()

const filterShape = Object.fromEntries(
  FILTER_FIELDS.map((field) => [
    field,
    filterValue.describe(
      FILTER_DESCRIPTIONS[field] ??
        `\`${field}\` eşitlik filtresi; çoklu değer parametre tekrarıyla`,
    ),
  ]),
) as Record<(typeof FILTER_FIELDS)[number], typeof filterValue>

const dayValue = (edge: string) =>
  z.iso
    .date()
    .optional()
    .describe(
      `Tarih alanının (\`dateField\`; varsayılan koleksiyonun ilk alanı, çoğunlukla \`date\`) Europe/Istanbul günü için ${edge} (\`YYYY-MM-DD\`, dahil). Gün (\`YYYY-MM-DD\`) veya an (ISO UTC) değerli kayıtlar eşlenir`,
    )

/** Liste ve sayım uçlarının ortak süzgeçleri. */
const readQueryShape = {
  q: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .optional()
    .describe(
      'Serbest arama; Türkçe büyük/küçük harf ve aksan duyarsız. Kaydın görünen alanlarında ve bağlı adlarda arar: `classes`ta kampüs adı; `invoices`, `grades`, `attendance`ta öğrenci adı, okul numarası ve sınıf adı (yalnız aktörün okuyabildiği bağlı kayıtlar)',
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
  dateField: z
    .enum(DATE_FIELD_NAMES)
    .optional()
    .describe(
      'Gün aralığının (`dateFrom`/`dateTo`) tarih alanı; koleksiyon başına izin listesi, dışındaki alan 400. Varsayılan listenin ilk alanıdır: `invoices` `dueDate` (`paidAt`; ödenmemiş taksit eşleşmez), `homework`/`studyTasks` `dueDate`/`createdAt`, `studentGoals` `deadline`/`reviewedAt`/`createdAt`, `schoolEvents` `date`/`endDate`/`consentDeadline`/`createdAt`, `students` `joinedAt`, `submissions` `submittedAt`, `prospects` `createdAt`/`trialAt`, `questions` `createdAt`/`answeredAt`, `guidanceCases` `followUp`/`createdAt`, `mockExams` `date`/`createdAt`, `quizzes`/`materials`/`mockResults` `createdAt`; diğer koleksiyonlarda `date`. Aralık yoksa etkisizdir',
    ),
  dateFrom: dayValue('başlangıç'),
  dateTo: dayValue('bitiş'),
  ...filterShape,
}

const dayOrder = (query: { dateFrom?: string | undefined; dateTo?: string | undefined }) =>
  !query.dateFrom || !query.dateTo || query.dateFrom <= query.dateTo
const dayOrderIssue = { path: ['dateTo'], message: 'Bitiş günü başlangıç gününden önce olamaz.' }

export const collectionListQuerySchema = pageQuerySchema
  .extend({
    ...readQueryShape,
    sort: z
      .string()
      .regex(SORT_PATTERN)
      .optional()
      .describe(
        `En çok üç alan, virgülle; eksi azalan (ör. \`-createdAt,name\`). Alanlar: ${SORT_FIELDS.join(', ')}. Bağlı alanlar yalnız tanımlı listede: \`branchName\` \`classes\`; \`studentName\`, \`studentNumber\`, \`className\` \`invoices\`, \`grades\`, \`attendance\` (başka listede 400). \`invoices\` \`status\`u türetilmiş durumdur. Verilmezse deponun sırası`,
      ),
  })
  .strict()
  .refine(dayOrder, dayOrderIssue)

export const collectionCountsQuerySchema = z
  .object({
    ...readQueryShape,
    groupBy: z
      .enum(GROUP_FIELDS)
      .describe(
        'Gruplama alanı (zorunlu). Rolün göremediği alan 400. `isActive` alanı olmayan kayıt `true`; `invoices` `status`u türetilmiş durumdur; kaydında sınıf olmayan öğrenci koleksiyonlarında `classId` öğrencinin güncel sınıfıdır',
      ),
    sum: z
      .enum(SUM_FIELDS)
      .optional()
      .describe(
        'Grup başına toplanacak sayısal alan; sayı olmayan değer toplama girmez. `amount` kuruştur. Rolün göremediği alan 400',
      ),
  })
  .strict()
  .refine(dayOrder, dayOrderIssue)

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

export const collectionCountGroupSchema = z
  .object({
    value: z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe(
        'Grup değeri; alanı olmayan veya skaler olmayan değerli kayıtlar `null` grubundadır',
      ),
    count: z.number().int().min(0).describe('Gruptaki kayıt sayısı'),
    sum: z
      .number()
      .optional()
      .describe('Yalnız `sum` istendiğinde: gruptaki değerlerin toplamı (`amount` kuruş)'),
  })
  .meta({ id: 'CollectionCountGroup' })

export const collectionCountsResponseSchema = z.object({
  data: z.array(collectionCountGroupSchema).describe('Gruplar, değere göre sıralı; `null` sonda'),
  meta: z
    .object({
      total: z.number().int().min(0).describe('Süzgeçten geçen toplam kayıt sayısı'),
      sum: z.number().optional().describe('Yalnız `sum` istendiğinde: bütün grupların toplamı'),
    })
    .meta({ id: 'CollectionCountsMeta' }),
})
