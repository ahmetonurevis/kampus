import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel self-servisi (ON-189; DOM-FIN-166). Kural dalları birim ve API testlerindedir
// (`tests/finance-staff-self-service.test.ts`, `apps/api/test/finance-staff-self-service.test.ts`);
// burada ön büro personeli "Bilgilerim"den dar ekranda telefon değişikliği ister, yönetici
// "Değişiklik talepleri" kuyruğundan onaylar ve değişiklik personelin özlük özetine yansır (K-553).

const DESK = '/onburo/tahsilat-takip?gorunum=bilgilerim'
const QUEUE = '/yonetici/finans?gorunum=degisiklik-talepleri'

type Profile = { file: { contact?: { phone: string | null } } | null; pendingKinds: string[] }

test.describe('DOM-FIN-166: personel self-servisi', () => {
  test('DOM-FIN-166: personel telefon değişikliği ister, yönetici onaylar ve karta yazılır (K-553)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'] })
    const desk = await api(school.user('onburo'))

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(DESK)
    const mine = page.getByRole('region', { name: 'Bilgilerim' })
    await expect(mine.getByText('Özlük kartınız henüz açılmadı.', { exact: false })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await mine
      .getByRole('region', { name: 'İletişim' })
      .getByRole('button', { name: 'Değişiklik iste' })
      .click()
    const form = page
      .getByRole('dialog', { name: 'Adres ve telefon değişikliği' })
      .getByRole('form', { name: 'Adres ve telefon' })
    await form.getByRole('button', { name: 'Talep gönder' }).click()
    await expect(form.getByText('Değiştirilecek adresi ya da telefonu yazın.')).toBeVisible()
    await form.getByLabel('Yeni telefon').fill('0532 123 45 67')
    await form.getByRole('button', { name: 'Talep gönder' }).click()
    await expect(page.getByRole('dialog', { name: 'Adres ve telefon değişikliği' })).toHaveCount(0)
    await expect(
      mine.getByRole('region', { name: 'İletişim' }).getByText('Onay bekliyor'),
    ).toBeVisible()
    const requests = page.getByRole('list', { name: 'Değişiklik taleplerim' })
    await expect(requests.getByText('Telefon: 05321234567')).toBeVisible()

    const manager = await loginAs(school.user('yonetici'))
    await manager.goto(QUEUE)
    const queue = manager.getByRole('region', { name: 'Değişiklik talepleri' })
    await queue.getByRole('button', { name: /Adres ve telefon talebini onayla$/ }).click()
    await expect(queue.getByText('Onaylandı', { exact: true }).first()).toBeVisible()

    await expect
      .poll(async () => {
        const response = await desk.context.get('/api/v1/finance/my-staff-profile')
        const profile = ((await response.json()) as { data: Profile }).data
        return profile.file?.contact?.phone ?? null
      })
      .toBe('05321234567')
  })
})
