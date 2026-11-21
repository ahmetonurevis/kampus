import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preValidationAsyncHookHandler,
} from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  TRIP_DAY_FAMILY_ROLES,
  TRIP_DAY_MANAGER_ROLES,
  TRIP_DAY_OPERATOR_ROLES,
  TRIP_DAY_ROLES,
  tripDayAssignSchema,
  tripDayCheckCompleteSchema,
  tripDayCheckProceedSchema,
  tripDayCheckStartSchema,
  tripDayGroupSchema,
  tripDayGroupUpdateSchema,
  tripDayMarksSchema,
} from '@kampus/school-core/lib/finance-trip-day.ts'

import type { Role } from '../auth.ts'
import { fieldCipherFromConfig } from '../lib/field-crypto.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  archiveTripDayGroupCommand,
  assignTripDayCommand,
  closeTripDayCheckCommand,
  createTripDayGroupCommand,
  getTripDayCardFor,
  getTripDayFor,
  listMyTripDaysFor,
  markTripDayCheckCommand,
  startTripDayCheckCommand,
  updateTripDayGroupCommand,
} from '../services/finance-trip-day.ts'
import type { HealthProfileDeps } from '../services/health-profiles.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  myTripDaysResponse,
  tripDayCardQuery,
  tripDayCardResponse,
  tripDayCheckParams,
  tripDayGroupParams,
  tripDayParams,
  tripDayResponse,
} from './finance-trip-day.schemas.ts'

/**
 * Gezi günü yoklaması ve acil kart uçları (docs/domain/finans.md DOM-FIN-154; ON-157; K-517…K-519).
 * Modül `finance`. Grup ve dağıtım yönetici ve ön büro; tur yönetici ve grubun sorumlusu (öğretmen
 * yalnız kendi grubunu görür, başkası 404); acil kart yönetici ve sorumlu (taze oturum); veli ve
 * öğrenci `GET /finance/trip-days/my` ile son kontrol noktasını okur (bildirim yok). Sıra: 401 →
 * 403 modül → 403 rol → başlık → 400 → işlem. Açılışlar ve işaretler `Idempotency-Key`, düzeltme,
 * arşiv ve tur bitirme `If-Match` ister.
 */

const URL = '/api/v1/finance/trip-plans/:planId/day'
const READ =
  'Rol: `yonetici`, `onburo`, `ogretmen` (öğretmen yalnız sorumlusu olduğu grubu görür; grubu yoksa 404; K-517). Modül `finance`.'
const MANAGE = 'Rol: `yonetici`, `onburo` (K-517). Modül `finance`.'
const OPERATE =
  'Rol: `yonetici`, `ogretmen`; turu yönetici ve grubun sorumlusu yürütür, sorumlusu olmadığı grup öğretmene 404 (K-517). Modül `finance`.'
