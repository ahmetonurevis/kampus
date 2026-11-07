import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import { ENROLLMENT_CERTIFICATE_ROLES } from '@kampus/school-core/lib/enrollment-certificate.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import { issueEnrollmentCertificate } from '../services/enrollment-certificates.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  enrollmentCertificateParamsSchema,
  enrollmentCertificateResponseSchema,
} from './enrollment-certificates.schemas.ts'

/**
 * Öğrenci belgesi verisi (docs/domain/kayit-ve-crm.md DOM-KAY-027; ON-049). PDF web'de bu yanıttan
 * üretilir. Yalnız yönetici ve ön büro, modül `crm`; veli ve öğrenci talebi OG-807'dedir.
 */
export function registerEnrollmentCertificateRoutes(app: FastifyInstance) {
  const typed = app.withTypeProvider<ZodTypeProvider>()

  typed.get(
    '/api/v1/prospects/students/:studentId/enrollment-certificate',
    {
      preValidation: [app.requireModule('crm'), app.requireRole(ENROLLMENT_CERTIFICATE_ROLES)],
      schema: {
        operationId: 'getEnrollmentCertificate',
        tags: ['prospects'],
        summary: 'Öğrenci belgesi verisi',
        description:
          'Okulda öğrenci, dil okulunda kursiyer belgesinin içeriği: kurum adı, ad, okul numarası, sınıf, sürmekte olan kurlar, eğitim yılı, düzenleme anı ve belge kimliği (core `buildEnrollmentCertificate`, DOM-KAY-027). Kimlik numarası, doğum tarihi, veli, sağlık, ücret, borç ve disiplin bilgisi yanıtta yoktur; borç belgeyi engellemez (DOM-KAY-025). Belge resmî değildir, e-Okul ve e-Özel belgesinin yerine geçmez. Her başarılı istek yeni belge kimliği üretir ve denetim kaydına `enrollment_certificate.issue` olarak yazılır (yalnız alan adları; DOM-YTK-052); belge kimliği denetim satırının kimliğidir. Ayrılan ve mezun öğrenci 422 `enrollment_certificate_inactive`. Olmayan, arşivlenmiş ya da başka kurumun öğrencisi 404. Roller: `yonetici`, `onburo` (diğerleri 403); `crm` modülü kapalıysa 403 `module_disabled`.',
        params: enrollmentCertificateParamsSchema,
        response: {
          200: enrollmentCertificateResponseSchema,
          ...authenticatedErrors,
          404: errorResponseSchema,
          422: errorResponseSchema,
        },
      },
    },
    async (request) => ({
      data: await issueEnrollmentCertificate(contextOf(request), request.params.studentId),
    }),
  )
}
