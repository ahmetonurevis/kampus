import { randomUUID } from 'node:crypto'

import { createSeed } from '../../../packages/school-core/src/data/seed.ts'
import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import {
  insertScholarshipAward,
  insertScholarshipProgram,
} from '../../../apps/api/src/db/finance-scholarships.ts'

import { e2e } from './env.ts'

/**
 * Burs fonu ekranı için kesin kayıtta atanmış gibi bir burs (DOM-FIN-025, DOM-FIN-068). Atama
 * kesin kayıt akışında yazılır; bu ekranda o akış denenmediği için program ve atama doğrudan
 * veritabanına konur. Kurumun eğitim yılı tenant'taki gibi örnek veriden gelir.
 */
export async function seedScholarshipAward(input: {
  institutionId: string
  studentId: string
  amountCents: number
}): Promise<string> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const now = new Date()
  const academicYear = createSeed(now).academicYear
  const programId = randomUUID()
  const awardId = randomUUID()
  try {
    await insertScholarshipProgram(db, input.institutionId, {
      id: programId,
      academicYear,
      name: 'E2E başarı bursu',
      conditions: 'E2E koşulu',
      terminationConditions: 'E2E sona erme koşulu',
      durationNote: 'Bir öğretim yılı',
      percentBasisPoints: null,
      amountCents: input.amountCents,
      capacity: 10,
      now,
    })
    await insertScholarshipAward(db, input.institutionId, {
      id: awardId,
      programId,
      studentId: input.studentId,
      academicYear,
      amountCents: input.amountCents,
      awardedByUserId: 'e2e-yonetici',
      now,
    })
    return awardId
  } finally {
    await close()
  }
}
