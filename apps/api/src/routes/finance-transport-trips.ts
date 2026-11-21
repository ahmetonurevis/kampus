import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_TRANSPORT_TRIP_FAMILY_ROLES,
  FINANCE_TRANSPORT_TRIP_ROLES,
  transportTripCloseSchema,
  transportTripMarkSchema,
  transportTripStartSchema,
} from '@kampus/school-core/lib/finance-transport-trips.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import {
  closeTripCommand,
  getTripFor,
  listMyTripsFor,
  listTripsFor,
  markTripCommand,
  startTripCommand,
} from '../services/finance-transport-trips.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  myTripsResponse,
  tripDayListResponse,
  tripDayQuery,
  tripParams,
  tripResponse,
  tripRouteParams,
} from './finance-transport-trips.schemas.ts'

/**
 * Servis seferi ve biniş-iniş uçları (docs/domain/finans.md DOM-FIN-149; ON-145; IST-144). Modül
 * `finance` ve `transport`. Rol yönetici, öğretmen ve ön büro; kapsam rehberliğe göre serviste
 * daralır (K-502): yönetici her seferi yürütür, rehber personel yalnız kendi güzergâhını, ön büro
 * her seferi okur, öğretmen yalnız rehberi olduğu güzergâhı görür (başkası 404). Veli ve öğrenci
 * `GET …/trips/my` ile bugünkü durumu okur. Sıra: 401 → 403 modül → 403 rol → başlık → 400 →
 * işlem. Başlatma ve işaret `Idempotency-Key`, kapatma `If-Match` ister. Konum alınmaz.
 */

const ROLES =
  'Rol: `yonetici`, `ogretmen`, `onburo`; seferi yönetici ve güzergâhın rehber personeli yürütür, ön büro bütün seferleri okur, öğretmen yalnız rehberi olduğu güzergâhı görür (K-502); diğer roller 403. Modüller `finance` ve `transport` (kapalıysa 403).'
