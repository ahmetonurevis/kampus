import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  MEAL_ALLERGY_ROLES,
  mealAllergyAcknowledgementSchema,
} from '@kampus/school-core/lib/finance-meal-allergy-checks.ts'

import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  acknowledgeMealAllergyCommand,
  mealAllergyOptionsFor,
  mealAllergyRosterFor,
  type MealAllergyDeps,
} from '../services/finance-meal-allergy-checks.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { healthAccessReasonOf, requireHealthAccessReason } from './finance-health-access.ts'
import { healthAccessHeadersSchema } from './finance-health-access.schemas.ts'
import {
  mealAllergyAcknowledgementResponse,
  mealAllergyOptionsResponse,
  mealAllergyRosterQuery,
  mealAllergyRosterResponse,
} from './finance-meal-allergy-checks.schemas.ts'

/**
 * Yemekhane alerji uyarısı uçları (docs/domain/finans.md DOM-FIN-162; ON-151; K-541…K-543;
 * H-117). Modüller `finance` ve `meals`. Yemekhane görevlisi rolü olmadığından servis listesini ve
 * onay işaretini yönetici ve ön büro kullanır. Liste sağlık ayrıntısı (alerjen uyarısı, eşlenemeyen
 * alerjinin adı) döndürdüğünden erişim gerekçesi ister (`X-Access-Reason`, DOM-FIN-156); seçim
 * ekranı ve onay işareti sağlık bilgisi döndürmez, gerekçe istemez. Onay `Idempotency-Key` ister.
 */

const ROLES =
  'Rol: `yonetici`, `onburo`; diğer roller 403. Modüller `finance` ve `meals` (kapalıysa 403).'
const BASE = '/api/v1/finance/meal-allergy-checks'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

export function registerFinanceMealAllergyCheckRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Anahtar uygulama kurulurken bir kez türetilir (`config.ts` doğrulamıştır).
  const deps: MealAllergyDeps = { cipher: fieldCipherFromConfig(app.config) }
  const meals: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'meals')
  const guarded = [
    app.authenticate,
    app.requireModule('finance'),
    meals,
    app.requireRole(MEAL_ALLERGY_ROLES),
  ]
  const tags = ['finance-meal-allergy-checks']

  typed.get(
    `${BASE}/options`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getMealAllergyOptions',
        tags,
        summary: 'Yemekhane alerji listesi seçenekleri',
        description: `Sınıflar, sınıf düzeyleri, kurumun açık öğünleri ve açılabilen gün aralığı (bugün ile 7 gün sonrası). Sağlık bilgisi dönmez, okuma denetlenmez. ${ROLES}`,
        response: { 200: mealAllergyOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await mealAllergyOptionsFor(contextOf(request)) }),
  )

  typed.get(
    BASE,
    {
      preValidation: [...guarded, requireHealthAccessReason()],
      schema: {
        operationId: 'getMealAllergyRoster',
        tags,
        summary: 'Yemekhane alerji servis listesi',
        description: `Seçilen gün (boşsa bugün; geçmiş 422 \`meal_allergy_date_past\`, 7 günden ileri 422 \`meal_allergy_date_too_far\`), öğün ve sınıf ya da sınıf düzeyinin (tam olarak biri; ikisi ya da hiçbiri 400) kayıtlı öğrencilerinden **yalnız uyarısı olanlar**: ad, sınıf, hangi yemekte hangi alerjen ve şiddet; menüyle karşılaştırılamayan alerji adıyla ayrıca ("elle kontrol"). Öğrencinin menüsü kampüsünün yayımlanmış menüsü, yoksa bütün kampüs menüsüdür; menüsünde o gün ve öğünde yemek olmayan öğrenci \`studentsWithoutMenu\` sayısına girer. Teşhis, ilaç ve not dönmez. Olmayan ya da başka kurumun sınıfı 404. Erişim gerekçesi zorunlu; listelenen her öğrenci gerekçesiyle \`finance.meal_allergy.roster_read\` denetimine ve sağlık erişim günlüğüne düşer (DOM-FIN-156). ${ROLES}`,
        querystring: mealAllergyRosterQuery,
        headers: healthAccessHeadersSchema(true),
        response: { 200: mealAllergyRosterResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { serviceDate, mealKind, classId, grade } = request.query
      const reason = healthAccessReasonOf(request)
      if (reason === null) throw new Error('health access reason missing for staff role')
      const selection = classId !== undefined ? { classId } : grade !== undefined ? { grade } : null
      if (selection === null) throw new Error('roster query refine did not run')
      reply.header('cache-control', 'no-store')
      return {
        data: await mealAllergyRosterFor(
          contextOf(request),
          deps,
          {
            serviceDate,
            mealKind,
            selection,
          },
          reason,
        ),
      }
    },
  )

  typed.post(
    `${BASE}/acknowledgements`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'acknowledgeMealAllergy',
        tags,
        summary: 'Alerji uyarısını işaretle',
        description: `"Uyarı görüldü, alternatif verildi" işareti (K-543): öğrenci, gün ve öğün; kim ve saat sunucuda yazılır. Yalnız bugünün (Europe/Istanbul) öğününde (değilse 422 \`meal_allergy_ack_not_today\`), kayıtlı (olmayan ya da başka kurumun 422 \`meal_allergy_student_not_found\`, ayrılmış 422 \`meal_allergy_student_inactive\`) ve o öğünde uyarısı olan öğrenci için (yoksa 422 \`meal_allergy_ack_no_warning\`); öğrenci × gün × öğün başına bir kez (409 \`meal_allergy_ack_exists\`). Kayıt değiştirilmez ve silinmez. Yanıtta sağlık bilgisi yoktur; gerekçe istenmez. Denetim \`finance.meal_allergy.acknowledge\` (alan adları). \`Idempotency-Key\` zorunlu. ${ROLES}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: mealAllergyAcknowledgementSchema,
        response: { 201: mealAllergyAcknowledgementResponse, ...commandErrors },
      },
    },
    async (request, reply) =>
      mealAllergyAcknowledgementResponse.parse(
        sendBody(
          reply,
          await acknowledgeMealAllergyCommand(
            contextOf(request),
            deps,
            request.commandInput,
            options(request, 'required').idempotency,
          ),
        ),
      ),
  )
}
