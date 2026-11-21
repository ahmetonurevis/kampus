import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getSkillProgress } from '../services/skill-progress.ts'
import { readErrors } from './communication.schemas.ts'
import { skillProgressParamsSchema, skillProgressResponseSchema } from './skill-progress.schemas.ts'

/**
 * Beceri ilerleme panosu ucu (OG-080; IST-057, DOM-BEC-035). `learning` modülüne bağlıdır; iki kurum
 * türünde de çalışır. Sıra: 401 → 403 modül/rol → 404 kapsam.
 */

const MODULE = 'learning'
const READERS: readonly Role[] = ['yonetici', 'ogretmen', 'ogrenci', 'veli']

export function registerSkillProgressRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/students/:studentId/skill-progress',
    {
      preValidation: [app.requireModule(MODULE), app.requireRole(READERS)],
      schema: {
        operationId: 'getSkillProgress',
        tags: ['learning'],
        summary: 'Beceri ilerleme panosu',
        description:
          'Öğrencinin okuma, dinleme, yazma ve konuşma eğrileri (IST-057, DOM-BEC-035): her nokta bir değerlendirme görevinin sayılan denemesi ya da kesinleşmiş puanlı teslimidir ve atama ile deneme/teslim kimliğini taşır. Alıştırma, puanı kişiye açılmamış sonuç (DOM-BEC-045), içeriği kaldırılmış görev (DOM-KYN-051) ve arşivlenmiş atama girmez. Son değer ve eğilim her okumada hesaplanır, saklanmaz. Roller: `yonetici` herkesi, `ogretmen` ders verdiği sınıftaki ya da grubunu okuyabildiği öğrenciyi (yalnız atamasını gördüğü görevler), `ogrenci` kendisini, `veli` bağlı çocuğunu görür; ön büro 403. Göremediği, olmayan ya da başka kurumun öğrencisi 404. Modül `learning`; kapalıysa 403 `module_disabled`.',
        params: skillProgressParamsSchema,
        response: { 200: skillProgressResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await getSkillProgress(contextOf(request), request.params.studentId),
    }),
  )
}
