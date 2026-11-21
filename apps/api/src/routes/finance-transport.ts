import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_TRANSPORT_FAMILY_ROLES,
  FINANCE_TRANSPORT_ROLES,
  transportAssignSchema,
  transportRouteCreateSchema,
  transportRouteUpdateSchema,
  transportVehicleCreateSchema,
  transportVehicleUpdateSchema,
} from '@kampus/school-core/lib/finance-transport.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveRouteCommand,
  assertSchoolLifeModule,
  archiveVehicleCommand,
  assignStudentCommand,
  createRouteCommand,
  createVehicleCommand,
  getRouteFor,
  listMyTransportFor,
  listRoutesFor,
  listVehiclesFor,
  removeAssignmentCommand,
  updateRouteCommand,
  updateVehicleCommand,
} from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  archivedResponse,
  assignmentParams,
  assignmentResponse,
  myTransportResponse,
  routeListQuery,
  routeListResponse,
  routeParams,
  routeResponse,
  vehicleListQuery,
  vehicleListResponse,
  vehicleParams,
  vehicleResponse,
} from './finance-transport.schemas.ts'

/**
 * Servis güzergâhı uçları (docs/domain/finans.md DOM-FIN-142; ON-098; IST-099). Modül
 * `finance` ve okul yaşamıyla ortak `transport` anahtarı; araç, güzergâh ve atama yönetici ve ön büroya açık
 * (K-482); veli ve öğrenci yalnız `GET …/transport/my` ile kendi (çocuğunun) servisini okur. Sıra:
 * 401 → 403 modül → 403 rol → `If-Match` → 400 → işlem. Oluşturma ve atama `Idempotency-Key`,
 * düzenleme, arşiv ve atama kaldırma `If-Match` ister. Sürücü telefonu yanıtlarda maskelidir.
 */

const STAFF =
  'Rol: `yonetici`, `onburo` (K-482); diğer roller 403. Modüller `finance` ve `transport` (kapalıysa 403).'
const BASE = '/api/v1/finance/transport'
const VEHICLES = `${BASE}/vehicles`
const ROUTES = `${BASE}/routes`

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

