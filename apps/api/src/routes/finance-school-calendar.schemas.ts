import { z } from 'zod'

import { daySchema } from '@kampus/school-core/lib/domain.ts'
import {
  calendarRangeIssue,
  SCHOOL_CALENDAR_LINK_SOURCES,
  SCHOOL_CALENDAR_LIST_RANGE_MAX_DAYS,
  SCHOOL_CALENDAR_RANGE_MAX_DAYS,
  SCHOOL_EVENT_AUDIENCES,
  SCHOOL_EVENT_KINDS,
  SCHOOL_EVENT_STATUSES,
} from '@kampus/school-core/lib/finance-school-calendar.ts'

import { dataResponse, pageMetaSchema, pageQuerySchema } from './common.schemas.ts'

/** Okul etkinlik takvimi şemaları (DOM-FIN-163; ON-090; IST-099; K-544…K-546). */

const eventBase = {
  id: z.string(),
  title: z.string(),
  kind: z.enum(SCHOOL_EVENT_KINDS),
  allDay: z.boolean(),
  startDate: z.string().describe('Başlangıç günü (YYYY-MM-DD, Europe/Istanbul)'),
  endDate: z.string().describe('Bitiş günü (YYYY-MM-DD, dahil)'),
  startTime: z.string().nullable().describe('Başlangıç saati (SS:DD); tüm günde `null`'),
  endTime: z.string().nullable().describe('Bitiş saati (SS:DD); tüm günde `null`'),
  startsAt: z.string().describe('Başlangıç anı (ISO 8601 UTC; tüm günde ilk günün gece yarısı)'),
  endsAt: z
    .string()
    .describe('Bitiş anı (ISO 8601 UTC; tüm günde son günden sonraki günün gece yarısı, hariç)'),
  location: z.string().nullable(),
  // kvkk: K — serbest metin; loglanmaz, denetime yazılmaz.
  description: z.string().nullable(),
  audienceKind: z.enum(SCHOOL_EVENT_AUDIENCES).describe('Hedef kitle türü'),
  // kvkk: K — serbest metin; hedef kitle de görür.
  cancelReason: z.string().nullable().describe('İptal gerekçesi; iptal edilmediyse `null`'),
}

export const schoolEventSchema = z.object({
  ...eventBase,
  audienceIds: z.array(z.string()).describe('Hedef kimlikleri (kademe, sınıf ya da grup)'),
  audienceLabels: z
    .array(z.string())
    .describe('Hedeflerin adları ("7. sınıf", "7-A", grup adı), `audienceIds` sırasıyla'),
  status: z.enum(SCHOOL_EVENT_STATUSES).describe('`draft` taslak, `published`, `cancelled`'),
  publishedAt: z.string().nullable().describe('Yayım anı (ISO 8601)'),
  cancelledAt: z.string().nullable().describe('İptal anı (ISO 8601)'),
  updatedAt: z.string().describe('Son değişiklik anı (ISO 8601)'),
  version: z.number().int().describe('`If-Match` için kayıt sürümü'),
})

const viewerEventSchema = z.object({
  ...eventBase,
  status: z
    .enum(['published', 'cancelled'])
    .describe('Yayımlanmış ya da yayımlandıktan sonra iptal edilmiş'),
})

const linkSchema = z
  .object({
    source: z
      .enum(SCHOOL_CALENDAR_LINK_SOURCES)
      .describe('`trip_plan` gezi planı (DOM-FIN-111), `ticketed_event` biletli etkinlik'),
    sourceId: z.string().describe('Bağlı kaydın kimliği (gezi planı ya da biletli etkinlik)'),
    reference: z.string().nullable().describe('Gezi plan numarası (`GZ-3`); bilette `null`'),
    title: z.string(),
    startsAt: z.string().describe('Çıkış ya da başlangıç anı (ISO 8601)'),
    endsAt: z.string().nullable().describe('Dönüş anı (ISO 8601); biletli etkinlikte `null`'),
    location: z.string().nullable().describe('Salon (biletli etkinlik); gezide `null`'),
  })
  .describe('Takvime bağlantı olarak eklenen kayıt; kopya değildir, kendi ekranında yönetilir')

export const schoolEventResponse = dataResponse(schoolEventSchema)
export const schoolEventListResponse = z.object({
  data: z.array(schoolEventSchema),
  meta: pageMetaSchema,
})
export const schoolCalendarResponse = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    events: z.array(schoolEventSchema).describe('Aralığa değen etkinlikler, başlangıç sırasıyla'),
    links: z.array(linkSchema).describe('Aralıktaki gezi planları ve biletli etkinlikler'),
  }),
)
export const mySchoolCalendarResponse = dataResponse(
  z.object({
    from: z.string(),
    to: z.string(),
    events: z
      .array(viewerEventSchema)
      .describe('Kapsamdaki yayımlanmış etkinlikler; taslak görünmez'),
    links: z
      .array(linkSchema)
      .describe('Öğrencinin gezi günü grubunda olduğu ya da bileti olan kayıtlar'),
  }),
)

const rangeShape = (maxDays: number) => ({
  from: daySchema.describe('İlk gün (YYYY-MM-DD, dahil)'),
  to: daySchema.describe(`Son gün (YYYY-MM-DD, dahil); aralık en çok ${String(maxDays)} gün`),
})

const rangeCheck =
  (maxDays: number) => (value: { from: string; to: string }, context: z.RefinementCtx) => {
    const issue = calendarRangeIssue(value.from, value.to, maxDays)
    if (issue !== null) context.addIssue({ code: 'custom', path: ['to'], message: issue })
  }

const filterShape = {
  kind: z.enum(SCHOOL_EVENT_KINDS).optional().describe('Tür süzgeci'),
  status: z.enum(SCHOOL_EVENT_STATUSES).optional().describe('Durum süzgeci'),
  audienceKind: z.enum(SCHOOL_EVENT_AUDIENCES).optional().describe('Hedef kitle türü süzgeci'),
  q: z.string().trim().min(1).max(100).optional().describe('Başlıkta arama'),
}

export const schoolCalendarQuery = z
  .strictObject({ ...rangeShape(SCHOOL_CALENDAR_RANGE_MAX_DAYS), ...filterShape })
  .superRefine(rangeCheck(SCHOOL_CALENDAR_RANGE_MAX_DAYS))
export const schoolEventListQuery = z
  .strictObject({
    ...rangeShape(SCHOOL_CALENDAR_LIST_RANGE_MAX_DAYS),
    ...pageQuerySchema.shape,
    ...filterShape,
  })
  .superRefine(rangeCheck(SCHOOL_CALENDAR_LIST_RANGE_MAX_DAYS))
export const mySchoolCalendarQuery = z
  .strictObject(rangeShape(SCHOOL_CALENDAR_RANGE_MAX_DAYS))
  .superRefine(rangeCheck(SCHOOL_CALENDAR_RANGE_MAX_DAYS))
export const schoolCalendarIcsQuery = z
  .strictObject(rangeShape(SCHOOL_CALENDAR_LIST_RANGE_MAX_DAYS))
  .superRefine(rangeCheck(SCHOOL_CALENDAR_LIST_RANGE_MAX_DAYS))

export const schoolEventParams = z.object({ eventId: z.uuid('Etkinlik geçersiz.') })
