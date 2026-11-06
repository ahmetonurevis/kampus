import { randomUUID } from 'node:crypto'

import { createSeed } from '../../../packages/school-core/src/data/seed.ts'
import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { insertFeeTariff } from '../../../apps/api/src/db/fee-tariffs.ts'
import { insertScholarshipProgram } from '../../../apps/api/src/db/finance-scholarships.ts'
import { insertMissingRecords } from '../../../apps/api/src/db/records.ts'

import { e2e } from './env.ts'

/**
 * İkinci, ödeyicisi öğrenci olan sözleşme (K-12): tarifeli, taksitsiz. Öğrencinin seed sözleşmesiyle
 * birlikte hesaba girer ve ödeyiciler farklı olur.
 */
export async function seedStudentPayerContract(input: {
  institutionId: string
  studentId: string
  contractId: string
  title: string
}): Promise<void> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const now = new Date()
  const academicYear = createSeed(now).academicYear
  const tariffId = randomUUID()
  const amountCents = 100_000
  try {
    await insertFeeTariff(db, input.institutionId, {
      id: tariffId,
      academicYear,
      versionNumber: 1,
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: `${String(academicYear)}-01-01`,
          announcedAmountCents: amountCents,
        },
      ],
      discounts: [],
      now,
    })
    await insertMissingRecords(
      db,
      input.institutionId,
      [
        {
          collection: 'contracts',
          id: input.contractId,
          data: {
            id: input.contractId,
            studentId: input.studentId,
            date: now.toISOString(),
            amount: amountCents,
            title: input.title,
            invoiceIds: [],
            tariffId,
            tariffVersion: 1,
            grossCents: amountCents,
            netCents: amountCents,
            discounts: [],
            extras: [],
            approvedByUserId: 'e2e-yonetici',
            payer: 'student',
          },
        },
      ],
      now,
    )
  } finally {
    await close()
  }
}

/**
 * Tarifeli ve burslu sözleşme (ON-046f; ADR 0010 adım 4). Taksit ve sözleşmenin kaynağı
 * tablolardır; tabloya yalnız core'un ürettiği biçim girer: tarife grubu tam, `tariffId` kurumun
 * tarifesine, burs `programId`'si kurumun burs programına bağlıdır. Sözleşme bu yüzden tenant'ın
 * `records` seçeneğiyle değil, tarife ve programdan sonra tohumla yazılır (tohum tablolara eşitler).
 * Bu ekranlarda tarife ve programın kendisi denenmez; doğrudan veritabanına konur.
 */
export async function seedScholarshipContract(input: {
  institutionId: string
  studentId: string
  contractId: string
  amountCents: number
  scholarshipCents: number
}): Promise<void> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const now = new Date()
  // Kurumun eğitim yılı tenant'taki gibi örnek veriden gelir.
  const academicYear = createSeed(now).academicYear
  const tariffId = randomUUID()
  const programId = randomUUID()
  const grossCents = input.amountCents + input.scholarshipCents
  try {
    await insertFeeTariff(db, input.institutionId, {
      id: tariffId,
      academicYear,
      versionNumber: 1,
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: grossCents,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: `${String(academicYear)}-01-01`,
          announcedAmountCents: grossCents,
        },
      ],
      discounts: [],
      now,
    })
    await insertScholarshipProgram(db, input.institutionId, {
      id: programId,
      academicYear,
      name: 'E2E başarı bursu',
      conditions: 'E2E koşulu',
      terminationConditions: 'E2E sona erme koşulu',
      durationNote: 'Bir öğretim yılı',
      percentBasisPoints: null,
      amountCents: input.scholarshipCents,
      capacity: 10,
      now,
    })
    await insertMissingRecords(
      db,
      input.institutionId,
      [
        {
          collection: 'contracts',
          id: input.contractId,
          data: {
            id: input.contractId,
            studentId: input.studentId,
            date: now.toISOString(),
            amount: input.amountCents,
            title: 'Özel okul eğitim sözleşmesi',
            academicYear,
            tariffId,
            tariffVersion: 1,
            grossCents,
            netCents: input.amountCents,
            discounts: [],
            extras: [],
            approvedByUserId: 'e2e-yonetici',
            payer: 'guardian',
            scholarship: { programId, amountCents: input.scholarshipCents },
          },
        },
      ],
      now,
    )
  } finally {
    await close()
  }
}
