import { randomUUID } from 'node:crypto'

import { createSeed } from '../../../packages/school-core/src/data/seed.ts'
import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { insertFeeTariff } from '../../../apps/api/src/db/fee-tariffs.ts'
import { insertMissingRecords } from '../../../apps/api/src/db/records.ts'

import { e2e } from './env.ts'

/**
 * Ücretsiz okutma ekranı için öğrencinin bu eğitim yılına ait tarifeli sözleşmesi (DOM-FIN-026).
 * Örnek verinin sözleşmesi eğitim yılı taşımadığı için kabul ona uygulanmaz; bu sözleşme taksitsizdir,
 * kabul taksit kapatmaz ve iade doğurmaz. Taksit ve iade dalları API testindedir.
 */
export async function seedFreeTuitionContract(input: {
  institutionId: string
  studentId: string
}): Promise<void> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const now = new Date()
  const academicYear = createSeed(now).academicYear
  const tariffId = randomUUID()
  const amountCents = 100_000
  const contractId = `e2e-ucretsiz-${randomUUID()}`
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
          id: contractId,
          data: {
            id: contractId,
            studentId: input.studentId,
            date: now.toISOString(),
            amount: amountCents,
            title: 'Özel okul eğitim sözleşmesi',
            academicYear,
            invoiceIds: [],
            tariffId,
            tariffVersion: 1,
            grossCents: amountCents,
            netCents: amountCents,
            discounts: [],
            extras: [],
            approvedByUserId: 'e2e-yonetici',
            payer: 'guardian',
          },
        },
      ],
      now,
    )
  } finally {
    await close()
  }
}
