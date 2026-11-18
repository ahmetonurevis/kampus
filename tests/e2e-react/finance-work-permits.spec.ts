import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğretmen çalışma onayı takibi (ON-174; DOM-FIN-114). Kural dalları birim ve API testlerindedir
// (`tests/finance-work-permits.test.ts`, `apps/api/test/finance-work-permits.test.ts`); burada
// ders programında görevli öğretmen onaysız uyarısıyla görünür (K-376), yönetici kayıt açar,
// başvuruyu ve onayı işler (varsayılan bitiş eğitim yılı sonu), uyarı kalkar; ön büro sekmeyi görmez
// (K-377).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-114: çalışma onayları', () => {
  test('DOM-FIN-114: programda görevli onaysız öğretmen uyarılır; kayıt, başvuru ve onayla uyarı kalkar; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    // Seed ders programı bu haftadan iki hafta sürer; öğretmen hesabı t1 kaydına bağlıdır.
    const school = await tenant({ roles: ['ogretmen', 'onburo'], collections: ['schedule'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=calisma-onayi`)
    const section = page.getByRole('region', { name: 'Çalışma onayları' })
    const summary = section.getByLabel('Uyarı özeti')
    await expect(summary).toContainText('Programda onaysız: 1')
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row.getByText('Onay yok')).toBeVisible()
    await expect(row.getByText('Programda görevli, onaysız')).toBeVisible()

    await row.getByRole('button', { name: `${teacher} çalışma onayı kayıtlarını aç` }).click()
    const panel = page.getByRole('dialog', { name: 'Öğretmen çalışma onayı' })
    await expect(panel.getByText('Henüz çalışma onayı kaydı yok.')).toBeVisible()

    await panel.getByRole('button', { name: 'Yeni kayıt' }).click()
    const create = page.getByRole('form', { name: 'Çalışma onayı kaydı' })
    await create.getByRole('button', { name: 'Kaydet' }).click()
    await expect(create.getByText('Branşı en az 2 karakterle yazın.')).toBeVisible()
    await create.getByLabel('Branş').fill('İngilizce')
    await create.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Yeni çalışma onayı kaydı' })).toBeHidden()

    const records = panel.getByRole('list', { name: 'Çalışma onayı kayıtları' })
    const item = records.getByRole('listitem', { name: 'İlk onay · İngilizce' })
    await expect(item.getByText('Hazırlanıyor')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Yeni kayıt' })).toBeDisabled()

    await item.getByRole('button', { name: 'Başvuruldu' }).click()
    const apply = page.getByRole('form', { name: 'Başvuru günü' })
    await apply.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Başvuru gününü kaydet' })).toBeHidden()
    await expect(item.getByText('Başvuruldu', { exact: true })).toBeVisible()

    await item.getByRole('button', { name: 'Onayı kaydet' }).click()
    const approve = page.getByRole('form', { name: 'Onay bilgisi' })
    await approve.getByRole('button', { name: 'Onayı kaydet' }).click()
    await expect(approve.getByText('Onay sayısını ya da belge numarasını yazın.')).toBeVisible()
    await approve.getByLabel('Onay sayısı / belge no').fill('E-2026-114')
    await approve.getByRole('button', { name: 'Onayı kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Onayı kaydet' })).toBeHidden()
    await expect(item.getByText('Onaylandı')).toBeVisible()
    await expect(item).toContainText('(sayı E-2026-114)')
    await expect(item).toContainText('31 Ağu')
    await expect(panel.getByRole('button', { name: 'Yeni kayıt' })).toBeEnabled()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await expect(row.getByText('Geçerli', { exact: true })).toBeVisible()
    await expect(row.getByText('Programda görevli, onaysız')).toHaveCount(0)
    await expect(summary).toContainText('Programda onaysız: 0')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=calisma-onayi`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Çalışma onayları' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Çalışma onayları' })).toHaveCount(0)
  })
})
