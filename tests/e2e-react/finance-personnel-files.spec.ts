import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel özlük kartı (ON-172; DOM-FIN-140). Kural dalları ve rol matrisi birim ve API
// testlerindedir (`tests/finance-personnel-files.test.ts`, `apps/api/test/finance-personnel-files.test.ts`);
// burada yönetici öğretmene kart açar (kimlik), tam kimlik numarasını ister, IBAN doğrulamasını
// görür ve banka ile acil durum kişisini ekler; kimlik no ve IBAN maskeli kalır (K-475, K-476).
// Ön büro sekmeyi görmez.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'

test.describe('DOM-FIN-140: personel özlük kartı', () => {
  test('DOM-FIN-140: yönetici kart açar, maskeli kimlik ve IBAN görür, tam kimliği ister; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=ozluk-kartlari`)
    const section = page.getByRole('region', { name: 'Özlük kartları' })
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('Kart açılmadı')
    await row.getByRole('button', { name: `${teacher} özlük kartını aç` }).click()

    const panel = page.getByRole('dialog', { name: 'Özlük kartı' })
    await expect(panel.getByText('Bu personelin özlük kartı henüz açılmadı.')).toBeVisible()
    await panel.getByRole('button', { name: 'Kimlik bilgilerini ekle' }).click()
    const identity = page.getByRole('dialog', { name: 'Kimlik bilgileri' })
    await identity.getByLabel('T.C. kimlik no').fill('12345678901')
    await identity.getByRole('button', { name: 'Kaydet' }).click()
    await expect(identity.getByText('Geçerli bir T.C. kimlik numarası girin')).toBeVisible()
    await identity.getByLabel('T.C. kimlik no').fill('10000000146')
    await identity.getByLabel('Doğum günü').fill('1990-05-12')
    await identity.getByRole('button', { name: 'Kaydet' }).click()
    await expect(identity).toBeHidden()
    const identityBlock = panel.getByRole('region', { name: 'Kimlik' })
    await expect(identityBlock).toContainText('*******0146')
    await expect(identityBlock).not.toContainText('10000000146')
    await identityBlock.getByRole('button', { name: 'Kimlik numarasını göster' }).click()
    await expect(identityBlock).toContainText('10000000146')
    await identityBlock.getByRole('button', { name: 'Gizle' }).click()
    await expect(identityBlock).not.toContainText('10000000146')

    await panel.getByRole('button', { name: 'Banka bilgilerini ekle' }).click()
    const bank = page.getByRole('dialog', { name: 'Banka bilgileri' })
    await bank.getByLabel('IBAN').fill('TR330006100519786457841327')
    await bank.getByLabel('Hesap sahibi').fill(teacher)
    await bank.getByRole('button', { name: 'Kaydet' }).click()
    await expect(bank.getByText('Geçerli bir TR IBAN girin')).toBeVisible()
    await bank.getByLabel('IBAN').fill('TR33 0006 1005 1978 6457 8413 26')
    await bank.getByRole('button', { name: 'Kaydet' }).click()
    await expect(bank).toBeHidden()
    const bankBlock = panel.getByRole('region', { name: 'Banka' })
    await expect(bankBlock).toContainText('TR********************1326')

    await panel.getByRole('button', { name: 'Acil durum bilgilerini ekle' }).click()
    const emergency = page.getByRole('dialog', { name: 'Acil durum bilgileri' })
    await emergency.getByRole('button', { name: 'Kişi ekle' }).click()
    await emergency.getByLabel('Ad soyad').fill('Ahmet Örnek')
    await emergency.getByLabel('Yakınlık').fill('Eşi')
    await emergency.getByLabel('Telefon').fill('0532 987 65 43')
    await emergency.getByRole('button', { name: 'Kaydet' }).click()
    await expect(emergency).toBeHidden()
    await expect(panel.getByRole('region', { name: 'Acil durum' })).toContainText(
      'Ahmet Örnek (Eşi) · 05329876543',
    )
    await page.keyboard.press('Escape')
    await expect(row).toContainText('Kimlik · Banka · Acil durum')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=ozluk-kartlari`)
    await expect(desk.getByRole('region', { name: 'Özlük kartları' })).toHaveCount(0)
  })
})
