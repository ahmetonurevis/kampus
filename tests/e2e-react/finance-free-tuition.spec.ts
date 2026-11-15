import type { Page } from '@playwright/test'

import { seedFreeTuitionContract } from './support/finance-free-tuition.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Ücretsiz okutma ekranı (ON-284; DOM-FIN-026, K-268…K-271). Kural dalları (taksit kapanması, iade,
// kontenjan aşımı, kurumlar arası 404) birim ve API testlerindedir (`tests/finance-free-tuition.test.ts`,
// `apps/api/test/finance-free-tuition.test.ts`); burada yöneticinin dönem, kontenjan, aday, kurul
// kararı, tutanak ve MEBBİS akışı ile ön büronun sekmeyi görmemesi var.

const ADMIN_URL = '/yonetici/finans?gorunum=ucretsiz'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=ucretsiz'
const STUDENT = 'Deniz Yılmaz'

const region = (page: Page, name: string) => page.getByRole('region', { name })

test.describe('ON-284: ücretsiz okutma ekranı', () => {
  test('DOM-FIN-026: yönetici dönemi açar, kontenjanı kesinleştirir, adayı kabul eder, tutanağı açar ve MEBBİS günü işler', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    await seedFreeTuitionContract({ institutionId: school.institutionId, studentId: 's1' })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)

    await page.getByRole('button', { name: 'Dönemi aç' }).click()
    const opening = page.getByRole('dialog', { name: 'Ücretsiz okutma dönemi' })
    await opening.getByRole('button', { name: 'Dönemi aç' }).click()
    await expect(opening).toBeHidden()

    const quota = region(page, /Ücretsiz okutma kontenjanı/)
    await expect(quota.getByText('Kesinleşmedi')).toBeVisible()
    await quota.getByRole('button', { name: 'Kontenjanı kesinleştir' }).click()
    const confirm = page.getByRole('dialog', { name: 'Kontenjanı kesinleştir' })
    await confirm.getByLabel('Kesin kontenjan').fill('50')
    await confirm.getByRole('button', { name: 'Kesinleştir' }).click()
    await expect(confirm).toBeHidden()
    await expect(quota.getByText('50', { exact: true })).toBeVisible()

    const applicants = region(page, 'Adaylar')
    await applicants.getByRole('button', { name: 'Aday ekle' }).click()
    const candidate = page.getByRole('dialog', { name: 'Ücretsiz okutma adayı' })
    await candidate.getByLabel('Öğrenci', { exact: true }).selectOption({ label: STUDENT })
    await candidate.getByLabel('Gerekçe').selectOption({ label: 'Şehit ya da gazi yakını' })
    await candidate.getByLabel('Başvuru formu').check()
    await candidate.getByRole('button', { name: 'Adayı kaydet' }).click()
    await expect(candidate).toBeHidden()
    await expect(applicants.getByRole('cell', { name: STUDENT, exact: true })).toBeVisible()
    await expect(applicants.getByText('1 / 5 teslim')).toBeVisible()

    await applicants.getByRole('button', { name: 'Kurul kararını kaydet' }).click()
    const board = page.getByRole('dialog', { name: 'Değerlendirme kurulu kararı' })
    const members = [
      ['Ayten Demir', 'Müdür (başkan)'],
      ['Selin Kaya', 'Öğretmen'],
      ['Murat Şen', 'Rehber öğretmen'],
    ] as const
    for (const [index, [name, title]] of members.entries()) {
      await board.getByLabel(`${String(index + 1)}. üye adı`).fill(name)
      await board.getByLabel(`${String(index + 1)}. üye görevi`).fill(title)
    }
    await board.getByLabel(new RegExp(`^${STUDENT}`)).selectOption({ label: 'Kabul' })
    await board.getByRole('button', { name: 'Kararı kaydet' }).click()
    await expect(board).toBeHidden()

    await expect(applicants.getByText('Kabul', { exact: true })).toBeVisible()
    const awards = region(page, 'Hak kazananlar')
    await expect(awards.getByRole('cell', { name: STUDENT, exact: true })).toBeVisible()
    await expect(awards.getByText('İade yok')).toBeVisible()

    const meetings = region(page, 'Değerlendirme kurulu toplantıları')
    await meetings.getByRole('button', { name: /tutanak PDF$/ }).click()
    const pdf = page.getByRole('dialog', { name: 'Ücretsiz okutma kurul tutanağı · Önizleme' })
    const downloading = page.waitForEvent('download')
    await pdf.getByRole('button', { name: 'PDF’yi indir' }).click()
    const text = await pdfText(await downloading)
    for (const expected of ['KURUL TUTANAĞI', 'Ayten Demir', STUDENT, 'Şehit ya da gazi yakını'])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(pdf).toBeHidden()

    await awards
      .getByLabel('MEBBİS durumu', { exact: true })
      .selectOption({ label: 'İşlenmemişler' })
    await awards.getByRole('button', { name: `${STUDENT} hakkının MEBBİS gününü işle` }).click()
    const mebbis = page.getByRole('dialog', { name: "MEBBİS'e işlendi" })
    await mebbis.getByRole('button', { name: 'Kaydet' }).click()
    await expect(mebbis).toBeHidden()
    await expect(awards.getByRole('cell', { name: STUDENT, exact: true })).toHaveCount(0)
  })

  test('K-269: ön büro sekmeyi görmez, doğrudan adres taksitlere düşer; dar ekranda taşma yok', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s1'] })
    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    await expect(desk.getByRole('button', { name: 'Ücretsiz okutma' })).toHaveCount(0)
    await expect(desk.getByRole('button', { name: 'Dönemi aç' })).toHaveCount(0)

    const admin = await loginAs(school.user('yonetici'))
    await admin.setViewportSize({ width: 390, height: 844 })
    await admin.goto(ADMIN_URL)
    await expect(admin.getByRole('button', { name: 'Dönemi aç' })).toBeVisible()
    await expectNoHorizontalOverflow(admin)
  })
})
