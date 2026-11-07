import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { z } from 'zod'

import {
  buildEnrollmentCertificate,
  type EnrollmentCertificate,
} from '@kampus/school-core/lib/enrollment-certificate.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'

import { listCurrentCourseNames } from '../db/enrollment-certificates.ts'
import { findRecord, loadRecords } from '../db/records.ts'
import { auditLog } from '../db/schema/audit-log.ts'
import { institutions } from '../db/schema/auth.ts'
import { institutionSettings } from '../db/schema/institution-settings.ts'
import { NotFoundError } from '../errors.ts'
import type { ServiceContext } from '../plugins/authenticate.ts'
import { mapOperationError } from './operation-runner.ts'

/** Belgenin okuduğu öğrenci alanları; kimlik, iletişim ve veli alanları hiç ayrıştırılmaz. */
const studentFacts = z.object({
  name: z.string(),
  classId: z.string(),
  number: z.string().nullish(),
  isActive: z.boolean().optional(),
})

/** Mezun ile ayrılanı ayıran yenileme alanları (core `EnrollmentRenewal`). */
const renewalFacts = z.object({
  id: z.string(),
  studentId: z.string(),
  mode: z.enum(['renew', 'graduate']),
  status: z.string(),
  year: z.number(),
  fromClassId: z.string(),
  targetClassId: z.string(),
  createdAt: z.string(),
})

const AUDITED_FIELDS = [
  'institutionName',
  'learnerName',
  'schoolNumber',
  'className',
  'courseNames',
  'academicYear',
]

/**
 * Öğrenci belgesi verisi (`GET /prospects/students/:id/enrollment-certificate`; DOM-KAY-027, DOM-YTK-052).
 * Kişisel veri dışa aktarımı olduğu için her düzenleme aynı transaction'da denetime yazılır; belge
 * kimliği denetim satırının kimliğidir, denetim yazılamazsa belge dönmez. Arşivlenmiş ya da başka
 * kurumun öğrencisi 404.
 */
export async function issueEnrollmentCertificate(
  ctx: ServiceContext,
  studentId: string,
): Promise<EnrollmentCertificate> {
  return ctx.db.transaction(async (tx) => {
    const stored = await findRecord(tx, ctx.institutionId, 'students', studentId)
    if (stored === null) throw new NotFoundError()
    const student = studentFacts.parse(stored.data)
    const [institution] = await tx
      .select({
        name: institutions.name,
        type: institutions.type,
        academicYear: institutionSettings.academicYear,
      })
      .from(institutions)
      .leftJoin(institutionSettings, eq(institutionSettings.institutionId, institutions.id))
      .where(eq(institutions.id, ctx.institutionId))
      .limit(1)
    if (!institution) throw new NotFoundError()
    // Sınıf sonradan arşivlenmiş olabilir; adı kaydın gerçeğidir.
    const classroom = await findRecord(tx, ctx.institutionId, 'classes', student.classId, {
      includeArchived: true,
    })
    const className = z.object({ name: z.string() }).safeParse(classroom?.data).data?.name ?? null
    const courseNames =
      institution.type === 'language_school'
        ? await listCurrentCourseNames(tx, ctx.institutionId, studentId, dayKey(ctx.now))
        : []
    // Yenilemeler yalnız pasif öğrencide mezun ile ayrılanı ayırmak için okunur.
    const renewals =
      student.isActive === false
        ? (
            await loadRecords(tx, ctx.institutionId, ['renewals'], {
              match: [{ field: 'studentId', values: [studentId] }],
            })
          ).map((row) => renewalFacts.parse(row.data))
        : []
    let certificate: EnrollmentCertificate
    try {
      certificate = buildEnrollmentCertificate({
        documentId: randomUUID(),
        issuedAt: ctx.now,
        institution: { name: institution.name, type: institution.type },
        student: { id: studentId, ...student },
        className,
        courseNames,
        academicYear: institution.academicYear ?? null,
        renewals,
      })
    } catch (error) {
      // Kural reddi yanıtta 422 olur; hata işlemi geri alır, denetim satırı yazılmaz.
      throw mapOperationError(error)
    }
    await tx.insert(auditLog).values({
      id: certificate.documentId,
      institutionId: ctx.institutionId,
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: 'enrollment_certificate.issue',
      entityType: 'students',
      entityId: studentId,
      changes: { fields: AUDITED_FIELDS },
      createdAt: ctx.now,
    })
    return certificate
  })
}
