import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Gezi planı ve onay dosyası (ON-155; DOM-FIN-111). Kural dalları birim ve API testlerindedir
// (`tests/finance-trip-plans.test.ts`, `apps/api/test/finance-trip-plans.test.ts`); burada ön büro
// finans ekranından taslak yazar ve onaya gönderir (K-366, K-367), yönetici onaylar, millî eğitim
// bildirimini işaretler (K-368) ve onay dosyası PDF'ini indirir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-111: gezi planı ekranı', () => {
  test('DOM-FIN-111: ön büro taslak yazar ve onaya gönderir; yönetici onaylar, bildirimi işaretler ve onay dosyasını indirir', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo', 'ogretmen'] })
    const teacher = school.user('ogretmen').name

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=gezi-plani`)
    const section = desk.getByRole('region', { name: 'Gezi planları' })
    await expect(section.getByText('Henüz gezi planı yok.')).toBeVisible()
    await section.getByRole('button', { name: 'Yeni gezi planı' }).click()
    const form = desk.getByRole('dialog', { name: 'Yeni gezi planı' })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText(/Adı en az 3 karakterle/)).toBeVisible()
    await form.getByLabel('Gezinin adı').fill('Bilim müzesi gezisi')
    await form.getByLabel('Amaç ve kazanım').fill('Fen dersinin deney kazanımlarını gözlemlemek.')
    await form.getByLabel('Beklenen öğrenci sayısı').fill('12')
    await form.getByLabel('1. durak', { exact: true }).fill('Bilim Müzesi')
    await form.getByLabel('1. görevli', { exact: true }).selectOption({ label: teacher })
    await form.getByLabel('Araç türü').selectOption({ label: 'Tren' })
    await form.getByRole('button', { name: 'Risk ekle' }).click()
    await form.getByLabel('1. risk', { exact: true }).fill('Kalabalıkta kaybolma')
    await form.getByLabel('Önlem').fill('Yaka kartı ve grup sorumlusu')
    await form.getByRole('button', { name: 'Kişi ekle' }).click()
    await form.getByLabel('1. kişi', { exact: true }).fill('Okul müdürü')
    await form.getByLabel('Telefon', { exact: true }).fill('05321234567')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const deskPanel = desk.getByRole('dialog', { name: 'Gezi planı', exact: true })
    await expect(
      deskPanel.getByRole('heading', { name: 'GZ-0001 · Bilim müzesi gezisi' }),
    ).toBeVisible()
    await expect(deskPanel.getByRole('form', { name: 'Onayla' })).toHaveCount(0)
    await deskPanel
      .getByRole('form', { name: 'Onaya gönder' })
      .getByRole('button', { name: 'Onaya gönder' })
      .click()
    await expect(deskPanel.getByText('Onay bekliyor', { exact: true }).first()).toBeVisible()

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=gezi-plani`)
    const list = page.getByRole('region', { name: 'Gezi planları' })
    await list.getByRole('button', { name: 'GZ-0001 ayrıntısını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Gezi planı', exact: true })
    await panel
      .getByRole('form', { name: 'Onayla' })
      .getByRole('button', { name: 'Planı onayla' })
      .click()
    await expect(panel.getByText('Onaylandı', { exact: true }).first()).toBeVisible()
    const notice = panel.getByRole('form', { name: 'Bildirimi işaretle' })
    await notice.getByLabel('Evrak sayısı (isteğe bağlı)').fill('E-2026-55')
    await notice.getByRole('button', { name: 'Bildirimi işaretle' }).click()
    await expect(panel.getByText(/E-2026-55/).first()).toBeVisible()

    await panel.getByRole('button', { name: 'Onay dosyası PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'Gezi planı ve onay dosyası · Önizleme' })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('gezi-plani-GZ-0001.pdf')
    const text = await pdfText(file)
    for (const expected of [
      'GEZİ PLANI',
      'GZ-0001',
      teacher,
      'Bilim Müzesi',
      'Kalabalıkta kaybolma',
    ])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(
      panel.getByRole('list', { name: 'Plan geçmişi' }).getByRole('listitem'),
    ).toHaveCount(4)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const deskApi = await api(school.user('onburo'))
    await expect
      .poll(async () => {
        const listed = await deskApi.get('/api/v1/finance/trip-plans')
        return (listed.body as { data: { number: string; status: string }[] }).data
      })
      .toEqual([expect.objectContaining({ number: 'GZ-0001', status: 'approved' })])
  })
})
