import type { FastifyInstance, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { NotFoundError } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { getInstitutionModules } from '../services/modules.ts'
import { getSkillReport } from '../services/skill-reports.ts'
import { readErrors } from './communication.schemas.ts'
import { skillReportQuerySchema, skillReportResponseSchema } from './skill-reports.schemas.ts'

/**
 * Beceri ve CEFR raporu ucu (OG-100; IST-118; DOM-BEC-037). `learning` modülüne bağlıdır ve yalnız
 * dil okulundadır. Sıra: 401 → 403 modül → 404 kurum türü → 403 rol → 400.
 */

export function registerSkillReportRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  /** CEFR raporu yalnız dil okulundadır (CEFR profiliyle aynı); okulda 404. */
  const languageSchool: preValidationAsyncHookHandler = async function (request) {
    const ctx = contextOf(request)
    const institution = await getInstitutionModules(ctx.db, ctx.institutionId)
    if (institution?.type !== 'language_school') throw new NotFoundError()
  }

  typed.get(
    '/api/v1/reports/skills',
    {
      preValidation: [
        app.requireModule('learning'),
        languageSchool,
        app.requireRole(['yonetici', 'ogretmen']),
      ],
      schema: {
        operationId: 'getSkillReport',
        tags: ['learning'],
        summary: 'Beceri ve CEFR raporu',
        description:
          'Dil grubu (`groupBy=class`) ya da kur seviyesi (`groupBy=level`) başına etkin kursiyer sayısı, okuma/dinleme/yazma/konuşma ortalaması, kanıt sayısı ve güncel genel seviye dağılımı (IST-118, DOM-BEC-037). Beceri puanı ilerleme panosunun kanıt kümesidir (değerlendirme türü, sayılan deneme ya da kesinleşmiş puanlı teslim); her kursiyer eşit ağırlıklıdır, kanıtsız beceri `null`. Her okumada hesaplanır, saklanmaz; kişi adı ya da puanı içermez. Kanıta inmek için grup kimliğiyle grup listesi ve kursiyerin CEFR profili kullanılır. Roller: `yonetici` kurum geneli, `ogretmen` yalnız kendi grubu ve koordinatörü olduğu seviyenin grupları; diğer roller 403. Yalnız dil okulunda (okulda 404); modül `learning`, kapalıysa 403 `module_disabled`. Bilinmeyen sorgu parametresi 400.',
        querystring: skillReportQuerySchema,
        response: { 200: skillReportResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await getSkillReport(contextOf(request), request.query) }),
  )
}
