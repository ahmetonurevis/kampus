import type { FastifyInstance, preValidationAsyncHookHandler } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ENROLLMENT_DOCUMENT_ROLES } from '@kampus/school-core/lib/enrollment-documents.ts'

import { contextOf } from '../plugins/authenticate.ts'
import {
  enrollmentDocumentListFor,
  enrollmentDocumentsFor,
} from '../services/enrollment-documents.ts'
import { commandErrors } from './commands.schemas.ts'
import {
  enrollmentDocumentListQuery,
  enrollmentDocumentListResponse,
  enrollmentDocumentParams,
  enrollmentDocumentsResponse,
} from './enrollment-documents.schemas.ts'

/**
 * Kayıt belgeleri uçları (docs/domain/kayit-ve-crm.md DOM-KAY-045; ON-344, K-384…K-386): kesin
 * kayıtta öğrenciye bağlanan aday belgelerinin öğrenci tarafı okuması. Yazma yoktur: bağ kesin kayıt
 * ve aday belge incelemesiyle kurulur. Modül `crm`; roller yönetici ve ön büro.
 */

const ROLES =
  'Roller: `yonetici`, `onburo` (diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`.'

export function registerEnrollmentDocumentRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()
  const guarded: preValidationAsyncHookHandler[] = [
    app.authenticate,
    app.requireModule('crm'),
    app.requireRole(ENROLLMENT_DOCUMENT_ROLES),
  ]
  const tags = ['prospects']

  typed.get(
    '/api/v1/prospects/enrollment-documents',
    {
      preValidation: guarded,
      schema: {
        operationId: 'listEnrollmentDocuments',
        tags,
        summary: 'Kayıt belgeleri listesi',
        description: `Aday kaydından gelen aktif öğrenciler, ad sırasıyla (DOM-KAY-045, K-386): öğrenciye bağlı belge sayısı, eksik zorunlu türler (kesin kayıtta ön başvuru ve kesin kayıt türlerinin ikisi de istenir; reddedilen ya da dosyası imha edilen belge eksiktir) ve incelemesi bekleyen belge sayısı. Ayrılan, mezun ve aktarımla gelen öğrenci listede yoktur. \`q\` ada göre arar, \`missingOnly=true\` yalnız eksiği olanları verir. Satır iletişim ve kimlik bilgisi taşımaz. ${ROLES}`,
        querystring: enrollmentDocumentListQuery,
        response: { 200: enrollmentDocumentListResponse, ...commandErrors },
      },
    },
    async (request) => {
      const { page, pageSize, q, missingOnly } = request.query
      const { items, total } = await enrollmentDocumentListFor(contextOf(request), {
        page,
        pageSize,
        q,
        missingOnly,
      })
      return { data: items, meta: { page, pageSize, total } }
    },
  )

  typed.get(
    '/api/v1/prospects/students/:studentId/enrollment-documents',
    {
      preValidation: guarded,
      schema: {
        operationId: 'getEnrollmentDocuments',
        tags,
        summary: 'Öğrencinin kayıt belgeleri',
        description: `Kesin kayıtta (ya da kayıttan sonraki kabulde) öğrenciye bağlanan aday belgeleri, eksik zorunlu türler ve öğrenciye bağlı özel nitelikli belge rızası (DOM-KAY-045, K-384, K-385). Dosya kopyalanmaz; belge \`GET /api/v1/prospects/{prospectId}/documents/{documentId}/url\` ile açılır ve açılış \`prospect_document.read\` olarak denetime yazılır. Özel nitelikli belgeyi açamayan (ön büro) dosya adını \`null\` görür. Reddedilen, yerine yenisi yüklenen ve rızası geri çekilip arşivlenen belge listede yoktur. Aday kaydından gelmeyen öğrencide \`prospectId\` \`null\`, liste boş. Olmayan, arşivlenmiş ya da başka kurumun öğrencisi 404. ${ROLES}`,
        params: enrollmentDocumentParams,
        response: { 200: enrollmentDocumentsResponse, ...commandErrors },
      },
    },
    async (request) => ({
      data: await enrollmentDocumentsFor(contextOf(request), request.params.studentId),
    }),
  )
}
