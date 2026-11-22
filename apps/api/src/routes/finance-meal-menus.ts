import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_MEAL_ADMIN_ROLES,
  FINANCE_MEAL_FAMILY_ROLES,
  FINANCE_MEAL_MANAGE_ROLES,
  mealMenuCreateSchema,
  mealMenuSettingsSchema,
  mealMenuUpdateSchema,
} from '@kampus/school-core/lib/finance-meal-menus.ts'

import type { Role } from '../auth.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveMealMenuCommand,
  createMealMenuCommand,
  getMealMenuFor,
  listMealMenusFor,
  listMyMealMenusFor,
  mealSettingsFor,
  publishMealMenuCommand,
  setMealSettingsCommand,
  unpublishMealMenuCommand,
  updateMealMenuCommand,
} from '../services/finance-meal-menus.ts'
import { assertSchoolLifeModule } from '../services/finance-transport.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  mealMenuArchivedResponse,
  mealMenuListQuery,
  mealMenuListResponse,
  mealMenuParams,
  mealMenuResponse,
  mealSettingsResponse,
  myMealMenusQuery,
  myMealMenusResponse,
} from './finance-meal-menus.schemas.ts'

/**
 * Yemek menüsü uçları (docs/domain/finans.md DOM-FIN-157; ON-090, ON-149; IST-099; K-526…K-528).
 * Modül `finance` ve okul yaşamıyla ortak `meals` anahtarı. Menü yönetici ve ön büroda; geçmiş gün
 * düzeltmesi ve öğün ayarı yöneticide; veli ve öğrenci `GET …/meal-menus/my` ile yalnız
 * yayımlanmış menüyü kampüs kapsamıyla okur. Oluşturma `Idempotency-Key`; düzenleme, yayım ve
 * arşiv `If-Match` ister.
 */

const MANAGE =
  'Rol: `yonetici`, `onburo`; diğer roller 403. Modüller `finance` ve `meals` (kapalıysa 403).'
const BASE = '/api/v1/finance/meal-menus'
const MENU = `${BASE}/:menuId`
const SETTINGS = '/api/v1/finance/meal-menu-settings'

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

