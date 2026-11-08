import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Demirbaş ekranı (ON-235; DOM-FIN-085). Kural dalları birim ve API testlerindedir
// (`tests/finance-fixed-assets.test.ts`, `apps/api/test/finance-fixed-assets.test.ts`); burada
// yönetici etiketi boş bırakıp demirbaş kaydeder (DB-<yıl>-<sıra>, K-185), durumunu değiştirir ve
// gerekçeyle hurdaya ayırır (K-188); ön büro sekmeyi görmez (K-189). Zimmet (ON-236; DOM-FIN-086):
// yönetici personel listesinden öğretmenin açık zimmetini görür, demirbaşı öğretmene zimmetler,
// tutanak PDF'ini indirir ve hasarlı iade alır (K-210…K-214).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-085: demirbaş ekranı', () => {
  test('DOM-FIN-085: yönetici demirbaş kaydeder, arızalı işaretler ve hurdaya ayırır; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=demirbas`)
    const assets = page.getByRole('region', { name: 'Demirbaşlar' })
    await expect(assets.getByText('Henüz demirbaş yok.')).toBeVisible()

    await assets.getByRole('button', { name: 'Yeni demirbaş' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni demirbaş' })
    await form.getByLabel('Ad', { exact: true }).fill('Akıllı tahta')
    await form.getByLabel('Kategori').selectOption({ label: 'Görsel-işitsel cihaz' })
    await form.getByLabel('Kampüs (isteğe bağlı)').selectOption({ label: 'Kadıköy Kampüsü' })
    await form.getByLabel('Konum').fill('2. kat 5-A sınıfı')
    await form.getByLabel('Alım değeri (₺, KDV hariç)').fill('0')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      form.getByText('Alım değerini 1.234,56 biçiminde, sıfırdan büyük girin.'),
    ).toBeVisible()
    await form.getByLabel('Alım değeri (₺, KDV hariç)').fill('45.000,00')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Demirbaş' })
    await expect(
      panel.getByRole('heading', { name: /^DB-\d{4}-0001 · Akıllı tahta$/ }),
    ).toBeVisible()
    await expect(panel.getByText('45.000,00 ₺')).toBeVisible()
    await expect(panel.getByText('Kadıköy Kampüsü')).toBeVisible()
    await panel.getByRole('button', { name: 'Düzenle' }).click()
    const edit = page.getByRole('dialog', { name: 'Demirbaşı düzenle' })
    await edit.getByLabel('Durum').selectOption({ label: 'Arızalı' })
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toBeHidden()
    await expect(panel.getByText('Arızalı', { exact: true })).toBeVisible()

    const scrap = panel.getByRole('form', { name: 'Hurdaya ayırma' })
    await scrap.getByLabel('Gerekçe').fill('Ekran kırık, onarılamaz')
    await scrap.getByRole('button', { name: 'Hurdaya ayır' }).click()
    await expect(panel.getByText('Hurdaya ayrıldı', { exact: true })).toBeVisible()
    await expect(panel.getByText('Ekran kırık, onarılamaz')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Düzenle' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(
      assets.getByRole('row', { name: /DB-\d{4}-0001/ }).getByText('Hurdaya ayrıldı'),
    ).toBeVisible()
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=demirbas`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Demirbaşlar' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Demirbaşlar' })).toHaveCount(0)
  })

  test('DOM-FIN-086: yönetici demirbaşı öğretmene zimmetler, tutanak PDF indirir, hasarlı iade alır; personel zimmetleri listelenir', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = school.user('ogretmen').name
    const admin = await api(school.user('yonetici'))
    const asset = async (name: string) => {
      const created = await admin.post('/api/v1/finance/fixed-assets', {
        name,
        category: 'it',
        location: 'Öğretmenler odası',
        acquisitionValueCents: 3_500_000,
        acquisitionDate: '2025-01-15',
      })
      expect(created.status).toBe(201)
      return (created.body as { data: { id: string; tagNumber: string } }).data
    }
    const laptop = await asset('Dizüstü bilgisayar')
    const projector = await asset('Projektör')
    const assignees = await admin.get('/api/v1/finance/fixed-asset-assignees?status=active')
    const people = (assignees.body as { data: { membershipId: string; name: string }[] }).data
    const membershipId = people.find((person) => person.name === teacher)?.membershipId ?? ''
    const given = await admin.post(`/api/v1/finance/fixed-assets/${projector.id}/assignments`, {
      assigneeType: 'staff',
      membershipId,
      assignedDate: '2025-02-01',
    })
    expect(given.status).toBe(201)

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=demirbas`)
    const staff = page.getByRole('region', { name: 'Personel zimmetleri' })
    await staff.getByRole('button', { name: `${teacher} zimmetlerini aç` }).click()
    const person = page.getByRole('dialog', { name: 'Personel zimmeti' })
    await expect(
      person
        .getByRole('list', { name: 'Açık zimmetler' })
        .getByText(`${projector.tagNumber} · Projektör`),
    ).toBeVisible()
    await expect(person.getByRole('button', { name: 'Zimmet tutanağı PDF' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(person).toBeHidden()

    const assets = page.getByRole('region', { name: 'Demirbaşlar' })
    await assets.getByRole('button', { name: `${laptop.tagNumber} ayrıntısını aç` }).click()
    const panel = page.getByRole('dialog', { name: 'Demirbaş' })
    const assign = panel.getByRole('form', { name: 'Zimmet ver' })
    await assign.getByRole('button', { name: 'Zimmet ver' }).click()
    await expect(assign.getByText('Personel seçin.', { exact: true })).toBeVisible()
    await assign
      .getByLabel('Personel', { exact: true })
      .selectOption({ label: `${teacher} · Öğretmen` })
    await assign.getByLabel('Not (isteğe bağlı)').fill('Şarj aletiyle')
    await assign.getByRole('button', { name: 'Zimmet ver' }).click()
    await expect(panel.getByText(`Zimmetli: ${teacher}`)).toBeVisible()
    await expect(panel.getByRole('form', { name: 'Hurdaya ayırma' })).toHaveCount(0)

    await panel.getByRole('button', { name: 'Zimmet tutanağı PDF' }).click()
    const preview = page.getByRole('dialog', { name: 'Demirbaş zimmet tutanağı · Önizleme' })
    const downloading = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe(`zimmet-tutanagi-${laptop.tagNumber}.pdf`)
    const text = await pdfText(file)
    for (const expected of ['DEMİRBAŞ ZİMMET TUTANAĞI', teacher, laptop.tagNumber, 'Teslim alan'])
      expect(text).toContain(expected)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    const giveBack = panel.getByRole('form', { name: 'Zimmet iadesi' })
    await giveBack.getByLabel('İade durumu').selectOption({ label: 'Hasarlı' })
    await giveBack.getByRole('button', { name: 'İade al' }).click()
    await expect(giveBack.getByText('Hasarı en az 5 karakterle açıklayın.')).toBeVisible()
    await giveBack.getByLabel('Durum notu').fill('Klavyede eksik tuş')
    await giveBack.getByRole('button', { name: 'İade al' }).click()
    const history = panel.getByRole('list', { name: 'Zimmet geçmişi' })
    await expect(history.getByText('Hasarlı', { exact: true })).toBeVisible()
    await expect(history.getByText('İade notu: Klavyede eksik tuş')).toBeVisible()
    await expect(panel.getByRole('form', { name: 'Zimmet ver' })).toBeVisible()
    await expect(panel.getByRole('form', { name: 'Hurdaya ayırma' })).toBeVisible()

    await expect
      .poll(async () => {
        const listed = await admin.get(
          `/api/v1/finance/fixed-asset-assignments?assetId=${laptop.id}`,
        )
        return (listed.body as { data: { returnCondition: string | null; note: string | null }[] })
          .data
      })
      .toEqual([expect.objectContaining({ returnCondition: 'damaged', note: 'Şarj aletiyle' })])
  })
})
