import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'

import { AppError, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  linkStudentGuardian,
  listStudentGuardians,
  unlinkStudentGuardian,
  updateStudentGuardian,
} from '../services/student-guardians.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  linkGuardianBodySchema,
  studentGuardianListParamsSchema,
  studentGuardianListResponseSchema,
  studentGuardianParamsSchema,
  studentGuardianResponseSchema,
  updateGuardianBodySchema,
} from './student-guardians.schemas.ts'

/**
 * Veli–öğrenci bağı uçları (IST-019; docs/domain/iletisim-ve-veli.md DOM-ILT-070…075). Bağ
 * platform yeteneğidir (velayet rızanın ve kapsamın girdisidir): modüle bağlı değildir. Rol listesi
 * core yetki tablosundan (`guardian.read`, `guardian.manage`) gelir ve `preValidation`'da
 * denetlenir. Sıra: 401 → 403 rol → `If-Match` → 400 → işlem (404, 409, 422).
 */

const roles = (action: 'guardian.read' | 'guardian.manage') =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

const WRITE_ACCESS = `Yalnız ${roles('guardian.manage')}; diğer roller 403. Olmayan, arşivli ya da başka kurumun öğrencisi 404. Denetime yalnız alan adları yazılır (velayet ve kısıt değeri yazılmaz).`
const VERSIONED =
  "`If-Match` bağın `rowVersion`'ı (zorunlu), tutmazsa 409 `version_conflict`; olmayan, kaldırılmış ya da başka öğrencinin bağı 404. `Idempotency-Key` isteğe bağlı."

function requiredVersion(request: FastifyRequest): number {
  const version = ifMatchVersion(request)
  if (version === null) throw new AppError(400, 'if_match_required', MESSAGES.if_match_required)
  return version
}

function sendLink(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return studentGuardianResponseSchema.parse(response.body)
}

const target = (request: FastifyRequest<{ Params: { studentId: string; linkId: string } }>) => ({
  studentId: request.params.studentId,
  linkId: request.params.linkId,
  expectedVersion: requiredVersion(request),
})

export function registerStudentGuardianRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const read = app.requireRole(WRITE_ACTION_ROLES['guardian.read'])
  const manage = app.requireRole(WRITE_ACTION_ROLES['guardian.manage'])
  const versionedHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    '/api/v1/students/:studentId/guardians',
    {
      preValidation: read,
      schema: {
        operationId: 'listStudentGuardians',
        tags: ['institution'],
        summary: 'Öğrencinin velileri',
        description: `Öğrencinin etkin veli bağları, kuruluş sırasıyla (DOM-ILT-070…075). Yönetici ve ön büro bütün bağları, velayet, iletişim kısıtı, ödeyici ve teslim alma bilgisiyle görür. Veli yalnız kendi bağını görür: öteki velinin varlığı, kimliği ve kısıtı ile kendi bağının kısıt alanı dönmez (DOM-ILT-073); bağı olmayan ya da iletişim kısıtlı veli 404 alır. Roller: ${roles('guardian.read')}; diğer roller 403. Olmayan ya da başka kurumun öğrencisi 404.`,
        params: studentGuardianListParamsSchema,
        response: { 200: studentGuardianListResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await listStudentGuardians(contextOf(request), request.params.studentId),
    }),
  )

  typed.post(
    '/api/v1/students/:studentId/guardians',
    {
      preValidation: manage,
      schema: {
        operationId: 'linkStudentGuardian',
        tags: ['institution'],
        summary: 'Öğrenciye veli bağla',
        description: `Öğrenciye veli kaydını (\`parentId\`) ve/veya veli hesabını (\`membershipId\`) bağlar (core \`planGuardianLink\`, DOM-ILT-070…075). Kurumda olmayan veli kaydı ya da hesap 404; veli rolünde olmayan hesap 422 \`guardian_account_not_parent\`; aynı veli ikinci kez 409 \`guardian_link_exists\`. Veli kaydı ile hesap birlikte verilirse aynı kişiye ait olmalıdır: kayıt ya da hesap kurumda başka bir bağda başkasıyla eşlenmişse 422 \`guardian_identity_mismatch\`. İletişim kısıtlı veli velayetli, ödeyici ve teslim alan olamaz (422 \`guardian_restricted_custody\`, \`guardian_restricted_payer\`, \`guardian_restricted_pickup\`); vasi velayetlidir (422 \`guardian_legal_custody\`); öğrencinin ikinci ödeyicisi 409 \`guardian_payer_exists\`; ilk bağ velayetsiz kurulamaz (422 \`guardian_custody_required\`). \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\` (öğrencinin bağ listesi). ${WRITE_ACCESS}`,
        params: studentGuardianListParamsSchema,
        body: linkGuardianBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: studentGuardianResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const { studentId } = request.params
      const body = sendLink(
        reply,
        await linkStudentGuardian(
          contextOf(request),
          studentId,
          request.body,
          idempotencyOf(request, true),
        ),
      )
      reply.header('location', `/api/v1/students/${encodeURIComponent(studentId)}/guardians`)
      return body
    },
  )

  typed.patch(
    '/api/v1/students/:studentId/guardians/:linkId',
    {
      preValidation: [manage, requireIfMatch()],
      schema: {
        operationId: 'updateStudentGuardian',
        tags: ['institution'],
        summary: 'Veli bağını değiştir',
        description: `Bağın yakınlığını, velayetini, iletişim kısıtını, ödeyici ve teslim alma yetkisini değiştirir (core \`planGuardianUpdate\`, DOM-ILT-071…075); veli kimliği değişmez. Kurallar bağ kurmadaki gibidir; son velayetli bağın velayeti kaldırılamaz (422 \`guardian_custody_required\`). Ödeyiciyi değiştirmek için önce eski ödeyicinin \`isPayer\` alanı kapatılır. ${VERSIONED} ${WRITE_ACCESS}`,
        params: studentGuardianParamsSchema,
        body: updateGuardianBodySchema,
        headers: versionedHeaders,
        response: { 200: studentGuardianResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendLink(
        reply,
        await updateStudentGuardian(
          contextOf(request),
          target(request),
          request.body,
          idempotencyOf(request, false),
        ),
      ),
  )

  typed.delete(
    '/api/v1/students/:studentId/guardians/:linkId',
    {
      preValidation: [manage, requireIfMatch()],
      schema: {
        operationId: 'unlinkStudentGuardian',
        tags: ['institution'],
        summary: 'Veli bağını kaldır',
        description: `Bağı kaldırır (arşiv; core \`planGuardianUnlink\`, DOM-ILT-071, DOM-ILT-075). Başka bağ dururken son velayetli bağ kaldırılamaz (422 \`guardian_custody_required\`); son bağ kaldırılabilir. Kaldırılan bağ rıza ve velayet vermez; verilmiş rızalar kayıtta kalır. Yanıt kaldırılan bağdır (\`archivedAt\` dolu). ${VERSIONED} ${WRITE_ACCESS}`,
        params: studentGuardianParamsSchema,
        headers: versionedHeaders,
        response: { 200: studentGuardianResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendLink(
        reply,
        await unlinkStudentGuardian(
          contextOf(request),
          target(request),
          idempotencyOf(request, false),
        ),
      ),
  )
}
