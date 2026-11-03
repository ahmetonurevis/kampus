import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import type { z } from 'zod'

import type { Role } from '../auth.ts'
import { AppError, MESSAGES, NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelCertificate,
  getCourseCertificate,
  getGroupMebbisList,
  issueCertificate,
  listCourseCertificates,
  recordMebbisCertificate,
  verifyCertificate,
} from '../services/certificates.ts'
import { getInstitutionModules } from '../services/modules.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  cancelCertificateBodySchema,
  certificateDetailResponseSchema,
  certificateListQuerySchema,
  certificateListResponseSchema,
  certificateParamsSchema,
  certificateResponseSchema,
  certificateVerificationParamsSchema,
  certificateVerificationResponseSchema,
  groupMebbisResponseSchema,
  issueCertificateBodySchema,
  mebbisDecisionParamsSchema,
  mebbisGroupParamsSchema,
  mebbisRecordBodySchema,
  mebbisRecordResponseSchema,
  verificationErrors,
} from './certificates.schemas.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'

/**
 * Kurum başarı belgesi ve MEBBİS belge izi uçları (OG-088; IST-081; DOM-DIL-080, 081, 082). Modül
 * `academic`; yalnız dil okulunda. Sıra: 401 → 403 modül kapalı → 404 kurum türü (okulda her rol
 * için) → 403 rol → 400 → işlem (404 kayıt/kapsam, 409 sürüm/tekillik, core kuralları 403/409/422).
 * Belgeyi kurum yöneticisi ya da kurun seviyesinin akademik koordinatörü düzenler ve iptal eder
 * (Sabah kararı 85); düz öğretmen 403.
 *
 * Kimliksiz doğrulama ucu (`GET /api/v1/certificate-verifications/:code`) oturumsuz ve modülden
 * bağımsızdır (Sabah kararı 85): düzenlenmiş belge, kurum modülü kapatsa da üçüncü kişiye
 * doğrulanabilmelidir. IP başına dakikada 30 istek; kod 140 bit rastgele olduğu için tahmin
 * edilemez, hız sınırı taramayı ayrıca yavaşlatır. Yoldaki kod loglanmaz (`app.ts` `req`).
 */

const MODULE = 'academic'
const STAFF: readonly Role[] = ['yonetici', 'ogretmen']
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']
const VERIFICATION_RATE_PER_MINUTE = 30
const SCOPE =
  'Modül `academic` (kapalıysa 403 `module_disabled`); yalnız dil okulunda, okulda 404. Grubu okuyamayan öğretmen için kayıt yoktur (404).'
const ISSUER =
  'Yalnız kurum yöneticisi ya da kurun seviyesinin akademik koordinatörü (öğretmen + `academic_coordinator` görevi); diğer öğretmen 403.'
const IDEMPOTENT = '`Idempotency-Key` isteğe bağlı; aynı anahtarla tekrar aynı yanıtı verir.'

function sender<T extends z.ZodType>(schema: T) {
  return (reply: FastifyReply, response: CommandResponse): z.output<T> => {
    if (response.replayed) reply.header('idempotent-replayed', 'true')
    reply.status(response.statusCode)
    return schema.parse(response.body)
  }
}

/** İptalde `If-Match` zorunludur (önceden `requireIfMatch` denetler). */
function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