const CARD_PER_MINUTE = 10

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceTripDayRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  // Sağlık profili okuması aynı servisle yapılır; anahtar uygulama kurulurken bir kez türetilir.
  const cipher = fieldCipherFromConfig(app.config)
  const healthDeps = (request: FastifyRequest): HealthProfileDeps => ({
    cipher,
    audit: { secret: app.config.BETTER_AUTH_SECRET, ip: request.ip, requestId: request.id },
  })
  const guard = (roles: readonly Role[]): preValidationAsyncHookHandler[] => [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(roles),
  ]
  const readers = guard(TRIP_DAY_ROLES)
  const managers = guard(TRIP_DAY_MANAGER_ROLES)
  const operators = guard(TRIP_DAY_OPERATOR_ROLES)
  const tags = ['finance-trip-plans']
  const versionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })
  const createHeaders = commandHeadersSchema('required', { ifMatch: false })

  typed.get(
    '/api/v1/finance/trip-days/my',
    {
      preValidation: guard(TRIP_DAY_FAMILY_ROLES),
      schema: {
        operationId: 'listMyTripDays',
        tags,
        summary: 'Çocuğumun gezideki son kontrol noktası',
        description:
          'Veli bağlı çocuklarının, öğrenci kendinin bugün süren (çıkış–dönüş günleri, Europe/Istanbul) gezilerindeki grubu, grup sorumlusu ve son kapanan kontrol noktasındaki işareti (`present`/`absent`; tur henüz kapanmadıysa boş). Gerekçe ve diğer öğrenciler dönmez; bildirim gönderilmez (K-519). Rol: `veli`, `ogrenci`. Modül `finance`.',
        response: { 200: myTripDaysResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listMyTripDaysFor(contextOf(request)) }),
  )

  typed.get(
    URL,
    {
      preValidation: readers,
      schema: {
        operationId: 'getTripDay',
        tags,
        summary: 'Gezi günü görünümü',
        description: `Planın grupları (ad, plaka, sorumlu), grupların öğrencileri ve yoklama turları (kontrol noktası, durum, sayılar, öğrenci başına var/yok), görevliler ve grubu olmayan katılımcılar. Katılımcılar bağlı ücretli etkinliğin asil katılımlarıdır; etkinliksiz planda kayıtlı öğrenciler (K-517). Katılımı iptal edilen öğrenci grup listesinden düşer. Eksikle devam gerekçesi yalnız turu yürütebilene döner. Olmayan ya da başka kurumun planı 404. ${READ}`,
        params: tripDayParams,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getTripDayFor(contextOf(request), request.params.planId) }),
  )

  typed.post(
    `${URL}/groups`,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createTripDayGroup',
        tags,
        summary: 'Gezi günü grubu aç',
        description: `Araç ya da grup: ad (2–60; planda tekil, 409 \`trip_day_group_name_taken\`), isteğe bağlı plaka (\`34 ABC 123\`) ve grup sorumlusu (planın görevlisi; değilse 422 \`trip_day_leader_not_staff\`). Tamamlanmış ya da iptal edilmiş plan 422 \`trip_day_plan_closed\`; planda en çok 30 grup (422 \`trip_day_groups_full\`). Denetim \`finance.trip_day.group_create\`. \`Idempotency-Key\` zorunlu. Başarı 201; yanıt gezi günü görünümüdür. ${MANAGE}`,
        headers: createHeaders,
        params: tripDayParams,
        body: tripDayGroupSchema,
        response: { 201: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createTripDayGroupCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.patch(
    `${URL}/groups/:groupId`,
    {
      preValidation: [...managers, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateTripDayGroup',
        tags,
        summary: 'Gezi günü grubunu düzelt',
        description: `Verilen alanlar değişir (ad, plaka, sorumlu); kurallar açmadakiyle aynıdır. Süren turu olan grubun sorumlusu değişmez (422 \`trip_day_check_open\`). Değişmeyen alan yazılmaz. Denetim \`finance.trip_day.group_update\`. \`If-Match\` grubun sürümü; tutmazsa 409. ${MANAGE}`,
        headers: versionHeaders,
        params: tripDayGroupParams,
        body: tripDayGroupUpdateSchema,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateTripDayGroupCommand(
        contextOf(request),
        request.params.planId,
        request.params.groupId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${URL}/groups/:groupId`,
    {
      preValidation: [...managers, requireIfMatch()],
      schema: {
        operationId: 'archiveTripDayGroup',
        tags,
        summary: 'Gezi günü grubunu kaldır',
        description: `Grup arşivlenir, öğrencileri grupsuz kalır. Yoklama turu açılmış grup kaldırılmaz (422 \`trip_day_group_has_checks\`). Denetim \`finance.trip_day.group_archive\`. \`If-Match\` grubun sürümü. ${MANAGE}`,
        headers: versionHeaders,
        params: tripDayGroupParams,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await archiveTripDayGroupCommand(
        contextOf(request),
        request.params.planId,
        request.params.groupId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/assignments`,
    {
      preValidation: [...managers, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'assignTripDayStudents',
        tags,
        summary: 'Öğrencileri gruplara dağıt',
        description: `1–200 öğrenciyi gruba ekler ya da taşır; \`groupId: null\` gruptan çıkarır. Yalnız gezinin katılımcısı (422 \`trip_day_student_not_participant\`); olmayan grup 422 \`trip_day_group_not_found\`. Hedefte ya da öğrencinin grubunda süren tur varken dağıtım değişmez (422 \`trip_day_check_open\`). Zaten o gruptaki öğrenci için bir şey yazılmaz. Denetim \`finance.trip_day.assign\` (öğrenci kimliği yazılmaz). \`Idempotency-Key\` zorunlu. ${MANAGE}`,
        headers: createHeaders,
        params: tripDayParams,
        body: tripDayAssignSchema,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await assignTripDayCommand(
        contextOf(request),
        request.params.planId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/groups/:groupId/checks`,
    {
      preValidation: [...operators, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'startTripDayCheck',
        tags,
        summary: 'Yoklama turu aç',
        description: `Grubun adlandırılmış kontrol noktasında (\`Okuldan çıkış\`, \`Varış\`, \`Dönüş çıkışı\`, \`Okula varış\` …; sayı serbest) yeni tur açar. Plan onaylı olmalı (422 \`trip_day_plan_not_approved\`), bugün gezi günlerinden biri (422 \`trip_day_not_today\`), grupta öğrenci olmalı (422 \`trip_day_group_empty\`); süren tur varken 409 \`trip_day_check_open\`; grupta en çok 50 tur. Denetim \`finance.trip_day.check_start\`. \`Idempotency-Key\` zorunlu; başarı 201. ${OPERATE}`,
        headers: createHeaders,
        params: tripDayGroupParams,
        body: tripDayCheckStartSchema,
        response: { 201: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await startTripDayCheckCommand(
        contextOf(request),
        request.params.planId,
        request.params.groupId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/checks/:checkId/marks`,
    {
      preValidation: [...operators, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'markTripDayCheck',
        tags,
        summary: 'Var ya da yok işaretle',
        description: `Süren turda 1–200 öğrenciyi \`present\` (var) ya da \`absent\` (yok) işaretler; yalnız grubun öğrencisi (422 \`trip_day_student_not_in_group\`), biten tur 422 \`trip_day_check_closed\`. İşaret anı verilmezse sunucu anıdır; çevrimdışı yeniden denemede cihazın işaret anı gönderilir: ileri olamaz (5 dk pay; 422 \`trip_day_mark_future\`), 24 saatten eski olamaz (422 \`trip_day_mark_too_old\`). Aynı işaretin yinelenmesi yazmaz. Konum alınmaz. Denetim \`finance.trip_day.check_mark\`. \`Idempotency-Key\` zorunlu; \`If-Match\` yok (çevrimdışı kuyruktaki ardışık işaretler sırayla uygulanır). ${OPERATE}`,
        headers: createHeaders,
        params: tripDayCheckParams,
        body: tripDayMarksSchema,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await markTripDayCheckCommand(
        contextOf(request),
        request.params.planId,
        request.params.checkId,
        request.commandInput,
        options(request, 'required').idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/checks/:checkId/complete`,
    {
      preValidation: [...operators, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeTripDayCheck',
        tags,
        summary: 'Yoklama turunu tamam yap',
        description: `Bütün öğrenciler "var" ise tur \`complete\` olur. Yok ya da işaretlenmemiş öğrenci varken 422 \`trip_day_check_missing\` (güvenlik; eksikle devam ayrı ve gerekçeli adımdır). Biten tur 409 \`trip_day_check_already_closed\`. Gövde boş nesnedir. Denetim \`finance.trip_day.check_complete\`. \`If-Match\` turun sürümü. ${OPERATE}`,
        headers: versionHeaders,
        params: tripDayCheckParams,
        body: tripDayCheckCompleteSchema,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await closeTripDayCheckCommand(
        contextOf(request),
        request.params.planId,
        request.params.checkId,
        'complete',
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${URL}/checks/:checkId/proceed`,
    {
      preValidation: [...operators, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'proceedTripDayCheck',
        tags,
        summary: 'Eksikle devam et',
        description: `Gerekçeyle (5–500) turu \`incomplete\` kapatır: bütün öğrenciler işaretlenmiş olmalı (422 \`trip_day_check_unmarked\`), en az biri "yok" olmalı (422 \`trip_day_check_no_missing\`; herkes varsa tur tamam yapılır). Eksik sayısı ve gerekçe turda saklanır; gerekçe denetime ve loga yazılmaz. Denetim \`finance.trip_day.check_proceed\`. \`If-Match\` turun sürümü. ${OPERATE}`,
        headers: versionHeaders,
        params: tripDayCheckParams,
        body: tripDayCheckProceedSchema,
        response: { 200: tripDayResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await closeTripDayCheckCommand(
        contextOf(request),
        request.params.planId,
        request.params.checkId,
        'proceed',
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return tripDayResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${URL}/groups/:groupId/emergency-card`,
    {
      config: {
        rateLimit: {
          max: CARD_PER_MINUTE,
          timeWindow: '1 minute',
          hook: 'preHandler' as const,
          keyGenerator: (request: FastifyRequest) =>
            `trip-day-card:${request.auth?.userId ?? request.ip}`,
        },
      },
      preValidation: [...operators, app.requireFreshSession],
      schema: {
        operationId: 'getTripDayEmergencyCard',
        tags,
        summary: 'Grubun acil kartı (PDF verisi)',
        description: `Grubun öğrencileri ada göre: sınıf, acil iletişim (velayetli ve iletişim kısıtı olmayan veli bağları, bağ yoksa öğrenci kaydındaki veli; en çok iki kişi; K-501) ve en az bilgiyle sağlık uyarısı: yalnız "alerji / kronik durum / ilaç var" türü, kısaltılmış acil talimat ve revirde kart günü için onaylı ilaç işareti; alerjen, ilaç adı ve doz yok (K-518). Sağlık bilgisi sağlık profili servisinden okunur (her öğrencide \`health_profile.read\` ya da \`health_profile.read_emergency\` denetimi); okuyanın profil erişimi yoksa \`source: unavailable\` ve yalnız revir işareti. \`purpose=office\` (varsayılan) veli telefonu maskeli; \`purpose=emergency\` tam telefon: yönetici her zaman, grup sorumlusu yalnız gezi günlerinde (403 \`trip_day_card_full_forbidden\`). Taze oturum ister (403 \`reauthentication_required\`), kullanıcı başına 10/dk. Her açılış denetime düşer: \`finance.trip_day.emergency_card\` ya da \`finance.trip_day.emergency_card_full\` (alan adları ve sayılar). Web PDF'i bu veriden üretir. ${OPERATE}`,
        params: tripDayGroupParams,
        querystring: tripDayCardQuery,
        response: { 200: tripDayCardResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await getTripDayCardFor(
        contextOf(request),
        healthDeps(request),
        request.params.planId,
        request.params.groupId,
        request.query.purpose,
      ),
    }),
  )
}
