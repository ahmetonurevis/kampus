import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_STAFF_CERTIFICATE_ROLES,
  staffCertificateCancelSchema,
  staffCertificateInputSchema,
} from '@kampus/school-core/lib/finance-staff-certificates.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  cancelStaffCertificateCommand,
  createStaffCertificateCommand,
  listCertificateStaffFor,
  listStaffCertificatesFor,
  staffCertificateDocumentFor,
} from '../services/finance-staff-certificates.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  certificateDocumentResponse,
  certificateListQuery,
  certificateListResponse,
  certificateParams,
  certificateResponse,
  certificateStaffQuery,
  certificateStaffResponse,
} from './finance-staff-certificates.schemas.ts'

/**
 * Personel çalışma ve hizmet belgesi uçları (docs/domain/finans.md DOM-FIN-106; ON-175). Modül
 * `finance`; okuma ve yazma yalnız yönetici (K-342). Belge üretimi numara keser: `Idempotency-Key`
 * zorunlu. İçerik dondurulur, belge silinmez; `…/cancel` gerekçeyle iptal eder (K-341). T.C. kimlik
 * no ve ücret yalnız `…/document` ucunda döner ve okuma denetime düşer (K-343).
 */

const MANAGER =
  'Rol: yalnız `yonetici` (K-342; muhasebe rolü açılsa da görmez, belge ücret içerebilir). Modül `finance`.'
const URL = '/api/v1/finance/staff-certificates'
const STAFF_URL = '/api/v1/finance/staff-certificate-staff'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceStaffCertificateRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_STAFF_CERTIFICATE_ROLES),
  ]
  const tags = ['finance-staff-certificates']

  typed.get(
    URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffCertificates',
        tags,
        summary: 'Personel belgelerini listele',
        description: `Düzenlenen çalışma ve hizmet belgeleri, yeni numara önce (DOM-FIN-106). Personel adında aranır; tür, durum (\`valid\`, \`cancelled\`), yıl ve personelle süzülür. Liste T.C. kimlik no ve ücret tutarı taşımaz, yalnız var olup olmadıklarını gösterir (K-343). ${MANAGER}`,
        querystring: certificateListQuery,
        response: { 200: certificateListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, kind, status, year, membershipId } = request.query
      const { items, total } = await listStaffCertificatesFor(contextOf(request), {
        page,
        pageSize,
        q,
        kind,
        status,
        year,
        membershipId,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    STAFF_URL,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listStaffCertificateStaff',
        tags,
        summary: 'Belge düzenlenebilecek personel',
        description: `Kurumun yönetici, öğretmen ve ön büro üyelikleri ada göre; etkin mi, pasifleştirme günü (ayrılış önerisi) ve iptal edilmemiş son belgedeki görev ile işe giriş günü (öneri; personel kaydında bu alanlar yoktur, K-340). ${MANAGER}`,
        querystring: certificateStaffQuery,
        response: { 200: certificateStaffResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q } = request.query
      const { items, total } = await listCertificateStaffFor(contextOf(request), {
        page,
        pageSize,
        q,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.post(
    URL,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'createStaffCertificate',
        tags,
        summary: 'Personel belgesi düzenle',
        description: `Çalışma belgesi (\`employment\`; etkin personel, görev, işe giriş, isteğe bağlı ücret ve muhatap) ya da hizmet belgesi (\`service\`; ayrılan personel, giriş–çıkış günü, görev; 4857 md. 28). Görev ve günler elle girilir (K-340); T.C. kimlik no isteğe bağlıdır, muhatap boşsa "İlgili makama". Numara kurumda yılın sıradaki numarasıdır (\`PB-<yıl>-<sıra>\`); içerik bu anda dondurulur (K-341). Ücret yalnız çalışma belgesinde \`includeWage: true\` ise düzenleme günündeki ana ücret tanımından kopyalanır, tanım yoksa 422 \`staff_certificate_wage_missing\` (K-342). Ayrılan personele çalışma belgesi 422 \`staff_certificate_staff_inactive\`, etkin personele hizmet belgesi 422 \`staff_certificate_staff_active\`; olmayan üyelik 422 \`staff_certificate_staff_not_found\`, öğrenci ya da veli 422 \`staff_certificate_not_staff\`; ileri tarihli giriş ya da çıkış 422. Denetim kaydına alan adları yazılır. \`Idempotency-Key\` zorunlu. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: false }),
        body: staffCertificateInputSchema,
        response: { 201: certificateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await createStaffCertificateCommand(
        contextOf(request),
        request.commandInput,
        options(request, 'required').idempotency,
      )
      const body = certificateResponse.parse(sendBody(reply, result))
      reply.header('location', `${URL}/${body.data.id}/document`)
      return body
    },
  )

  typed.get(
    `${URL}/:certificateId/document`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getStaffCertificateDocument',
        tags,
        summary: 'Personel belgesinin içeriği',
        description: `PDF'in verisi: dondurulmuş içeriğin tamamı (kurum adı, personel adı, görev, günler, T.C. kimlik no, muhatap, ücret, düzenleyen, iptal). Önizleme ve indirme aynı veriden üretilir. Okuma aynı transaction'da denetime yazılır (\`finance.staff_certificate.read\`, alan adları; K-343). İptal edilmiş belge de okunur (PDF "İptal edildi" basar). Olmayan ya da başka kurumun belgesi 404. ${MANAGER}`,
        params: certificateParams,
        response: { 200: certificateDocumentResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await staffCertificateDocumentFor(contextOf(request), request.params.certificateId),
    }),
  )

  typed.post(
    `${URL}/:certificateId/cancel`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'cancelStaffCertificate',
        tags,
        summary: 'Personel belgesini iptal et',
        description: `Gerekçeyle (5–500 karakter); belge silinmez, numarası yeniden kullanılmaz, PDF "İptal edildi" ibaresiyle kalır (K-341). İptal edilmiş belge 409 \`staff_certificate_cancelled\`, sürüm tutmazsa 409. Gerekçe denetim kaydına yazılmaz. \`If-Match\` zorunlu. Başka kurumun belgesi 404. ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: 'required' }),
        params: certificateParams,
        body: staffCertificateCancelSchema,
        response: { 200: certificateResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await cancelStaffCertificateCommand(
        contextOf(request),
        request.params.certificateId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return certificateResponse.parse(sendBody(reply, result))
    },
  )
}