export function registerFinanceMealMenuRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const meals: preValidationAsyncHookHandler = async (request) =>
    assertSchoolLifeModule(contextOf(request), 'meals')
  const guarded = (roles: readonly Role[]) => [
    app.authenticate,
    app.requireModule('finance'),
    meals,
    app.requireRole(roles),
  ]
  const manage = guarded(FINANCE_MEAL_MANAGE_ROLES)
  const admin = guarded(FINANCE_MEAL_ADMIN_ROLES)
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const tags = ['finance-meal-menus']

  typed.get(
    `${BASE}/my`,
    {
      preValidation: guarded(FINANCE_MEAL_FAMILY_ROLES),
      schema: {
        operationId: 'listMyMealMenus',
        tags,
        summary: 'Haftalık yemek menüsü (veli ve öğrenci)',
        description:
          'Velinin bağlı çocuklarının ya da öğrencinin kampüsü için haftanın **yayımlanmış** menüsü: kampüsün kendi menüsü, yoksa bütün kampüslerin menüsü (K-526). Gün başına öğünler, kalemler, 14 alerjen işareti, besin değeri ve günlük toplam (K-528). Taslak görünmez; menü yoksa `menus` boş. Kapsam sunucuda core `mealMenus` kuralıyla daralır. Rol: `veli`, `ogrenci`; diğer roller 403. Modüller `finance` ve `meals`.',
        querystring: myMealMenusQuery,
        response: { 200: myMealMenusResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await listMyMealMenusFor(
        contextOf(request),
        request.query.weekStart === undefined ? {} : { weekStart: request.query.weekStart },
      ),
    }),
  )

  typed.get(
    BASE,
    {
      preValidation: manage,
      schema: {
        operationId: 'listMealMenus',
        tags,
        summary: 'Haftalık yemek menüleri',
        description: `Arşivlenmemiş menüler, yeni hafta önce; kampüs, durum, kalem ve gün sayısı. Süzgeç durum, kampüs (\`all\` bütün kampüs menüleri) ve başlangıç haftası. ${MANAGE}`,
        querystring: mealMenuListQuery,
        response: { 200: mealMenuListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, status, branchId, from } = request.query
      const { items, total } = await listMealMenusFor(contextOf(request), {
        page,
        pageSize,
        status,
        branchId,
        from,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    BASE,
    {
      preValidation: [...manage, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createMealMenu',
        tags,
        summary: 'Haftalık menü aç ya da kopyala',
        description: `Taslak menü açar: hafta (pazartesi; tamamen geçmiş 422 \`meal_menu_week_past\`, bir yıldan ileri 422 \`meal_menu_week_too_far\`), isteğe bağlı kampüs (yok 422 \`meal_menu_branch_not_found\`). Aynı hafta ve kampüste ikinci menü 409 \`meal_menu_exists\`. \`copyFromMenuId\` verilirse kaynağın kalemleri aynı hafta günlerine kopyalanır, kurumun kapalı öğünü atlanır (kaynak yok 422 \`meal_menu_source_not_found\`; K-526). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        body: mealMenuCreateSchema,
        response: { 201: mealMenuResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createMealMenuCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = mealMenuResponse.parse(sendBody(reply, result))
      reply.header('location', `${BASE}/${body.data.id}`)
      return body
    },
  )

  typed.get(
    MENU,
    {
      preValidation: manage,
      schema: {
        operationId: 'getMealMenu',
        tags,
        summary: 'Haftalık menü ayrıntısı',
        description: `Haftanın yedi günü: öğünler, kalemler, alerjen işaretleri, besin değeri ve günlük toplam (K-528); geçmiş gün düzeltmeleri. Başka kurumun ya da arşivli menü 404. ${MANAGE}`,
        params: mealMenuParams,
        response: { 200: mealMenuResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getMealMenuFor(contextOf(request), request.params.menuId),
    }),
  )

  typed.patch(
    MENU,
    {
      preValidation: [...manage, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateMealMenu',
        tags,
        summary: 'Menü hücrelerini yaz',
        description: `Gönderilen gün × öğün hücreleri yeniden yazılır (boş liste hücreyi boşaltır); gönderilmeyen hücre değişmez. Gün haftada olmalı (422 \`meal_menu_date_outside_week\`), öğün kurumda açık olmalı (422 \`meal_kind_disabled\`); hiçbir hücre değişmediyse 422 \`meal_menu_unchanged\`. Yayımlanmış menüde bugünden önceki gün yalnız yöneticinin gerekçeli düzeltmesidir: gerekçe yok 422 \`meal_menu_day_past\`, yönetici değil 403 \`meal_menu_correction_forbidden\`, gerekçe gereksiz 422 \`meal_menu_correction_not_needed\`; önceki kalemler arşivde kalır (K-527). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: mealMenuParams,
        body: mealMenuUpdateSchema,
        response: { 200: mealMenuResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await updateMealMenuCommand(
        contextOf(request),
        request.params.menuId,
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return mealMenuResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${MENU}/publish`,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'publishMealMenu',
        tags,
        summary: 'Menüyü yayımla',
        description: `Taslak menü veli ve öğrenciye açılır. Yayımlanmış 422 \`meal_menu_not_draft\`, yemeksiz 422 \`meal_menu_empty\` (K-527). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: mealMenuParams,
        response: { 200: mealMenuResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await publishMealMenuCommand(
        contextOf(request),
        request.params.menuId,
        expectedVersion,
        idempotency,
      )
      return mealMenuResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${MENU}/unpublish`,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'unpublishMealMenu',
        tags,
        summary: 'Menüyü yayımdan kaldır',
        description: `Hafta başlamadan menü taslağa döner; başlamış haftada 422 \`meal_menu_week_started\`, taslakta 422 \`meal_menu_not_published\` (K-527). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: mealMenuParams,
        response: { 200: mealMenuResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await unpublishMealMenuCommand(
        contextOf(request),
        request.params.menuId,
        expectedVersion,
        idempotency,
      )
      return mealMenuResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    MENU,
    {
      preValidation: [...manage, requireIfMatch()],
      schema: {
        operationId: 'archiveMealMenu',
        tags,
        summary: 'Taslak menüyü arşivle',
        description: `Yalnız taslak arşivlenir; yayımlanmış 422 \`meal_menu_published\` (K-527). \`If-Match\` zorunlu. ${MANAGE}`,
        headers: versionHeaders,
        params: mealMenuParams,
        response: { 200: mealMenuArchivedResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await archiveMealMenuCommand(
        contextOf(request),
        request.params.menuId,
        expectedVersion,
        idempotency,
      )
      return mealMenuArchivedResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    SETTINGS,
    {
      preValidation: manage,
      schema: {
        operationId: 'getMealMenuSettings',
        tags,
        summary: 'Öğün ayarı',
        description: `Kurumun kullandığı öğünler (kahvaltı, öğle, ikindi ara öğünü); hiç kaydedilmediyse yalnız öğle ve sürüm 1 (K-526). ${MANAGE}`,
        response: { 200: mealSettingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await mealSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS,
    {
      preValidation: [...admin, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'setMealMenuSettings',
        tags,
        summary: 'Öğün ayarını kaydet',
        description:
          'En az bir öğün; değişiklik yoksa 422 `meal_menu_settings_unchanged`. Kapanan öğünün mevcut kalemleri görünür kalır, yeni kalem yazılmaz (K-526). `If-Match` zorunlu (hiç kaydedilmediyse 1). Rol: `yonetici`; diğer roller 403. Modüller `finance` ve `meals`.',
        headers: versionHeaders,
        body: mealMenuSettingsSchema,
        response: { 200: mealSettingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const { expectedVersion, idempotency } = versionOf(request)
      const result = await setMealSettingsCommand(
        contextOf(request),
        request.commandInput,
        expectedVersion,
        idempotency,
      )
      return mealSettingsResponse.parse(sendBody(reply, result))
    },
  )
}
