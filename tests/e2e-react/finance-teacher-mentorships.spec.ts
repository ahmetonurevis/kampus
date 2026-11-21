import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Yeni öğretmen mentorluğu (ON-219; DOM-FIN-136, K-463…K-465). Kural dalları birim ve API
// testlerindedir (`tests/finance-teacher-mentorships.test.ts`,
// `apps/api/test/finance-teacher-mentorships.test.ts`); burada yönetici yeni öğretmeni mentorla
// eşleştirir (40 gün önce başlamış, görüşmesiz eşleşme gecikmiş görünür), görüşme kaydeder,
// zorunlu maddeleri işaretler ve eşleşmeyi tamamlar; ön büro sekmeyi görmez.

const ADMIN_URL = '/yonetici/finans?gorunum=mentorluk'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=mentorluk'
const REQUIRED = [
  'Okul kuralları ve günlük işleyişin tanıtımı',
  'Ders planı ve müfredat beklentilerinin gözden geçirilmesi',
  'Ölçme-değerlendirme ve not girişinin gösterilmesi',
  'Mentorun dersinin izlenmesi',
] as const

test.describe('ON-219: yeni öğretmen mentorluğu', () => {
  test('DOM-FIN-136: yönetici eşleştirir, görüşme kaydeder, listeyi işaretler ve tamamlar; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen', 'onburo'],
      staff: [{ key: 'yeni', role: 'ogretmen', name: 'Yeni Öğretmen Ada' }],
    })
    const mentor = school.user('ogretmen').name
    const mentee = school.staff('yeni').name
    const admin = school.user('yonetici').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const region = page.getByRole('region', { name: 'Mentorluk' })
    await expect(region.getByText('Henüz mentorluk eşleşmesi yok.')).toBeVisible()

    await region.getByRole('button', { name: 'Yeni eşleşme' }).click()
    const create = page.getByRole('dialog', { name: 'Yeni mentorluk eşleşmesi' })
    await create.getByLabel('Yeni öğretmen').selectOption({ label: mentee })
    await create.getByLabel('Mentor', { exact: true }).selectOption({ label: mentor })
    await create.getByLabel('Başlangıç').fill(istanbulDay(-40))
    await create.getByRole('button', { name: 'Eşleşmeyi aç' }).click()
    await expect(create).toBeHidden()

    // Açılan eşleşme panelde görünür; panel açıkken arka plan erişilebilirlik ağacında yoktur.
    const panel = page.getByRole('dialog', { name: 'Mentorluk eşleşmesi' })
    await expect(panel.getByRole('heading', { name: new RegExp(mentee) })).toBeVisible()
    await expect(panel).toContainText('30 günü aştı')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    const row = region.getByRole('row', { name: new RegExp(mentee) })
    await expect(row).toContainText('Sürüyor')
    await expect(row).toContainText('30 günü aştı')
    await expect(row).toContainText('0/5 madde · %0')
    await expect(region.getByLabel('Mentorluk özeti')).toContainText('Görüşmesi geciken1')
    const reopen = () => row.getByRole('button', { name: `${mentee} eşleşmesini aç` }).click()
    await reopen()
    // Görüşme kaydı olmadan tamamlanmaz (K-463).
    await panel.getByRole('button', { name: 'Tamamla', exact: true }).click()
    const complete = page.getByRole('dialog', { name: 'Mentorluğu tamamla' })
    await complete.getByRole('button', { name: 'Tamamla', exact: true }).click()
    await expect(page.getByText(/Görüşme kaydı olmayan eşleşme tamamlanmaz/)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(complete).toBeHidden()

    await panel.getByRole('button', { name: 'Görüşme ekle' }).click()
    const meeting = page.getByRole('dialog', { name: 'Görüşme kaydı' })
    await meeting.getByLabel('Konu').fill('İlk hafta değerlendirmesi')
    await meeting.getByLabel('Not (isteğe bağlı)').fill('Sınıf yönetiminde destek istiyor')
    await meeting.getByLabel('Sonraki adım (isteğe bağlı)').fill('Mentorun dersini izlesin')
    await meeting.getByRole('button', { name: 'Görüşmeyi kaydet' }).click()
    await expect(meeting).toBeHidden()
    await expect(panel.getByText(/45 dk · İlk hafta değerlendirmesi/)).toBeVisible()
    await expect(panel.getByText('Sonraki adım: Mentorun dersini izlesin')).toBeVisible()
    await expect(panel).not.toContainText('30 günü aştı')

    for (const label of REQUIRED) {
      await panel.getByRole('button', { name: `${label}: tamamlandı` }).click()
      await expect(panel.getByRole('button', { name: `${label}: işareti geri al` })).toBeVisible()
    }
    await expect(panel.getByRole('listitem', { name: REQUIRED[0] })).toContainText(admin)
    await page.keyboard.press('Escape')
    await expect(row).toContainText('4/5 madde · %80')
    await expect(row).not.toContainText('30 günü aştı')
    await reopen()

    await panel.getByRole('button', { name: 'Tamamla', exact: true }).click()
    await complete.getByRole('button', { name: 'Tamamla', exact: true }).click()
    await expect(complete).toBeHidden()
    await expect(
      panel.getByText('Eşleşme sona erdi; görüşme ve madde işareti alınmaz.'),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Görüşme ekle' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(row).toContainText('Tamamlandı')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Mentorluk' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Mentorluk' })).toHaveCount(0)
  })
})
