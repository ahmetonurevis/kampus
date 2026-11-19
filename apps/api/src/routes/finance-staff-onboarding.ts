import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_ONBOARDING_ROLES,
  jobOfferAcceptSchema,
  jobOfferInputSchema,
  jobOfferRejectSchema,
  jobOfferSendSchema,
  jobOfferUpdateSchema,
  jobOfferWithdrawSchema,
  onboardingLinkSchema,
  onboardingSettingsSchema,
  onboardingStepCompleteSchema,
  onboardingStepUpdateSchema,
} from '@kampus/school-core/lib/finance-staff-onboarding.ts'

import { contextOf, type ServiceContext } from '../plugins/authenticate.ts'
import {
  acceptJobOfferCommand,
  completeOnboardingStepCommand,
  createJobOfferCommand,
  getJobOfferFor,
  getOnboardingSettingsFor,
  jobOfferLetterFor,
  linkOnboardingAccountCommand,
  listJobOffersFor,
  listOnboardingStaffFor,
  rejectJobOfferCommand,
  reopenOnboardingStepCommand,
  sendJobOfferCommand,
  updateJobOfferCommand,
  updateOnboardingSettingsCommand,
  updateOnboardingStepCommand,
  withdrawJobOfferCommand,
} from '../services/finance-staff-onboarding.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  letterResponse,
  offerListQuery,
  offerListResponse,
  offerParams,
  offerResponse,
  settingsResponse,
  staffOptionsResponse,
  stepParams,
} from './finance-staff-onboarding.schemas.ts'

