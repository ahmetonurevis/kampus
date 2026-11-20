import { expect, test } from './support/fixtures.ts'
import { seedExpiredJobApplication } from './support/finance-job-postings.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İş ilanları ve başvuru havuzu (ON-177; DOM-FIN-128). Kural dalları birim ve API testlerindedir
// (`tests/finance-job-postings.test.ts`, `apps/api/test/finance-job-postings.test.ts`); burada
// yönetici ilan açar ve yayımlar (K-439), e-postayla gelen başvuruyu aydınlatma sürümüyle kaydeder
// ve ön elemeye alır (K-440), saklama süresi dolan başvuruyu anonimleştirir (K-441); ön büro
// sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-128: iş ilanları', () => {
  test('DOM-FIN-128: yönetici ilan açar, başvuru kaydeder ve süresi dolanı anonimleştirir; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    await seedExpiredJobApplication(school.institutionId, 'Eski Aday')
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=is-ilanlari`)
    const section = page.getByRole('region', { name: 'İş ilanları' })

    await section.getByRole('button', { name: 'Yeni ilan' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni iş ilanı' })
    const form = dialog.getByRole('form', { name: 'İş ilanı' })
    await form.getByLabel('İlan başlığı').fill('İngilizce öğretmeni')
    await form.getByLabel('Pozisyon / branş').fill('İngilizce öğretmeni')
    await form.getByLabel('Çalışma türü').selectOption({ label: 'Yarı zamanlı' })
    await form.getByLabel('Açıklama').fill('Ortaokul İngilizce dersleri için öğretmen arıyoruz.')
    await form.getByRole('button', { name: 'Taslak kaydet' }).click()
    await expect(dialog).toBeHidden()

    const row = section.getByRole('row', { name: /İngilizce öğretmeni/ })
    await expect(row).toContainText('Taslak')
    await row.getByRole('button', { name: 'İngilizce öğretmeni ilanını yayımla' }).click()
    await expect(row).toContainText('Yayında')

    await section.getByRole('button', { name: 'Başvuru kaydet' }).click()
    const apply = page.getByRole('dialog', { name: 'Başvuru kaydet' })
    const applyForm = apply.getByRole('form', { name: 'İş başvurusu' })
    await applyForm
      .getByLabel('İlan', { exact: true })
      .selectOption({ label: 'İngilizce öğretmeni' })
    await applyForm.getByLabel('Aday adı soyadı').fill('Deniz Aday')
    await applyForm.getByRole('button', { name: 'Başvuruyu kaydet' }).click()
    await expect(applyForm.getByText('E-posta ya da telefondan en az birini girin.')).toBeVisible()
    await applyForm.getByLabel('E-posta').fill('deniz.aday@ornek.com')
    await applyForm.getByRole('button', { name: 'Başvuruyu kaydet' }).click()
    await expect(
      applyForm.getByText(
        'Aydınlatma metni gösterilmeden başvuru kaydedilemez; gösterilen sürümü yazın.',
      ),
    ).toBeVisible()
    await applyForm.getByLabel('Gösterilen aydınlatma metni sürümü').fill('2026/1')
    await applyForm.getByRole('button', { name: 'Başvuruyu kaydet' }).click()
    await expect(apply).toBeHidden()

    const panel = page.getByRole('dialog', { name: 'Başvuru' })
    await expect(panel.getByText('deniz.aday@ornek.com')).toBeVisible()
    await expect(panel.getByText(/Sürüm 2026\/1/)).toBeVisible()
    const stageForm = panel.getByRole('form', { name: 'Aşama değiştir' })
    await stageForm.getByLabel('Yeni aşama').selectOption({ label: 'Ön eleme' })
    await stageForm.getByRole('button', { name: 'Aşamayı kaydet' }).click()
    await expect(panel.getByRole('list', { name: 'Aşama geçmişi' })).toContainText(
      'Yeni → Ön eleme',
    )
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    await section.getByRole('button', { name: 'Saklama', exact: true }).click()
    const due = section.getByRole('row', { name: /Eski Aday/ })
    await expect(due).toContainText('Geçen yılın matematik ilanı')
    await expect(section.getByRole('row', { name: /Deniz Aday/ })).toHaveCount(0)
    await due.getByRole('button', { name: 'Eski Aday başvurusunu anonimleştir' }).click()
    const confirm = page.getByRole('dialog', { name: 'Başvuruyu anonimleştir' })
    await confirm.getByRole('button', { name: 'Anonimleştir' }).click()
    await expect(confirm).toBeHidden()
    await expect(section.getByText('Saklama süresi dolan başvuru yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Başvurular', exact: true }).click()
    await expect(section.getByRole('row', { name: /Anonim aday/ })).toContainText(
      'Anonimleştirildi',
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=is-ilanlari`)
    await expect(desk.getByRole('region', { name: 'İş ilanları' })).toHaveCount(0)
  })
})
