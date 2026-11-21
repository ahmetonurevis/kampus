import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Personel performans dönemi (ON-211; DOM-FIN-124, K-427…K-429). Kural dalları birim ve API
// testlerindedir (`tests/finance-performance.test.ts`, `apps/api/test/finance-performance.test.ts`);
// burada yönetici dönem açar, öğretmeni iki hedefle ekler, dönemi aşamalardan geçirir, ara görüşme
// ve puanları yazar, genel puanı görür ve dönemi kapatır; ön büro sekmeyi görmez.

const ADMIN_URL = '/yonetici/finans?gorunum=performans'
const DESK_URL = '/onburo/tahsilat-takip?gorunum=performans'

test.describe('ON-211: performans dönemi', () => {
  test('DOM-FIN-124: yönetici hedef belirler, ara görüşme ve puan yazar, dönemi kapatır; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(ADMIN_URL)
    const periods = page.getByRole('region', { name: 'Performans dönemleri' })
    await expect(periods.getByText('Henüz performans dönemi açılmadı.')).toBeVisible()

    await periods.getByRole('button', { name: 'Yeni dönem' }).click()
    const periodDialog = page.getByRole('dialog', { name: 'Yeni performans dönemi' })
    await periodDialog.getByLabel('Dönem adı').fill('Güz performansı')
    await periodDialog.getByLabel('Başlangıç günü').fill(istanbulDay(-30))
    await periodDialog.getByLabel('Bitiş günü').fill(istanbulDay(60))
    await periodDialog.getByRole('button', { name: 'Dönemi aç' }).click()
    await expect(periodDialog).toBeHidden()
    const row = periods.getByRole('row', { name: /Güz performansı/ })
    await expect(row).toContainText('Planlama')

    await row.getByRole('button', { name: 'Güz performansı kayıtları' }).click()
    const reviews = page.getByRole('region', { name: 'Güz performansı · personel kayıtları' })
    await reviews.getByRole('button', { name: 'Personel ekle' }).click()
    const enroll = page.getByRole('dialog', { name: 'Döneme personel ekle' })
    await enroll
      .getByLabel('Personel', { exact: true })
      .selectOption({ label: `${teacher} · Öğretmen` })
    await enroll.getByLabel('1. hedef', { exact: true }).fill('Okuma becerisi')
    await enroll.getByLabel('1. ölçüt').fill('Sınıf ortalaması B1')
    await enroll.getByLabel('1. ağırlık (%)').fill('60')
    await enroll.getByRole('button', { name: 'Hedef ekle' }).click()
    await enroll.getByLabel('2. hedef', { exact: true }).fill('Veli görüşmesi')
    await enroll.getByLabel('2. ölçüt').fill('Her veliyle iki görüşme')
    await enroll.getByLabel('2. ağırlık (%)').fill('30')
    await enroll.getByRole('button', { name: 'Personeli ekle' }).click()
    // Ağırlık toplamı 100 değilse form gönderilmez (K-428).
    await expect(enroll.getByRole('alert').filter({ hasText: 'şu an %90' })).toBeVisible()
    await enroll.getByLabel('2. ağırlık (%)').fill('40')
    await enroll.getByRole('button', { name: 'Personeli ekle' }).click()
    await expect(enroll).toBeHidden()
    const reviewRow = reviews.getByRole('row', { name: new RegExp(teacher) })
    await expect(reviewRow).toContainText('Okuma becerisi (%60)')

    // Planlama → yürürlükte → ara görüşme (K-427).
    for (const next of ['Yürürlükte', 'Ara görüşme']) {
      await row
        .getByRole('button', { name: `Güz performansı dönemini ${next} aşamasına geçir` })
        .click()
      const advance = page.getByRole('dialog', { name: 'Dönemin aşamasını ilerlet' })
      await advance.getByRole('button', { name: `${next} aşamasına geç` }).click()
      await expect(advance).toBeHidden()
      await expect(row).toContainText(next)
    }
    await reviewRow.getByRole('button', { name: `${teacher} kaydını düzenle` }).click()
    let edit = page.getByRole('dialog', { name: `${teacher} · performans kaydı` })
    await edit.getByLabel('Ara görüşme günü').fill(istanbulDay())
    await edit.getByLabel('Ara görüşme notu').fill('Okuma hedefinde iyi ilerliyor')
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toBeHidden()

    await row
      .getByRole('button', { name: 'Güz performansı dönemini Değerlendirme aşamasına geçir' })
      .click()
    let advance = page.getByRole('dialog', { name: 'Dönemin aşamasını ilerlet' })
    await advance.getByRole('button', { name: 'Değerlendirme aşamasına geç' }).click()
    await expect(advance).toBeHidden()
    await reviewRow.getByRole('button', { name: `${teacher} kaydını düzenle` }).click()
    edit = page.getByRole('dialog', { name: `${teacher} · performans kaydı` })
    await edit.getByLabel('Okuma becerisi puanı').selectOption('4')
    await edit.getByLabel('Veli görüşmesi puanı').selectOption('3')
    await edit.getByLabel('Personelin görüşü').fill('Değerlendirmeye katılıyorum')
    await edit.getByRole('button', { name: 'Kaydet' }).click()
    await expect(edit).toBeHidden()
    // Genel puan ağırlıklı ortalamadır: 0,6 × 4 + 0,4 × 3 = 3,60.
    await expect(reviewRow).toContainText('3,60 / 5')

    await row
      .getByRole('button', { name: 'Güz performansı dönemini Kapandı aşamasına geçir' })
      .click()
    advance = page.getByRole('dialog', { name: 'Dönemin aşamasını ilerlet' })
    await advance.getByRole('button', { name: 'Kapandı aşamasına geç' }).click()
    await expect(advance).toBeHidden()
    await expect(row).toContainText('Kapandı')
    await expect(row).toContainText('1 / 1 puanlandı')
    await expect(reviews.getByRole('button', { name: 'Personel ekle' })).toHaveCount(0)
    await reviewRow.getByRole('button', { name: `${teacher} kaydını görüntüle` }).click()
    edit = page.getByRole('dialog', { name: `${teacher} · performans kaydı` })
    await expect(edit.getByText('Dönem kapandı; kayıt değiştirilemez.')).toBeVisible()
    await expect(edit.getByRole('button', { name: 'Kaydet' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Performans' })).toHaveCount(0)
    await expect(desk.getByRole('region', { name: 'Performans dönemleri' })).toHaveCount(0)
  })
})
