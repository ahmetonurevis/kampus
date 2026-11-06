import { randomUUID } from 'node:crypto'

import { apiRequest, type ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Kayıt yenileme (IST-100): ücret yayımlı tarifeden ve artış tavanından hesaplanır, yenileme
// planlamak sınıfı değiştirmez, dönem geçişi ayrı işlemdir. Her yazan test kendi kurumunu kurar
// (`tenant`): s3 (Zeynep, 6-A → 7-A) devam eden ara sınıf öğrencisidir, sözleşmesi taban olur;
// s4 (Arda, 8-A → 9-A) kademe başlangıcına geçer, tavan uygulanmaz.

interface Renewal {
  id: string
  studentId: string
  status: string
  netCents: number
  academicYear: number
}
interface StudentRecord {
  classId: string
}

const RENEWALS = '/api/v1/finance/renewals'

async function renewalOf(client: ApiClient, studentId: string) {
  const result = await client.get(`${RENEWALS}?studentId=${studentId}`)
  expect(result.status).toBe(200)
  return (result.body as { data: Renewal[] }).data[0]
}

async function classOf(client: ApiClient, studentId: string) {
  const result = await client.get(`/api/v1/collections/students/${studentId}`)
  expect(result.status).toBe(200)
  return (result.body as { data: { record: StudentRecord } }).data.record.classId
}

function nextDay(offset: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + offset * 86_400_000),
  )
}

/** Kurumun yenileme yılı: güncel eğitim yılının bir sonrası. */
async function renewalYear(client: ApiClient) {
  const me = await client.get('/api/v1/me')
  expect(me.status).toBe(200)
  const year = (me.body as { data: { activeInstitution: { academicYear: number } } }).data
    .activeInstitution.academicYear
  return year + 1
}