export function registerFinanceTransportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolLife: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'transport')
  const staff = [
    app.authenticate,
    app.requireModule('finance'),
    schoolLife,
    app.requireRole(FINANCE_TRANSPORT_ROLES),
  ]
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-transport']

  typed.get(
    `${BASE}/my`,
    {
      preValidation: [
        app.authenticate,
        app.requireModule('finance'),
        schoolLife,
        app.requireRole(FINANCE_TRANSPORT_FAMILY_ROLES),
      ],
      schema: {
        operationId: 'listMyTransport',
        tags,
        summary: 'Kendi (çocuğumun) servisi',
        description:
          'Velinin bağlı çocuklarının ya da öğrencinin kendi etkin servis atamaları: yön, güzergâh, durak ve saat, araç plakası, sürücü adı ve maskeli telefonu, rehber personel (K-482). Kapsam sunucuda core `transportAssignments` kuralıyla daralır; başka öğrencinin ataması dönmez. Sayfalama yoktur (çocuk başına en çok iki satır). Rol: `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `transport`.',
        response: { 200: myTransportResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyTransportFor(contextOf(request)) }),
  )

  // --- Araç --------------------------------------------------------------------------------------

  typed.get(
    VEHICLES,
    {
      preValidation: staff,
      schema: {
        operationId: 'listTransportVehicles',
        tags,
        summary: 'Servis araçları',
        description: `Arşivlenmemiş araçlar plakaya göre; sürücü telefonu maskeli (K-481), rehber adı, etkin güzergâh sayısı ve en yüksek güzergâh doluluğu. \`q\` plakada arar. ${STAFF}`,
        querystring: vehicleListQuery,
        response: { 200: vehicleListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listVehiclesFor(contextOf(request), { page, pageSize, q })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    VEHICLES,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTransportVehicle',
        tags,
        summary: 'Servis aracı ekle',
        description: `Plaka (kurumda tekil; 409 \`transport_plate_taken\`), kapasite (1–80), sürücü adı ve telefonu (yalnız yazılır, yanıtta maskeli), isteğe bağlı rehber personel (kurumun etkin personeli; 422 \`transport_guide_not_found\`, \`transport_guide_not_staff\`, \`transport_guide_inactive\`) (K-481). Denetim \`finance.transport.vehicle_create\` (alan adları). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: createHeaders,
        body: transportVehicleCreateSchema,
        response: { 201: vehicleResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createVehicleCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return vehicleResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${VEHICLES}/:vehicleId`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTransportVehicle',
        tags,
        summary: 'Servis aracını düzenle',
        description: `Gönderilen alanlar değişir; telefon gönderilmezse korunur. Kapasite aracın güzergâhlarındaki atanmış öğrenci sayısının altına inemez (422 \`transport_capacity_below_load\`); değişiklik yoksa 422 \`transport_vehicle_unchanged\` (K-481, K-482). Başka kurumun aracı 404. \`If-Match\` zorunlu. ${STAFF}`,
        headers: versionHeaders,
        params: vehicleParams,
        body: transportVehicleUpdateSchema,
        response: { 200: vehicleResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateVehicleCommand(
        contextOf(request),
        request.params.vehicleId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return vehicleResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${VEHICLES}/:vehicleId`,
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'archiveTransportVehicle',
        tags,
        summary: 'Servis aracını arşivle',
        description: `Etkin güzergâhta kullanılan araç arşivlenmez (422 \`transport_vehicle_in_use\`; K-482). Başka kurumun aracı 404. \`If-Match\` zorunlu. ${STAFF}`,
        headers: versionHeaders,
        params: vehicleParams,
        response: { 200: archivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveVehicleCommand(
        contextOf(request),
        request.params.vehicleId,
        expectedVersion,
        idempotency,
      )
      return archivedResponse.parse(sendBody(reply, result))
    },
  )

  // --- Güzergâh ----------------------------------------------------------------------------------

  typed.get(
    ROUTES,
    {
      preValidation: staff,
      schema: {
        operationId: 'listTransportRoutes',
        tags,
        summary: 'Servis güzergâhları',
        description: `Arşivlenmemiş güzergâhlar yön ve ada göre; araç plakası, kapasite, doluluk, durak sayısı ve ilk/son durak saati. Süzgeç \`direction\`, \`vehicleId\`; \`q\` adda arar. ${STAFF}`,
        querystring: routeListQuery,
        response: { 200: routeListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, direction, vehicleId } = request.query
      const { items, total } = await listRoutesFor(contextOf(request), {
        page,
        pageSize,
        q,
        direction,
        vehicleId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    ROUTES,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTransportRoute',
        tags,
        summary: 'Servis güzergâhı aç',
        description: `Ad (aynı yönde tekil; 409 \`transport_route_name_taken\`), yön (sabah/akşam; sonradan değişmez), araç (kurumda yoksa 422 \`transport_vehicle_not_found\`) ve sıralı duraklar (1–40; durak adı ya da semt ve SS:DD saat, saatler sırayla ilerler; açık adres alınmaz) (K-481). \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: createHeaders,
        body: transportRouteCreateSchema,
        response: { 201: routeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createRouteCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = routeResponse.parse(sendBody(reply, result))
      reply.header('location', `${ROUTES}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${ROUTES}/:routeId`,
    {
      preValidation: staff,
      schema: {
        operationId: 'getTransportRoute',
        tags,
        summary: 'Servis güzergâhı ayrıntısı',
        description: `Duraklar (sıra, ad, saat, atanmış sayı), etkin atamalar (öğrenci, durak) ve aracın sürücü adı, maskeli telefonu ve rehberi. Başka kurumun ya da arşivli güzergâh 404. ${STAFF}`,
        params: routeParams,
        response: { 200: routeResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getRouteFor(contextOf(request), request.params.routeId) }),
  )

  typed.patch(
    `${ROUTES}/:routeId`,
    {
      preValidation: [...staff, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTransportRoute',
        tags,
        summary: 'Servis güzergâhını düzenle',
        description: `Ad, araç ve bütün durak listesi (var olan durak \`id\` ile korunur; listede olmayan kaldırılır). Yön değişmez. Yeni aracın kapasitesi güzergâhtaki öğrenci sayısından az 422 \`transport_capacity_below_load\`; kaldırılan durakta atanmış öğrenci 422 \`transport_stop_has_students\`; başka güzergâhın durağı 422 \`transport_stop_not_found\` (K-481, K-482). \`If-Match\` zorunlu. ${STAFF}`,
        headers: versionHeaders,
        params: routeParams,
        body: transportRouteUpdateSchema,
        response: { 200: routeResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateRouteCommand(
        contextOf(request),
        request.params.routeId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return routeResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${ROUTES}/:routeId`,
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'archiveTransportRoute',
        tags,
        summary: 'Servis güzergâhını arşivle',
        description: `Atanmış öğrencisi olan güzergâh arşivlenmez (422 \`transport_route_has_students\`; K-482); durakları güzergâhla birlikte arşivlenir. \`If-Match\` zorunlu. ${STAFF}`,
        headers: versionHeaders,
        params: routeParams,
        response: { 200: archivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveRouteCommand(
        contextOf(request),
        request.params.routeId,
        expectedVersion,
        idempotency,
      )
      return archivedResponse.parse(sendBody(reply, result))
    },
  )

  // --- Atama -------------------------------------------------------------------------------------

  typed.post(
    `${ROUTES}/:routeId/assignments`,
    {
      preValidation: [...staff, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'assignTransportStudent',
        tags,
        summary: 'Öğrenciyi durağa ata',
        description: `Öğrenci (kurumda yok 422 \`transport_student_not_found\`, etkin değil \`transport_student_inactive\`) güzergâhın bir durağına (yoksa 422 \`transport_stop_not_on_route\`) atanır. Aynı güzergâha ikinci atama 409 \`transport_student_already_assigned\`, aynı yönde başka güzergâh 409 \`transport_student_direction_taken\`, araç kapasitesi dolu 409 \`transport_capacity_full\` (K-482); eşzamanlı atamalar kurum kilidiyle sıraya girer. Başka kurumun güzergâhı 404. \`Idempotency-Key\` zorunlu. ${STAFF}`,
        headers: createHeaders,
        params: routeParams,
        body: transportAssignSchema,
        response: { 201: assignmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await assignStudentCommand(
        contextOf(request),
        request.params.routeId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return assignmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${BASE}/assignments/:assignmentId`,
    {
      preValidation: [...staff, requireIfMatch()],
      schema: {
        operationId: 'removeTransportAssignment',
        tags,
        summary: 'Servis atamasını kaldır',
        description: `Atama arşivlenir; öğrenci aynı yönde yeniden atanabilir (K-482). Başka kurumun ataması 404. \`If-Match\` atamanın sürümüdür. ${STAFF}`,
        headers: versionHeaders,
        params: assignmentParams,
        response: { 200: archivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await removeAssignmentCommand(
        contextOf(request),
        request.params.assignmentId,
        expectedVersion,
        idempotency,
      )
      return archivedResponse.parse(sendBody(reply, result))
    },
  )
}
