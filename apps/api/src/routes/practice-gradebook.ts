import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getPracticeGradebook } from '../services/practice-gradebook.ts'
import { readErrors } from './communication.schemas.ts'
import {
  practiceGradebookQuerySchema,
  practiceGradebookResponseSchema,
} from './practice-gradebook.schemas.ts'

/**
 * Alıştırma not defteri ucu (OG-085; IST-056, DOM-BEC-048). `learning` modülüne bağlıdır; iki kurum
 * türünde de çalışır. Veli alıştırma puanını görmez (DOM-BEC-041): rol 403. Sıra: 401 → 403
 * modül/rol → 400 sorgu.
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci']

export function registerPracticeGradebookRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/practice-gradebook',
    {
      preValidation: [app.requireModule(MODULE), app.requireRole(READERS)],
      schema: {
        operationId: 'getPracticeGradebook',
        tags: ['learning'],
        summary: 'Alıştırma not defteri',
        description:
          'Alıştırma sonuçlarının ünite, beceri ve kazanım kırılımı (IST-056, DOM-BEC-048): kişinin gördüğü arşivsiz, otomatik puanlı alıştırma atamalarından kursiyer başına son tamamlanan deneme alınır. Hücre madde puanlarının toplamıdır (kazanılan / olası × 100); ünite setin, beceri ve kazanım maddenin etiketidir (soru etiketsizse setin). Her okumada hesaplanır, saklanmaz; not aktarımına, not ortalamasına, seviye önerisine ve beceri panosuna girmez. İçeriği kaldırılmış atama girmez (DOM-KYN-051). En yeni 100 alıştırma ataması okunur (`truncated`). `targetId` hedefi o sınıf/grup/öğrenci olan atamalara daraltır. Roller: `yonetici` bütün atamalar, `ogretmen` atadığı ya da kapsamındaki hedefi yüzünden gördüğü atamalar (DOM-YTK-028), `ogrenci` yalnız kendi sonucu; `veli` (DOM-BEC-041) ve ön büro 403. Bilinmeyen parametre 400. Modül `learning`; kapalıysa 403 `module_disabled`.',
        querystring: practiceGradebookQuerySchema,
        response: { 200: practiceGradebookResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getPracticeGradebook(contextOf(request), request.query),
    }),
  )
}
