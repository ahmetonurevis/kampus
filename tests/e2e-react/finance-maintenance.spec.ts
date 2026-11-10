import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Arıza ve bakım talebi (ON-239; DOM-FIN-089). Kural dalları birim ve API testlerindedir
// (`tests/finance-maintenance-requests.test.ts`, `apps/api/test/finance-maintenance-requests.test.ts`);
// burada ön büro finans ekranından arıza bildirir (K-236), yönetici öğretmene atar, işe başlatır,
// maliyetle çözer, iş emri PDF'ini indirir ve kapatır (K-237); ön büro maliyeti görmez (K-238).
// Demirbaş listesinde açık arıza işareti ve ayrıntıda arıza geçmişi (K-239).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

type Detail = { id: string; number: string; resolutionCostCents?: number | null }

test.describe('DOM-FIN-089: arıza ve bakım ekranı', () => {
  test('DOM-FIN-089: ön büro arıza bildirir; yönetici atar, başlatır, maliyetle çözer, iş emri PDF indirir ve kapatır', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo', 'ogretmen'] })
    const teacher = school.user('ogretmen').name

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=ariza`)
    const section = desk.getByRole('region', { name: 'Arıza ve bakım' })
    await expect(section.getByText('Henüz arıza bildirilmedi.')).toBeVisible()
    await section.getByRole('button', { name: 'Arıza bildir' }).click()
    const form = desk.getByRole('dialog', { name: 'Arıza bildir' })
    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(form.getByText(/Başlığı en az 3 karakterle/)).toBeVisible()
    await form.getByLabel('Başlık').fill('Klima su akıtıyor')
    await form.getByLabel('Açıklama').fill('Öğretmenler odasındaki klima damlatıyor.')
    await form.getByLabel('Oda ya da yer').fill('Öğretmenler odası')
    await form.getByLabel('Öncelik').selectOption({ label: 'Acil' })
    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(form).toBeHidden()
    const deskPanel = desk.getByRole('dialog', { name: 'Arıza talebi' })
    await expect(
      deskPanel.getByRole('heading', { name: 'AT-0001 · Klima su akıtıyor' }),
    ).toBeVisible()
    await expect(
      deskPanel.getByRole('list', { name: 'İş emri geçmişi' }).getByText('Bildirildi'),
    ).toBeVisible()
    await expect(deskPanel.getByRole('form', { name: 'İş emrini ata' })).toHaveCount(0)
    await expect(deskPanel.getByRole('form', { name: 'Talebi iptal et' })).toBeVisible()

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ariza`)
    const list = page.getByRole('region', { name: 'Arıza ve bakım' })
    await list.getByRole('button', { name: 'AT-0001 ayrıntısını aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Arıza talebi' })
    const assign = panel.getByRole('form', { name: 'İş emrini ata' })
    await assign.getByRole('button', { name: 'Ata' }).click()
    await expect(assign.getByText('Personel seçin.', { exact: true })).toBeVisible()
    await assign
      .getByLabel('Personel', { exact: true })
      .selectOption({ label: `${teacher} · Öğretmen` })
    await assign.getByRole('button', { name: 'Ata' }).click()
    await expect(panel.getByText('Atandı', { exact: true }).first()).toBeVisible()
    await panel
      .getByRole('form', { name: 'İşe başla' })
      .getByRole('button', { name: 'İşe başla' })
      .click()
    const resolve = panel.getByRole('form', { name: 'İş emrini çöz' })
    await resolve.getByLabel('Yapılan iş').fill('Tahliye borusu temizlendi.')
    await resolve.getByLabel('Maliyet (₺, isteğe bağlı)').fill('1.250,00')
    await resolve.getByRole('button', { name: 'Çözüldü olarak işaretle' }).click()
    await expect(panel.getByText('1.250,00 ₺')).toBeVisible()

    await panel.getByRole('button', { name: 'İş emri PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'Arıza iş emri · Önizleme' })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('is-emri-AT-0001.pdf')
    const text = await pdfText(file)
    for (const expected of ['ARIZA İŞ EMRİ', 'AT-0001', teacher, 'Tahliye borusu temizlendi.'])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    await panel
      .getByRole('form', { name: 'Kapat' })
      .getByRole('button', { name: 'Talebi kapat' })
      .click()
    await expect(panel.getByText('Kapatıldı', { exact: true }).first()).toBeVisible()
    await expect(
      panel.getByRole('list', { name: 'İş emri geçmişi' }).getByRole('listitem'),
    ).toHaveCount(5)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const deskApi = await api(school.user('onburo'))
    await expect
      .poll(async () => {
        const listed = await deskApi.get('/api/v1/finance/maintenance-requests')
        return (listed.body as { data: (Detail & { status: string })[] }).data
      })
      .toEqual([expect.objectContaining({ number: 'AT-0001', status: 'closed' })])
    const listed = await deskApi.get('/api/v1/finance/maintenance-requests')
    const [row] = (listed.body as { data: Detail[] }).data
    expect(row && 'resolutionCostCents' in row).toBe(false)
  })

  test('DOM-FIN-089: demirbaş listesinde açık arıza işareti, ayrıntıda arıza geçmişi ve etiketli bildirim', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const admin = await api(school.user('yonetici'))
    const created = await admin.post('/api/v1/finance/fixed-assets', {
      name: 'Akıllı tahta',
      category: 'audiovisual',
      location: '5-A sınıfı',
      acquisitionValueCents: 4_500_000,
      acquisitionDate: '2025-01-15',
    })
    expect(created.status).toBe(201)
    const asset = (created.body as { data: { id: string; tagNumber: string } }).data

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=demirbas`)
    const assets = page.getByRole('region', { name: 'Demirbaşlar' })
    await assets.getByRole('button', { name: `${asset.tagNumber} ayrıntısını aç` }).click()
    const panel = page.getByRole('dialog', { name: 'Demirbaş' })
    const history = panel.getByRole('region', { name: 'Arıza geçmişi' })
    await expect(history.getByText('Bu demirbaşa arıza bildirilmedi.')).toBeVisible()
    await history.getByRole('button', { name: 'Arıza bildir' }).click()
    const form = page.getByRole('dialog', { name: 'Arıza bildir' })
    await expect(form.getByLabel('Demirbaş etiketi (isteğe bağlı)')).toHaveValue(asset.tagNumber)
    await expect(form.getByLabel('Oda ya da yer')).toHaveValue('5-A sınıfı')
    await form.getByLabel('Başlık').fill('Dokunmatik çalışmıyor')
    await form.getByLabel('Açıklama').fill('Kalem dokunuşlarını algılamıyor.')
    await form.getByRole('button', { name: 'Bildir' }).click()
    await expect(form).toBeHidden()
    await expect(
      history.getByRole('link', { name: 'AT-0001 · Dokunmatik çalışmıyor' }),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      assets.getByRole('row', { name: new RegExp(asset.tagNumber) }).getByText('Açık arıza'),
    ).toBeVisible()
  })
})
