import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  clubAttendanceSchema,
  clubCreateSchema,
  clubMemberAddSchema,
  clubUpdateSchema,
  FINANCE_CLUB_ATTENDANCE_ROLES,
  FINANCE_CLUB_FAMILY_ROLES,
  FINANCE_CLUB_MANAGE_ROLES,
  FINANCE_CLUB_READ_ROLES,
} from '@kampus/school-core/lib/finance-clubs.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  addClubMemberCommand,
  archiveClubCommand,
  archiveClubSessionCommand,
  createClubCommand,
  getClubFor,
  getClubSessionFor,
  listClubsFor,
  listMyClubsFor,
  recordClubAttendanceCommand,
  removeClubMemberCommand,
  updateClubCommand,
} from '../services/finance-clubs.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  clubArchivedResponse,
  clubListQuery,
  clubListResponse,
  clubMemberParams,
  clubMemberResponse,
  clubParams,
  clubResponse,
  clubSessionParams,
  clubSessionResponse,
  myClubsResponse,
} from './finance-clubs.schemas.ts'

/**
 * Kulüp uçları (docs/domain/finans.md DOM-FIN-142; ON-098; IST-099; K-483). Modül `finance` ve okul
 * yaşamıyla ortak `clubs` anahtarı. Kulüp ve üyelik yönetici ve ön büroda; öğretmen yalnız sorumlu olduğu
 * kulübü okur ve yoklamasını alır (başka kulüp 404); veli ve öğrenci `GET …/clubs/my` ile kendi
 * (çocuğunun) üyeliğini okur. Oluşturma, üye ekleme ve yoklama `Idempotency-Key`; düzenleme ve
 * arşivler `If-Match` ister.
 */

const MANAGE =
  'Rol: `yonetici`, `onburo`; diğer roller 403. Modüller `finance` ve `clubs` (kapalıysa 403).'
const READ =
  'Rol: `yonetici`, `onburo` bütün kulüpler; `ogretmen` yalnız sorumlu olduğu kulüp (başkası 404); veli ve öğrenci 403. Modüller `finance` ve `clubs`.'
const ATTEND =
  'Rol: `yonetici` ya da kulübün sorumlu `ogretmen`i (başka kulüp 404); ön büro, veli ve öğrenci 403. Modüller `finance` ve `clubs`.'
const BASE = '/api/v1/finance/clubs'
const CLUB = `${BASE}/:clubId`

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

