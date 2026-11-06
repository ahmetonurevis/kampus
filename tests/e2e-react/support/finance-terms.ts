import { randomUUID } from 'node:crypto'

import { createSeed } from '../../../packages/school-core/src/data/seed.ts'
import { setInstitutionAcademicYear } from '../../../apps/api/src/db/academic-years.ts'
import { connectPostgres } from '../../../apps/api/src/db/client.ts'
import { insertFeeTariff } from '../../../apps/api/src/db/fee-tariffs.ts'
import { insertScholarshipProgram } from '../../../apps/api/src/db/finance-scholarships.ts'
import { insertMissingRecords } from '../../../apps/api/src/db/records.ts'
import { feeTariffs } from '../../../apps/api/src/db/schema/fee-tariffs.ts'

import { e2e } from './env.ts'

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

/** Ek hizmet kalemli yayımlı tarife (DOM-FIN-003, ON-087): yıllık servis, aylık yemek. */
export async function seedStudentServiceTariff(input: {
  institutionId: string
  academicYear: number
}): Promise<void> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const extra = (kind: 'transport' | 'meal', unit: 'year' | 'month', amountCents: number) => ({
    kind,
    level: null,
    amountCents,
    unit,
    vatBasisPoints: 1000,
    vatEffectiveDate: `${String(input.academicYear)}-01-01`,
    announcedAmountCents: null,
  })
  try {
    await db.insert(feeTariffs).values({
      institutionId: input.institutionId,
      id: randomUUID(),
      academicYear: input.academicYear,
      versionNumber: 1,
      status: 'published',
      items: [extra('transport', 'year', 4_000_000), extra('meal', 'month', 500_000)],
      announcedDate: `${String(input.academicYear)}-05-01`,
      publishedByUserId: 'e2e',
      publishedAt: new Date(),
    })
  } finally {
    await close()
  }
}

/**
 * Önceki yılın tarifesi geçerli kalan kurum (DOM-FIN-002, K-11). Karar gerçek saate bağlı olduğu için
 * kurumun eğitim yılı geçmişe alınır: `tariffYear + 1` eğitim yılının ilan dönemi (o yılın mayıs
 * sonu) test hangi gün koşarsa koşsun bitmiştir. Tarife yalnız `tariffYear` için yayımlıdır.
 */
export async function seedCarriedOverTariff(input: {
  institutionId: string
  /** Kurumun güncel eğitim yılı: kesin kayıtta hedef yıl, yenilemede hedef yılın bir öncesi. */
  academicYear: number
  tariffYear: number
  amountCents: number
}): Promise<void> {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  try {
    await setInstitutionAcademicYear(db, input.institutionId, input.academicYear, new Date())
    await db.insert(feeTariffs).values({
      institutionId: input.institutionId,
      id: randomUUID(),
      academicYear: input.tariffYear,
      versionNumber: 1,
      status: 'published',
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents: input.amountCents,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: `${String(input.tariffYear)}-01-01`,
          announcedAmountCents: input.amountCents,
        },
      ],
      announcedDate: `${String(input.tariffYear)}-05-01`,
      publishedByUserId: 'e2e',
      publishedAt: new Date(),
    })
  } finally {
    await close()
  }
}
