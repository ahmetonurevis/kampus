import { dayKey } from '../../packages/school-core/src/lib/format.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel sağlık raporu (ON-185; DOM-FIN-110). Kural dalları birim ve API testlerindedir
// (`tests/finance-medical-reports.test.ts`, `apps/api/test/finance-medical-reports.test.ts`);
// burada yönetici öğretmene bu ayın ilk üç gününe istirahat raporu girer, ay özetinde 3 günü
// görür, çakışan raporun reddini görür (K-364), SGK işaretlerini koyar (K-365) ve raporu
// gerekçeyle iptal eder; ön büro sekmeyi görmez. Tarihler Europe/Istanbul gününe göredir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-110: sağlık raporları', () => {
  test('DOM-FIN-110: yönetici rapor girer, ay özetinde görür, çakışma reddedilir, işaretler ve iptal; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const month = dayKey().slice(0, 7)
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=saglik-raporu`)
    const section = page.getByRole('region', { name: 'Sağlık raporları' })
    await expect(section.getByRole('list', { name: 'Bilgi notları' })).toContainText(
      'Kampüs SGK bildirimi yapmaz',
    )
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('0 gün')

    await row.getByRole('button', { name: `${teacher} sağlık raporlarını aç` }).click()
    const person = page.getByRole('dialog', { name: 'Personel sağlık raporları' })
    await expect(person.getByText('Henüz rapor girilmedi.')).toBeVisible()

    const enter = async (start: string, end: string) => {
      await person.getByRole('button', { name: 'Rapor gir' }).click()
      const form = page.getByRole('form', { name: 'Sağlık raporu' })
      await form.getByLabel('Başlangıç').fill(start)
      await form.getByLabel('Bitiş').fill(end)
      await form.getByRole('button', { name: 'Kaydet' }).click()
      return form
    }
    const backwards = await enter(`${month}-03`, `${month}-01`)
    await expect(backwards.getByText('Bitiş günü başlangıç gününden önce olamaz.')).toBeVisible()
    await backwards.getByLabel('Başlangıç').fill(`${month}-01`)
    await backwards.getByLabel('Bitiş').fill(`${month}-03`)
    await backwards.getByLabel('Veren kurum (isteğe bağlı)').selectOption({ label: 'Aile hekimi' })
    await backwards.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Sağlık raporu gir' })).toBeHidden()

    const reports = person.getByRole('list', { name: 'Raporlar' })
    const item = reports.getByRole('listitem').first()
    await expect(item).toContainText('İstirahat (hastalık)')
    await expect(item).toContainText('3 gün')
    await expect(item).toContainText('Aile hekimi')
    await expect(item).toContainText('İşverene bildirilmedi')

    const overlap = await enter(`${month}-03`, `${month}-04`)
    await expect(overlap.getByText('raporuyla çakışıyor', { exact: false })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Sağlık raporu gir' })).toBeHidden()

    await item.getByRole('button', { name: 'İşverene bildirildi' }).click()
    await expect(item).toContainText('İşverene bildirildi · SGK onayı bekliyor')
    await item.getByRole('button', { name: 'SGK sisteminde onaylandı' }).click()
    await expect(item).toContainText('İşverene bildirildi · SGK sisteminde onaylandı')

    await page.keyboard.press('Escape')
    await expect(person).toBeHidden()
    await expect(row).toContainText('3 gün')
    await expect(row).toContainText('İstirahat (hastalık) 3')
    await expect(row).toContainText('0 bildirim · 0 SGK')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
    await page.setViewportSize({ width: 1440, height: 1000 })

    await row.getByRole('button', { name: `${teacher} sağlık raporlarını aç` }).click()
    await person
      .getByRole('list', { name: 'Raporlar' })
      .getByRole('button', { name: 'İptal et' })
      .click()
    const cancel = page.getByRole('dialog', { name: 'Sağlık raporunu iptal et' })
    await cancel.getByRole('textbox', { name: 'Gerekçe' }).fill('Yanlış personele girildi')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(person.getByText('Henüz rapor girilmedi.')).toBeVisible()
    await person.getByRole('button', { name: 'İptal edilenler' }).click()
    const cancelled = person.getByRole('list', { name: 'İptal edilen raporlar' })
    await expect(cancelled.getByRole('listitem')).toContainText(
      'İptal gerekçesi: Yanlış personele girildi',
    )
    await page.keyboard.press('Escape')
    await expect(row).toContainText('0 gün')

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=saglik-raporu`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Sağlık raporları' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Sağlık raporları' })).toHaveCount(0)
  })
})
