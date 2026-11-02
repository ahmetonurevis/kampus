import type { FastifyInstance, FastifyReply } from 'fastify'
import type { z } from 'zod'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { WRITE_ACTION_ROLES, type WriteAction } from '@kampus/school-core/lib/authorize.ts'

import { contextOf } from '../plugins/authenticate.ts'
import { consentStatus, giveConsent, listConsents, withdrawConsent } from '../services/consents.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import {
  acknowledgeNotice,
  currentConsentText,
  currentNotice,
  listNotices,
  publishNotice,
} from '../services/privacy-notices.ts'
import { idempotencyOf, ifMatchVersion } from './command-support.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import { readErrors } from './communication.schemas.ts'
import {
  acknowledgeBodySchema,
  acknowledgementResponseSchema,
  consentBodySchema,
  consentListQuerySchema,
  consentListResponseSchema,
  consentParamsSchema,
  consentResponseSchema,
  consentStatusQuerySchema,
  consentStatusResponseSchema,
  consentTextParamsSchema,
  consentTextResponseSchema,
  currentNoticeResponseSchema,
  noticeParamsSchema,
  privacyNoticeBodySchema,
  privacyNoticeListQuerySchema,
  privacyNoticeListResponseSchema,
  privacyNoticeResponseSchema,
} from './privacy.schemas.ts'
import { emptyCommandBodySchema } from './workflows.schemas.ts'

/**
 * Aydınlatma (IST-016) ve açık rıza (IST-017) uçları; docs/domain/yetki-ve-kapsam.md
 * DOM-YTK-056…062, guvenlik-kvkk §9. Rıza ve aydınlatma platform yeteneğidir: modüle bağlı
 * değildir, kapatılamaz. Rol listesi core yetki tablosundan (`WRITE_ACTION_ROLES`) gelir; veri
 * sahibine göre karar (veli/öğrenci, 18 yaş, velayet) core `lib/consents.ts` ve
 * `lib/privacy-notices.ts`'tedir. Sıra: 401 → 403 rol → başlıklar → 400 gövde → işlem.
 */

const rolesOf = (action: WriteAction) =>
  WRITE_ACTION_ROLES[action].map((role) => `\`${role}\``).join(', ')

function send<T>(reply: FastifyReply, response: CommandResponse, schema: z.ZodType<T>): T {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}

