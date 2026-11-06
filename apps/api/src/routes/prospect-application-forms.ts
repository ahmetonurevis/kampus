import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  prospectApplicationSchema,
  updateApplicationFormSchema,
} from '@kampus/school-core/lib/prospect-application-form.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  applicationFormSettings,
  applicationFramePolicy,
  publicApplicationForm,
  rotateApplicationFormKey,
  submitApplication,
  updateApplicationForm,
} from '../services/prospect-application-forms.ts'
import { verificationRateKey } from './certificates.ts'
import { ifMatchVersion } from './command-support.ts'
import { requireIfMatch } from './commands.ts'
import { commandErrors } from './commands.schemas.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  applicationFormKeyParamsSchema,
  applicationFormRotateHeadersSchema,
  applicationFormSettingsResponseSchema,
  applicationFormVersionHeadersSchema,
  applicationFramePolicyResponseSchema,
  applicationReceivedResponseSchema,
  applicationSubmissionErrors,
  publicApplicationErrors,
  publicApplicationFormResponseSchema,
} from './prospect-application-forms.schemas.ts'

/**
 * Kurum sitesine gömülen ön başvuru formu (ON-133; docs/domain/kayit-ve-crm.md DOM-KAY-002, -003,
 * -004, -007, -009; IST-145).
 *
 * Üç uç oturumsuzdur ve `requireModule` taşımaz: kurum oturumdan değil form anahtarından çözülür,
 * `crm` kapalıysa serviste aynı 404 döner (403 `module_disabled` kurumun varlığını söylerdi). CORS'a
 * kurum sitesi eklenmez: form kendi kökenimizdeki sayfada iframe içinde çalışır, istek aynı köktendir.
 * Bu yüzden CSRF denetimi de gevşetilmez; başka kökenden doğrudan gönderim 403 `csrf_rejected`.
 *
 * Hız sınırı IP başınadır (IPv6'da /64); gövde sınırı yalnız bu uçta daraltılır. Proxy havuzuna karşı
 * serviste kurum başına günlük tavan vardır.
 */

const FORM_READS_PER_MINUTE = 30
const FRAME_POLICY_READS_PER_MINUTE = 60
const SUBMISSIONS_PER_WINDOW = 5
const SUBMISSION_WINDOW = '10 minutes'
const SUBMISSION_BODY_LIMIT = 4 * 1024

const MANAGER = ['yonetici'] as const
const SETTINGS_PATH = '/api/v1/prospects/application-form'
const PUBLIC_PATH = '/api/v1/prospects/application-forms/:formKey'

const ipLimit = (max: number, timeWindow: string) => ({
  rateLimit: {
    max,
    timeWindow,
    keyGenerator: (request: FastifyRequest) => verificationRateKey(request.ip),
  },
})

