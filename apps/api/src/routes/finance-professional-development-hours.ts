import type { FastifyInstance, FastifyReply, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES,
  professionalDevelopmentCertificateInputSchema,
  professionalDevelopmentDocumentInputSchema,
  professionalDevelopmentTargetInputSchema,
} from '@kampus/school-core/lib/finance-professional-development-hours.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  attachDocumentCommand,
  currentProfessionalDevelopmentYear,
  linkCertificateCommand,
  listHoursFor,
  professionalDevelopmentDocumentUrl,
  removeDocumentCommand,
  targetFor,
  unlinkCertificateCommand,
  updateTargetCommand,
} from '../services/finance-professional-development-hours.ts'
import type { CommandResponse } from '../services/operation-runner.ts'
import type { StorageDriver } from '../storage/storage.ts'
import { captureInput, options, rejectIfMatch, requireIfMatch } from './commands.ts'
import { commandErrors, commandHeadersSchema } from './commands.schemas.ts'
import {
  documentUrlResponse,
  hoursListQuery,
  hoursListResponse,
  targetParams,
  targetResponse,
} from './finance-professional-development-hours.schemas.ts'
import { enrollmentParams, enrollmentResponse } from './finance-professional-development.schemas.ts'

/**
 * Mesleki gelişim saati, hedef, katılım belgesi ve sertifika uçları (docs/domain/finans.md
 * DOM-FIN-144; ON-215; K-487…K-489). Modül `finance`; okuma ve yazma yalnız yönetici. Sertifika bağı
 * yeni özlük belgesi açabildiği için `Idempotency-Key` ister; belge ve bağ değişiklikleri katılımın
 * `If-Match` sürümüyle.
 */

const MANAGER = 'Rol: yalnız `yonetici` (K-487). Modül `finance`.'
const TARGETS = '/api/v1/finance/professional-development-targets'
const HOURS = '/api/v1/finance/professional-development-hours'
const ENROLLMENT = '/api/v1/finance/professional-development/:programId/enrollments/:enrollmentId'