export function registerCertificateRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** Belge yalnız dil okulundadır (DOM-YTK-012); okulda 404, rol denetiminden önce. */
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }
  const guard = (roles: readonly Role[]) => [
    app.requireModule(MODULE),
    languageSchool,
    app.requireRole(roles),
  ]
  const sendCertificate = sender(certificateResponseSchema)
  const sendMebbis = sender(mebbisRecordResponseSchema)

  typed.post(
    '/api/v1/course-certificates',
    {
      preValidation: [...guard(STAFF), rejectIfMatch()],
      schema: {
        operationId: 'issueCourseCertificate',
        tags: ['learning'],
        summary: 'Kurum başarı belgesi düzenle',
        description: `Kaydın geçerli onaylı \`passed\` kararıyla belge düzenler (DOM-DIL-081, 082); onay bekleyen, tekrar ya da devamsızlık kararı 422. İçerik düzenleme anının kopyasıdır. Numara kurum sayacından \`KB-<yıl>-<sıra>\`, doğrulama kodu rastgeledir. Karar başına tek geçerli belge (409 \`certificate_already_issued\`); hatalı belge iptal edilip \`replacesCertificateId\` ile yeniden düzenlenir. ${ISSUER} Başarı 201. \`Idempotency-Key\` zorunlu (yoksa 400 \`idempotency_key_required\`). ${SCOPE}`,
        body: issueCertificateBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: certificateResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCertificate(
        reply,
        await issueCertificate(contextOf(request), request.body, idempotencyOf(request, true)),
      ),
  )

  typed.post(
    '/api/v1/course-certificates/:certificateId/cancel',
    {
      preValidation: [...guard(STAFF), requireIfMatch()],
      schema: {
        operationId: 'cancelCourseCertificate',
        tags: ['learning'],
        summary: 'Kurum başarı belgesini iptal et',
        description: `Gerekçe zorunlu; belge bir kez iptal edilir (409 \`certificate_already_cancelled\`). Numara ve kod korunur, doğrulama bundan sonra \`cancelled\` döner (DOM-DIL-082). ${ISSUER} \`If-Match\` belgenin satır sürümü (\`rowVersion\`; yoksa 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`). Olmayan ya da başka kurumun belgesi 404. ${IDEMPOTENT} ${SCOPE}`,
        params: certificateParamsSchema,
        body: cancelCertificateBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        response: { 200: certificateResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCertificate(
        reply,
        await cancelCertificate(
          contextOf(request),
          {
            certificateId: request.params.certificateId,
            expectedVersion: requiredVersion(request),
            body: request.body,
          },
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.get(
    '/api/v1/course-certificates',
    {
      preValidation: guard(READERS),
      schema: {
        operationId: 'listCourseCertificates',
        tags: ['learning'],
        summary: 'Kurum başarı belgeleri',
        description: `Yönetici kurumun bütün belgelerini, öğretmen okuyabildiği grupların belgelerini görür. Öğrenci kendisinin, veli 18 yaş altı çocuğunun yalnız geçerli belgelerini görür; iptal izi ve düzenleyen gösterilmez. Ön büro 403. Yeniden eskiye, sayfalı (\`meta.total\`). ${SCOPE}`,
        querystring: certificateListQuerySchema,
        response: { 200: certificateListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const { items, total } = await listCourseCertificates(contextOf(request), request.query)
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/course-certificates/:certificateId',
    {
      preValidation: guard(READERS),
      schema: {
        operationId: 'getCourseCertificate',
        tags: ['learning'],
        summary: 'Kurum başarı belgesi ayrıntısı',
        description: `Kapsam dışı, başka kurumun ya da kursiyer ve veli için iptal edilmiş belge 404. Ön büro 403. ${SCOPE}`,
        params: certificateParamsSchema,
        response: { 200: certificateDetailResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getCourseCertificate(contextOf(request), request.params.certificateId),
    }),
  )

  typed.get(
    '/api/v1/groups/:groupId/mebbis-certificates',
    {
      preValidation: guard(STAFF),
      schema: {
        operationId: 'getGroupMebbisCertificates',
        tags: ['learning'],
        summary: 'Grubun MEBBİS belge listesi',
        description: `Belgeye hak kazanan kursiyerler (geçerli karar onaylı \`passed\`; devamsızlık ve tekrar listeye girmez) ve MEBBİS'te düzenlenen Kurs Bitirme Belgesi izi (DOM-DIL-080). Roller: \`yonetici\`, \`ogretmen\` (grubu okuyabilen); diğer roller 403. Olmayan ya da başka kurumun grubu 404. ${SCOPE}`,
        params: mebbisGroupParamsSchema,
        response: { 200: groupMebbisResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getGroupMebbisList(contextOf(request), request.params.groupId),
    }),
  )

  typed.post(
    '/api/v1/progression-decisions/:decisionId/mebbis-record',
    {
      preValidation: [...guard(STAFF), rejectIfMatch()],
      schema: {
        operationId: 'recordMebbisCertificate',
        tags: ['learning'],
        summary: 'MEBBİS belgesini işaretle',
        description: `Resmî Kurs Bitirme Belgesinin MEBBİS'te düzenlendiğini belge no ve tarihle işaretler; platform resmî belgeyi üretmez (DOM-DIL-080). Yalnız kaydın geçerli onaylı \`passed\` kararı (aksi 422); karar başına bir iz (409 \`mebbis_already_recorded\`); ileri tarih 422. ${ISSUER} Başarı 201. ${IDEMPOTENT} ${SCOPE}`,
        params: mebbisDecisionParamsSchema,
        body: mebbisRecordBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 201: mebbisRecordResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendMebbis(
        reply,
        await recordMebbisCertificate(
          contextOf(request),
          { decisionId: request.params.decisionId, body: request.body },
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.get(
    '/api/v1/certificate-verifications/:code',
    {
      config: {
        rateLimit: { max: VERIFICATION_RATE_PER_MINUTE, timeWindow: '1 minute' },
      },
      schema: {
        operationId: 'verifyCourseCertificate',
        tags: ['learning'],
        summary: 'Kurum başarı belgesini doğrula',
        description: `Kimlik gerektirmez ve modülden bağımsızdır: düzenlenmiş belge modül kapansa da doğrulanır (DOM-DIL-082, Sabah kararı 85). Yanıt yalnız durum (\`valid\` ya da \`cancelled\`), kursiyerin baş harfleri, kur adı, düzenleme günü ve kurum adıdır; belge numarası ve puanlar yoktur. Biçimi bozuk ve bulunamayan kod aynı 404 \`not_found\`. IP başına dakikada ${VERIFICATION_RATE_PER_MINUTE} istek; aşılırsa 429 \`rate_limited\` ve \`Retry-After\`.`,
        params: certificateVerificationParamsSchema,
        response: { 200: certificateVerificationResponseSchema, ...verificationErrors },
      },
    },
    async (request) => ({ data: await verifyCertificate(app.db, request.params.code) }),
  )
}
