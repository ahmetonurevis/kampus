import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import {
  EMERGENCY_SUMMARY_MANAGE_ROLES,
  EMERGENCY_SUMMARY_VIEW_ROLES,
  emergencySummaryCreateSchema,
  emergencySummaryUpdateSchema,
} from '@kampus/school-core/lib/finance-emergency-summaries.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  approveEmergencySummaryCommand,
  archiveEmergencySummaryCommand,
  classEmergencyCardsFor,
  createEmergencySummaryCommand,
  getEmergencySummaryFor,
  listEmergencyClassesFor,
  listEmergencySummariesFor,
  revealEmergencyContactFor,
  studentEmergencyCardFor,
  updateEmergencySummaryCommand,
  type EmergencySummaryDeps,
} from '../services/finance-emergency-summaries.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  emergencyCardQuery,
  emergencyCardResponse,
  emergencyClassCardsResponse,
  emergencyClassListResponse,
  emergencyClassParams,
  emergencyContactParams,
  emergencyContactResponse,
  emergencyStudentParams,
  emergencySummaryArchiveResponse,
  emergencySummaryListQuery,
  emergencySummaryListResponse,
  emergencySummaryParams,
  emergencySummaryResponse,
} from './finance-emergency-summaries.schemas.ts'

/**
 * Acil durum özeti uçları (docs/domain/finans.md DOM-FIN-155; ON-165; K-520…K-522; H-111). Modül
 * `finance`. Özeti yalnız yönetici yazar, onaylar ve arşivler; yayındaki özeti yönetici, ön büro ve
 * öğretmen (sınıf öğretmeni olduğu ve derse girdiği sınıflar) okur. Sağlık ayrıntısı dönen her
 * okuma öğrenci başına denetimdedir. Açma `Idempotency-Key`; düzeltme, onay ve arşiv `If-Match`
 * ister. Tam telefon ayrı açılışla, kullanıcı başına 10/dk.
 */

const MANAGE = 'Rol: yalnız `yonetici`. Modül `finance`.'
const VIEW =
  'Rol: `yonetici` ve `onburo` (bütün sınıflar), `ogretmen` (sınıf öğretmeni olduğu ve derse girdiği sınıflar; başkası 404). Veli ve öğrenci 403. Modül `finance`.'
const BASE = '/api/v1/finance/emergency-summaries'
const REVEALS_PER_MINUTE = 10
const PRINTS_PER_MINUTE = 20

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

const perUser = (prefix: string, max: number) => ({
  rateLimit: {
    max,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) =>
      `${prefix}:${request.auth?.institutionId ?? ''}:${request.auth?.userId ?? request.ip}`,
  },
})

export function registerFinanceEmergencySummaryRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: EmergencySummaryDeps = { cipher: fieldCipherFromConfig(app.config) }
  const guarded = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const manage = guarded(EMERGENCY_SUMMARY_MANAGE_ROLES)
  const view = guarded(EMERGENCY_SUMMARY_VIEW_ROLES)
  const tags = ['finance-emergency-summaries']
  const ifMatch = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    BASE,
    {
      preValidation: manage,
      schema: {
        operationId: 'listEmergencySummaries',
        tags,
        summary: 'Acil durum özetleri',
        description: `Öğrenci adına göre; süzgeç durum, sınıf ve öğrenci adı. Satırda metin ve uyarı işareti yoktur, okuma denetlenmez. \`needsReview\`: sağlık profili onaydan sonra değişti (K-520). ${MANAGE}`,
        querystring: emergencySummaryListQuery,
        response: { 200: emergencySummaryListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, state, classId, q } = request.query
      const { items, total } = await listEmergencySummariesFor(contextOf(request), deps, {
        page,
        pageSize,
        state,
        classId,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createEmergencySummary',
        tags,
        summary: 'Acil durum özeti aç',
        description: `Öğrenci (yok 422 \`emergency_summary_student_not_found\`, ayrılmış 422 \`emergency_summary_student_inactive\`) ve acil eylem metni (10–500). Özet onay bekler ve onaylanana kadar kimseye görünmez (K-520). Öğrencinin etkin özeti varsa 409 \`emergency_summary_exists\`. Metin şifreli saklanır; sağlık profili kopyalanmaz. Yanıt yönetim ayrıntısıdır ve okuması denetime düşer. Denetim \`finance.emergency_summary.create\` (alan adları). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: emergencySummaryCreateSchema,
        response: { 201: emergencySummaryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createEmergencySummaryCommand(
        contextOf(request),
        deps,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = emergencySummaryResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    `${BASE}/classes`,
    {
      preValidation: view,
      schema: {
        operationId: 'listEmergencySummaryClasses',
        tags,
        summary: 'Acil durum özeti olan sınıflar',
        description: `Okuyanın görebildiği sınıflar ve her sınıfta yayında özeti olan kayıtlı öğrenci sayısı (K-521). Sağlık bilgisi dönmez, okuma denetlenmez. ${VIEW}`,
        response: { 200: emergencyClassListResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listEmergencyClassesFor(contextOf(request)) }),
  )

  typed.get(
    `${BASE}/classes/:classId`,
    {
      config: perUser('emergency-class', PRINTS_PER_MINUTE),
      preValidation: view,
      schema: {
        operationId: 'getEmergencyClassCards',
        tags,
        summary: 'Sınıfın acil durum özetleri',
        description: `Yalnız yayında özeti olan kayıtlı öğrenciler, ada göre: ad, sınıf, onaylı acil eylem, uyarı türü işaretleri (alerji, kronik durum, düzenli ilaç; ad ve tanı yok), bugün okulda verilecek onaylı ilaç var mı ve acil iletişim (en çok iki kişi, telefon maskeli; K-501, K-522). \`purpose=view\` ekranda (denetim \`finance.emergency_summary.read\`), \`purpose=print\` sınıf PDF'i (denetim \`finance.emergency_summary.print\`); öğrenci başına bir denetim satırı (alan adları). Kullanıcı başına 20/dk. Kapsam dışı, olmayan ya da başka kurumun sınıfı 404. ${VIEW}`,
        params: emergencyClassParams,
        querystring: emergencyCardQuery,
        response: { 200: emergencyClassCardsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await classEmergencyCardsFor(
        contextOf(request),
        deps,
        request.params.classId,
        request.query.purpose,
      ),
    }),
  )

  typed.get(
    `${BASE}/students/:studentId`,
    {
      preValidation: view,
      schema: {
        operationId: 'getStudentEmergencyCard',
        tags,
        summary: 'Öğrencinin acil durum özeti',
        description: `Sınıf kartıyla aynı alanlar. Özet yayında değilse, öğrenci kapsam dışı, ayrılmış, olmayan ya da başka kurumdaysa 404. Denetim \`finance.emergency_summary.read\` (öğrenci, alan adları). ${VIEW}`,
        params: emergencyStudentParams,
        response: { 200: emergencyCardResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await studentEmergencyCardFor(contextOf(request), deps, request.params.studentId),
    }),
  )

  typed.post(
    `${BASE}/students/:studentId/contacts/:position/reveal`,
    {
      config: perUser('emergency-contact', REVEALS_PER_MINUTE),
      preValidation: view,
      schema: {
        operationId: 'revealEmergencyContact',
        tags,
        summary: 'Acil iletişim kişisinin tam telefonu',
        description: `Karttaki sıradaki kişinin (1 ya da 2) tam telefonu (K-521). Yalnız kartı görebilen, yayında özeti olan kayıtlı öğrenci için; kişi yoksa 404 \`emergency_contact_not_found\`, telefonu yoksa 422 \`emergency_contact_phone_missing\`. Her açılış \`finance.emergency_summary.contact_reveal\` denetimine düşer (öğrenci ve alan adı; telefon yazılmaz). Yanıt \`Cache-Control: no-store\`; istemci değeri yalnız bellekte tutar. Kayıt oluşturmadığından \`Idempotency-Key\` kullanılmaz; her açılış ayrı kayıttır. Kullanıcı başına 10/dk. ${VIEW}`,
        params: emergencyContactParams,
        response: { 200: emergencyContactResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const data = await revealEmergencyContactFor(
        contextOf(request),
        request.params.studentId,
        request.params.position,
      )
      reply.header('cache-control', 'no-store')
      return { data }
    },
  )

  typed.get(
    `${BASE}/:summaryId`,
    {
      preValidation: manage,
      schema: {
        operationId: 'getEmergencySummary',
        tags,
        summary: 'Acil durum özeti ayrıntısı',
        description: `Onay bekleyen ve yayındaki metin, sağlık profilindeki acil talimat (metne kaynak; kopyalanmaz), uyarı işaretleri, bugünkü ilaç, acil iletişim ve gözden geçirme işareti. Okuma aynı transaction'da \`finance.emergency_summary.manage_read\` denetimine düşer (öğrenci, alan adları). Olmayan, arşivli ya da başka kurumun özeti 404. ${MANAGE}`,
        params: emergencySummaryParams,
        response: { 200: emergencySummaryResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getEmergencySummaryFor(contextOf(request), deps, request.params.summaryId),
    }),
  )

  typed.patch(
    `${BASE}/:summaryId`,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateEmergencySummary',
        tags,
        summary: 'Acil eylem metnini düzelt',
        description: `Yeni metin onay bekler; yayındaki metin onaylanana kadar görünmeye devam eder. Yayındaki metne dönen düzeltme bekleyen değişikliği kaldırır. Aynı metin 422 \`emergency_summary_unchanged\`. Denetim \`finance.emergency_summary.update\`. \`If-Match\` zorunlu. ${MANAGE}`,
        headers: ifMatch,
        params: emergencySummaryParams,
        body: emergencySummaryUpdateSchema,
        response: { 200: emergencySummaryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateEmergencySummaryCommand(
        contextOf(request),
        deps,
        request.params.summaryId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return emergencySummaryResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${BASE}/:summaryId/approve`,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'approveEmergencySummary',
        tags,
        summary: 'Acil durum özetini onayla',
        description: `Onay bekleyen metni yayına alır; bekleyen metin yoksa ve sağlık profili onaydan sonra değiştiyse yayındaki metni yeniden onaylar (gözden geçirildi). İkisi de yoksa 422 \`emergency_summary_nothing_to_approve\`. Onay anındaki profil damgası saklanır (K-520). Gövde boş nesne. Denetim \`finance.emergency_summary.approve\`. \`If-Match\` zorunlu. ${MANAGE}`,
        headers: ifMatch,
        params: emergencySummaryParams,
        body: z.strictObject({}),
        response: { 200: emergencySummaryResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await approveEmergencySummaryCommand(
        contextOf(request),
        deps,
        request.params.summaryId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return emergencySummaryResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${BASE}/:summaryId`,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'archiveEmergencySummary',
        tags,
        summary: 'Acil durum özetini arşivle',
        description: `Özet görünmez olur; öğrenci için yeni özet açılabilir. Denetim \`finance.emergency_summary.archive\`. \`If-Match\` zorunlu. ${MANAGE}`,
        headers: ifMatch,
        params: emergencySummaryParams,
        response: { 200: emergencySummaryArchiveResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveEmergencySummaryCommand(
        contextOf(request),
        request.params.summaryId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return emergencySummaryArchiveResponse.parse(sendBody(reply, result))
    },
  )
}
