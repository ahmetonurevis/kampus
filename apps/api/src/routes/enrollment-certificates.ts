import type { FastifyInstance } from 'fastify'
import type { ZodTypeProvider } from 'fastify-type-provider-zod'

import {
  ENROLLMENT_CERTIFICATE_FAMILY_ROLES,
  ENROLLMENT_CERTIFICATE_ROLES,
} from '@kampus/school-core/lib/enrollment-certificate.ts'

import { errorResponseSchema } from '../errors.ts'
import { contextOf } from '../plugins/authenticate.ts'
import {
  issueEnrollmentCertificate,
  issueFamilyEnrollmentCertificate,
} from '../services/enrollment-certificates.ts'
import { authenticatedErrors } from './common.schemas.ts'
import {
  enrollmentCertificateParamsSchema,
  enrollmentCertificateResponseSchema,
} from './enrollment-certificates.schemas.ts'

/**
 * Öğrenci belgesi verisi (docs/domain/kayit-ve-crm.md DOM-KAY-027; ON-049, ON-304). PDF web'de bu
 * yanıttan üretilir. İki uç aynı belgeyi düzenler: personel `/prospects` altında (modül `crm`), aile
 * `/finance` altında (modül `finance`). Kapalı aday modülü ailenin belgesini kapatmaz; aile ucunun
 * bağlı olduğu modül, düğmeyi taşıyan aile sayfalarıyla aynıdır (K-32).
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

  typed.get(
    '/api/v1/finance/students/:studentId/enrollment-certificate',
    {
      preValidation: [
        app.requireModule('finance'),
        app.requireRole(ENROLLMENT_CERTIFICATE_FAMILY_ROLES),
      ],
      schema: {
        operationId: 'getFamilyEnrollmentCertificate',
        tags: ['prospects'],
        summary: 'Velinin çocuğu ya da öğrencinin kendisi için öğrenci belgesi verisi',
        description:
          'Personel ucuyla aynı belgeyi düzenler (DOM-KAY-027, K-32): içerik izin listesidir, her başarılı istek yeni belge kimliği üretir ve aktör rolüyle denetim kaydına `enrollment_certificate.issue` olarak yazılır. Veli velayetli ve iletişim kısıtı olmayan bağlı çocuğunu, öğrenci kendisini alır (DOM-ILT-070, DOM-ILT-074); ödeyici bağı belge açmaz. Kapsam dışı, olmayan, arşivlenmiş ya da başka kurumun öğrencisi aynı 404. Ayrılan ve mezun öğrenci 422 `enrollment_certificate_inactive`. Roller: `veli`, `ogrenci` (diğerleri 403); `crm` modülü kapalı olsa da çalışır, `finance` modülü kapalıysa 403 `module_disabled`.',
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
      data: await issueFamilyEnrollmentCertificate(contextOf(request), request.params.studentId),
    }),
  )
}
