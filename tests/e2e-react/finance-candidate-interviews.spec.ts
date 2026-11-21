import { seedInterviewStageApplication } from './support/finance-candidate-interviews.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Aday mülakatı ve değerlendirme (ON-178; DOM-FIN-138). Kural dalları birim ve API testlerindedir
// (`tests/finance-candidate-interviews.test.ts`, `apps/api/test/finance-candidate-interviews.test.ts`);
// burada yönetici mülakat formu açar (K-470), "mülakat" aşamasındaki başvuruya dünkü mülakatı
// planlar, teklif kapısını görür, "yapıldı" işaretler, kendi değerlendirmesini gönderir ve başvuruyu
// teklife geçirir (K-469).

const ADMIN = '/yonetici/finans'
const DAY = 86_400_000
const TURKEY = 3 * 3_600_000
/** `days` gün sonrasının İstanbul günü (`YYYY-MM-DD`). */
const istanbulDay = (days: number) =>
  new Date(Date.now() + days * DAY + TURKEY).toISOString().slice(0, 10)

test.describe('DOM-FIN-138: aday mülakatı', () => {
  test('DOM-FIN-138: yönetici form açar, mülakat planlar, değerlendirir ve teklife geçirir', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: [] })
    await seedInterviewStageApplication(school.institutionId, 'Ece Aday', istanbulDay(0))
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=is-ilanlari`)
    const section = page.getByRole('region', { name: 'İş ilanları' })

    await section.getByRole('button', { name: 'Mülakat formları', exact: true }).click()
    await section.getByRole('button', { name: 'Yeni mülakat formu' }).click()
    const templateDialog = page.getByRole('dialog', { name: 'Yeni mülakat formu' })
    const templateForm = templateDialog.getByRole('form', { name: 'Mülakat formu' })
    await templateForm.getByLabel('Form adı').fill('Fen mülakat formu')
    await templateForm.getByRole('button', { name: 'Formu kaydet' }).click()
    await expect(templateDialog).toBeHidden()
    await expect(section.getByRole('row', { name: /Fen mülakat formu/ })).toContainText(
      'Kullanılmadı',
    )

    await section.getByRole('button', { name: 'Başvurular', exact: true }).click()
    await section.getByRole('button', { name: 'Ece Aday başvurusunu aç' }).click()
    const panel = page.getByRole('dialog', { name: 'Başvuru' })
    await expect(panel.getByText('0 yapıldı · 0 planlı')).toBeVisible()

    const stageForm = panel.getByRole('form', { name: 'Aşama değiştir' })
    await stageForm.getByLabel('Yeni aşama').selectOption({ label: 'Teklif' })
    await stageForm.getByRole('button', { name: 'Aşamayı kaydet' }).click()
    await expect(stageForm.getByText(/en az bir yapılmış mülakat gerekir/)).toBeVisible()

    await panel.getByRole('button', { name: 'Mülakat planla' }).click()
    const planDialog = page.getByRole('dialog', { name: 'Mülakat planla' })
    const plan = planDialog.getByRole('form', { name: 'Mülakat planı' })
    await plan.getByLabel('Gün ve saat').fill(`${istanbulDay(-1)}T10:00`)
    await plan.getByLabel('Mülakat formu').selectOption({ label: 'Fen mülakat formu (sürüm 1)' })
    await plan.getByRole('button', { name: 'Mülakatı planla' }).click()
    await expect(plan.getByText('Mülakatın yapılacağı yeri yazın.')).toBeVisible()
    await expect(plan.getByText('En az bir değerlendirici seçin.')).toBeVisible()
    await plan.getByLabel('Yer').fill('Müdür odası')
    await plan.getByRole('checkbox', { name: school.user('yonetici').name }).check()
    await plan.getByRole('button', { name: 'Mülakatı planla' }).click()
    await expect(planDialog).toBeHidden()

    const item = panel.getByRole('listitem', { name: /^Yüz yüze/ })
    await expect(item).toContainText('Planlandı')
    await item.getByRole('button', { name: 'Yapıldı' }).click()
    await expect(item.getByRole('button', { name: 'Yapıldı' })).toHaveCount(0)
    await item.getByRole('button', { name: 'Değerlendirmemi gir' }).click()
    const evaluationDialog = page.getByRole('dialog', { name: 'Değerlendirmem' })
    const evaluation = evaluationDialog.getByRole('form', { name: 'Mülakat değerlendirmesi' })
    for (const criterion of ['Alan bilgisi', 'İletişim', 'Sınıf yönetimi yaklaşımı', 'Kuruma uyum'])
      await evaluation.getByLabel(`${criterion} puanı`).selectOption('4')
    await evaluation.getByLabel('Genel değerlendirme').fill('Alanında güçlü, iletişimi açık.')
    await evaluation.getByRole('button', { name: 'Değerlendirmeyi gönder' }).click()
    await expect(evaluationDialog).toBeHidden()
    await expect(item).toContainText(`${school.user('yonetici').name}: 80/100`)
    await expect(item.getByRole('button', { name: 'Değerlendirmemi gir' })).toHaveCount(0)
    await expect(panel.getByText(/1 yapıldı · 0 planlı · mülakat ortalaması 80\/100/)).toBeVisible()

    await stageForm.getByLabel('Yeni aşama').selectOption({ label: 'Teklif' })
    await stageForm.getByRole('button', { name: 'Aşamayı kaydet' }).click()
    await expect(panel.getByRole('list', { name: 'Aşama geçmişi' })).toContainText(
      'Mülakat → Teklif',
    )
    await expect(panel.getByRole('button', { name: 'Mülakat planla' })).toHaveCount(0)

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)
  })
})
