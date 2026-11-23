import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_MEAL_CANCEL_ROLES,
  FINANCE_MEAL_SUBSCRIPTION_ADMIN_ROLES,
  FINANCE_MEAL_SUBSCRIPTION_FAMILY_ROLES,
  FINANCE_MEAL_SUBSCRIPTION_MANAGE_ROLES,
  mealCancellationCreateSchema,
  mealSubscriptionCreateSchema,
  mealSubscriptionSettingsSchema,
  mealSubscriptionUpdateSchema,
} from '@kampus/school-core/lib/finance-meal-subscriptions.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveMealSubscriptionCommand,
  cancelMealDaysCommand,
  createMealSubscriptionCommand,
  getMealSubscriptionFor,
  listMealSubscriptionsFor,
  listMyMealSubscriptionsFor,
  mealCutoffFor,
  mealDailyCountFor,
  mealMonthlySummaryFor,
  restoreMealCancellationCommand,
  setMealCutoffCommand,
  updateMealSubscriptionCommand,
} from '../services/finance-meal-subscriptions.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  mealCancellationParams,
  mealCancellationRestoredResponse,
  mealCancellationsResponse,
  mealCutoffSettingsResponse,
  mealDailyCountQuery,
  mealDailyCountResponse,
  mealMonthlySummaryQuery,
  mealMonthlySummaryResponse,
  mealSubscriptionArchivedResponse,
  mealSubscriptionListQuery,
  mealSubscriptionListResponse,
  mealSubscriptionParams,
  mealSubscriptionResponse,
  myMealSubscriptionsResponse,
} from './finance-meal-subscriptions.schemas.ts'

/**
 * Yemek aboneliği uçları (docs/domain/finans.md DOM-FIN-164; ON-150; IST-099; K-547…K-549).
 * Modül `finance` ve okul yaşamıyla ortak `meals` anahtarı. Abonelik, günlük sayım ve aylık özet
 * yönetici ve ön büroda; kesim ayarı yöneticide. Gün iptali ve geri alma okulda ve velide (veli
 * yalnız bağlı çocuğunun aboneliğinde, kesimden önce); veli ve öğrenci `GET …/my` ile okur.
 * Oluşturma ve gün iptali `Idempotency-Key`; düzenleme, arşiv ve geri alma `If-Match` ister.
 */

const MANAGE =
  'Rol: `yonetici`, `onburo`; diğer roller 403. Modüller `finance` ve `meals` (kapalıysa 403).'
const BASE = '/api/v1/finance/meal-subscriptions'
const SUBSCRIPTION = `${BASE}/:subscriptionId`
const CANCELLATIONS = `${SUBSCRIPTION}/cancellations`
const DAILY = '/api/v1/finance/meal-daily-counts'
const MONTHLY = '/api/v1/finance/meal-monthly-summary'
const SETTINGS = '/api/v1/finance/meal-subscription-settings'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function versionOf(request: FastifyRequest) {
  const opts = options(request, 'optional')
  if (opts.expectedVersion === null) throw new Error('If-Match guard did not run')
  return { expectedVersion: opts.expectedVersion, idempotency: opts.idempotency }
}

export function registerFinanceMealSubscriptionRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const meals: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'meals')
  const guarded = (roles: readonly Role[]) => [
    app.authenticate,
    app.requireModule('finance'),
    meals,
    app.requireRole(roles),
  ]
  const manage = guarded(FINANCE_MEAL_SUBSCRIPTION_MANAGE_ROLES)
  const cancel = guarded(FINANCE_MEAL_CANCEL_ROLES)
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-meal-subscriptions']

  typed.get(
    `${BASE}/my`,
    {
      preValidation: guarded(FINANCE_MEAL_SUBSCRIPTION_FAMILY_ROLES),
      schema: {
        operationId: 'listMyMealSubscriptions',
        tags,
        summary: 'Yemek aboneliklerim (veli ve öğrenci)',
        description:
          'Velinin bağlı çocuklarının ya da öğrencinin sürmekte ve başlamamış yemek abonelikleri: öğün, tarih, günler, diyet türü ve bugünden 28 günlük yemek takvimi (yemek var, iptal, geç iptal, tatil; kesim anı). `canCancel`/`canRestore` velide kesime göre hesaplanır, öğrencide hep `false` (K-548). Kapsam sunucuda core `mealMenus` kuralıyla daralır. Rol: `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `meals`.',
        response: { 200: myMealSubscriptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyMealSubscriptionsFor(contextOf(request)) }),
  )

  typed.get(
    BASE,
    {
      preValidation: manage,
      schema: {
        operationId: 'listMealSubscriptions',
        tags,
        summary: 'Yemek abonelikleri',
        description: `Arşivlenmemiş abonelikler, öğrenci adına göre: öğrenci, sınıf, öğün, tarih, günler, diyet türü ve durum (bugüne göre başlamadı, sürüyor, bitti). Süzgeç öğrenci adı (\`q\`), durum, öğün, diyet türü ve sınıf. ${MANAGE}`,
        querystring: mealSubscriptionListQuery,
        response: { 200: mealSubscriptionListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, status, mealKind, dietType, classId } = request.query
      const { items, total } = await listMealSubscriptionsFor(contextOf(request), {
        page,
        pageSize,
        q,
        status,
        mealKind,
        dietType,
        classId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMealSubscription',
        tags,
        summary: 'Yemek aboneliği aç',
        description: `Öğrenci (yok 422 \`meal_subscription_student_not_found\`, pasif 422 \`meal_subscription_student_inactive\`), kurumda açık öğün (422 \`meal_kind_disabled\`), başlangıç–bitiş (bugünden önce 422 \`meal_subscription_start_past\`, en çok 366 gün), hafta günleri ve diyet türü; "diğer" diyette kısa açıklama zorunlu, diğerlerinde yazılmaz (400). Aynı öğünde tarihleri değen abonelik 409 \`meal_subscription_overlap\` (K-547). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        body: mealSubscriptionCreateSchema,
        response: { 201: mealSubscriptionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMealSubscriptionCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = mealSubscriptionResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    SUBSCRIPTION,
    {
      preValidation: manage,
      schema: {
        operationId: 'getMealSubscription',
        tags,
        summary: 'Yemek aboneliği ayrıntısı',
        description: `Abonelik, kesim, bugünden 28 günlük yemek takvimi (okul bayraklarıyla) ve bütün etkin iptaller. Başka kurumun ya da arşivli abonelik 404. ${MANAGE}`,
        params: mealSubscriptionParams,
        response: { 200: mealSubscriptionResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMealSubscriptionFor(contextOf(request), request.params.subscriptionId),
    }),
  )

  typed.patch(
    SUBSCRIPTION,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateMealSubscription',
        tags,
        summary: 'Yemek aboneliğini düzenle',
        description: `Başlamamış abonelikte tarih, gün ve diyet değişir (başlangıç bugünden önce 422 \`meal_subscription_start_past\`). Başlamış abonelikte yalnız bitiş günü değişir (başka alan 422 \`meal_subscription_started\`, bugünden önce 422 \`meal_subscription_end_past\`); bitmiş abonelik 422 \`meal_subscription_ended\`. Sonuç bütün olarak doğrulanır (422 \`meal_subscription_end_before_start\`, \`meal_diet_note_required\` …); değişiklik yoksa 422 \`meal_subscription_unchanged\`; çakışma 409 \`meal_subscription_overlap\` (K-547). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: mealSubscriptionParams,
        body: mealSubscriptionUpdateSchema,
        response: { 200: mealSubscriptionResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateMealSubscriptionCommand(
        contextOf(request),
        request.params.subscriptionId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return mealSubscriptionResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    SUBSCRIPTION,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'archiveMealSubscription',
        tags,
        summary: 'Başlamamış aboneliği sil',
        description: `Yalnız başlamamış abonelik arşivlenir; başlamış abonelik 422 \`meal_subscription_started\` (bitiş gününü değiştirin; K-547). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: mealSubscriptionParams,
        response: { 200: mealSubscriptionArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveMealSubscriptionCommand(
        contextOf(request),
        request.params.subscriptionId,
        expectedVersion,
        idempotency,
      )
      return mealSubscriptionArchivedResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    CANCELLATIONS,
    {
      preValidation: [...cancel, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelMealDays',
        tags,
        summary: 'Yemek günlerini iptal et',
        description:
          'Aboneliğin seçilen yemek günleri iptal edilir (en çok 31 gün). Yemek günü değil 422 `meal_day_not_subscribed`, okul takviminde tatil 422 `meal_day_holiday`, geçmiş gün 422 `meal_day_past`, zaten iptal 409 `meal_day_already_cancelled`. Kesim (kurum ayarı; varsayılan bir gün önce 15:00) geçtiyse veli 422 `meal_cancellation_cutoff_passed` alır, okulun iptali `late: true` (geç iptal) yazılır ve iade/mahsup gününe girmez (K-548). Gerekçe alınmaz. Veli yalnız bağlı çocuğunun aboneliğinde (başka öğrenci 404). `Idempotency-Key` zorunlu. Rol: `yonetici`, `onburo`, `veli`; diğer roller 403. Modüller `finance` ve `meals`.',
        headers: createHeaders,
        params: mealSubscriptionParams,
        body: mealCancellationCreateSchema,
        response: { 201: mealCancellationsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await cancelMealDaysCommand(
        contextOf(request),
        request.params.subscriptionId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return mealCancellationsResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${CANCELLATIONS}/:cancellationId`,
    {
      preValidation: [...cancel, requireIfMatch()],
      schema: {
        operationId: 'restoreMealDay',
        tags,
        summary: 'Gün iptalini geri al',
        description:
          'İptal geri alınır, gün yeniden yemek günü olur. Geçmiş gün 422 `meal_day_past`; veli yalnız kesimden önce (sonra 422 `meal_cancellation_cutoff_passed`), okul gün bitene kadar (K-548). Veli yalnız bağlı çocuğunun aboneliğinde (başka öğrenci 404). `If-Match` (iptalin sürümü) zorunlu. Rol: `yonetici`, `onburo`, `veli`; diğer roller 403. Modüller `finance` ve `meals`.',
        headers: versionHeaders,
        params: mealCancellationParams,
        response: { 200: mealCancellationRestoredResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await restoreMealCancellationCommand(
        contextOf(request),
        request.params.subscriptionId,
        request.params.cancellationId,
        expectedVersion,
        idempotency,
      )
      return mealCancellationRestoredResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    DAILY,
    {
      preValidation: manage,
      schema: {
        operationId: 'getMealDailyCount',
        tags,
        summary: 'Günlük yemek sayısı (mutfak)',
        description: `Seçilen gün için öğün × diyet türü yemek sayısı; iptal ve geç iptal düşülür ve ayrıca sayılır; sınıf kırılımı. Okul takviminde kurum tatiliyse sayılar sıfır ve tatilin adı döner (K-549). Öğrenci adı dönmez. ${MANAGE}`,
        querystring: mealDailyCountQuery,
        response: { 200: mealDailyCountResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await mealDailyCountFor(contextOf(request), { date: request.query.date }),
    }),
  )

  typed.get(
    MONTHLY,
    {
      preValidation: manage,
      schema: {
        operationId: 'listMealMonthlySummary',
        tags,
        summary: 'Aylık yemek gün özeti',
        description: `Ayda yemek günü olan her abonelik: abone olunan gün (tatil hariç), tatil, iptal, geç iptal, yemek günü ve iade/mahsup için gün sayısı (= kesimden önce iptal). Tutar hesaplanmaz (ek hizmet kalemi ON-087 ile; K-549, H-119). Öğrenci adına göre, sayfalı; süzgeç ay, öğrenci adı, öğün ve sınıf. ${MANAGE}`,
        querystring: mealMonthlySummaryQuery,
        response: { 200: mealMonthlySummaryResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, month, q, mealKind, classId } = request.query
      const { items, total } = await mealMonthlySummaryFor(contextOf(request), {
        page,
        pageSize,
        month,
        q,
        mealKind,
        classId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: manage,
      schema: {
        operationId: 'getMealSubscriptionSettings',
        tags,
        summary: 'Gün iptali kesimi',
        description: `Kesim yemek gününden kaç gün önce ve saat kaçta (Europe/Istanbul); hiç kaydedilmediyse bir gün önce 15:00 ve sürüm 1 (K-548). ${MANAGE}`,
        response: { 200: mealCutoffSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await mealCutoffFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [
        ...guarded(FINANCE_MEAL_SUBSCRIPTION_ADMIN_ROLES),
        requireIfMatch(),
        captureInput(),
      ],
      schema: {
        operationId: 'setMealSubscriptionSettings',
        tags,
        summary: 'Gün iptali kesimini kaydet',
        description:
          'Kesim 0–7 gün önce, `SS:DD` saatinde; değişiklik yoksa 422 `meal_subscription_settings_unchanged`. Yeni kesim kaydedildiği andan sonraki iptallere uygulanır; yapılmış iptaller değişmez (K-548). `If-Match` zorunlu (hiç kaydedilmediyse 1). Rol: `yonetici`; diğer roller 403. Modüller `finance` ve `meals`.',
        headers: versionHeaders,
        body: mealSubscriptionSettingsSchema,
        response: { 200: mealCutoffSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await setMealCutoffCommand(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return mealCutoffSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