/** Yılın öğrenim ücreti tarifesini API'den açar ve yayımlar (tutar kuruş). */
async function publishTariff(client: ApiClient, academicYear: number, amountCents: number) {
  const draft = await client.post(
    '/api/v1/fee-tariffs',
    {
      academicYear,
      items: [
        {
          kind: 'tuition',
          level: null,
          amountCents,
          unit: 'year',
          vatBasisPoints: 1000,
          vatEffectiveDate: `${String(academicYear - 1)}-01-01`,
          announcedAmountCents: amountCents,
        },
      ],
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(draft.status, JSON.stringify(draft.body)).toBe(201)
  const { id, version } = (draft.body as { data: { id: string; version: number } }).data
  const published = await client.post(
    `/api/v1/fee-tariffs/${id}/publish`,
    { announcedDate: nextDay(-1), mebbisRecordedDate: null },
    { 'idempotency-key': randomUUID(), 'if-match': `"${String(version)}"` },
  )
  expect(published.status, JSON.stringify(published.body)).toBe(200)
}

test.describe('kayıt yenileme', () => {
  test('yönetici artış tavanı oranını girer, ücret özetini görür ve yenilemeyi planlar; sınıf değişmez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s3'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    const year = await renewalYear(client)
    await page.goto('/yonetici/kayit-yenileme')
    await expect(page.getByRole('heading', { name: 'Kayıt Yenileme', level: 2 })).toBeVisible()

    // Devam eden öğrencinin tavanı için yılın ÜFE/TÜFE oranı girilir (DOM-FIN-005).
    await page.getByRole('button', { name: 'Oran ekle' }).click()
    const rates = page.getByRole('dialog', { name: 'Artış tavanı oranı ekle' })
    await rates.getByLabel('Ücret yılı (başlangıç)').fill(String(year))
    await rates.getByLabel('ÜFE ortalaması (%)', { exact: true }).fill('40')
    await rates.getByLabel('TÜFE ortalaması (%)', { exact: true }).fill('30')
    await rates.getByLabel('Kaynak (TÜİK bülteni)').fill('TÜİK bülteni 53607')
    await rates.getByLabel('Bülten tarihi').fill(nextDay(-30))
    await rates.getByRole('button', { name: 'Kaydet' }).click()
    await expect(rates).toBeHidden()
    const indexes = page.getByRole('region', { name: 'Artış tavanı oranları' })
    await expect(indexes.getByText('%40').first()).toBeVisible()

    await page.getByRole('button', { name: 'Kayıt yenile' }).click()
    const form = page.getByRole('dialog', { name: 'Kayıt yenile' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Zeynep Demir · 6-A' })
    await form.getByLabel('Yeni sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Taksit sayısı').fill('6')
    await form.getByLabel('İlk taksit tarihi').fill(nextDay(30))
    await form.getByRole('button', { name: 'Kontrol et' }).click()

    const summary = form.getByRole('region', { name: 'Yeni dönem ödeme özeti' })
    await expect(summary.getByText(/^Artış tavanı: /)).toBeVisible()
    await expect(summary.getByText(/^Net eğitim bedeli: /)).toBeVisible()
    await expect(summary.getByText('6 taksit')).toBeVisible()
    const quote = await client.post(`${RENEWALS}/quote`, {
      studentId: 's3',
      targetClassId: 'c1',
      academicYear: year,
      installmentCount: 6,
    })
    expect(quote.status).toBe(200)
    const quoted = (quote.body as { data: { netCents: number; ceiling: { status: string } } }).data
    expect(quoted.ceiling.status).toBe('applied')

    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()

    await expect.poll(async () => (await renewalOf(client, 's3'))?.status).toBe('Planlandı')
    expect((await renewalOf(client, 's3'))?.netCents).toBe(quoted.netCents)
    // Yenileme planlamak sınıfı değiştirmez; geçiş ayrı işlemdir.
    expect(await classOf(client, 's3')).toBe('c3')
    await page.getByLabel('Tabloda ara').fill('Zeynep Demir')
    await page.getByRole('button', { name: 'Zeynep Demir' }).click()
    const detail = page.getByRole('dialog', { name: 'Zeynep Demir' })
    await expect(detail.getByText(/^1\. taksit/)).toBeVisible()
    await expect(detail.getByText(/^Artış tavanı: /)).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Dönem geçişini uygula' })).toBeVisible()
  })

  test('DOM-FIN-002, renewal_above_tariff: ilan edilen ücreti aşan bedel reddedilir; ileti görünür, yenileme yazılmaz', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s3'],
      collections: ['renewals'],
      tariffYears: ['current'],
    })
    const client = await api(school.user('yonetici'))
    // Gelecek yılın ilanı 25.000 ₺; form 30.000 ₺ ile gönderilir. Tavan oranı girilmeden ücret
    // hesaplanmaz (DOM-FIN-005), bu yüzden yılın ÜFE/TÜFE oranı API'den eklenir.
    const year = await renewalYear(client)
    await publishTariff(client, year, 2_500_000)
    const rates = await client.post(
      `${RENEWALS}/price-indexes`,
      {
        academicYear: year,
        ppiBasisPoints: 4_000,
        cpiBasisPoints: 3_000,
        source: 'TÜİK bülteni (test)',
        bulletinDate: nextDay(-30),
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(rates.status, JSON.stringify(rates.body)).toBe(201)
    const before = await renewalOf(client, 's3')

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/kayit-yenileme')
    await page.getByRole('button', { name: 'Kayıt yenile' }).click()
    const form = page.getByRole('dialog', { name: 'Kayıt yenile' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Zeynep Demir · 6-A' })
    await form.getByLabel('Yeni sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Öğrenim ücreti (₺)').fill('30000')
    await form.getByLabel('Taksit sayısı').fill('6')
    await form.getByLabel('İlk taksit tarihi').fill(nextDay(30))
    await form.getByRole('button', { name: 'Kontrol et' }).click()

    // Ret ücret önizlemesinde gelir; onay düğmesi çıkmaz.
    await expect(form.getByText('Eğitim bedeli ilan edilen ücreti aşamaz.')).toBeVisible()
    await expect(form.getByRole('button', { name: 'Onayla ve kaydet' })).toHaveCount(0)
    // Form düzeltme için açık kalır; kayıt değişmez.
    await expect(form.getByLabel('Öğrenim ücreti (₺)')).toHaveValue('30000')
    expect(await renewalOf(client, 's3')).toEqual(before)
  })

  test('dönem geçişi ayrı işlemle uygulanır ve sınıfı değiştirir', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s4'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const client = await api(school.user('yonetici'))
    const year = await renewalYear(client)
    const body = { studentId: 's4', targetClassId: 'c5', academicYear: year, installmentCount: 8 }
    const quote = await client.post(`${RENEWALS}/quote`, body)
    expect(quote.status).toBe(200)
    const tariffId = (quote.body as { data: { tariffId: string } }).data.tariffId
    const created = await client.post(
      RENEWALS,
      { ...body, mode: 'renew', tariffId, firstDueDate: nextDay(30) },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status).toBe(201)
    expect(await classOf(client, 's4')).toBe('c4')

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/kayit-yenileme')
    await page.getByLabel('Tabloda ara').fill('Arda Çelik')
    await page.getByRole('button', { name: 'Arda Çelik' }).click()
    await page
      .getByRole('dialog', { name: 'Arda Çelik' })
      .getByRole('button', { name: 'Dönem geçişini uygula' })
      .click()
    const confirm = page.getByRole('dialog', { name: 'Dönem geçişini uygula' })
    await confirm.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(confirm).toBeHidden()

    await expect.poll(async () => classOf(client, 's4')).toBe('c5')
    expect((await renewalOf(client, 's4'))?.status).toBe('Tamamlandı')
  })

  test('IST-100, DOM-FIN-005: yeni dönem sözleşmesi Ek 2 ücret kararında tavan hesabını ve oran kaynağını yazar', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s3'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const client = await api(school.user('yonetici'))
    const year = await renewalYear(client)
    const rates = await client.post(
      `${RENEWALS}/price-indexes`,
      {
        academicYear: year,
        ppiBasisPoints: 4000,
        cpiBasisPoints: 3000,
        source: 'TÜİK bülteni 53607',
        bulletinDate: nextDay(-30),
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(rates.status, JSON.stringify(rates.body)).toBe(201)
    const body = { studentId: 's3', targetClassId: 'c1', academicYear: year, installmentCount: 6 }
    const quote = await client.post(`${RENEWALS}/quote`, body)
    expect(quote.status).toBe(200)
    const quoted = (quote.body as { data: { tariffId: string; ceiling: { status: string } } }).data
    expect(quoted.ceiling.status).toBe('applied')
    const created = await client.post(
      RENEWALS,
      { ...body, mode: 'renew', tariffId: quoted.tariffId, firstDueDate: nextDay(30) },
      { 'idempotency-key': randomUUID() },
    )
    expect(created.status).toBe(201)

    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/kayit-yenileme')
    await page.getByLabel('Tabloda ara').fill('Zeynep Demir')
    await page.getByRole('button', { name: 'Zeynep Demir' }).click()
    const opener = page
      .getByRole('dialog', { name: 'Zeynep Demir' })
      .getByRole('button', { name: 'Yeni dönem sözleşmesi' })
    await opener.click()

    const preview = page.getByRole('dialog', { name: 'Eğitim sözleşmesi · Önizleme' })
    const viewer = preview.getByLabel('PDF sayfa görünümü')
    await expect(viewer).toContainText('YENİLEME SÖZLEŞMESİ')
    const status = preview.getByRole('status').filter({ hasText: /^Sayfa 1 \/ \d+$/ })
    const total = Number((await status.textContent())?.split('/')[1]?.trim())
    expect(total).toBeGreaterThanOrEqual(3)
    // Sayfa metni altbilgideki "k / N" ile o sayfanın olduğu doğrulanınca okunur.
    const pages: string[] = [(await viewer.textContent()) ?? '']
    for (let current = 2; current <= total; current += 1) {
      await preview.getByRole('button', { name: 'Sonraki PDF sayfası' }).click()
      await expect(viewer).toContainText(`${String(current)} / ${String(total)}`)
      pages.push((await viewer.textContent()) ?? '')
    }
    const appendix = pages.findIndex((text) => text.includes('Ek 2 / Yenileme ücret kararı'))
    expect(appendix).toBeGreaterThan(pages.findIndex((text) => text.includes('Ek 1 / Ödeme planı')))
    const decision = pages.slice(appendix).join(' ')
    expect(decision).toContain('Artış tavanı')
    expect(decision).toContain('Son sözleşmenin indirimsiz ücreti')
    expect(decision).toContain('TÜİK bülteni 53607')

    await page.keyboard.press('Escape')
    await expect(preview).toBeHidden()
    await expect(opener).toBeFocused()
  })

  test('K-10, DOM-KAY-027: yönetici davet açar, ödeyici veli yanıt verir; yenilemeyecek planı engellemez, plan daveti planlandı yapar', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['veli'],
      students: ['s3'],
      childIds: ['s3'],
      collections: ['renewals'],
      tariffYears: ['current', 'next'],
    })
    const client = await api(school.user('yonetici'))
    const year = await renewalYear(client)
    const guardians = await client.get('/api/v1/students/s3/guardians')
    expect(guardians.status).toBe(200)
    const bond = (
      guardians.body as { data: { id: string; membershipId: string | null; rowVersion?: number }[] }
    ).data.find((item) => item.membershipId !== null)
    const payer = await apiRequest(
      client.context,
      'PATCH',
      `/api/v1/students/s3/guardians/${String(bond?.id)}`,
      { isPayer: true },
      { 'if-match': `"${String(bond?.rowVersion ?? 1)}"` },
    )
    expect(payer.status, JSON.stringify(payer.body)).toBe(200)
    const rate = await client.post(`${RENEWALS}/price-indexes`, {
      academicYear: year,
      ppiBasisPoints: 4_000,
      cpiBasisPoints: 3_000,
      source: 'TÜİK bülteni 53607',
      bulletinDate: nextDay(-30),
    })
    expect(rate.status, JSON.stringify(rate.body)).toBe(201)

    // Personel seçili öğrenciye davet açar; liste durumu gösterir.
    const admin = await loginAs(school.user('yonetici'))
    await admin.goto('/yonetici/kayit-yenileme')
    await admin.getByRole('button', { name: 'Davetler' }).click()
    const section = admin.getByRole('region', { name: 'Yenileme davetleri' })
    await section.getByRole('button', { name: 'Davet aç' }).click()
    const dialog = admin.getByRole('dialog', { name: 'Yenileme daveti aç' })
    await dialog.getByRole('checkbox', { name: 'Zeynep Demir · 6-A' }).check()
    await dialog.getByRole('button', { name: 'Davet aç (1)' }).click()
    await expect(dialog).toBeHidden()
    const invitations = section.getByRole('table', { name: 'Yenileme davetleri' })
    await expect(invitations.getByText('Zeynep Demir')).toBeVisible()
    await expect(invitations.getByText('Bekliyor')).toBeVisible()

    // Ödeyici veli niyetini bildirir; sözleşme ve taksit açılmaz.
    const parent = await loginAs(school.user('veli'))
    await parent.goto('/veli/kayit-yenileme?cocuk=s3')
    const card = parent.getByRole('region', { name: /kayıt yenileme daveti/ })
    await card.getByLabel('Not (isteğe bağlı)').fill('Taşınıyoruz.')
    await card.getByRole('button', { name: 'Yenilemeyeceğim' }).click()
    await expect(card.getByText('Yenilemeyecek')).toBeVisible()
    await expect(card.getByRole('button', { name: 'Yenilemeyeceğim' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(await renewalOf(client, 's3')).toBeUndefined()

    // Personel yanıtı görür; plan formu uyarır, engellemez. Oturum bağlamda tektir: rol değişir.
    await loginAs(school.user('yonetici'), { fresh: true })
    await admin.goto('/yonetici/kayit-yenileme?gorunum=davetler')
    await expect(invitations.getByText('Taşınıyoruz.')).toBeVisible()
    await admin.getByRole('button', { name: 'Kayıt yenile' }).click()
    const form = admin.getByRole('dialog', { name: 'Kayıt yenile' })
    await form.getByLabel('Öğrenci', { exact: true }).selectOption({ label: 'Zeynep Demir · 6-A' })
    await form.getByLabel('Yeni sınıf').selectOption({ label: '7-A · Kadıköy Kampüsü' })
    await form.getByLabel('Taksit sayısı').fill('2')
    await form.getByLabel('İlk taksit tarihi').fill(nextDay(30))
    await form.getByRole('button', { name: 'Kontrol et' }).click()
    await expect(form.getByText(/Veli davete "Yenilemeyecek" yanıtı verdi/)).toBeVisible()
    await form.getByRole('button', { name: 'Onayla ve kaydet' }).click()
    await expect(form).toBeHidden()
    await expect(invitations.getByText('Planlandı')).toBeVisible()

    // Plan yapılınca veli yanıtı değiştiremez; sözleşme onayı ayrı kalır.
    await loginAs(school.user('veli'), { fresh: true })
    await parent.goto('/veli/kayit-yenileme?cocuk=s3')
    await expect(card.getByRole('button', { name: 'Yenilemek istiyorum' })).toHaveCount(0)
    await expect(card.getByRole('link', { name: 'Sözleşmeler' })).toBeVisible()
  })

  test('veli yenileme işlemi göremez; liste kapsamına daralır', async ({ loginAs }) => {
    const page = await loginAs('veli')
    await page.goto('/veli/kayit-yenileme?cocuk=s1')
    await expect(page.getByText('Seçili çocuğunuzun kayıtları')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kayıt yenile' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Zeynep Demir' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Artış tavanı oranları' })).toHaveCount(0)
  })
})