export function registerFinanceClubRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const schoolLife: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'clubs')
  const guarded = (roles: readonly Role[]) => [
    app.authenticate,
    app.requireModule('finance'),
    schoolLife,
    app.requireRole(roles),
  ]
  const manage = guarded(FINANCE_CLUB_MANAGE_ROLES)
  const read = guarded(FINANCE_CLUB_READ_ROLES)
  const attend = guarded(FINANCE_CLUB_ATTENDANCE_ROLES)
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-clubs']

  typed.get(
    `${BASE}/my`,
    {
      preValidation: guarded(FINANCE_CLUB_FAMILY_ROLES),
      schema: {
        operationId: 'listMyClubs',
        tags,
        summary: 'Kendi (çocuğumun) kulüpleri',
        description:
          'Velinin bağlı çocuklarının ya da öğrencinin kendi etkin kulüp üyelikleri: kulüp, gün ve saat, sorumlu öğretmen, işaretlendiği ve geldiği oturum sayısı (K-483). Kapsam sunucuda core `clubMemberships` kuralıyla daralır. Sayfalama yoktur. Rol: `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `clubs`.',
        response: { 200: myClubsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyClubsFor(contextOf(request)) }),
  )

  typed.get(
    BASE,
    {
      preValidation: read,
      schema: {
        operationId: 'listClubs',
        tags,
        summary: 'Kulüpler',
        description: `Arşivlenmemiş kulüpler ada göre; sorumlu öğretmen, kontenjan ve üye sayısı, gün ve saat. \`q\` adda arar. ${READ}`,
        querystring: clubListQuery,
        response: { 200: clubListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listClubsFor(contextOf(request), { page, pageSize, q })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createClub',
        tags,
        summary: 'Kulüp aç',
        description: `Ad (kurumda tekil; 409 \`club_name_taken\`), sorumlu öğretmen (kurumun etkin öğretmeni; 422 \`club_teacher_not_found\`, \`club_teacher_not_teacher\`, \`club_teacher_inactive\`), kontenjan (1–200), haftanın günü ve saat aralığı (K-483). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        body: clubCreateSchema,
        response: { 201: clubResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createClubCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = clubResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    CLUB,
    {
      preValidation: read,
      schema: {
        operationId: 'getClub',
        tags,
        summary: 'Kulüp ayrıntısı',
        description: `Etkin üyeler (devam sayılarıyla) ve etkin oturumlar (durum sayılarıyla). Başka kurumun ya da arşivli kulüp 404. ${READ}`,
        params: clubParams,
        response: { 200: clubResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getClubFor(contextOf(request), request.params.clubId) }),
  )

  typed.patch(
    CLUB,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateClub',
        tags,
        summary: 'Kulübü düzenle',
        description: `Gönderilen alanlar değişir. Kontenjan üye sayısının altına inemez (422 \`club_capacity_below_members\`), bitiş başlangıçtan sonra olmalı (422 \`club_time_order\`), değişiklik yoksa 422 \`club_unchanged\` (K-483). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: clubParams,
        body: clubUpdateSchema,
        response: { 200: clubResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateClubCommand(
        contextOf(request),
        request.params.clubId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return clubResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    CLUB,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'archiveClub',
        tags,
        summary: 'Kulübü arşivle',
        description: `Etkin üyesi olan kulüp arşivlenmez (422 \`club_has_members\`; K-483). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: clubParams,
        response: { 200: clubArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveClubCommand(
        contextOf(request),
        request.params.clubId,
        expectedVersion,
        idempotency,
      )
      return clubArchivedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${CLUB}/members`,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'addClubMember',
        tags,
        summary: 'Kulübe üye ekle',
        description: `Öğrenci (kurumda yok 422 \`club_student_not_found\`, etkin değil \`club_student_inactive\`) kulübe eklenir. Aynı öğrenci ikinci kez 409 \`club_member_exists\`, kontenjan dolu 409 \`club_capacity_full\` (K-483); eşzamanlı eklemeler kurum kilidiyle sıraya girer. \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        params: clubParams,
        body: clubMemberAddSchema,
        response: { 201: clubMemberResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await addClubMemberCommand(
        contextOf(request),
        request.params.clubId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return clubMemberResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${CLUB}/members/:memberId`,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'removeClubMember',
        tags,
        summary: 'Kulüp üyeliğini sonlandır',
        description: `Üyelik arşivlenir; geçmiş yoklama işaretleri kalır. Başka kulübün üyeliği 404. \`If-Match\` üyeliğin sürümüdür. ${MANAGE}`,
        headers: versionHeaders,
        params: clubMemberParams,
        response: { 200: clubArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await removeClubMemberCommand(
        contextOf(request),
        request.params.clubId,
        request.params.memberId,
        expectedVersion,
        idempotency,
      )
      return clubArchivedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${CLUB}/sessions`,
    {
      preValidation: [...attend, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'recordClubAttendance',
        tags,
        summary: 'Kulüp yoklaması al',
        description: `Oturum günü (bugünden sonra 422 \`club_session_future\`) ve bütün etkin üyelerin durumu (geldi, gelmedi, izinli). Üye yoksa 422 \`club_no_members\`, kulüp dışı üye 422 \`club_attendance_unknown_member\`, eksik işaret 422 \`club_attendance_incomplete\`; aynı günün oturumu 409 \`club_session_exists\` (K-483). \`Idempotency-Key\` zorunlu. ${ATTEND}`,
        headers: createHeaders,
        params: clubParams,
        body: clubAttendanceSchema,
        response: { 201: clubSessionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await recordClubAttendanceCommand(
        contextOf(request),
        request.params.clubId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return clubSessionResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${CLUB}/sessions/:sessionId`,
    {
      preValidation: read,
      schema: {
        operationId: 'getClubSession',
        tags,
        summary: 'Kulüp oturumu',
        description: `Oturumun işaretleri (ayrılmış üyeler dahil), öğrenci adına göre. Başka kulübün ya da arşivli oturum 404. ${READ}`,
        params: clubSessionParams,
        response: { 200: clubSessionResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getClubSessionFor(
        contextOf(request),
        request.params.clubId,
        request.params.sessionId,
      ),
    }),
  )

  typed.delete(
    `${CLUB}/sessions/:sessionId`,
    {
      preValidation: [...attend, requireIfMatch()],
      schema: {
        operationId: 'archiveClubSession',
        tags,
        summary: 'Kulüp oturumunu arşivle',
        description: `Yanlış alınan oturum arşivlenir; aynı gün yeniden alınabilir (K-483). \`If-Match\` oturumun sürümüdür. ${ATTEND}`,
        headers: versionHeaders,
        params: clubSessionParams,
        response: { 200: clubArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveClubSessionCommand(
        contextOf(request),
        request.params.clubId,
        request.params.sessionId,
        expectedVersion,
        idempotency,
      )
      return clubArchivedResponse.parse(sendBody(reply, result))
    },
  )
}
