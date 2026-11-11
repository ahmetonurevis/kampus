import { readFile } from 'node:fs/promises'

import { money } from '../../packages/school-core/src/lib/format.ts'
import { createApiClient, switchInstitutionApi, type ApiResult } from './support/api.ts'
import { istanbulDay } from './support/enrollment-finance-smoke.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Bütçe–gerçekleşen görünümü (ON-244; DOM-FIN-066). Kural dalları (esas, merkez eşlemesi, iptal ve
// iade, gider kaynağı) birim ve API testlerindedir (`tests/finance-budget-actuals.test.ts`,
// `apps/api/test/finance-budget-actuals.test.ts`); burada yönetici dönem panelinde planı
// gerçekleşenle karşılaştırır, esası değiştirir ve CSV indirir.

const ADMIN_URL = '/yonetici/finans?gorunum=butce'
const DUE = 1_000_000
const LATER = 500_000
const PLAN = 3_000_000
const STUDENT = 'e2e-bg-ogrenci'

/** Kadıköy 7. sınıfta (c1) bir öğrenci: geçmiş vadeli ve gelecek vadeli iki öğrenim taksiti. */
function records() {
  const invoice = (installment: number, amount: number, days: number) => ({
    collection: 'invoices' as const,
    data: {
      id: `e2e-bg-inv-${String(installment)}`,
      studentId: STUDENT,
      installment,
      amount,
      dueDate: `${istanbulDay(days)}T09:00:00.000Z`,
      paidAt: null,
      method: null,
      reminderAt: null,
      feeKind: 'tuition',
    },
  })
  return [
    {
      collection: 'students' as const,
      data: {
        id: STUDENT,
        name: 'Bora Bütçe',
        classId: 'c1',
        parentId: 'p1',
        joinedAt: '2025-09-01T09:00:00.000Z',
        isActive: true,
        progress: 0,
      },
    },
    invoice(1, DUE, -20),
    invoice(2, LATER, 20),
  ]
}

const created = (result: ApiResult) => {
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string } }).data
}

test('DOM-FIN-066: yönetici dönem panelinde gerçekleşeni görür, esası değiştirir, CSV indirir', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: [], records: records() })
  const api = await createApiClient({ email: school.user('yonetici').email }, { fresh: true })
  try {
    expect((await switchInstitutionApi(api, school.institutionId)).ok).toBe(true)
    const campus = created(
      await api.post('/api/v1/finance/cost-centers', {
        code: 'KAD',
        name: 'Kadıköy merkezi',
        type: 'campus',
        campusId: 'b1',
      }),
    )
    const income = created(
      await api.post('/api/v1/finance/budget-items', {
        code: 'G-100',
        name: 'Öğrenim geliri',
        kind: 'income',
        feeKind: 'tuition',
      }),
    )
    const expense = created(
      await api.post('/api/v1/finance/budget-items', {
        code: 'P-100',
        name: 'Personel',
        kind: 'expense',
      }),
    )
    const period = created(
      await api.post('/api/v1/finance/budget-periods', {
        name: 'Gerçekleşen bütçesi',
        startDate: istanbulDay(-60),
        endDate: istanbulDay(300),
      }),
    )
    for (const itemId of [income.id, expense.id])
      created(
        await api.post(`/api/v1/finance/budget-periods/${period.id}/lines`, {
          costCenterId: campus.id,
          itemId,
          amountCents: PLAN,
        }),
      )
  } finally {
    await api.dispose()
  }

  const page = await loginAs(school.user('yonetici'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(ADMIN_URL)
  await page
    .getByRole('region', { name: 'Bütçe dönemleri' })
    .getByRole('button', { name: 'Gerçekleşen bütçesi dönemini aç' })
    .click()
  const panel = page.getByRole('dialog', { name: 'Gerçekleşen bütçesi' })
  await panel.getByRole('button', { name: 'Gerçekleşen', exact: true }).click()
  const report = panel.getByRole('region', { name: 'Bütçe–gerçekleşen' })
  const table = report.getByRole('table')
  const incomeRow = table.getByRole('row', { name: /G-100/ })
  // Tahakkuk esası: yalnız vadesi gelmiş taksit; plan dönemin tamamı.
  await expect(incomeRow).toContainText(money(PLAN))
  await expect(incomeRow).toContainText(money(DUE))
  await expect(incomeRow).toContainText(money(DUE - PLAN))
  // Gider gerçekleşeni mal kabulden gelir (DOM-FIN-074, K-151); kabul yok, sıfır.
  await expect(table.getByRole('row', { name: /P-100/ })).toContainText(money(0))
  await expect(
    report
      .getByRole('listitem')
      .filter({ hasText: /^Gider gerçekleşeni satın alma mal kabulünden/ }),
  ).toBeVisible()
  await expectNoHorizontalOverflow(page)

  // Tahsilat esası: tahsilat yok, gerçekleşen sıfır.
  await report.getByLabel('Esas').selectOption({ label: 'Tahsilat esası' })
  await expect(report.getByRole('listitem').filter({ hasText: /^Tahsilat esası:/ })).toBeVisible()
  await expect(table.getByRole('row', { name: /G-100/ })).toContainText(money(0))

  await report.getByLabel('Esas').selectOption({ label: 'Tahakkuk esası' })
  await expect(table.getByRole('row', { name: /G-100/ })).toContainText(money(DUE))
  const downloading = page.waitForEvent('download')
  await report.getByRole('button', { name: 'CSV indir' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('butce-gerceklesen-Gerçekleşen-bütçesi-tahakkuk.csv')
  const csv = await readFile(await download.path(), 'utf8')
  expect(csv).toContain('"Kalem kodu";"Kalem";"Tür";"Maliyet merkezi";"Ay"')
  expect(csv).toContain('"Dönem";30000,00;10000,00;-20000,00;33,33;"Hesaplandı"')
})
