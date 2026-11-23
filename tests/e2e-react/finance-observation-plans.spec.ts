import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Ders gözlem planı (ON-207; DOM-FIN-139, K-472…K-474). Kural dalları (çakışma, dönem sınırı,
// geçmiş gün, geciken plan) birim ve API testlerindedir (`tests/finance-observation-plans.test.ts`,
// `apps/api/test/finance-observation-plans.test.ts`); burada yönetici bugüne plan açar, plandan
// gözlemi başlatıp tamamlar ve planı "gerçekleşti" görür; ikinci planı erteler, iptal eder ve
// öğretmene gönderilecek bildirimleri görür.

const ADMIN_URL = '/yonetici/finans?gorunum=ders-gozlemleri'
const CRITERIA = [
  'Ders planı ve hazırlık',
  'Sınıf yönetimi',
  'Öğrenci katılımı',
  'Öğretim yöntemi ve materyal',
  'Ölçme ve geri bildirim',
] as const

test.describe('ON-207: ders gözlem planı', () => {
  test('DOM-FIN-139: yönetici plan açar, plandan gözlemi tamamlar; diğer planı erteler ve iptal eder', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen'] })
    const teacher = school.user('ogretmen').name
    const observer = school.user('yonetici').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)

    // Plan bir gözlem formuna bağlanır; form önerilen ölçütlerle açılır (DOM-FIN-130).
    const forms = page.getByRole('region', { name: 'Gözlem formları' })
    await forms.getByRole('button', { name: 'Yeni form' }).click()
    const formDialog = page.getByRole('dialog', { name: 'Yeni gözlem formu' })
    await formDialog.getByRole('button', { name: 'Formu kaydet' }).click()
    await expect(formDialog).toBeHidden()

    await page
      .getByRole('toolbar', { name: 'Ders gözlemleri görünümü' })
      .getByRole('button', { name: 'Plan' })
      .click()
    const plans = page.getByRole('region', { name: 'Gözlem planı' })
    await expect(plans.getByText('Bu aralıkta gözlem planı yok.')).toBeVisible()

    const openPlan = async (startTime: string) => {
      await plans.getByRole('button', { name: 'Yeni plan' }).click()
      const dialog = page.getByRole('dialog', { name: 'Yeni gözlem planı' })
      await dialog.getByLabel('Gözlem formu').selectOption({ label: 'Ders gözlem formu (sürüm 1)' })
      await dialog.getByLabel('Öğretmen', { exact: true }).selectOption({ label: teacher })
      await dialog.getByLabel('Gözlemci', { exact: true }).selectOption({ label: observer })
      await dialog.getByLabel('Başlangıç saati').fill(startTime)
      await dialog.getByRole('button', { name: 'Planı kaydet' }).click()
      await expect(dialog).toBeHidden()
    }

    await openPlan('09:00')
    const first = plans.getByRole('listitem').filter({ hasText: '09:00–09:40' })
    await expect(first).toContainText('Planlandı')
    await expect(first).toContainText('1 bildirim gönderilecek')

    // Gözlem plandan açılır (K-473); tamamlanınca plan gerçekleşir.
    await first.getByRole('button', { name: /planından gözlemi başlat/ }).click()
    const editor = page.getByRole('dialog', { name: 'Ders gözlemi' })
    for (const title of CRITERIA) await editor.getByLabel(`${title} seviyesi`).selectOption('3')
    await editor.getByLabel('Genel değerlendirme').fill('Plan gününde gözlendi')
    await editor.getByRole('button', { name: 'Kaydet ve tamamla' }).click()
    await expect(editor).toBeHidden()
    await expect(first).toContainText('Gerçekleşti')
    await expect(first.getByRole('button', { name: /planını ertele/ })).toHaveCount(0)

    // Erteleme ve iptal gerekçe ister (K-472); her adım öğretmene bildirim kaydı açar (K-474).
    await openPlan('11:00')
    const second = plans
      .getByRole('listitem')
      .filter({ hasText: teacher })
      .filter({
        hasText: /11:00–11:40/,
      })
    await second.getByRole('button', { name: /planını ertele/ }).click()
    const postpone = page.getByRole('dialog', { name: 'Gözlem planını ertele' })
    await postpone.getByLabel('Yeni saat').fill('13:00')
    await postpone.getByRole('button', { name: 'Ertele' }).click()
    await expect(postpone.getByText('Gerekçeyi en az 3 karakterle yazın.')).toBeVisible()
    await postpone.getByLabel('Erteleme gerekçesi').fill('Veli toplantısı')
    await postpone.getByRole('button', { name: 'Ertele' }).click()
    await expect(postpone).toBeHidden()
    const moved = plans.getByRole('listitem').filter({ hasText: '13:00–13:40' })
    await expect(moved).toContainText('Ertelendi')
    await expect(moved).toContainText('Veli toplantısı')

    await moved.getByRole('button', { name: /planını iptal et/ }).click()
    const cancel = page.getByRole('dialog', { name: 'Gözlem planını iptal et' })
    await cancel.getByLabel('İptal gerekçesi').fill('Öğretmen izinli')
    await cancel.getByRole('button', { name: 'Planı iptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(moved).toContainText('İptal')
    await expect(moved).toContainText('3 bildirim gönderilecek')

    await moved.getByRole('button', { name: /planının bildirimleri/ }).click()
    const notices = page.getByRole('dialog', { name: 'Öğretmen bildirimleri' })
    await expect(notices.getByRole('listitem')).toHaveCount(3)
    await expect(notices.getByText(/Gözlem ertelendi/)).toBeVisible()
    await expect(notices.getByText(/Gözlem iptal edildi/)).toBeVisible()
    await page.keyboard.press('Escape')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
