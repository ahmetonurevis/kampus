import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  SCHOOL_CALENDAR_ICAL_ROLES,
  SCHOOL_CALENDAR_MANAGE_ROLES,
  SCHOOL_CALENDAR_VIEWER_ROLES,
  schoolEventCancelSchema,
  schoolEventCreateSchema,
  schoolEventUpdateSchema,
} from '@kampus/school-core/lib/finance-school-calendar.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelSchoolEventCommand,
  createSchoolEventCommand,
  getSchoolEventFor,
  listSchoolEventsFor,
  mySchoolCalendarFor,
  publishSchoolEventCommand,
  schoolCalendarFor,
  schoolCalendarIcsFor,
  updateSchoolEventCommand,
} from '../services/finance-school-calendar.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  mySchoolCalendarQuery,
  mySchoolCalendarResponse,
  schoolCalendarIcsQuery,
  schoolCalendarQuery,
  schoolCalendarResponse,
  schoolEventListQuery,
  schoolEventListResponse,
  schoolEventParams,
  schoolEventResponse,
} from './finance-school-calendar.schemas.ts'

/**
 * Okul etkinlik takvimi uçları (docs/domain/finans.md DOM-FIN-163; ON-090; IST-099; K-544…K-546).
 * Modül `finance` ve okul yaşamıyla ortak `calendar` anahtarı. Etkinlik yazma, yayım ve iptal
 * yönetici ve ön büroda; öğretmen, veli ve öğrenci `GET …/school-calendar/my` ile yalnız kendi
 * kapsamının yayımlanmış etkinliklerini okur; iCal dışa aktarımı beş role açıktır. Oluşturma
 * `Idempotency-Key`; düzenleme, yayım ve iptal `If-Match` ister. Silme ucu yoktur.
 */

const MANAGE =
  'Rol: `yonetici`, `onburo`; diğer roller 403. Modüller `finance` ve `calendar` (kapalıysa 403).'
const BASE = '/api/v1/finance/school-calendar'
const EVENTS = `${BASE}/events`
const EVENT = `${EVENTS}/:eventId`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: FastifyRequest) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

const isManager = (role: Role) => (SCHOOL_CALENDAR_MANAGE_ROLES as readonly Role[]).includes(role)

export function registerFinanceSchoolCalendarRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const calendar: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'calendar')
  const guarded = (roles: readonly Role[]) => [
    app.authenticate,
    app.requireModule('finance'),
    calendar,
    app.requireRole(roles),
  ]
  const manage = guarded(SCHOOL_CALENDAR_MANAGE_ROLES)
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-school-calendar']

  typed.get(
    BASE,
    {
      preValidation: manage,
      schema: {
        operationId: 'getSchoolCalendar',
        tags,
        summary: 'Okul takvimi (ay ve hafta görünümü)',
        description: `Aralığa değen bütün etkinlikler (taslak, yayımlanmış, iptal edilmiş; başlangıç günü, tüm gün önce, saat sırasıyla) ve bağlantılar: aralıkta süren onaylı ya da tamamlanmış gezi planları ve aralıkta başlayan biletli etkinlikler (kopya değil, K-546). Aralık en çok 62 gün (ay görünümü 6 hafta); sayfasızdır. Süzgeç tür (gezi seçilince yalnız gezi bağlantıları, diğer türlerde bağlantı yok), durum, hedef kitle türü ve başlık araması. ${MANAGE}`,
        querystring: schoolCalendarQuery,
        response: { 200: schoolCalendarResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await schoolCalendarFor(contextOf(request), request.query) }),
  )

  typed.get(
    `${BASE}/my`,
    {
      preValidation: guarded(SCHOOL_CALENDAR_VIEWER_ROLES),
      schema: {
        operationId: 'getMySchoolCalendar',
        tags,
        summary: 'Kendi okul takvimim (öğretmen, veli, öğrenci)',
        description:
          'Aralığa değen **yayımlanmış** etkinlikler (yayımdan sonra iptal edilenler `cancelled` ve gerekçesiyle); taslak görünmez. Hedef kitle kapsamı sunucuda (K-544): tüm kurum herkese; kademe, sınıf ve grup yalnız velinin bağlı çocuklarının, öğrencinin kendisinin, öğretmenin ders verdiği ve rehberi olduğu sınıfların (ve o sınıfların kademelerinin) ve öğretmeni olduğu grupların. Bağlantılar (K-546): veli ve öğrencide öğrencinin gezi günü grubunda olduğu onaylı gezi planları ve adına etkin bileti olan biletli etkinlikler, öğretmende görevli olduğu gezi planları. Aralık en çok 62 gün. Rol: `ogretmen`, `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `calendar`.',
        querystring: mySchoolCalendarQuery,
        response: { 200: mySchoolCalendarResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await mySchoolCalendarFor(contextOf(request), request.query) }),
  )

  typed.get(
    `${BASE}/ical`,
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
          // Oturum `preValidation`'da çözülür; anahtar kullanıcıya göre olsun diye sonra sayılır.
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            `school-calendar-ical:${request.auth?.userId ?? request.ip}`,
        },
      },
      preValidation: guarded(SCHOOL_CALENDAR_ICAL_ROLES),
      schema: {
        operationId: 'exportSchoolCalendarIcal',
        tags,
        summary: 'Okul takvimini iCal (.ics) olarak indir',
        description:
          'RFC 5545 takvim dosyası (`text/calendar; charset=utf-8`, ek olarak): yönetici ve ön büroda kurumun yayımlanmış etkinlikleri, öğretmen, veli ve öğrencide `GET …/my` ile aynı kapsam; ikisinde de bağlantılar (gezi planı, biletli etkinlik). Taslak dosyaya girmez; yayımdan sonra iptal edilen `STATUS:CANCELLED` ile gider. Tüm gün etkinlik `VALUE=DATE`, saatli etkinlik UTC anıdır. Aralık en çok 366 gün. Dosya oturumla indirilir; kişisel abonelik bağlantısı (belirteçli adres) yoktur. Kullanıcı başına 10/dk. Rol: beş rol. Modüller `finance` ve `calendar`.',
        querystring: schoolCalendarIcsQuery,
        // Gövde `reply.serializer` ile düz metin gider; şema yalnız belgeleme içindir.
        response: { 200: z.string().describe('iCal dosyası (RFC 5545)'), ...commandErrors },
      },
    },
    async (request, reply) => {
      const ctx = contextOf(request)
      const { ics, filename } = await schoolCalendarIcsFor(
        ctx,
        request.query,
        isManager(ctx.actor.role),
      )
      return (reply as FastifyReply)
        .type('text/calendar; charset=utf-8')
        .header('content-disposition', `attachment; filename="${filename}"`)
        .header('cache-control', 'no-store')
        .serializer((payload: unknown) => String(payload))
        .send(ics)
    },
  )

  typed.get(
    EVENTS,
    {
      preValidation: manage,
      schema: {
        operationId: 'listSchoolEvents',
        tags,
        summary: 'Okul takvimi (liste görünümü)',
        description: `Aralığa değen etkinlikler sayfalı (başlangıç sırasıyla); aralık en çok 366 gün. Süzgeç tür, durum, hedef kitle türü ve başlık araması. Bağlantılar bu listede yoktur (ay/hafta görünümündedir). ${MANAGE}`,
        querystring: schoolEventListQuery,
        response: { 200: schoolEventListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listSchoolEventsFor(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    EVENTS,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createSchoolEvent',
        tags,
        summary: 'Etkinlik ekle (taslak)',
        description: `Taslak etkinlik açar (K-544): başlık, tür, tüm gün ya da saatli (iki saat de SS:DD, tek günlükte bitiş başlangıçtan sonra), başlangıç ve bitiş günü (en çok 120 gün), yer, açıklama ve hedef kitle (tüm kurum, kademe 1–12, sınıf ya da dil okulu grubu). Tatil ve sınav haftası tüm gündür (400). Kurumda olmayan sınıf ya da iptal edilmiş/olmayan grup 422 \`school_event_audience_not_found\`. Taslak yalnız yönetici ve ön büroda görünür. \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        body: schoolEventCreateSchema,
        response: { 201: schoolEventResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createSchoolEventCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = schoolEventResponse.parse(sendBody(reply, result))
      reply.header('location', `${EVENTS}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    EVENT,
    {
      preValidation: manage,
      schema: {
        operationId: 'getSchoolEvent',
        tags,
        summary: 'Etkinlik ayrıntısı',
        description: `Etkinlik, hedeflerin adları, durum anları ve sürüm. Başka kurumun etkinliği 404. ${MANAGE}`,
        params: schoolEventParams,
        response: { 200: schoolEventResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getSchoolEventFor(contextOf(request), request.params.eventId),
    }),
  )

  typed.patch(
    EVENT,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateSchoolEvent',
        tags,
        summary: 'Etkinliği düzenle',
        description: `Gönderilen alanlar mevcutla birleşir ve sonuç bütün olarak doğrulanır (ihlal 422 \`school_event_invalid\`, \`issues\` yolu alan adı); hedef değiştiyse sınıf ve grup kurumda olmalı (422 \`school_event_audience_not_found\`). Değişiklik yoksa 422 \`school_event_unchanged\`; iptal edilmiş etkinlik 422 \`school_event_cancelled\`. Yayımlanmış etkinlikte değişiklik hedef kitleye hemen görünür (K-544). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: schoolEventParams,
        body: schoolEventUpdateSchema,
        response: { 200: schoolEventResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateSchoolEventCommand(
        contextOf(request),
        request.params.eventId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return schoolEventResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${EVENT}/publish`,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'publishSchoolEvent',
        tags,
        summary: 'Etkinliği yayımla',
        description: `Taslak etkinlik hedef kitleye açılır. Yayımlanmış 422 \`school_event_not_draft\`, iptal edilmiş 422 \`school_event_cancelled\` (K-544). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: schoolEventParams,
        response: { 200: schoolEventResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await publishSchoolEventCommand(
        contextOf(request),
        request.params.eventId,
        expectedVersion,
        idempotency,
      )
      return schoolEventResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${EVENT}/cancel`,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelSchoolEvent',
        tags,
        summary: 'Etkinliği iptal et',
        description: `Gerekçeli iptal (10–500 karakter); etkinlik silinmez. Yayımlanmışken iptal edilen etkinlik hedef kitleye "İptal edildi" ve gerekçesiyle görünür, taslakken iptal edilen görünmez. İptal edilmiş 422 \`school_event_cancelled\`, bitiş günü geçmiş 422 \`school_event_ended\` (K-544). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: schoolEventParams,
        body: schoolEventCancelSchema,
        response: { 200: schoolEventResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await cancelSchoolEventCommand(
        contextOf(request),
        request.params.eventId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return schoolEventResponse.parse(sendBody(reply, result))
    },
  )
}
