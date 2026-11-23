import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Sosyal etkinlik saatleri (ON-170; DOM-FIN-160). Kural dalları birim ve API testlerindedir
// (`tests/finance-social-activities.test.ts`, `apps/api/test/finance-social-activities.test.ts`);
// burada yönetici dar ekranda etkinlik açar, 9-A'dan seçtiği öğrenciye onaylı saat girer, sınıf
// özetinde öğrencinin saatini görür ve belge PDF'ini indirir (K-535…K-537).

const ADMIN = '/yonetici/finans?gorunum=sosyal-etkinlik'

type ClassRow = { classId: string; className: string }

test.describe('DOM-FIN-160: sosyal etkinlik saatleri', () => {
  test('DOM-FIN-160: yönetici etkinlik açar, saat girer, sınıf özetini görür ve belgeyi indirir (K-535…K-537)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: [], classes: ['c5'] })
    const admin = school.user('yonetici')
    const client = await api(admin)
    const classes = await client.context.get('/api/v1/finance/social-activities/classes')
    expect(classes.status()).toBe(200)
    const target = ((await classes.json()) as { data: ClassRow[] }).data.find(
      (row) => row.classId === 'c5',
    )
    expect(target).toBeDefined()
    if (target === undefined) return

    const page = await loginAs(admin)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(ADMIN)
    const section = page.getByRole('region', { name: 'Sosyal etkinlik saatleri' })
    await section.getByRole('button', { name: 'Etkinlik ekle' }).click()
    const form = page.getByRole('form', { name: 'Etkinlik ekle' })
    await form.getByLabel('Etkinlik adı').fill('Kütüphane gönüllüleri')
    await form.getByLabel('Sorumlu öğretmen').selectOption({ label: admin.name })
    await form.getByLabel('Yer').fill('Okul kütüphanesi')
    await form.getByRole('button', { name: 'Etkinliği kaydet' }).click()
    await expect(form).toHaveCount(0)

    await section.getByRole('button', { name: 'Kütüphane gönüllüleri için saat gir' }).click()
    const entry = page.getByRole('form', { name: 'Saat gir' })
    await entry.getByLabel('Saat', { exact: true }).fill('2,5')
    await entry.getByLabel('Sınıf', { exact: true }).selectOption(target.classId)
    const first = entry.getByRole('checkbox').first()
    await first.check()
    await entry.getByRole('button', { name: 'Saatleri kaydet' }).click()
    await expect(entry).toHaveCount(0)
    await expect
      .poll(async () => {
        const list = await client.context.get('/api/v1/finance/social-activities')
        return ((await list.json()) as { data: { approvedMinutes: number }[] }).data[0]
          ?.approvedMinutes
      })
      .toBe(150)
    await expectNoHorizontalOverflow(page)

    await section.getByRole('button', { name: 'Sınıf özeti' }).click()
    await section.getByLabel('Sınıf', { exact: true }).selectOption(target.classId)
    const students = section.getByRole('list', { name: `${target.className} öğrencileri` })
    await expect(students).toContainText('2,5 / 40 saat')
    const downloading = page.waitForEvent('download')
    await students
      .getByRole('button', { name: /sosyal etkinlik belgesini indir/ })
      .first()
      .click()
    const file = await downloading
    expect(file.suggestedFilename()).toMatch(/^sosyal-etkinlik-belgesi-SEG-\d{8}-/)
  })
})