const BASE = '/api/v1/finance/transport'
const TRIPS = `${BASE}/trips`

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceTransportTripRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolLife: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'transport')
  const staff = [
    app.authenticate,
    app.requireModule('finance'),
    schoolLife,
    app.requireRole(FINANCE_TRANSPORT_TRIP_ROLES),
  ]
  const tags = ['finance-transport']

  typed.get(
    `${TRIPS}/my`,
    {
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        schoolLife,
        app.requireRole(FINANCE_TRANSPORT_TRIP_FAMILY_ROLES),
      ],
      schema: {
        operationId: 'listMyTransportTrips',
        tags,
        summary: 'Çocuğumun bugünkü servis biniş-inişi',
        description:
          'Velinin bağlı çocuklarının ya da öğrencinin kendi bugünkü (Europe/Istanbul) servis durumu, yön başına bir satır: güzergâh, durak, sefer durumu (`not_started`, `open`, `closed`), işaret (`pending`, `boarded`, `alighted`, `absent`) ve biniş/iniş anı (K-502). Kapsam sunucuda core `transportAssignments` kuralıyla daralır. Bildirim göndermez. Rol: `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `transport`.',
        response: { 200: myTripsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyTripsFor(contextOf(request)) }),
  )

  typed.get(
    TRIPS,
    {
      preValidation: staff,
      schema: {
        operationId: 'listTransportTrips',
        tags,
        summary: 'Günlük sefer özeti',
        description: `Rolün görebildiği her güzergâh için günün seferi (başlatılmadıysa \`trip: null\`) ve binen (inen dahil), inen, gelmeyen, araçta (binip inişi işaretlenmemiş) ve işaretlenmemiş sayıları; o gün seferi olan arşivli güzergâh da listelenir. \`date\` verilmezse bugün (Europe/Istanbul); \`direction\` süzer. Yön ve ada göre sıralı. ${ROLES}`,
        querystring: tripDayQuery,
        response: { 200: tripDayListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize, direction } = request.query
      const date = request.query.date ?? dayKey(ctx.now)
      const { items, total } = await listTripsFor(ctx, { date, direction, page, pageSize })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    `${TRIPS}/:tripId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getTransportTrip',
        tags,
        summary: 'Sefer ve işaretleme listesi',
        description: `Seferin öğrencileri durak sırasıyla: açık seferde güzergâha atanmış öğrenciler ve işaretler, kapanmış seferde kapanıştaki işaretler (K-503). Her satırda durum, biniş ve iniş anı, son düzeltmenin anı (gerekçe yalnız yöneticiye). \`canOperate\` ve \`canCorrect\` kullanıcının bu seferdeki yetkisidir. Başka kurumun ya da görülemeyen güzergâhın seferi 404. ${ROLES}`,
        params: tripParams,
        response: { 200: tripResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getTripFor(contextOf(request), request.params.tripId) }),
  )

  typed.post(
    `${BASE}/routes/:routeId/trips`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'startTransportTrip',
        tags,
        summary: 'Seferi başlat',
        description: `Güzergâhın bugünkü (Europe/Istanbul) seferini güzergâhın yönü ve bugünkü aracıyla açar. Aynı güzergâhın aynı gün ve yönde ikinci seferi 409 \`transport_trip_exists\`; rehberi olmadığı güzergâhta ön büro 403 \`transport_trip_not_guide\` (K-502). Gövde boş nesnedir. Denetim \`finance.transport.trip_start\`. \`Idempotency-Key\` zorunlu. Başarı 201. ${ROLES}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: tripRouteParams,
        body: transportTripStartSchema,
        response: { 201: tripResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await startTripCommand(
        contextOf(request),
        request.params.routeId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = tripResponse.parse(sendBody(reply, result))
      reply.header('location', `${TRIPS}/${body.data.id}`)
      return body
    },
  )

  typed.post(
    `${TRIPS}/:tripId/marks`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'markTransportTrip',
        tags,
        summary: 'Biniş, iniş ya da gelmedi işaretle',
        description: `Öğrenciyi bindi (\`boarded\`), indi (\`alighted\`; önce biniş, 422 \`transport_mark_not_boarded\`) ya da gelmedi (\`absent\`) işaretler. Yalnız güzergâha atanmış öğrenci (422 \`transport_trip_student_not_on_route\`). Saat verilmezse işaret anıdır; çevrimdışı yeniden denemede cihazın işaret anı gönderilir: seferin gününde olmalı (422 \`transport_mark_other_day\`), ileri olamaz (5 dk pay; 422 \`transport_mark_future\`), iniş binişten önce olamaz (422 \`transport_mark_alight_before_board\`). Aynı işaretin yinelenmesi değişiklik yazmaz. Açık seferde rehber ya da yönetici (403 \`transport_trip_not_guide\`); kapanmış seferi yalnız yönetici gerekçeyle düzeltir (422 \`transport_trip_closed\`, \`transport_mark_reason_required\`, \`transport_trip_closed_on_board\`, \`transport_mark_unchanged\`; K-503). Konum alınmaz. Denetim \`finance.transport.trip_mark\` ya da \`finance.transport.trip_mark_correct\` (alan adları). \`Idempotency-Key\` zorunlu; ardışık işaretler kilitsizdir (\`If-Match\` yok). Yanıt seferin güncel hâlidir. ${ROLES}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        params: tripParams,
        body: transportTripMarkSchema,
        response: { 200: tripResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await markTripCommand(
        contextOf(request),
        request.params.tripId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${TRIPS}/:tripId/close`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'closeTransportTrip',
        tags,
        summary: 'Seferi kapat',
        description: `Binip inişi işaretlenmemiş (araçta kalmış olabilecek) öğrenci varken 422 \`transport_trip_students_on_board\`, işaretlenmemiş öğrenci varken 422 \`transport_trip_unmarked\` (K-504); kapanmış sefer 409 \`transport_trip_already_closed\`. Kapanan sefer yeniden açılmaz; sonraki değişiklik yöneticinin gerekçeli düzeltmesidir. Gövde boş nesnedir. Denetim \`finance.transport.trip_close\`. \`If-Match\` seferin sürümüdür. ${ROLES}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: tripParams,
        body: transportTripCloseSchema,
        response: { 200: tripResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
      const result = await closeTripCommand(
        contextOf(request),
        request.params.tripId,
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return tripResponse.parse(sendBody(reply, result))
    },
  )
}
