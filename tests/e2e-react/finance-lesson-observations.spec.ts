import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Ders gözlem formu (ON-206; DOM-FIN-130, K-445…K-447). Kural dalları birim ve API
// testlerindedir (`tests/finance-lesson-observations.test.ts`,
// `apps/api/test/finance-lesson-observations.test.ts`); burada yönetici önerilen ölçütlerle form
// açar, öğretmene gözlem açar, seviyeleri yazar, hedef altı seviyede not ister, gözlemi tamamlar ve
// sunucunun puanını görür; kullanılmış forma yalnız yeni sürüm açılır; ön büro sekmeyi görmez.

const ADMIN_URL = '/yonetici/finans?gorunum=ders-gozlemleri'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=ders-gozlemleri'
const LEVELS = [
  ['Ders planı ve hazırlık', '4'],
  ['Sınıf yönetimi', '2'],
  ['Öğrenci katılımı', '3'],
  ['Öğretim yöntemi ve materyal', '5'],
  ['Ölçme ve geri bildirim', '3'],
] as const

test.describe('ON-206: ders gözlem formu', () => {
  test('DOM-FIN-130: yönetici form açar, gözlem yazar ve tamamlar, puanı sunucu hesaplar; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const forms = page.getByRole('region', { name: 'Gözlem formları' })
    await expect(forms.getByText('Henüz gözlem formu yok. Önce bir form oluşturun.')).toBeVisible()

    await forms.getByRole('button', { name: 'Yeni form' }).click()
    const formDialog = page.getByRole('dialog', { name: 'Yeni gözlem formu' })
    await expect(formDialog.getByLabel('2. ölçüt adı')).toHaveValue('Sınıf yönetimi')
    await formDialog.getByRole('button', { name: 'Formu kaydet' }).click()
    await expect(formDialog).toBeHidden()
    const formRow = forms.getByRole('row', { name: /Ders gözlem formu/ })
    await expect(formRow).toContainText('Sürüm 1 · 5 ölçüt')
    await expect(formRow).toContainText('Kullanılmadı')

    const observations = page.getByRole('region', { name: 'Ders gözlemleri' })
    await observations.getByRole('button', { name: 'Yeni gözlem' }).click()
    const create = page.getByRole('dialog', { name: 'Yeni ders gözlemi' })
    await create.getByLabel('Gözlem formu').selectOption({ label: 'Ders gözlem formu (sürüm 1)' })
    await create.getByLabel('Öğretmen', { exact: true }).selectOption({ label: teacher })
    await create.getByRole('button', { name: 'Gözlemi aç' }).click()
    await expect(create).toBeHidden()

    const editor = page.getByRole('dialog', { name: 'Ders gözlemi' })
    for (const [title, level] of LEVELS)
      await editor.getByLabel(`${title} seviyesi`).selectOption(level)
    // (4 + 2 + 3 + 5 + 3) / 25 → %68 (önizleme; kesin puanı sunucu verir).
    await expect(editor.getByText('Puan önizlemesi: %68 (17 / 25)')).toBeVisible()
    await editor.getByLabel('Genel değerlendirme').fill('Planlı ve etkileşimli bir ders')
    await editor.getByRole('button', { name: 'Kaydet ve tamamla' }).click()
    // Hedefin altındaki seviyeye not gerekir (rubrik kriter yorumu kuralı).
    await expect(editor.getByText(/hedefin altında seviye verildi; kısa not yazın/)).toBeVisible()
    await editor.getByLabel('Sınıf yönetimi notu').fill('Geçişlerde zaman kaybı oldu')
    await editor.getByRole('button', { name: 'Kaydet ve tamamla' }).click()
    await expect(editor).toBeHidden()

    const row = observations.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('Tamamlandı')
    await expect(row).toContainText('%68 (17 / 25)')
    await row.getByRole('button', { name: new RegExp(`${teacher} .* gözlemini görüntüle`) }).click()
    await expect(editor.getByText('Gözlem tamamlandı; değiştirilemez.')).toBeVisible()
    await expect(editor.getByText(/Geçişlerde zaman kaybı oldu/)).toBeVisible()
    await page.keyboard.press('Escape')

    // Kullanılmış form yerinde değişmez; yeni sürüm açılır (K-445).
    await expect(formRow).toContainText('1 gözlemde')
    await expect(
      formRow.getByRole('button', { name: 'Ders gözlem formu formunu düzenle' }),
    ).toHaveCount(0)
    await formRow.getByRole('button', { name: 'Ders gözlem formu için yeni sürüm aç' }).click()
    const versionDialog = page.getByRole('dialog', { name: 'Ders gözlem formu · yeni sürüm' })
    await versionDialog.getByLabel('1. ölçüt ağırlığı').fill('2')
    await versionDialog.getByRole('button', { name: 'Yeni sürümü aç' }).click()
    await expect(versionDialog).toBeHidden()
    await expect(formRow).toContainText('Sürüm 2 · 5 ölçüt')
    await expect(formRow).toContainText('Kullanılmadı')
    await expect(row).toContainText('%68 (17 / 25)')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Ders gözlemleri' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Gözlem formları' })).toHaveCount(0)
  })
})
