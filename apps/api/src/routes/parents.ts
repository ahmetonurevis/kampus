import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { revealParentContactSchema } from '@kampus/school-core/lib/parent-contact.ts'

import { AppError, errorResponseSchema, MESSAGES } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { revealParentContactCommand } from '../services/parent-contact.ts'
import { authenticatedErrors } from './common.schemas.ts'
import { parentParamsSchema, revealParentContactResponseSchema } from './parents.schemas.ts'

/** Veli iletişimi açılış sınırı (kullanıcı ve kurum başına dakikada); genel IP sınırı 300'dür. */
export const PARENT_CONTACT_REVEAL_LIMIT = 10

/**
 * Veli uçları (docs/domain/yetki-ve-kapsam.md DOM-YTK-055). Maskeli okuma genel koleksiyon
 * ucundadır (`GET /collections/parents`; öğretmene maskeli, öğrenci ve veliye iletişimsiz). Sıra:
 * 401 → 403 `module_disabled` → 403 `forbidden` (yalnız öğretmen) → 429 açılış sınırı → 400 gövde
 * → kapsam (404) → 422 boş alan. Sınır gövde doğrulamasından önce sayar: geçersiz ve kapsam
 * dışı denemeler de sayılır, kimlik tahmini de sınırlanır.
 */
export function registerParentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  const checkRevealLimit = app.createRateLimit({
    max: PARENT_CONTACT_REVEAL_LIMIT,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      request.auth
        ? `parent-contact:${request.auth.institutionId}:${request.auth.userId}`
        : request.ip,
  })
  async function limitReveals(request: FastifyRequest, reply: FastifyReply) {
    const limit = await checkRevealLimit(request)
    if (limit.isAllowed || !limit.isExceeded) return
    reply.header('retry-after', limit.ttlInSeconds)
    throw new AppError(429, 'rate_limited', MESSAGES.rate_limited)
  }

  typed.post(
    '/api/v1/parents/:parentId/reveal-contact',
    {
      preValidation: [
        app.authenticate,
        app.requireModule('communication'),
        app.requireRole(['ogretmen']),
        limitReveals,
      ],
      schema: {
        operationId: 'revealParentContact',
        tags: ['communication'],
        summary: 'Veli iletişim bilgisini göster',
        description: `Öğretmenin, ders verdiği öğrencinin velisinin telefonunu veya e-postasını tam değeriyle açması (core \`revealParentContact\`, DOM-YTK-055, DOM-YTK-052). Listede (\`GET /collections/parents\`) öğretmen bu alanları maskeli görür (\`0532 *** ** 12\`, \`a***@gmail.com\`). Gövde \`{ studentId, field }\`, \`field\` \`phone\` veya \`email\`; bilinmeyen alan 400. Yalnız öğrencinin sınıfında dersi ya da sınıf rehberliği olan öğretmen, yalnız o öğrenciye bağlı veli için: kapsam dışı öğrenci, öğrenciye bağlı olmayan, olmayan veya başka kurumun velisi 404. Alan boşsa 422 \`parent_contact_missing\`. Her başarılı açılış \`audit_log\`'a \`parent_contact.reveal\` olarak yazılır (\`entityType\` \`parents\`, \`entityId\` veli, \`changes.fields\` alan adı, \`changes.studentId\` öğrenci); değer denetim kaydına ve loga yazılmaz. Yanıt \`Cache-Control: no-store\` taşır; istemci değeri yalnız bellekte tutar. Açılış kullanıcı ve kurum başına dakikada ${String(PARENT_CONTACT_REVEAL_LIMIT)} ile sınırlıdır (geçersiz ve kapsam dışı denemeler dahil), aşılırsa 429 \`rate_limited\` ve \`Retry-After\`. \`Idempotency-Key\` kullanılmaz: işlem kayıt oluşturmaz, tekrar yalnız yeni bir denetim kaydıdır ve her açılışın kaydı istenir. Modül \`communication\`; kapalıysa 403 \`module_disabled\`. Roller: \`ogretmen\` (yönetici ve ön büro tam değeri listede görür; öğrenci ve veli hiç görmez).`,
        params: parentParamsSchema,
        body: revealParentContactSchema,
        response: {
          200: revealParentContactResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const data = await revealParentContactCommand(
        contextOf(request),
        request.params.parentId,
        request.body,
      )
      reply.header('cache-control', 'no-store')
      return { data }
    },
  )
}