export function registerProspectApplicationFormRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const managerGuards = [app.requireModule('crm'), app.requireRole(MANAGER)]

  typed.get(
    SETTINGS_PATH,
    {
      preValidation: managerGuards,
      schema: {
        operationId: 'getProspectApplicationFormSettings',
        tags: ['prospects'],
        summary: 'Web başvuru formu ayarı',
        description:
          'Yönetici formun anahtarını, durumunu, site adresini ve yayımlı aday aydınlatma sürümünü görür (ON-133). Modül `crm`. Rol: `yonetici`.',
        response: { 200: applicationFormSettingsResponseSchema, ...authenticatedErrors },
      },
    },
    async (request) => ({ data: await applicationFormSettings(contextOf(request)) }),
  )

  typed.patch(
    SETTINGS_PATH,
    {
      preValidation: [...managerGuards, requireIfMatch()],
      schema: {
        operationId: 'updateProspectApplicationForm',
        tags: ['prospects'],
        summary: 'Web başvuru formunu aç, kapat ya da site adresini yaz',
        description:
          'Kapalı form açık uçta geçersiz anahtarla aynı 404 alır. Site adresi yalnız https kök adresidir (`frame-ancestors` değeri); `null` adresi kaldırır, form yalnız doğrudan bağlantıyla açılır. Aydınlatması yayımlanmamış form açılamaz: 422 `application_form_notice_missing` (DOM-KAY-003). İlk anahtar üretilmeden 404. Modül `crm`. Rol: `yonetici`.',
        headers: applicationFormVersionHeadersSchema,
        body: updateApplicationFormSchema,
        response: { 200: applicationFormSettingsResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await updateApplicationForm(
        contextOf(request),
        request.body,
        ifMatchVersion(request) ?? 0,
      ),
    }),
  )

  typed.post(
    `${SETTINGS_PATH}/rotate-key`,
    {
      preValidation: managerGuards,
      schema: {
        operationId: 'rotateProspectApplicationFormKey',
        tags: ['prospects'],
        summary: 'Web başvuru formu anahtarı üret ya da yenile',
        description:
          'İlk üretimde form kapalı başlar. Yenilemede eski anahtar hemen geçersiz olur, eski gömme kodu 404 alır; form varken `If-Match` zorunludur. Anahtar değeri denetime yazılmaz. Modül `crm`. Rol: `yonetici`.',
        headers: applicationFormRotateHeadersSchema,
        response: { 200: applicationFormSettingsResponseSchema, ...commandErrors },
      },
    },
    async (request) => ({
      data: await rotateApplicationFormKey(contextOf(request), ifMatchVersion(request)),
    }),
  )

  typed.get(
    PUBLIC_PATH,
    {
      config: ipLimit(FORM_READS_PER_MINUTE, '1 minute'),
      schema: {
        operationId: 'getPublicProspectApplicationForm',
        tags: ['prospects'],
        summary: 'Başvuru formunun açık verisi',
        description: `Kimlik gerektirmez; kurum anahtardan çözülür. Yanıt kurum adı, aktif kampüsler, yaş grubu sorusu ve güncel aday aydınlatma metnidir. Biçimi bozuk, yenilenmiş ya da bilinmeyen anahtar, kapalı form, kapalı \`crm\` modülü, metni ya da kampüsü olmayan form aynı 404 \`not_found\`. IP başına dakikada ${FORM_READS_PER_MINUTE} istek; aşılırsa 429 \`rate_limited\` ve \`Retry-After\`.`,
        params: applicationFormKeyParamsSchema,
        response: { 200: publicApplicationFormResponseSchema, ...publicApplicationErrors },
      },
    },
    async (request) => ({ data: await publicApplicationForm(app.db, request.params.formKey) }),
  )

  typed.get(
    `${PUBLIC_PATH}/frame-policy`,
    {
      config: ipLimit(FRAME_POLICY_READS_PER_MINUTE, '1 minute'),
      schema: {
        operationId: 'getProspectApplicationFramePolicy',
        tags: ['prospects'],
        summary: 'Başvuru sayfasının gömülebileceği site',
        description: `Sayfayı sunan vekil, \`/basvuru/:anahtar\` yanıtının \`frame-ancestors\` değerini buradan okur (\`X-Frame-Ancestors\` başlığı ve gövde). Hep 200'dür; geçersiz anahtar, kapalı form ve site adresi olmayan form \`'none'\` alır. IP başına dakikada ${FRAME_POLICY_READS_PER_MINUTE} istek.`,
        params: applicationFormKeyParamsSchema,
        response: { 200: applicationFramePolicyResponseSchema, ...publicApplicationErrors },
      },
    },
    async (request, reply) => {
      const frameAncestors = await applicationFramePolicy(app.db, request.params.formKey)
      void reply.header('x-frame-ancestors', frameAncestors)
      return { data: { frameAncestors } }
    },
  )

  typed.post(
    `${PUBLIC_PATH}/submissions`,
    {
      bodyLimit: SUBMISSION_BODY_LIMIT,
      config: ipLimit(SUBMISSIONS_PER_WINDOW, SUBMISSION_WINDOW),
      schema: {
        operationId: 'submitProspectApplication',
        tags: ['prospects'],
        summary: 'Başvuru gönder',
        description: `Kimlik gerektirmez. Aday \`Yeni aday\` aşamasında, \`Web sitesi\` kaynağıyla açılır (DOM-KAY-001, -007, -009). Gövde katıdır: ad, telefon, isteğe bağlı e-posta, kampüs, ilgi, 18 yaş altında veli adı, aydınlatma sürümü ve kanal bazında ticari ileti onayı (varsayılan kapalı, DOM-KAY-004); T.C. kimlik no, doğum tarihi, adres, kaynak, referans, kardeş, kurum kimliği ve bilinmeyen alan 400. Eski aydınlatma sürümü 409 \`notice_outdated\` (DOM-KAY-003). Yanıt kişi varlığını belli etmez: aynı iletişimli açık aday varsa yeni kayıt açılmaz, adayın kartına temas notu düşülür (aday başına 24 saatte bir, DOM-KAY-002), onay yazılmaz ve aynı 202 döner; gizli alan (\`website\`) dolu gönderim ve kurumun günlük form tavanı doluyken gönderim de hiçbir şey yazmadan aynı 202'yi alır. Kurum kilidi 3 saniyede alınamazsa hiçbir şey yazılmaz: 409 \`conflict\`, aynı istek yeniden denenebilir. Başka kökenden gönderim 403 \`csrf_rejected\`. Gövde en çok ${SUBMISSION_BODY_LIMIT} bayt (413). IP başına ${SUBMISSION_WINDOW.replace(' minutes', ' dakikada')} ${SUBMISSIONS_PER_WINDOW} gönderim; aşılırsa 429 \`rate_limited\` ve \`Retry-After\`. Telefon, e-posta ve ad loglanmaz.`,
        params: applicationFormKeyParamsSchema,
        body: prospectApplicationSchema,
        response: { 202: applicationReceivedResponseSchema, ...applicationSubmissionErrors },
      },
    },
    async (request, reply) => {
      await submitApplication(
        { db: app.db, now: app.clock(), log: request.log },
        request.params.formKey,
        request.body,
      )
      void reply.status(202)
      return { data: { received: true as const } }
    },
  )
}
