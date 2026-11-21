import { eq } from 'drizzle-orm'

import type { Database } from '../../src/db/client.ts'
import { insertFeeTariff } from '../../src/db/fee-tariffs.ts'
import { insertScholarshipProgram } from '../../src/db/finance-scholarships.ts'
import { bankAccounts } from '../../src/db/schema/payments.ts'
import { studentWithdrawals } from '../../src/db/schema/withdrawals.ts'
import { FIXED_NOW } from './app.ts'

/**
 * Tarifeli sözleşme fikstürü (ON-046f; ADR 0010 adım 4). Taksit ve sözleşmenin kaynağı tablolardır;
 * tabloya yalnız core'un ürettiği biçim girer (`contractRecordSchema`): tarife grubu (`tariffId`,
 * `tariffVersion`, brüt, net, indirimler, ek hizmetler, onaylayan, ödeyici) ya hep dolu ya hep
 * boştur, `tariffId` kurumun tarifesine, burs `programId`'si kurumun burs programına bağlıdır.
 * Fikstür sözleşmesi tohumdan önce bu satırları açar; `contractTerms` grubu birlikte verir.
 */

export const TEST_TARIFF_ID = '0b8f5c2e-6d0e-4a59-9a3c-0f3d2a4c1b7e'
export const TEST_SCHOLARSHIP_PROGRAM_ID = '5d1f7a3c-2b4e-4c8a-9e6f-1a2b3c4d5e6f'

/** Kurumun taslak tarifesi: yıllık öğrenim ücreti ve %10 erken kayıt indirimi. */
export async function insertTestTariff(
  db: Database,
  institutionId: string,
  input: { id?: string; amountCents?: number; academicYear?: number } = {},
): Promise<string> {
  const id = input.id ?? TEST_TARIFF_ID
  const amountCents = input.amountCents ?? 10_000_000
  await insertFeeTariff(db, institutionId, {
    id,
    academicYear: input.academicYear ?? 2026,
    versionNumber: 1,
    items: [
      {
        kind: 'tuition',
        level: null,
        amountCents,
        unit: 'year',
        vatBasisPoints: 1000,
        vatEffectiveDate: '2026-01-01',
        announcedAmountCents: amountCents,
      },
    ],
    discounts: [{ kind: 'early_registration', percentBasisPoints: 1_000, amountCents: null }],
    now: FIXED_NOW,
  })
  return id
}

/** Kurumun burs programı (sözleşmedeki `scholarship.programId`). */
export async function insertTestScholarshipProgram(
  db: Database,
  institutionId: string,
  id = TEST_SCHOLARSHIP_PROGRAM_ID,
): Promise<string> {
  await insertScholarshipProgram(db, institutionId, {
    id,
    academicYear: 2026,
    name: 'Test başarı bursu',
    conditions: 'Test koşulu',
    terminationConditions: 'Test sona erme koşulu',
    durationNote: 'Bir öğretim yılı',
    percentBasisPoints: null,
    amountCents: 100_000,
    capacity: 10,
    now: FIXED_NOW,
  })
  return id
}

/** Sözleşmenin tam tarife grubu (core `ContractTerms`); `payer` ve tutarlar fikstürden. */
export function contractTerms(input: {
  grossCents: number
  netCents: number
  payer?: 'guardian' | 'student'
  tariffId?: string
}) {
  return {
    tariffId: input.tariffId ?? TEST_TARIFF_ID,
    tariffVersion: 1,
    grossCents: input.grossCents,
    netCents: input.netCents,
    discounts: [],
    extras: [],
    approvedByUserId: 'u-yonetici',
    payer: input.payer ?? 'guardian',
  }
}

/** İade ödemesinin çıktığı kurum hesabı (M-13, DOM-FIN-032); kurum başına aynı kimlik. */
export const TEST_REFUND_BANK_ACCOUNT_ID = '7c3e9a1b-4d2f-4e8a-b6c5-2f1e0d9c8b7a'
export const TEST_REFUND_BANK_LABEL = 'Test Bankası · 0777'

/** Kurumun bildirilmiş hesabını açar; varsa bir şey yapmaz. */
export async function insertRefundBankAccount(db: Database, institutionId: string): Promise<void> {
  await db
    .insert(bankAccounts)
    .values({
      institutionId,
      id: TEST_REFUND_BANK_ACCOUNT_ID,
      bankName: 'Test Bankası',
      iban: 'TR420001000000000000000777',
      accountHolder: 'Test Kurumu',
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    })
    .onConflictDoNothing()
}

/**
 * İade ödemesinden hemen önce ayrılışın kurumuna hesap açar. Hesap tanımlı kurumda banka havalesi
 * tahsilatı hesap seçimi ister (DOM-FIN-032); tahsilat fikstürleri hesapsız kurumla yazıldığı için
 * hesap kurum kurulurken değil, iade ödenirken eklenir. Kayıt yoksa (404 testi) bir şey yapmaz.
 */
export async function ensureRefundBankAccount(db: Database, withdrawalId: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(withdrawalId)) return
  const [row] = await db
    .select({ institutionId: studentWithdrawals.institutionId })
    .from(studentWithdrawals)
    .where(eq(studentWithdrawals.id, withdrawalId))
    .limit(1)
  if (row !== undefined) await insertRefundBankAccount(db, row.institutionId)
}