function sendBody(reply: FastifyReply, result: CommandResponse): unknown {
  if (result.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(result.statusCode)
  return result.body
}

function expected(version: number | null): number {
  if (version === null) throw new Error('If-Match guard did not run')
  return version
}

export function registerFinanceProfessionalDevelopmentHoursRoutes(
  app: FastifyInstance,
  storage: StorageDriver,
) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('finance'),
    app.requireRole(FINANCE_PROFESSIONAL_DEVELOPMENT_HOURS_ROLES),
  ]
  const tags = ['finance-professional-development']
  const versioned = commandHeadersSchema('optional', { ifMatch: 'required' })

  typed.get(
    HOURS,
    {
      preValidation: guarded,
      schema: {
        operationId: 'listProfessionalDevelopmentHours',
        tags,
        summary: 'Mesleki gelişim saati özeti',
        description: `Etkin personelin öğretim yılındaki tamamlanan saati, hedefi ve eksik saati, ada göre (DOM-FIN-144, K-487). Tamamlanan saat "katıldı" işaretli atamaların katılım saatidir; katılım günü tarihli eğitimde bitiş günü, sürekli eğitimde işaretin İstanbul günüdür ve kurumun kayıtlı öğretim yılı (yoksa 1 Eylül – 31 Ağustos) aralığına düşmelidir. Hedef yoksa \`targetHours\`, \`missingHours\` ve \`met\` boştur ve \`status\` süzgeci boş liste döner; hedef varken süzgeç yalnız hedef rollerindeki personeli döner. \`academicYear\` verilmezse içinde bulunulan yıl; yanıtın \`meta.academicYear\` alanındadır. ${MANAGER}`,
        querystring: hoursListQuery,
        response: { 200: hoursListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const ctx = contextOf(request)
      const { page, pageSize, q, status } = request.query
      const academicYear =
        request.query.academicYear ?? (await currentProfessionalDevelopmentYear(ctx))
      const { items, total } = await listHoursFor(ctx, {
        academicYear,
        q,
        status,
        page,
        pageSize,
      })
      return { data: items, meta: { page, pageSize, total, academicYear } }
    },
  )

  typed.get(
    `${TARGETS}/:academicYear`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getProfessionalDevelopmentTarget',
        tags,
        summary: 'Öğretim yılı hedef saati',
        description: `Kurumun öğretim yılı hedefi (K-487) ve yılın gün aralığı. Hedef yazılmamışsa \`targetHours\` boş, roller boş liste. ${MANAGER}`,
        params: targetParams,
        response: { 200: targetResponse, ...commandErrors },
      },
    },
    async (request) => ({ data: await targetFor(contextOf(request), request.params.academicYear) }),
  )

  typed.patch(
    `${TARGETS}/:academicYear`,
    {
      preValidation: [...guarded, rejectIfMatch(), captureInput()],
      schema: {
        operationId: 'updateProfessionalDevelopmentTarget',
        tags,
        summary: 'Öğretim yılı hedef saatini yaz',
        description: `Hedef tam saat (1–500) ve uygulandığı personel rolleri (varsayılan öğretmen); \`targetHours: null\` hedefi kaldırır (K-487). Ayar bütünüyle yazılır, kayıtlı öğretim yılı şart değildir. Denetim \`finance.professional_development.target\` (alan adları). ${MANAGER}`,
        headers: commandHeadersSchema('optional', { ifMatch: false }),
        params: targetParams,
        body: professionalDevelopmentTargetInputSchema,
        response: { 200: targetResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const result = await updateTargetCommand(
        contextOf(request),
        request.params.academicYear,
        request.commandInput,
        options(request, 'optional').idempotency,
      )
      return targetResponse.parse(sendBody(reply, result))
    },
  )

  typed.post(
    `${ENROLLMENT}/document`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'attachProfessionalDevelopmentDocument',
        tags,
        summary: 'Katılım belgesi ekle',
        description: `Yüklenmiş \`document\` amaçlı dosyayı katılıma bağlar (K-488). Yalnız "katıldı" katılımda (422 \`professional_development_document_not_attended\`); PDF (422 \`professional_development_document_format\`), en çok 10 MB (422 \`professional_development_document_too_large\`). Başkasının ya da hazır olmayan dosya 422 \`file_unavailable\`/\`file_not_ready\`, başka kayda bağlı dosya 409 \`file_already_attached\`. Eski belgenin dosya bağı kalkar. Arşivdeki eğitimde de eklenir. Denetim \`finance.professional_development.document_attach\`. \`If-Match\` katılımın sürümü. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: versioned,
        params: enrollmentParams,
        body: professionalDevelopmentDocumentInputSchema,
        response: { 200: enrollmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await attachDocumentCommand(
        contextOf(request),
        request.params.programId,
        request.params.enrollmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return enrollmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${ENROLLMENT}/document`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'removeProfessionalDevelopmentDocument',
        tags,
        summary: 'Katılım belgesini kaldır',
        description: `Belgenin katılımla bağı kalkar; bağsız dosyayı temizlik işi siler. Belge yoksa 422 \`professional_development_no_document\`. Denetim \`finance.professional_development.document_remove\`. \`If-Match\` zorunlu. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: versioned,
        params: enrollmentParams,
        response: { 200: enrollmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await removeDocumentCommand(
        contextOf(request),
        request.params.programId,
        request.params.enrollmentId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return enrollmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.get(
    `${ENROLLMENT}/document/url`,
    {
      preValidation: guarded,
      schema: {
        operationId: 'getProfessionalDevelopmentDocumentUrl',
        tags,
        summary: 'Katılım belgesini aç',
        description: `Kısa ömürlü imzalı bağlantı (5 dk). Her üretim denetim kaydına \`finance.professional_development.document_open\` olarak yazılır. Belge yoksa 422 \`professional_development_no_document\`. Dosya \`GET /files/{fileId}/url\` yolundan açılmaz (404). Başka kurumun kaydı 404. ${MANAGER}`,
        params: enrollmentParams,
        response: { 200: documentUrlResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await professionalDevelopmentDocumentUrl(
        contextOf(request),
        storage,
        request.params.programId,
        request.params.enrollmentId,
      ),
    }),
  )

  typed.post(
    `${ENROLLMENT}/certificate`,
    {
      preValidation: [...guarded, requireIfMatch(), captureInput()],
      schema: {
        operationId: 'linkProfessionalDevelopmentCertificate',
        tags,
        summary: 'Katılıma sertifika bağla',
        description: `Sertifika ikinci kez tutulmaz, özlük belgesidir (DOM-FIN-113; K-488). \`source: existing\`: personelin yerine geçilmemiş \`certificate\` türü belgesi (başka personelin ya da yoksa 422 \`professional_development_certificate_not_found\`, başka tür 422 \`professional_development_certificate_wrong_type\`, yerine geçilmiş 422 \`professional_development_certificate_superseded\`, başka katılıma bağlı 409 \`professional_development_certificate_linked\`). \`source: upload\`: yüklenen PDF (en çok 10 MB) ile aynı işlemde yeni sertifika özlük belgesi açılır; özlük belgesi kuralları geçer (ör. 422 \`staff_document_date_in_future\`, ayrılmış personel 422 \`staff_document_staff_inactive\`). Yalnız "katıldı" katılımda; zaten bağlıysa 409 \`professional_development_certificate_exists\`. Denetim \`finance.professional_development.certificate_link\` (yeni belgede ayrıca \`finance.staff_document.create\`). \`Idempotency-Key\` ve \`If-Match\` zorunlu. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: commandHeadersSchema('required', { ifMatch: 'required' }),
        params: enrollmentParams,
        body: professionalDevelopmentCertificateInputSchema,
        response: { 200: enrollmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'required')
      const result = await linkCertificateCommand(
        contextOf(request),
        request.params.programId,
        request.params.enrollmentId,
        request.commandInput,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return enrollmentResponse.parse(sendBody(reply, result))
    },
  )

  typed.delete(
    `${ENROLLMENT}/certificate`,
    {
      preValidation: [...guarded, requireIfMatch()],
      schema: {
        operationId: 'unlinkProfessionalDevelopmentCertificate',
        tags,
        summary: 'Sertifika bağını kaldır',
        description: `Katılımın sertifika bağı kalkar; özlük belgesi kalır (K-488). Bağ yoksa 422 \`professional_development_no_certificate\`. Denetim \`finance.professional_development.certificate_unlink\`. \`If-Match\` zorunlu. Başka kurumun kaydı 404. ${MANAGER}`,
        headers: versioned,
        params: enrollmentParams,
        response: { 200: enrollmentResponse, ...commandErrors },
      },
    },
    async (request, reply) => {
      const opts = options(request, 'optional')
      const result = await unlinkCertificateCommand(
        contextOf(request),
        request.params.programId,
        request.params.enrollmentId,
        expected(opts.expectedVersion),
        opts.idempotency,
      )
      return enrollmentResponse.parse(sendBody(reply, result))
    },
  )
}
