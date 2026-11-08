import { randomUUID } from 'node:crypto'

import { createSeed } from '../../packages/school-core/src/data/seed.ts'
import { money } from '../../packages/school-core/src/lib/format.ts'
import type { WithdrawalBreakdown } from '../../packages/school-core/src/lib/withdrawals.ts'
import { connectPostgres } from '../../apps/api/src/db/client.ts'
import { studentWithdrawals } from '../../apps/api/src/db/schema/withdrawals.ts'
import { istanbulDay } from './support/enrollment-finance-smoke.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Açılış nöbeti (DOM-FIN-061, ON-095): ön büro ilk taksiti, onaysız sözleşmeyi ve bekleyen iadeyi
// tek sekmede görür, satırdan mevcut panele ve listeye geçer. Kural dalları (zincir, pencere, olay
// türleri, kısmi ödeme) birim ve API testlerindedir (`tests/finance-opening-watch.test.ts`,
// `apps/api/test/finance-opening-watch.test.ts`).

const YEAR = createSeed(new Date()).academicYear
const AMOUNT = 1_500_000
const REFUND = 420_000
const LEAVER = { id: 'e2e-ow-ayrilan', name: 'Melis Ayrılan' }

/** Sözleşmesi onay bekleyen öğrenci: 1. taksitin vadesi 10 gün önce, 2. taksit iki ay sonra. */
function openingRecords(prefix: string) {
  const invoice = (installment: number, days: number) => ({
    collection: 'invoices' as const,
    data: {
      id: `${prefix}-inv-${String(installment)}`,
      studentId: 's1',
      installment,
      amount: AMOUNT,
      dueDate: `${istanbulDay(days)}T09:00:00.000Z`,
      paidAt: null,
      method: null,
      reminderAt: null,
      academicYear: YEAR,
    },
  })
  return [
    {
      collection: 'contracts' as const,
      data: {
        id: `${prefix}-contract`,
        studentId: 's1',
        date: new Date().toISOString(),
        amount: AMOUNT * 2,
        title: 'Açılış sözleşmesi',
        academicYear: YEAR,
        invoiceIds: [`${prefix}-inv-1`, `${prefix}-inv-2`],
      },
    },
    invoice(1, -10),
    invoice(2, 60),
    {
      collection: 'students' as const,
      data: {
        id: LEAVER.id,
        name: LEAVER.name,
        classId: 'c1',
        parentId: 'p1',
        joinedAt: '2025-09-01T09:00:00.000Z',
        isActive: false,
        progress: 0,
      },
    },
  ]
}

/** Ayrılış listesinin yanıt şemasına uyan, iadeli tek sözleşmelik hesap dökümü. */
function refundBreakdown(): WithdrawalBreakdown {
  return {
    institutionType: 'school',
    withdrawalDate: istanbulDay(-35),
    termStartDate: istanbulDay(-60),
    started: true,
    attendedUnits: 10,
    totalUnits: 180,
    publicSchoolExemption: false,
    deductionBasisPoints: 1_000,
    baseCents: AMOUNT * 2,
    deductionCents: 0,
    usageCents: 0,
    entitledCents: AMOUNT * 2 - REFUND,
    paidCents: AMOUNT * 2,
    creditCents: 0,
    extras: [],
    refundCents: REFUND,
    debtCents: 0,
  }
}

/** Ayrılış kaydı API'de yalnız taze oturumlu yönetici onayıyla yazılır; burada doğrudan konur. */
async function seedPendingRefund(institutionId: string) {
  const { db, close } = connectPostgres(e2e.databaseUrl)
  const now = new Date()
  try {
    await db.insert(studentWithdrawals).values({
      institutionId,
      id: randomUUID(),
      studentId: LEAVER.id,
      contractId: `${institutionId}-ayrilan-sozlesme`,
      withdrawalDate: istanbulDay(-35),
      reason: 'relocation',
      targetSchool: null,
      breakdown: refundBreakdown(),
      refundCents: REFUND,
      debtCents: 0,
      refundDueDate: istanbulDay(-5),
      approvedByUserId: 'e2e-yonetici',
      createdAt: now,
      updatedAt: now,
    })
  } finally {
    await close()
  }
}