export function registerPrivacyRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const role = (action: WriteAction) => app.requireRole(WRITE_ACTION_ROLES[action])

  typed.get(
    '/api/v1/privacy-notices',
    {
      preValidation: role('notice.publish'),
      schema: {
        operationId: 'listPrivacyNotices',
        tags: ['privacy'],
        summary: 'Aydınlatma ve rıza metinleri',
        description: `Kurumun yayımlanmış bütün aydınlatma (\`notice\`) ve rıza (\`consent_text\`) metni sürümleri, konu ve sürüm sırasıyla, sayfalı. Yayımlanmış metin değişmez. Bilinmeyen parametre 400. Roller: ${rolesOf('notice.publish')}; diğer roller 403.`,
        querystring: privacyNoticeListQuerySchema,
        response: { 200: privacyNoticeListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listNotices(contextOf(request), { page, pageSize })
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.post(
    '/api/v1/privacy-notices',
    {
      preValidation: role('notice.publish'),
      schema: {
        operationId: 'publishPrivacyNotice',
        tags: ['privacy'],
        summary: 'Aydınlatma veya rıza metni yayımla',
        description: `Yeni metin sürümü yayımlar (core \`planNoticePublication\`, DOM-YTK-056, DOM-YTK-060): sürüm konunun (kitle ya da amaç) son sürümünün bir fazlasıdır; yayımlanmış metin değiştirilmez, düzeltme yeni sürümdür. Rıza metninde \`requiresReconsent\` doğruysa eski sürüme verilmiş rızalar geçersiz sayılır ve yeniden rıza istenir. Eşzamanlı yayım çakışırsa 409. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. Denetime yalnız alan adları (metin gövdesi loglanmaz). Roller: ${rolesOf('notice.publish')}; diğer roller 403.`,
        body: privacyNoticeBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: privacyNoticeResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const body = send(
        reply,
        await publishNotice(contextOf(request), request.body, idempotencyOf(request, true)),
        privacyNoticeResponseSchema,
      )
      reply.header('location', `/api/v1/privacy-notices/${body.data.id}`)
      return body
    },
  )

  typed.get(
    '/api/v1/privacy-notices/current',
    {
      preValidation: role('notice.acknowledge'),
      schema: {
        operationId: 'getCurrentPrivacyNotice',
        tags: ['privacy'],
        summary: 'Güncel aydınlatma metni',
        description: `Oturum rolünün kitlesine ait son aydınlatma metni ve kullanıcının bu sürümü görüp görmediği (IST-016, DOM-YTK-056). İlk girişte ve yeni sürüm yayımlanınca \`needsAcknowledgement\` doğrudur; istemci metni gösterip \`POST /privacy-notices/{noticeId}/acknowledge\` çağırır. Yayımlanmış metin yoksa \`notice\` boştur. Roller: ${rolesOf('notice.acknowledge')}.`,
        response: { 200: currentNoticeResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await currentNotice(contextOf(request)) }),
  )

  typed.post(
    '/api/v1/privacy-notices/:noticeId/acknowledge',
    {
      preValidation: role('notice.acknowledge'),
      schema: {
        operationId: 'acknowledgePrivacyNotice',
        tags: ['privacy'],
        summary: 'Aydınlatma metninin gösterildiğini kaydet',
        description: `Aydınlatma metninin kullanıcıya gösterildiğini kaydeder (DOM-YTK-056); aydınlatma onay değildir, yalnız gösterim kaydıdır. Yalnız kitlenin son sürümü kaydedilir: eski sürüm 409 \`notice_outdated\`, başka kitlenin metni, rıza metni, olmayan ya da başka kurumun metni 404. İlk kayıt 201; aynı sürümün ikinci kaydı yeni satır açmaz, ilk gösterimi 200 ile döndürür. \`Idempotency-Key\` isteğe bağlı. Roller: ${rolesOf('notice.acknowledge')}.`,
        params: noticeParamsSchema,
        body: acknowledgeBodySchema,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: {
          200: acknowledgementResponseSchema,
          201: acknowledgementResponseSchema,
          ...commandErrors,
        },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      return send(
        reply,
        await acknowledgeNotice(
          contextOf(request),
          { noticeId: request.params.noticeId, channel: request.body.channel },
          idempotencyOf(request, false),
        ),
        acknowledgementResponseSchema,
      )
    },
  )

  typed.get(
    '/api/v1/consent-texts/:purpose',
    {
      preValidation: role('consent.status'),
      schema: {
        operationId: 'getConsentText',
        tags: ['privacy'],
        summary: 'Amacın güncel rıza metni',
        description: `Amacın son yayımlanmış rıza metni ve geçerli rıza için gereken en düşük metin sürümü (DOM-YTK-058, DOM-YTK-060). Rıza formu bu metni gösterir ve \`textId\` olarak gönderir. Metin yoksa 404 \`consent_text_not_found\` (o amaçta rıza alınamaz). Roller: ${rolesOf('consent.status')}.`,
        params: consentTextParamsSchema,
        response: { 200: consentTextResponseSchema, ...readErrors },
      },
    },
    async (request) => ({
      data: await currentConsentText(contextOf(request), request.params.purpose),
    }),
  )

  typed.get(
    '/api/v1/consents',
    {
      preValidation: role('consent.read'),
      schema: {
        operationId: 'listConsents',
        tags: ['privacy'],
        summary: 'Rıza kayıtları',
        description: `Veri sahibinin rıza ve itiraz satırları, amaç ve veriliş sırasıyla, sayfalı (DOM-ILT-034). \`studentId\` verilirse öğrenci amaçları, verilmezse oturum sahibinin hesap amaçları (tanıtım iletisi). \`status=open\` geri çekilmemiş satırlar (varsayılan), \`all\` geçmiş dahil; bugün geçerli olup olmadığı \`GET /consents/status\`'tadır. Kapsam: yönetici ve ön büro kurumun öğrencileri, veli bağlı çocukları, öğrenci kendi kaydı; kapsam dışı ya da başka kurumun öğrencisi 404 \`not_found\`. Öğretmen satırları okuyamaz (403), yalnız var/yok sonucunu görür (DOM-YTK-061). Rızayı veren kullanıcının kimliği (\`grantedByUserId\`) yalnız yönetici ve ön büroya döner; veli ve öğrenci yalnız ilişkiyi (\`grantorRelation\`) görür. Bilinmeyen parametre 400. Roller: ${rolesOf('consent.read')}.`,
        querystring: consentListQuerySchema,
        response: { 200: consentListResponseSchema, ...readErrors },
      },
    },
    async (request) => {
      const { page, pageSize } = request.query
      const result = await listConsents(contextOf(request), request.query)
      return { data: result.items, meta: { page, pageSize, total: result.total } }
    },
  )

  typed.get(
    '/api/v1/consents/status',
    {
      preValidation: role('consent.status'),
      schema: {
        operationId: 'getConsentStatus',
        tags: ['privacy'],
        summary: 'Amaç başına geçerli rıza sonucu',
        description: `Amaç başına yalnız var/yok sonucu (DOM-YTK-061): geçerli rıza var ve etkin itiraz yok. Süresi dolmuş (eğitim yılı sonu, 18. yaş günü), geri çekilmiş ya da yeniden rıza gerektiren eski metne verilmiş rıza geçersizdir; geri çekme anında yansır. \`studentId\` verilirse öğrenci amaçları, verilmezse oturum sahibinin hesap amaçları. Kapsam: yönetici ve ön büro kurumun, öğretmen yalnız ders verdiği sınıfların öğrencileri, veli bağlı çocukları, öğrenci kendisi; kapsam dışı ya da başka kurumun öğrencisi 404 \`not_found\`. Roller: ${rolesOf('consent.status')}.`,
        querystring: consentStatusQuerySchema,
        response: { 200: consentStatusResponseSchema, ...readErrors },
      },
    },
    async (request) => ({ data: await consentStatus(contextOf(request), request.query) }),
  )

  typed.post(
    '/api/v1/consents',
    {
      preValidation: role('consent.give'),
      schema: {
        operationId: 'giveConsent',
        tags: ['privacy'],
        summary: 'Açık rıza ver veya itiraz kaydet',
        description: `Amaç ve metin sürümüne bağlı açık rıza ya da öğrenci itirazı kaydeder (IST-017, core \`planConsent\`; DOM-YTK-057, -058, -062). Öğrenci amaçlarında \`studentId\` zorunludur: 18 yaş altında yalnız doğrulanmış velayet sahibi veli (aksi 403 \`consent_guardian_required\` / \`consent_custody_required\`), 18 ve üstünde yalnız öğrencinin kendisi (veli 403 \`consent_adult_self\`); yaş güncel doğum tarihinden, Europe/Istanbul gününe göre. Hesap amaçlarında \`studentId\` verilmez. \`textId\` amacın güncel metni olmalı: eski sürüm 409 \`consent_text_outdated\`, olmayan metin 404 \`consent_text_not_found\`. Aynı amaçta geçerli rıza varsa 409 \`consent_exists\`; süresi dolmuş satır aynı işlemde \`renewed\` ile kapanır. Eğitim yılı amaçları kurum eğitim yılının sonunda (ertesi yılın 1 Eylül 00:00 Europe/Istanbul) düşer; eğitim yılı tanımsızsa 422 \`academic_year_required\`. Kapsam dışı ya da başka kurumun öğrencisi 404. Gövdedeki bilinmeyen alan (\`institutionId\` dahil) 400. \`Idempotency-Key\` zorunlu; başarı 201 ve \`Location\`. Denetime yalnız alan adları. Roller: ${rolesOf('consent.give')}; personel rıza veremez (403).`,
        body: consentBodySchema,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        response: { 201: consentResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      const body = send(
        reply,
        await giveConsent(contextOf(request), request.body, idempotencyOf(request, true)),
        consentResponseSchema,
      )
      reply.header('location', `/api/v1/consents/${body.data.id}`)
      return body
    },
  )

  typed.post(
    '/api/v1/consents/:consentId/withdraw',
    {
      preValidation: role('consent.withdraw'),
      schema: {
        operationId: 'withdrawConsent',
        tags: ['privacy'],
        summary: 'Rızayı veya itirazı geri çek',
        description: `Rızayı ya da itirazı geri çeker (DOM-YTK-059): tek işlem, anında etkili; \`GET /consents/status\` hemen yok döner. Geri çekme rızayı veren tarafındır (18 yaş altında velayetli veli, 18 ve üstünde öğrenci). Konuşma kaydı rızası geri çekilirse öğrencinin o amaçtaki dosyaları (kayda bağlanmış ve öğrencinin hesabının yüklediği henüz bağlanmamış) aynı işlemde imhaya işaretlenir (\`retention_until = now\`); bağlanmamış kayıt artık bağlanamaz. İkinci geri çekme 409 \`consent_already_withdrawn\`; olmayan, kapsam dışı ya da başka kurumun kaydı 404. Gövde yok ya da boş nesne. \`Idempotency-Key\` isteğe bağlı. Roller: ${rolesOf('consent.withdraw')}.`,
        params: consentParamsSchema,
        body: emptyCommandBodySchema.strict().optional(),
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        response: { 200: consentResponseSchema, ...commandErrors },
      },
    },
    async (request, reply) => {
      ifMatchVersion(request, false)
      return send(
        reply,
        await withdrawConsent(
          contextOf(request),
          request.params.consentId,
          idempotencyOf(request, false),
        ),
        consentResponseSchema,
      )
    },
  )
}