/**
 * İş teklifi ve işe başlama listesi uçları (docs/domain/finans.md DOM-FIN-121; ON-179). Modül
 * `finance`; okuma ve yazma yalnız yönetici (K-412). Sıra: 401 → 403 modül → 403 rol → `If-Match` →
 * 400 → işlem. Kampüs adaya e-posta göndermez; mektup PDF'i istemcide üretilir. Personel hesabı
 * burada açılmaz, davetle (IST-007) açılmış üyelik bağlanır. Teklif açılışı `Idempotency-Key`
 * ister; durum geçişleri ve adım işlemleri teklifin `If-Match` sürümüyle yapılır.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-412). Modül `finance`.'
const URL = '/api/v1/finance/job-offers'
const ITEM = `${URL}/:offerId`
const STEP = `${ITEM}/steps/:stepId`
const SETTINGS_URL = '/api/v1/finance/staff-onboarding-settings'
const STAFF_URL = '/api/v1/finance/staff-onboarding-staff'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

type OfferTransition = (
  ctx: ServiceContext,
  id: string,
  input: unknown,
  expectedVersion: number,
  idempotency: IdempotencyRequest | null,
) => Promise<CommandResponse>

export function registerFinanceStaffOnboardingRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_ONBOARDING_ROLES),
  ]
  const tags = ['finance-staff-onboarding']
  const transitionHeaders = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    SETTINGS_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffOnboardingSettings',
        tags,
        summary: 'İşe başlama ayarı',
        description: `Yeni işe başlama listelerine kopyalanan oryantasyon adımları (K-413). Ayar yazılmadıysa varsayılan adımlar ve \`isDefault: true\`. ${MANAGER}`,
        response: { 200: settingsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getOnboardingSettingsFor(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS_URL,
    {
      preValidation: [...guarded, captureInput()],
      schema: {
        operationId: 'updateStaffOnboardingSettings',
        tags,
        summary: 'Oryantasyon adımlarını değiştir',
        description: `Adım listesi bütünüyle yazılır (en çok 20; ad 2–120, aynı ad iki kez olmaz). İlk yazma \`If-Match\` almaz (ayar varsa 409), sonrakiler ayarın sürümünü ister. Açılmış listeler değişmez. ${MANAGER}`,
        headers: commandHeadersSchema('optional'),
        body: onboardingSettingsSchema,
        response: { 200: settingsResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateOnboardingSettingsCommand(
        contextOf(request),
        request.commandInput,
        opts.expectedVersion,
        opts.idempotency,
      )
      return settingsResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    STAFF_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffOnboardingStaff',
        tags,
        summary: 'Sorumlu ve hesap seçimi için personel',
        description: `Kurumun etkin personel üyelikleri (yönetici, öğretmen, ön büro) ada göre, en çok 500. Hesap bağlamada ve adım sorumlusunda kullanılır. ${MANAGER}`,
        response: { 200: staffOptionsResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await listOnboardingStaffFor(contextOf(request)) }),
  )

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listJobOffers',
        tags,
        summary: 'İş tekliflerini listele',
        description: `Teklifler işe başlama günü yeni olan önce; her satırda işe başlama listesinin ilerlemesi. Satırda iletişim ve ücret yoktur. \`status\` ve \`q\` (aday/personel adı, pozisyon) süzer. ${MANAGER}`,
        querystring: offerListQuery,
        response: { 200: offerListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, ...filters } = request.query
      const { items, total } = await listJobOffersFor(contextOf(request), {
        page,
        pageSize,
        ...filters,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    ITEM,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getJobOffer',
        tags,
        summary: 'Teklif ve işe başlama listesi',
        description: `Teklif, aday iletişimi, ücret önerisi, bağlı hesap ve adımlar; her adımda kaynak durumu (\`evidence\`) bugüne göre hesaplanır. Başka kurumun teklifi 404. ${MANAGER}`,
        params: offerParams,
        response: { 200: offerResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await getJobOfferFor(contextOf(request), request.params.offerId) }),
  )

  typed.get(
    `${ITEM}/letter`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getJobOfferLetter',
        tags,
        summary: 'Teklif mektubu içeriği',
        description: `Mektup PDF'inin verisi (kurum adı, aday adı, pozisyon, başlangıç, ücret önerisi, son yanıt günü, not). Her okuma \`finance.job_offer.letter_read\` denetimine yazılır. Kampüs e-posta göndermez. Başka kurumun teklifi 404. ${MANAGER}`,
        params: offerParams,
        response: { 200: letterResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await jobOfferLetterFor(contextOf(request), request.params.offerId),
    }),
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createJobOffer',
        tags,
        summary: 'İş teklifi hazırla',
        description: `Taslak teklif: aday adı ve isteğe bağlı iletişim (personel değilse) ya da kurumdaki personelin üyeliği, pozisyon, rol, başlangıç, ücret türü ve önerisi (kuruş), isteğe bağlı son yanıt günü ve not. Personel üyeliği bulunamazsa 422 \`job_offer_not_found\`, personel değilse 422 \`job_offer_not_staff\`, pasifse 422 \`job_offer_inactive\`. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: jobOfferInputSchema,
        response: { 201: offerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createJobOfferCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = offerResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}`)
      return body
    },
  )

  typed.patch(
    ITEM,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateJobOffer',
        tags,
        summary: 'Taslak teklifi düzelt',
        description: `Verilen alanlar değişir. Yalnız taslak (422 \`job_offer_not_draft\`); personel seçilmiş teklifte aday adı ve iletişimi yazılmaz (422 \`job_offer_candidate_is_staff\`); değişiklik yoksa 422 \`job_offer_unchanged\`. \`If-Match\` zorunlu. ${MANAGER}`,
        headers: transitionHeaders,
        params: offerParams,
        body: jobOfferUpdateSchema,
        response: { 200: offerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateJobOfferCommand(
        contextOf(request),
        request.params.offerId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return offerResponse.parse(sendBody(reply, result))
    },
  )

  const transition = (spec: {
    verb: 'send' | 'accept' | 'reject' | 'withdraw' | 'link-account'
    operationId: string
    summary: string
    description: string
    body:
      | typeof jobOfferSendSchema
      | typeof jobOfferAcceptSchema
      | typeof jobOfferRejectSchema
      | typeof jobOfferWithdrawSchema
      | typeof onboardingLinkSchema
    run: OfferTransition
  }) =>
    typed.post(
      `${ITEM}/${spec.verb}`,
      {
        preValidation: [...guarded, requireIfMatch(), captureInput()],
        schema: {
          operationId: spec.operationId,
          tags,
          summary: spec.summary,
          description: `${spec.description} \`If-Match\` zorunlu. Başka kurumun teklifi 404. ${MANAGER}`,
          headers: transitionHeaders,
          params: offerParams,
          body: spec.body,
          response: { 200: offerResponse, ...commandErrors },
        },
      },
      async (request, reply) => {
        const opts = options(request, 'optional')
        const result = await spec.run(
          contextOf(request),
          request.params.offerId,
          request.commandInput,
          expected(opts.expectedVersion),
          opts.idempotency,
        )
        return offerResponse.parse(sendBody(reply, result))
      },
    )

  transition({
    verb: 'send',
    operationId: 'sendJobOffer',
    summary: 'Gönderildi olarak işaretle',
    description:
      'Taslak teklif adaya iletildiği günle `sent` olur; Kampüs e-posta göndermez (K-412). Taslak değilse 422 `job_offer_not_draft`, gelecek gün 422 `job_offer_date_in_future`.',
    body: jobOfferSendSchema,
    run: sendJobOfferCommand,
  })
  transition({
    verb: 'accept',
    operationId: 'acceptJobOffer',
    summary: 'Kabulü kaydet',
    description:
      'Gönderilmiş teklif kabul günüyle `accepted` olur ve işe başlama listesi aynı işlemde açılır (K-413): hesap, kurumun zorunlu özlük belgesi türleri, öğretmende çalışma onayı, ücret tanımı, kıdem başlangıcı, zimmet (isteğe bağlı) ve oryantasyon adımları; son gün işe başlama günü. Gönderilmemiş teklif 422 `job_offer_not_sent`, gönderimden önceki gün 422 `job_offer_decision_before_sent`, son yanıt günü geçtiyse 422 `job_offer_expired`.',
    body: jobOfferAcceptSchema,
    run: acceptJobOfferCommand,
  })
  transition({
    verb: 'reject',
    operationId: 'rejectJobOffer',
    summary: 'Reddi kaydet',
    description:
      'Gönderilmiş teklif ret günü ve isteğe bağlı gerekçeyle (denetime yazılmaz) `rejected` olur. Gönderilmemiş teklif 422 `job_offer_not_sent`.',
    body: jobOfferRejectSchema,
    run: rejectJobOfferCommand,
  })
  transition({
    verb: 'withdraw',
    operationId: 'withdrawJobOffer',
    summary: 'Teklifi geri çek',
    description:
      'Taslak, gönderilmiş ya da işe başlama listesi tamamlanmamış kabul edilmiş teklif `withdrawn` olur; liste kapanır. Reddedilen ya da geri çekilen 422 `job_offer_closed`, listesi tamamlanan 422 `job_offer_onboarding_completed`.',
    body: jobOfferWithdrawSchema,
    run: withdrawJobOfferCommand,
  })
  transition({
    verb: 'link-account',
    operationId: 'linkJobOfferAccount',
    summary: 'Personel hesabını bağla',
    description:
      'Davetle (IST-007) açılmış personel üyeliği listeye bağlanır; hesap adımı bugünle tamamlanır, adayın e-posta ve telefonu silinir (personel kaydı esas). Hesap burada açılmaz. Liste açık değilse 422 `onboarding_not_open`; üyelik yoksa 422 `onboarding_member_not_found`, personel değilse 422 `onboarding_member_not_staff`, pasifse 422 `onboarding_member_inactive`, rolü tekliftekinden farklıysa 422 `onboarding_member_role_mismatch`, zaten bağlıysa 422 `onboarding_member_unchanged`, hesaba dayanan adım işaretliyse 422 `onboarding_member_locked`, sürmekte olan başka listeye bağlıysa 422 `onboarding_member_linked`.',
    body: onboardingLinkSchema,
    run: linkOnboardingAccountCommand,
  })

  typed.patch(
    STEP,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'updateOnboardingStep',
        tags,
        summary: 'Adımın sorumlusunu ve son gününü değiştir',
        description: `Sorumlu kurumun etkin personeli (422 \`onboarding_responsible_not_found\`, \`onboarding_responsible_not_staff\`, \`onboarding_responsible_inactive\`); \`null\` kaldırır. Liste açık değilse 422 \`onboarding_not_open\`. \`If-Match\` teklifin sürümüdür. Başka teklifin adımı 404. ${MANAGER}`,
        headers: transitionHeaders,
        params: stepParams,
        body: onboardingStepUpdateSchema,
        response: { 200: offerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await updateOnboardingStepCommand(
        contextOf(request),
        request.params.offerId,
        request.params.stepId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return offerResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${STEP}/complete`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'completeOnboardingStep',
        tags,
        summary: 'Adımı tamamlandı işaretle',
        description: `Tamamlanma günü (bugünden sonra olamaz, 422 \`onboarding_date_in_future\`) ve isteğe bağlı not. Kaynak isteyen adım (hesap, özlük belgesi, çalışma onayı, ücret, kıdem) kaynak kaydı yoksa 422 \`onboarding_step_evidence_missing\` (K-413); işaretli adım 422 \`onboarding_step_completed\`; liste açık değilse 422 \`onboarding_not_open\`. Zorunlu adımların hepsi bitince liste tamamlanır (K-414). \`If-Match\` teklifin sürümüdür. ${MANAGER}`,
        headers: transitionHeaders,
        params: stepParams,
        body: onboardingStepCompleteSchema,
        response: { 200: offerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await completeOnboardingStepCommand(
        contextOf(request),
        request.params.offerId,
        request.params.stepId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return offerResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${STEP}/reopen`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'reopenOnboardingStep',
        tags,
        summary: 'Adımın işaretini geri al',
        description: `İşaret, gün, işaretleyen ve not silinir. İşaretli olmayan adım 422 \`onboarding_step_not_completed\`; liste açık değilse 422 \`onboarding_not_open\`. \`If-Match\` teklifin sürümüdür. ${MANAGER}`,
        headers: transitionHeaders,
        params: stepParams,
        response: { 200: offerResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await reopenOnboardingStepCommand(
        contextOf(request),
        request.params.offerId,
        request.params.stepId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return offerResponse.parse(sendBody(reply, result))
    },
  )
}
