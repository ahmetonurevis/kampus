import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel izinleri (ON-181; DOM-FIN-109). Kural dalları birim ve API testlerindedir
// (`tests/finance-staff-leave.test.ts`, `apps/api/test/finance-staff-leave.test.ts`); burada
// yönetici öğretmenin kıdem başlangıcını girer, hak edişi (5 × 14 + 20 gün) ve bakiyeyi görür
// (K-360), geçen yıla izin kaydı yazar, sunucu reddini alanda görür, kaydı iptal eder (K-362),
// babalık izninin varsayılan gününü yasal en azın altına indiremez, üstüne çıkarır (K-361); ön
// büro sekmeyi görmez. Tarihler İstanbul gününe göredir: kıdem başlangıcı altı yıl önceki 1 Ocak.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const thisYear = Number(
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric' }).format(
    new Date(),
  ),
)

test.describe('DOM-FIN-109: personel izinleri', () => {
  test('DOM-FIN-109: yönetici kıdem başlangıcını girer, hak edişi görür, izin yazar ve iptal eder; tür ayarı yasal günü korur; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=personel-izin`)
    const section = page.getByRole('region', { name: 'Personel izinleri' })
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row.getByText('Girilmedi')).toBeVisible()

    await row.getByRole('button', { name: `${teacher} izinlerini aç` }).click()
    const person = page.getByRole('dialog', { name: 'Personel izni' })
    await expect(
      person.getByText('Kıdem başlangıcı girilmedi; yıllık izin hesaplanmıyor.'),
    ).toBeVisible()
    await person.getByRole('button', { name: 'Kıdem başlangıcını gir' }).click()
    const profile = page.getByRole('form', { name: 'İzin bilgisi' })
    await profile.getByLabel('Kıdem başlangıcı').fill(`${String(thisYear - 6)}-01-01`)
    await profile.getByLabel('Devreden gün').fill('3')
    await profile.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      profile.getByText('Açılış devrinin gününü ve gün sayısını birlikte girin.'),
    ).toBeVisible()
    await profile.getByLabel('Devreden gün').fill('')
    await profile.getByRole('button', { name: 'Kaydet' }).click()
    await expect(profile).toBeHidden()

    await expect(person.getByText('6 tam yıl')).toBeVisible()
    await expect(person.getByLabel('Yıllık izin bakiyesi')).toContainText('Bu yılın hakkı20 gün')
    await expect(person.getByLabel('Yıllık izin bakiyesi')).toContainText('Kalan90 gün')

    await person.getByRole('button', { name: 'İzin kaydı ekle' }).click()
    const record = page.getByRole('form', { name: 'İzin kaydı' })
    await record.getByLabel('İlk gün').fill(`${String(thisYear - 1)}-07-06`)
    await record.getByLabel('Son gün').fill(`${String(thisYear - 1)}-07-10`)
    await record.getByLabel('İş günü').fill('6')
    await record.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      record.getByText('İş günü sayısı seçilen tarih aralığındaki gün sayısını aşamaz.'),
    ).toBeVisible()
    await record.getByLabel('İş günü').fill('5')
    await record.getByRole('button', { name: 'Kaydet' }).click()
    await expect(record).toBeHidden()
    await expect(person.getByLabel('Yıllık izin bakiyesi')).toContainText('Kalan85 gün')
    await expect(person.getByLabel('Yıllık izin bakiyesi')).toContainText('Devreden65 gün')

    const used = person.getByRole('list', { name: 'Kullanılan izinler' })
    await used.getByRole('listitem').first().getByRole('button', { name: 'İptal et' }).click()
    const cancel = page.getByRole('dialog', { name: 'İzin kaydını iptal et' })
    await cancel.getByRole('textbox', { name: 'Gerekçe' }).fill('Yanlış yıla girildi')
    await cancel.getByRole('button', { name: 'İptal et' }).click()
    await expect(cancel).toBeHidden()
    await expect(person.getByText('Henüz izin kaydı yok.')).toBeVisible()
    await expect(person.getByLabel('Yıllık izin bakiyesi')).toContainText('Kalan90 gün')
    await page.keyboard.press('Escape')
    await expect(person).toBeHidden()
    await expect(row).toContainText('20 gün (6. yıl)')
    await expect(row).toContainText('90 gün')

    await section.getByRole('button', { name: 'İzin türleri' }).click()
    const types = page.getByRole('dialog', { name: 'İzin türleri' })
    const paternity = types.getByRole('listitem', { name: 'Babalık izni (eşin doğumu)' })
    await expect(paternity).toContainText('5 gün (yasal en az 5)')
    await paternity.getByRole('button', { name: 'Babalık izni (eşin doğumu) ayarla' }).click()
    const setting = page.getByRole('form', { name: 'İzin türü ayarı' })
    await expect(setting.getByText('yasa gereği değiştirilemez').first()).toBeVisible()
    await setting.getByLabel('Varsayılan gün').fill('4')
    await setting.getByRole('button', { name: 'Kaydet' }).click()
    await expect(
      setting.getByText(
        'Babalık izni (eşin doğumu) yasal olarak en az 5 gündür; daha az girilemez.',
      ),
    ).toBeVisible()
    await setting.getByLabel('Varsayılan gün').fill('10')
    await setting.getByRole('button', { name: 'Kaydet' }).click()
    await expect(setting).toBeHidden()
    await expect(paternity).toContainText('10 gün (yasal en az 5)')
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=personel-izin`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Personel izinleri' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Personel izinleri' })).toHaveCount(0)
  })
})