test('DOM-FIN-061: ön büro açılış nöbetinde ilk taksiti, onaysız sözleşmeyi ve bekleyen iadeyi görür', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({
    roles: ['onburo'],
    students: ['s1'],
    records: openingRecords('e2e-ow'),
  })
  await seedPendingRefund(school.institutionId)

  const page = await loginAs(school.user('onburo'))
  await page.goto('/onburo/tahsilat-takip?gorunum=acilis')
  const watch = page.getByRole('region', { name: 'Açılış nöbeti', exact: true })
  await expect(watch.getByRole('heading', { name: 'Açılış nöbeti', level: 2 })).toBeVisible()
  const summary = watch.getByLabel('Açılış nöbeti özeti')
  await expect(summary).toContainText('Gecikmiş ilk taksit')
  await expect(summary).toContainText(money(AMOUNT))
  await expect(summary).toContainText('1 iadenin süresi geçti')

  const installments = watch.getByRole('region', { name: 'İlk taksitler' })
  const installment = installments.getByRole('row', { name: /Deniz Yılmaz/ })
  await expect(installment.getByText('Gecikmiş · 10 gün')).toBeVisible()
  await expect(installment.getByText('1. taksit')).toBeVisible()

  const contracts = watch.getByRole('region', { name: 'Onaylanmamış sözleşmeler' })
  await expect(
    contracts.getByRole('row', { name: /Deniz Yılmaz/ }).getByText('Kurum imzası bekleniyor'),
  ).toBeVisible()

  const refunds = watch.getByRole('region', { name: 'Bekleyen iadeler' })
  const refund = refunds.getByRole('row', { name: new RegExp(LEAVER.name) })
  await expect(refund.getByText(money(REFUND))).toBeVisible()
  await expect(refund.getByText(/5 gün geçti/)).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Satır mevcut taksit panelini açar; panel kapanınca nöbette kalınır.
  await installments.getByRole('button', { name: 'Deniz Yılmaz 1. taksit ayrıntısını aç' }).click()
  await expect(page.getByRole('dialog')).toContainText('Deniz Yılmaz')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/gorunum=acilis/)

  // Sözleşme satırı Sözleşmeler sekmesinin panelini açar.
  await contracts.getByRole('link', { name: 'Deniz Yılmaz sözleşmesini aç' }).click()
  await expect(page).toHaveURL(/gorunum=sozlesmeler&sozlesme=e2e-ow-contract/)
  await expect(page.getByRole('dialog')).toContainText('Kurum imzası bekleniyor')
  await page.goBack()

  // Bekleyen iadelerin tümü ayrılış listesinde iade durumu süzülmüş açılır.
  await refunds.getByRole('link', { name: 'Ayrılış ve iade listesi' }).click()
  await expect(page).toHaveURL(/gorunum=ayrilis&iade=pending/)
  // Görünüm değişince nöbet sekmesi kalkar; satır yalnız ayrılış listesinden okunur.
  await expect(watch).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ayrılış ve iade', level: 2 })).toBeVisible()
  await expect(page.getByRole('row', { name: new RegExp(LEAVER.name) })).toBeVisible()
})

test('DOM-FIN-061: başka eğitim yılında ilk taksit ve sözleşme yok, iade kalır', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({
    roles: ['onburo'],
    students: ['s1'],
    records: openingRecords('e2e-ow2'),
  })
  await seedPendingRefund(school.institutionId)
  const page = await loginAs(school.user('onburo'))
  await page.goto('/onburo/tahsilat-takip?gorunum=acilis')
  const watch = page.getByRole('region', { name: 'Açılış nöbeti', exact: true })
  await expect(
    watch.getByRole('region', { name: 'İlk taksitler' }).getByRole('row', { name: /Deniz Yılmaz/ }),
  ).toBeVisible()
  await watch.getByLabel('Eğitim yılı').selectOption(String(YEAR + 1))
  await expect(page).toHaveURL(new RegExp(`yil=${String(YEAR + 1)}`))
  await expect(watch).toContainText(`${String(YEAR + 1)}–${String(YEAR + 2)}`)
  await expect(
    watch
      .getByRole('region', { name: 'İlk taksitler' })
      .getByText('Bu açılışta ilk taksiti bekleyen öğrenci yok.'),
  ).toBeVisible()
  await expect(
    watch
      .getByRole('region', { name: 'Bekleyen iadeler' })
      .getByRole('row', { name: new RegExp(LEAVER.name) }),
  ).toBeVisible()
})
