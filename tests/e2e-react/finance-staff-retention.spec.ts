import { expect, test } from './support/fixtures.ts'
import { seedDepartedTeacher } from './support/finance-staff-retention.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Özlük saklama ve imha (ON-176; DOM-FIN-122; IST-021). Kural dalları birim ve API testlerindedir
// (`tests/finance-staff-retention.test.ts`, `apps/api/test/finance-staff-retention.test.ts`);
// burada yönetici özlük dosyası süresini yasal en az sürenin altına indiremez, uzatır (K-415),
// 2014'te ayrılan öğretmenin süresi dolan adli sicil kaydını onayla imha eder ve imha kaydını
// görür (K-416, K-417); ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-122: özlük saklama ve imha', () => {
  test('DOM-FIN-122: yönetici süreyi uzatır, süresi dolan adli sicil kaydını imha eder; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    await seedDepartedTeacher(school.institutionId)
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ozluk-imha`)
    const section = page.getByRole('region', { name: 'Özlük saklama ve imha' })

    const policy = section.getByRole('table', { name: 'Saklama politikası' })
    const fileRow = policy.getByRole('row', { name: /Özlük dosyası/ })
    await expect(fileRow).toContainText('10 yıl')
    await fileRow.getByRole('button', { name: 'Özlük dosyası süresini değiştir' }).click()
    const dialog = page.getByRole('dialog', { name: 'Saklama süresini değiştir' })
    await dialog.getByLabel('Süre', { exact: true }).fill('9')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      dialog.getByText('Yasal en az süre 10 yıl; daha kısa süre girilemez.'),
    ).toBeVisible()
    await dialog.getByLabel('Süre', { exact: true }).fill('15')
    await dialog.getByRole('button', { name: 'Kaydet' }).click()
    await expect(dialog).toBeHidden()
    await expect(fileRow).toContainText('15 yıl')
    await expect(fileRow).toContainText('Kurum ayarı')

    const candidates = section.getByRole('table', { name: 'İmha adayları' })
    const waiting = candidates.getByRole('row', { name: new RegExp(`${teacher}.*Özlük dosyası`) })
    await expect(waiting).toContainText('gün kaldı')
    await expect(waiting.getByRole('button')).toHaveCount(0)
    const due = candidates.getByRole('row', {
      name: new RegExp(`${teacher}.*Adli sicil kayıtları`),
    })
    await expect(due).toContainText('Süre doldu')
    await due.getByRole('button', { name: `${teacher} Adli sicil kayıtları imha et` }).click()
    const confirm = page.getByRole('dialog', { name: 'Özlük verisini imha et' })
    await expect(confirm).toContainText('kalıcı olarak silinecek')
    await confirm.getByRole('button', { name: 'Kalıcı olarak imha et' }).click()
    await expect(confirm).toBeHidden()
    await expect(page.getByText('Adli sicil kayıtları imha edildi: 1 kayıt.')).toBeVisible()
    await expect(due).toHaveCount(0)

    const log = section.getByRole('table', { name: 'İmha kayıtları' })
    const entry = log.getByRole('row', { name: /Adli sicil kayıtları/ })
    await expect(entry).toContainText('Fiziksel silme')
    await expect(entry).toContainText('1 kayıt')
    await expect(entry).not.toContainText(teacher)
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=ozluk-imha`)
    await expect(desk.getByRole('region', { name: 'Özlük saklama ve imha' })).toHaveCount(0)
  })
})
