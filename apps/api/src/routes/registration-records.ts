import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { updateParentDetailsSchema } from '@kampus/school-core/lib/registration-records.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { updateParentDetailsCommand } from '../services/registration-records.ts'
import { sendCommand } from './command-support.ts'
import { captureInput, options, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema, commandResponseSchema } from './commands.schemas.ts'

const ROLES = WRITE_ACTION_ROLES['parent.update']
const parentParamsSchema = z.object({
  parentId: z.string().min(1).max(200).describe('Veli kaydının kimliği'),
})

/** Kayıt sonrası veli ve öğrenci kaydı yazma uçları (ON-117). */
export function registerRegistrationRecordRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const input = (request: FastifyRequest) => request.commandInput

  typed.patch(
    '/api/v1/parents/:parentId',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('crm'),
        app.requireRole(ROLES),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'updateParentDetails',
        tags: ['parents'],
        summary: 'Veli bilgisini düzelt',
        description: `Kesin kayıtta açılan veli kaydının adını, telefonunu ve e-postasını düzeltir (core \`updateParentDetails\`, ON-117, DOM-KAY-012, KVKK md. 11 düzeltme hakkı). Yalnız gönderilen alanlar değişir; e-posta boş metinle silinir, telefon silinemez. Hiçbiri farklı değilse 409 \`parent_unchanged\`. Yakınlık, velayet ve ödeyici bağı veli–öğrenci bağındadır, burada değişmez; veli hesabının e-postası ayrıdır. Denetime yalnız alan adları gider. \`If-Match\` zorunludur (veli kaydının sürümü): eksikse 400 \`if_match_required\`, tutmazsa 409 \`version_conflict\`. Olmayan veya başka kurumun kaydı 404. Modül \`crm\`. Roller: ${ROLES.map((role) => `\`${role}\``).join(', ')}.`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: parentParamsSchema,
        body: updateParentDetailsSchema,
        response: { 200: commandResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) =>
      sendCommand(
        reply,
        await updateParentDetailsCommand(
          contextOf(request),
          request.params.parentId,
          input(request),
          options(request, 'optional'),
        ),
      ),
  )
}
