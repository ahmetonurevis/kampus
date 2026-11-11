import { readFile } from 'node:fs/promises'

import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Demirbaş ekranı (ON-235; DOM-FIN-085). Kural dalları birim ve API testlerindedir
// (`tests/finance-fixed-assets.test.ts`, `apps/api/test/finance-fixed-assets.test.ts`); burada
// yönetici etiketi boş bırakıp demirbaş kaydeder (DB-<yıl>-<sıra>, K-185), durumunu değiştirir ve
// gerekçeyle hurdaya ayırır (K-188); ön büro sekmeyi görmez (K-189). Zimmet (ON-236; DOM-FIN-086):
// yönetici personel listesinden öğretmenin açık zimmetini görür, demirbaşı öğretmene zimmetler,
// tutanak PDF'ini indirir ve hasarlı iade alır (K-210…K-214). Sayım (ON-237; DOM-FIN-087): yönetici
// karekodlu etiket PDF'ini alır, oda sayımı başlatır, kodları klavyeyle okutur (bulundu, yanlış
// konumda, bilinmeyen kod reddi), tamamlar, konumu tek tıkla düzeltir ve sonucu CSV indirir
// (K-232…K-235). Amortisman ön hesabı (ON-238; DOM-FIN-088): yönetici ömrü ve yöntemi seçer,
// ayrıntıda yıllık tabloyu, sekmede yıl raporunu görür ve CSV indirir; ekran ve dosya "resmî
// defter yerine geçmez" notunu taşır (K-224…K-227).

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
    await expect(panel.getByRole('definition').filter({ hasText: /^45\.000,00 ₺$/ })).toBeVisible()
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

  test('DOM-FIN-087: yönetici etiket PDF alır, oda sayımında kod okutur, tamamlar, konumu düzeltir ve CSV indirir', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const admin = await api(school.user('yonetici'))
    const asset = async (name: string, location: string) => {
      const created = await admin.post('/api/v1/finance/fixed-assets', {
        name,
        category: 'laboratory',
        location,
        acquisitionValueCents: 900_000,
        acquisitionDate: '2025-01-15',
      })
      expect(created.status).toBe(201)
      return (created.body as { data: { id: string; tagNumber: string } }).data
    }
    const microscope = await asset('Mikroskop', 'Fen laboratuvarı')
    const scale = await asset('Hassas terazi', 'Fen laboratuvarı')
    const printer = await asset('Yazıcı', 'Müdür odası')

    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=demirbas`)
    const assets = page.getByRole('region', { name: 'Demirbaşlar' })
    await assets.getByRole('checkbox', { name: `${microscope.tagNumber} etiketini seç` }).click()
    await assets.getByRole('button', { name: "Seçili demirbaşların etiket PDF'i" }).click()
    const preview = page.getByRole('dialog', { name: 'Demirbaş etiketleri · Önizleme' })
    const labelDownload = page.waitForEvent('download')
    await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
    const labels = await labelDownload
    expect(labels.suggestedFilename()).toBe(`demirbas-etiketi-${microscope.tagNumber}.pdf`)
    expect(await pdfText(labels)).toContain(microscope.tagNumber)
    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()

    const counts = page.getByRole('region', { name: 'Demirbaş sayımları' })
    await counts.getByRole('button', { name: 'Yeni sayım' }).click()
    const start = page.getByRole('dialog', { name: 'Yeni sayım' })
    await start.getByLabel('Oda / konum').fill('fen LABORATUVARI')
    await start.getByRole('button', { name: 'Sayımı başlat' }).click()
    const panel = page.getByRole('dialog', { name: 'Demirbaş sayımı' })
    const summary = panel.getByLabel('Sayım özeti')
    await expect(panel.getByRole('heading', { name: 'fen LABORATUVARI' })).toBeVisible()

    const scan = panel.getByRole('form', { name: 'Etiket okutma' })
    const code = scan.getByLabel('Demirbaş kodu')
    await code.fill(microscope.tagNumber.toLowerCase())
    await code.press('Enter')
    const status = panel.getByRole('status')
    await expect(status).toContainText(`${microscope.tagNumber} · Mikroskop: bulundu.`)
    await expect(code).toHaveValue('')
    await code.fill(printer.tagNumber)
    await code.press('Enter')
    await expect(status).toContainText('yanlış konumda. Kayıtlı yer: Müdür odası.')
    await code.fill('YOK-0001')
    await code.press('Enter')
    await expect(
      scan.getByText('Bu kod kurumun demirbaşlarında yok. Etiketi kontrol edin.'),
    ).toBeVisible()

    await panel.getByRole('button', { name: 'Sayımı tamamla' }).click()
    await panel.getByRole('button', { name: 'Evet, tamamla' }).click()
    await expect(panel.getByText('Tamamlandı', { exact: true })).toBeVisible()
    await expect(summary.getByText('Bulunamadı')).toBeVisible()
    const rows = panel.getByRole('list', { name: 'Sayım satırları' })
    await expect(rows.getByText(`${scale.tagNumber} · Hassas terazi`)).toBeVisible()
    await rows
      .getByRole('button', { name: `${printer.tagNumber} konumunu sayılan yere düzelt` })
      .click()
    await expect(rows.getByText('Kayıt sayılan yere taşındı.')).toBeVisible()

    const csvDownload = page.waitForEvent('download')
    await panel.getByRole('button', { name: 'Sonucu CSV indir' }).click()
    const csv = await readFile(await (await csvDownload).path(), 'utf8')
    expect(csv).toContain(`"${scale.tagNumber}";"Hassas terazi";"Bulunamadı"`)
    expect(csv).toContain(`"${printer.tagNumber}";"Yazıcı";"Yanlış konumda"`)

    await expect
      .poll(async () => {
        const moved = await admin.get(`/api/v1/finance/fixed-assets/${printer.id}`)
        return (moved.body as { data: { location: string } }).data.location
      })
      .toBe('fen LABORATUVARI')
    const missing = await admin.get(`/api/v1/finance/fixed-assets/${scale.id}`)
    expect((missing.body as { data: { status: string; lastCount: unknown } }).data).toEqual(
      expect.objectContaining({
        status: 'in_use',
        lastCount: expect.objectContaining({ outcome: 'missing' }),
      }),
    )
  })

  test('DOM-FIN-088: yönetici ömür ve yöntemi seçer, amortisman tablosunu ve yıl raporunu görür, CSV indirir', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=demirbas`)
    const assets = page.getByRole('region', { name: 'Demirbaşlar' })
    await assets.getByRole('button', { name: 'Yeni demirbaş' }).click()
    const form = page.getByRole('dialog', { name: 'Yeni demirbaş' })
    await form.getByLabel('Ad', { exact: true }).fill('Dizüstü bilgisayar')
    await form.getByLabel('Kategori').selectOption({ label: 'Bilgisayar ve bilişim' })
    await expect(form.getByLabel('Faydalı ömür (yıl)')).toHaveValue('4')
    await form.getByLabel('Konum').fill('Öğretmenler odası')
    await form.getByLabel('Alım değeri (₺, KDV hariç)').fill('40.000,00')
    await form.getByLabel('Alım günü').fill('2025-01-15')
    await form.getByLabel('Faydalı ömür (yıl)').fill('0')
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form.getByText('Faydalı ömrü 1–50 arasında tam yıl girin.')).toBeVisible()
    await form.getByLabel('Faydalı ömür (yıl)').fill('5')
    await form.getByLabel('Amortisman yöntemi').selectOption({ label: 'Azalan bakiyeler' })
    await form.getByRole('button', { name: 'Kaydet' }).click()
    await expect(form).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Demirbaş' })
    const schedule = panel.getByRole('region', { name: 'Amortisman ön hesabı' })
    await expect(schedule.getByText('Azalan bakiyeler · 5 yıl · yıllık oran %40')).toBeVisible()
    await expect(schedule.getByText(/resmî defter yerine geçmez/)).toBeVisible()
    const first = schedule.getByRole('row', { name: /^2025/ })
    // Dönem başı 40.000, ayrılan ve birikmiş 16.000 (%40), net 24.000.
    await expect(first).toContainText('40.000,00 ₺')
    await expect(first).toContainText('16.000,00 ₺')
    await expect(first).toContainText('24.000,00 ₺')
    await page.keyboard.press('Escape')

    const report = page.getByRole('region', { name: 'Amortisman ön hesabı' })
    await expect(report.getByText(/resmî defter yerine geçmez/)).toBeVisible()
    await report.getByLabel('Hesap yılı').selectOption('2025')
    const summary = report.getByRole('definition').filter({ hasText: '16.000,00 ₺' })
    await expect(summary.first()).toBeVisible()
    await expect(
      report.getByRole('row', { name: /Bilgisayar ve bilişim/ }).getByText('24.000,00 ₺'),
    ).toBeVisible()
    const downloading = page.waitForEvent('download')
    await report.getByRole('button', { name: 'CSV indir' }).click()
    const file = await downloading
    expect(file.suggestedFilename()).toBe('amortisman-on-hesabi-2025.csv')
    const csv = await readFile(await file.path(), 'utf8')
    expect(csv).toContain('resmî defter yerine geçmez')
    expect(csv).toContain('"Dizüstü bilgisayar";"Bilgisayar ve bilişim"')
  })
})
