import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğretmenin öğrenci profili (`/ogretmen/ogrenci/:id`, OG-205). Seed: Selin Kaya (t1) 7-A'nın
// (c1) sınıf danışmanı ve rehberlik görevlisidir; Deniz Yılmaz (s1) 7-A öğrencisidir. 7-B (c9)
// başka kampüstedir, öğrencisi s9 Selin'in kapsamında değildir. Paylaşılan oturum salt okunurdur.
// Sıradan branş öğretmeni teste özel kurumda t2 (Türkçe) hesabıdır.

const COLLECTIONS = '/api/v1/collections'
const FOREIGN_STUDENT = 's9'
const GUIDANCE_TITLE = 'Matematik çalışma alışkanlığı'
const GUIDANCE_SHARED = 'Kısa ve düzenli tekrarlar'
const GUIDANCE_INTERNAL = 'İlk görüşmede çalışma ortamı ve zaman yönetimi konuşuldu.'

test.describe('öğretmen: öğrenci profili', () => {
  test('sınıf özetinden profil açılır, bölümler gezilir, "Listeye dön" sınıf özetine döner', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/siniflarim?sinif=c1')
    const dialog = page.getByRole('dialog', { name: 'Sınıf özeti' })
    await dialog.getByRole('link', { name: 'Deniz Yılmaz profilini aç' }).click()
    await expect(page).toHaveURL(/\/ogretmen\/ogrenci\/s1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Deniz Yılmaz' })).toBeVisible()
    const summary = page.getByRole('region', { name: 'Öğrenci özeti' })
    await expect(summary).toContainText('7-A')
    await expect(summary).toContainText('Göreviniz: Sınıf danışmanı')
    await expect(summary.getByText('Not ortalaması')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Veli iletişimi' })).toBeVisible()
    // Akademik gelişim varsayılan sekmedir.
    await expect(page.getByRole('heading', { name: 'Aylık başarı eğilimi' })).toBeVisible()

    const tabs = page.getByRole('toolbar', { name: 'Öğrenci profili bölümleri' })
    const sections = [
      ['Not geçmişi', 'notlar', 'Notlar'],
      ['Devamsızlık', 'devamsizlik', 'Katılım geçmişi'],
      ['Ödev durumu', 'odevler', 'Ödev durumu'],
      ['Quiz ve deneme', 'sinavlar', 'Quiz sonuçları'],
      ['Hedef ve rehberlik', 'takip', 'Rehberlik'],
    ] as const
    for (const [label, key, heading] of sections) {
      await tabs.getByRole('button', { name: label }).click()
      await expect(page).toHaveURL(new RegExp(`[?&]sekme=${key}`))
      await expect(
        page.getByRole('heading', { level: 2, name: heading, exact: true }),
      ).toBeVisible()
    }
    // Rehberlik görevlisinde de profil iç notu taşımaz; dosya Rehberlik & Takip'tedir.
    const guidance = page.getByRole('list', { name: 'Rehberlik dosyaları' })
    await expect(guidance.getByText(GUIDANCE_TITLE)).toBeVisible()
    await expect(guidance.getByText(GUIDANCE_SHARED)).toBeVisible()
    await expect(page.getByText(GUIDANCE_INTERNAL)).toHaveCount(0)

    // Sekme gezintisinden sonra da dönüş adresi korunur: panel açık sınıf özeti.
    await page.getByRole('link', { name: 'Listeye dön' }).click()
    await expect(page).toHaveURL(/\/ogretmen\/siniflarim\?sinif=c1$/)
    await expect(dialog.getByRole('heading', { name: '7-A' })).toBeVisible()
  })

  test('DOM-YTK-022: kapsam dışı öğrencinin profili açılmaz, sunucu 404 döner', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('ogretmen')
    const admin = await api('yonetici')
    const teacher = await api('ogretmen')
    const foreign = await admin.get(`${COLLECTIONS}/students/${FOREIGN_STUDENT}`)
    expect(foreign.status).toBe(200)
    expect((await teacher.get(`${COLLECTIONS}/students/${FOREIGN_STUDENT}`)).status).toBe(404)
    const name = (foreign.body as { data: { record: { name: string } } }).data.record.name

    await page.goto(`/ogretmen/ogrenci/${FOREIGN_STUDENT}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Öğrenci profili' })).toBeVisible()
    await expect(page.getByText('Öğrenci bulunamadı.')).toBeVisible()
    await expect(page.getByText(name)).toHaveCount(0)
    await expect(page.getByRole('toolbar', { name: 'Öğrenci profili bölümleri' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Listeye dön' }).click()
    await expect(page).toHaveURL(/\/ogretmen\/siniflarim$/)
  })

  test('DOM-YTK-020: sıradan branş öğretmeni paylaşılan planı görür, iç notu ne ekranda ne yanıtta görür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen'],
      teacherId: 't2',
      students: ['s1'],
      collections: ['guidanceCases'],
    })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/ogrenci/s1?sekme=takip')
    await expect(page.getByRole('heading', { level: 1, name: 'Deniz Yılmaz' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Öğrenci özeti' })).toContainText(
      'Göreviniz: Branş öğretmeni',
    )
    const guidance = page.getByRole('list', { name: 'Rehberlik dosyaları' })
    await expect(guidance.getByText(GUIDANCE_TITLE)).toBeVisible()
    await expect(guidance.getByText(GUIDANCE_SHARED)).toBeVisible()
    await expect(page.getByText(GUIDANCE_INTERNAL)).toHaveCount(0)

    const client = await api(school.user('ogretmen'))
    const cases = await client.get(`${COLLECTIONS}/guidanceCases?studentId=s1`)
    expect(cases.status).toBe(200)
    const body = JSON.stringify(cases.body)
    expect(body).toContain(GUIDANCE_TITLE)
    expect(body).not.toContain('internalNote')
    expect(body).not.toContain(GUIDANCE_INTERNAL)
  })
})

test.describe('öğretmen: öğrenci profili, 390 px', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('profil ve sekmelerde yatay taşma yok', async ({ page, loginAs }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/ogrenci/s1')
    await expect(page.getByRole('heading', { name: 'Aylık başarı eğilimi' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    for (const [key, heading] of [
      ['notlar', 'Notlar'],
      ['odevler', 'Ödev durumu'],
      ['takip', 'Rehberlik'],
    ] as const) {
      await page.goto(`/ogretmen/ogrenci/s1?sekme=${key}`)
      await expect(
        page.getByRole('heading', { level: 2, name: heading, exact: true }),
      ).toBeVisible()
      await expect(page.getByText(/yükleniyor/)).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
    }
  })
})
