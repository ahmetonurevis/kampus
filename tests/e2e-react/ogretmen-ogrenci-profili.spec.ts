import { average } from '../../packages/school-core/src/lib/format.ts'
import { expect, test } from './support/fixtures.ts'
import { expectEveryRow, expectNoHorizontalOverflow } from './support/ui.ts'

// Öğretmenin öğrenci profili (`/ogretmen/ogrenci/:id`, OG-205). Seed: Selin Kaya (t1) 7-A'nın
// (c1) sınıf danışmanı ve rehberlik görevlisidir; Deniz Yılmaz (s1) 7-A öğrencisidir. 7-B (c9)
// başka kampüstedir, öğrencisi s9 Selin'in kapsamında değildir. Paylaşılan oturum salt okunurdur.
// Sıradan branş öğretmeni teste özel kurumda t2 (Türkçe) hesabıdır.

const COLLECTIONS = '/api/v1/collections'
const FOREIGN_STUDENT = 's9'
const PARENT = {
  id: 'p-og205',
  name: 'Kerem Yılmaz',
  studentIds: ['s1'],
  phone: '05321234512',
  email: 'kerem.yilmaz@example.com',
}
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

  test('özet göstergeleri kayıtlardan gelir; ödev, quiz ve deneme satırları listelenir', async ({
    page,
    loginAs,
    api,
  }) => {
    await loginAs('ogretmen')
    const teacher = await api('ogretmen')
    const read = async (collection: string) => {
      const result = await teacher.get(`${COLLECTIONS}/${collection}?studentId=s1&pageSize=100`)
      expect(result.status).toBe(200)
      return (result.body as { data: { record: Record<string, unknown> }[] }).data.map(
        (item) => item.record,
      )
    }
    const scores = (await read('grades')).map((row) => Number(row.score))
    const absent = (await read('attendance')).filter((row) => row.status === 'absent').length
    expect(scores.length).toBeGreaterThan(0)

    await page.goto('/ogretmen/ogrenci/s1')
    const summary = page.getByRole('region', { name: 'Öğrenci özeti' })
    await expect(summary).toContainText(`${average(scores)}/100`)
    // Devamsızlık kartı ve sekmesi aynı birimi (gün) kullanır; veriye dayanmayan gösterge yok.
    await expect(summary).toContainText(`${absent} gün`)
    await expect(summary).not.toContainText('ders')
    await expect(summary).not.toContainText('Dönem ilerlemesi')

    // Sınıf danışmanı sınıfın işlerini görür: ödev satırı ve teslim durumu listelenir.
    await page.goto('/ogretmen/ogrenci/s1?sekme=odevler')
    await page.getByLabel('Tabloda ara').fill('Sayılar ve işlemler')
    const homework = page.getByRole('row', { name: /Sayılar ve işlemler çalışması/ })
    await expect(homework).toBeVisible()
    await expect(page.getByText(/görebileceğiniz ödev yok/)).toHaveCount(0)

    // Quiz denemesi sunucunun hesapladığı puanla gelir (seed: matematik quizi %80).
    await page.goto('/ogretmen/ogrenci/s1?sekme=sinavlar')
    const quiz = page.getByRole('row', { name: /Matematik · 7-A kazanım testi/ })
    await expect(quiz).toBeVisible()
    await expect(quiz).toContainText('%80')
    await expect(page.getByText(/görebileceğiniz quiz sonucu yok/)).toHaveCount(0)
  })

  test('öğretmen kaydı gelene kadar bölümler yükleniyor gösterir, hata olursa boş ekran çizmez', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogretmen')
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/v1/collections/teachers**', async (route) => {
      await held
      await route.continue()
    })
    await page.goto('/ogretmen/ogrenci/s1?sekme=odevler')
    await expect(page.getByRole('heading', { level: 1, name: 'Deniz Yılmaz' })).toBeVisible()
    await expect(page.getByText('Profil bölümleri yükleniyor…')).toBeVisible()
    // Öğretmen kimliği bilinmeden süzülmüş (yanlış boş) tablo çizilmez.
    await expect(page.getByText(/görebileceğiniz ödev yok/)).toHaveCount(0)
    release()
    await page.getByLabel('Tabloda ara').fill('Sayılar ve işlemler')
    await expect(page.getByRole('row', { name: /Sayılar ve işlemler çalışması/ })).toBeVisible()
    await page.unroute('**/api/v1/collections/teachers**')

    // Okuma hatasında hata ve yeniden deneme görünür; bölümler yanlış boş çizilmez.
    await page.route('**/api/v1/collections/teachers**', (route) =>
      route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'forbidden', message: 'Öğretmen kaydı okunamadı.' }),
      }),
    )
    await page.reload()
    await expect(page.getByRole('alert')).toBeVisible()
    await expect(page.getByRole('button', { name: /Yeniden dene/ })).toBeVisible()
    await expect(page.getByText(/görebileceğiniz ödev yok/)).toHaveCount(0)
    await expect(page.getByLabel('Tabloda ara')).toHaveCount(0)
  })

  test('DOM-AKD-074: branş öğretmeni yalnız kendi ödevini ve quizini görür', async ({
    page,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen'],
      teacherId: 't2',
      students: ['s1'],
      collections: ['homework', 'submissions', 'quizzes', 'quizAttempts'],
    })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/ogrenci/s1?sekme=odevler')
    await expect(page.getByRole('row', { name: /Türkçe · Paragraf çalışması/ })).toBeVisible()
    await expect(page.getByText('Matematik · Sayılar ve işlemler çalışması')).toHaveCount(0)
    await page.goto('/ogretmen/ogrenci/s1?sekme=sinavlar')
    await expect(page.getByRole('row', { name: /Türkçe · 7-A kazanım testi/ })).toBeVisible()
    await expect(page.getByText('Matematik · 7-A kazanım testi')).toHaveCount(0)
  })

  test('DOM-YTK-055: profilde veli iletişimi maskeli gelir, tam değer sayfada ve yanıtta yoktur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen'],
      students: ['s1'],
      records: [{ collection: 'parents', data: PARENT }],
    })
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/ogrenci/s1')
    const contacts = page
      .getByRole('region', { name: 'Veli iletişimi' })
      .getByRole('list', { name: 'Veli iletişim bilgileri' })
    await expect(contacts.getByText('Kerem Yılmaz')).toBeVisible()
    await expect(contacts.getByText('0532 *** ** 12')).toBeVisible()
    await expect(contacts.getByText('k***@example.com')).toBeVisible()
    await expect(page.getByText(PARENT.phone)).toHaveCount(0)
    await expect(page.getByText(PARENT.email)).toHaveCount(0)

    const parents = await (await api(school.user('ogretmen'))).get(`${COLLECTIONS}/parents`)
    expect(parents.status).toBe(200)
    expect(JSON.stringify(parents.body)).not.toContain(PARENT.phone)
    expect(JSON.stringify(parents.body)).not.toContain(PARENT.email)
  })

  test('tablo, panel ve seçim kullanıldıktan sonra da "Listeye dön" sınıf özetine döner', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/siniflarim?sinif=c1')
    await page
      .getByRole('dialog', { name: 'Sınıf özeti' })
      .getByRole('link', { name: 'Deniz Yılmaz profilini aç' })
      .click()
    await expect(page).toHaveURL(/\/ogretmen\/ogrenci\/s1$/)

    // Akademik gelişim: ders seçimi adresi yazar.
    await page.getByLabel('Analiz dersi').selectOption({ label: 'Matematik' })
    await expect(page).toHaveURL(/[?&]ders=/)

    // Not geçmişi: arama (adrese yazılmaz, ADR 0009), sıralama ve sağ panel açma.
    await page
      .getByRole('toolbar', { name: 'Öğrenci profili bölümleri' })
      .getByRole('button', { name: 'Not geçmişi' })
      .click()
    await expect(page).toHaveURL(/[?&]sekme=notlar/)
    await page.getByLabel('Tabloda ara').fill('Matematik')
    await expectEveryRow(page.getByRole('table').locator('tbody tr'), 'Matematik')
    await expect(page).not.toHaveURL(/[?&]not-q=/)
    const firstRecord = page.locator('button.record-link, a.record-link').first()
    await firstRecord.click()
    await expect(page).toHaveURL(/[?&]not=/)
    await page.getByRole('dialog').getByRole('button', { name: 'Kapat' }).first().click()
    await expect(page).not.toHaveURL(/[?&]not=/)

    // Quiz ve deneme: aramadan sonra da dönüş adresi durur.
    await page
      .getByRole('toolbar', { name: 'Öğrenci profili bölümleri' })
      .getByRole('button', { name: 'Quiz ve deneme' })
      .click()
    await expect(
      page.getByRole('heading', { level: 2, name: 'Quiz sonuçları', exact: true }),
    ).toBeVisible()
    await page.getByLabel('Tabloda ara').first().fill('kazanım')
    await expect(page.getByRole('row', { name: /Matematik · 7-A kazanım testi/ })).toBeVisible()
    await expect(page).not.toHaveURL(/[?&]quiz-q=/)

    await page.getByRole('link', { name: 'Listeye dön' }).click()
    await expect(page).toHaveURL(/\/ogretmen\/siniflarim\?sinif=c1$/)
    await expect(
      page.getByRole('dialog', { name: 'Sınıf özeti' }).getByRole('heading', { name: '7-A' }),
    ).toBeVisible()
  })

  test('tarayıcı geri/ileri sekmeleri döndürür ve dönüş adresi her girdide korunur', async ({
    page,
    loginAs,
  }) => {
    await loginAs('ogretmen')
    await page.goto('/ogretmen/siniflarim?sinif=c1')
    await page
      .getByRole('dialog', { name: 'Sınıf özeti' })
      .getByRole('link', { name: 'Deniz Yılmaz profilini aç' })
      .click()
    const tabs = page.getByRole('toolbar', { name: 'Öğrenci profili bölümleri' })
    await expect(page.getByRole('heading', { name: 'Aylık başarı eğilimi' })).toBeVisible()

    await tabs.getByRole('button', { name: 'Devamsızlık' }).click()
    await expect(page).toHaveURL(/[?&]sekme=devamsizlik/)
    await tabs.getByRole('button', { name: 'Ödev durumu' }).click()
    await expect(page).toHaveURL(/[?&]sekme=odevler/)
    await expect(page.getByRole('heading', { level: 2, name: 'Ödev durumu' })).toBeVisible()

    await page.goBack()
    await expect(page).toHaveURL(/[?&]sekme=devamsizlik/)
    await expect(page.getByRole('heading', { level: 2, name: 'Katılım geçmişi' })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/ogretmen\/ogrenci\/s1$/)
    await expect(page.getByRole('heading', { name: 'Aylık başarı eğilimi' })).toBeVisible()
    await page.goForward()
    await expect(page).toHaveURL(/[?&]sekme=devamsizlik/)
    await expect(page.getByRole('heading', { level: 2, name: 'Katılım geçmişi' })).toBeVisible()

    // Geri/ileri sonrası da "Listeye dön" panel açık sınıf özetine götürür.
    await page.getByRole('link', { name: 'Listeye dön' }).click()
    await expect(page).toHaveURL(/\/ogretmen\/siniflarim\?sinif=c1$/)
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
