import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { WRITE_ACTION_ROLES } from '@kampus/school-core/lib/authorize.ts'
import { adultPayerSchema } from '@kampus/school-core/lib/finance-payers.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { addAdultPayerCommand } from '../services/finance-payers.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { studentGuardianResponseSchema } from './student-guardians.schemas.ts'

/**
 * Yetişkin kursiyerin ayrı ödeyicisi (ON-124; DOM-KAY-012, DOM-ILT-074). Modül `finance`; rol
 * listesi veli bağını yöneten rollerdir (`guardian.manage`: yönetici, ön büro). Bağ kurulduktan
 * sonra veli bağı uçlarında (`/api/v1/students/:studentId/guardians`) listelenir ve kaldırılır.
 */

const ROLES = WRITE_ACTION_ROLES['guardian.manage']

export function registerFinancePayerRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.post(
    '/api/v1/finance/students/:studentId/payers',
    {
      preValidation: [app.authenticate, app.requireModule('finance'), app.requireRole(ROLES)],
      schema: {
        operationId: 'addAdultPayer',
        tags: ['finance-payers'],
        summary: 'Yetişkin kursiyere ödeyici ekle',
        description: `Kursta 18 yaş ve üstü kursiyere ücreti ödeyen kişiyi velayetsiz ödeyici olarak bağlar (core \`resolveAdultPayer\`, \`attachAdultPayer\`; DOM-KAY-012, DOM-ILT-074, ON-124). Gövde mevcut veli kaydı (\`existingParentId\`) ya da yeni kişidir (\`name\`, \`phone\`, \`relationship\`: \`mother\`, \`father\`, \`other\`); yeni kişinin veli kaydı açılır, öğrenci kaydın \`studentIds\`'ine yazılmaz. Bağ \`custody: 'none'\`, \`isPayer: true\`'dur: ödeyici finansı (fatura, sözleşme, tahsilat ve dekont, bakiye, ekstre) ve finans bildirimini görür; not, devam, ödev, mesaj ve randevu görmez, rıza veremez. Öğrencinin veli kaydı (\`parentId\`) ödeyicinin kaydı olur; onaylanmamış sözleşmelerin tarafı ve onaylayanı ödeyiciye geçer (\`payer: 'guardian'\`), imza yetkilisi işlenmiş olanların onay isteği ödeyiciye yeniden yazılır; onaylı sözleşme değişmez, değişiklik ek protokoldür (DOM-FIN-010; kullanıcı kararı 2026-11-04). Hesabı veli hesabı davetiyle (\`POST /api/v1/institution-members/guardian-invitations\`, \`parentId\`) açılır. Okulda ve 18 yaş altında 422 \`payer_not_applicable\` (yaş kimlik satırındaki doğum tarihinden, yoksa adayın yaş grubundan); kursiyerin kendi satırı ya da iletişim kısıtlı kişi 422 \`payer_not_eligible\`; ödeyicisi olan öğrenci 409 \`guardian_payer_exists\`, aynı kişi 409 \`guardian_link_exists\`. Olmayan, arşivli ya da başka kurumun öğrencisi ve olmayan veli kaydı 404. Modül \`finance\` kapalıysa 403 \`module_disabled\`. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\` (öğrencinin bağ listesi). Denetime yalnız alan adları yazılır. Roller: ${ROLES.map((role) => `\`${role}\``).join(', ')}.`,
        params: z.object({ studentId: z.string().min(1).max(200).describe('Öğrenci kimliği') }),
        body: adultPayerSchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: studentGuardianResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const { studentId } = request.params
      const response = await addAdultPayerCommand(
        contextOf(request),
        studentId,
        request.body,
        idempotencyOf(request, true),
      )
      if (response.replayed) reply.header('idempotent-replayed', 'true')
      reply.status(201)
      reply.header('location', `/api/v1/students/${encodeURIComponent(studentId)}/guardians`)
      return studentGuardianResponseSchema.parse(response.body)
    },
  )
}
