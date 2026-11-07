import { z } from 'zod'

import { enrollmentCertificateSchema } from '@kampus/school-core/lib/enrollment-certificate.ts'

import { dataResponse } from './common.schemas.ts'

// Öğrenci belgesi verisi (`GET /api/v1/students/:studentId/enrollment-certificate`; DOM-KAY-027).
// Yanıt core izin listesidir: şemada olmayan kimlik, ücret ve sağlık alanı istemciye gitmez.

export const enrollmentCertificateParamsSchema = z.object({
  studentId: z.string().min(1).max(200).describe('Öğrenci kimliği'),
})

export const enrollmentCertificateResponseSchema = dataResponse(enrollmentCertificateSchema)
