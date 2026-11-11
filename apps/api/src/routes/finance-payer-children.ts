import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'
import { z } from 'zod'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { listPayerChildrenFor } from '../services/finance-payer-children.ts'
import { authenticatedErrors, dataResponse } from './common.schemas.ts'

/**
 * Veli finans seçicisinin ödeyici çocukları (ON-313; K-04; DOM-FIN-052, DOM-ILT-074). Modül
 * `finance`, yalnız `veli`. Liste velinin ödeyicisi olduğu öğrencilerle sınırlıdır (birkaç satır);
 * sayfalama yoktur.
 */

const payerChildSchema = z.object({
  id: z.string().describe('Öğrenci kimliği'),
  name: z.string().describe('Öğrencinin adı'),
  className: z.string().nullable().describe('Güncel sınıf ya da kur grubu adı'),
})

export function registerFinancePayerChildrenRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  typed.get(
    '/api/v1/finance/payer-children',
    {
      preValidation: [app.authenticate, app.requireModule('finance'), app.requireRole(['veli'])],
      schema: {
        operationId: 'listFinancePayerChildren',
        tags: ['finance-exports'],
        summary: 'Velinin ödeyicisi olduğu çocuklar',
        description:
          'Veli finans sayfalarının çocuk seçicisi için ödeyicisi olunan öğrenciler (K-04, DOM-FIN-052, DOM-ILT-074). Velayeti olmayan ödeyici veli çocuğu `/me` çocuk listesinde görmez; finans sayfaları bu listeyle o çocuğun taksit, dekont ve sözleşmesini açar. Akademik ve iletişim ekranları bu listeyi kullanmaz. Velayetli ödeyicinin çocuğu da listededir. İletişim kısıtlı veli ödeyici olamaz, listesi boştur. Yalnız ad ve güncel sınıf adı döner (KVKK asgarisi); sıralama ada göre. Başka kurumun öğrencisi listede yoktur. Rol: `veli`; diğer roller 403, modül kapalı 403.',
        response: {
          200: dataResponse(z.array(payerChildSchema)),
          ...authenticatedErrors,
          404: errorResponseSchema,
        },
      },
    },
    async (request) => ({ data: await listPayerChildrenFor(contextOf(request)) }),
  )
}
