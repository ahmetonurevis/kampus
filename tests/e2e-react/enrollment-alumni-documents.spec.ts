import { istanbulDay } from './support/commands.ts'
import { pdfText } from './support/finance-pdf-text.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Mezun belge talebi (ON-260, DOM-KAY-044): ön büro mezunun not dökümü talebini kaydeder, hazırlar,
// PDF'i açar ve kimlik notuyla teslim eder. Talep edenin yetkisi, ücret, numara ve kurumlar arası
// kurallar API ve birim testlerindedir (`apps/api/test/enrollment-alumni-documents.test.ts`,
// `tests/enrollment-alumni-documents.test.ts`), şablon metni web birim testindedir.

const GRADUATE = { id: 'e2e-alumni-1', name: 'Mezun Deniz Aksoy', number: '2022091' }
const records = [
  { collection: 'classes' as const, data: { id: 'e2e-alumni-c12', name: '12-M' } },
  {
    collection: 'students' as const,
    data: {
      id: GRADUATE.id,
      name: GRADUATE.name,
      classId: 'e2e-alumni-c12',
      number: GRADUATE.number,
      isActive: false,
    },
  },
  {
    collection: 'renewals' as const,
    data: {
      id: 'e2e-alumni-r1',
      studentId: GRADUATE.id,
      mode: 'graduate',
      status: 'Mezun',
      year: 2025,
      fromClassId: 'e2e-alumni-c12',
      targetClassId: 'e2e-alumni-c12',
      createdAt: '2025-06-01T07:00:00.000Z',
      activatedAt: '2025-06-27T08:00:00.000Z',
    },
  },
  {
    collection: 'grades' as const,
    data: {
      id: 'e2e-alumni-g1',
      studentId: GRADUATE.id,
      classId: 'e2e-alumni-c12',
      subjectId: 'mat',
      subject: 'Matematik',
      term: 1,
      score: 88,
      date: '2024-11-04T09:00:00.000Z',
      assessmentType: 'sinav',
    },
  },
]

test('ON-260 DOM-KAY-044: ön büro mezunun not dökümü talebini kaydeder, hazırlar, PDF açar ve teslim eder', async ({
  api,
  loginAs,
  tenant,
}) => {
  const school = await tenant({
    roles: ['onburo'],
    records,
    birthDates: { [GRADUATE.id]: '2007-01-15' },
  })
  const page = await loginAs(school.user('onburo'))
  await page.goto('/onburo/kayit-islemleri')
  const section = page.getByRole('region', { name: 'Mezun belge talepleri' })
  await section.getByRole('button', { name: 'Yeni belge talebi' }).click()

  const form = page.getByRole('dialog', { name: 'Yeni belge talebi' })
  await form.getByLabel('Öğrenci ara').fill('Mezun Deniz')
  const student = form.getByLabel('Öğrenci', { exact: true })
  await expect(student.locator('option', { hasText: GRADUATE.name })).toHaveCount(1)
  await student.selectOption({
    label: `${GRADUATE.name} · ${GRADUATE.number} · Mezun · 27 Haz 2025`,
  })
  await form.getByLabel('Belge türü').selectOption({ label: 'Not dökümü (transkript)' })
  await form.getByLabel('Talep nasıl geldi').selectOption({ label: 'Dilekçe' })
  await form.getByRole('button', { name: 'Talebi kaydet' }).click()

  const detail = page.getByRole('dialog', { name: `${GRADUATE.name} · Not dökümü (transkript)` })
  await expect(detail.getByText('Durum: Alındı')).toBeVisible()
  await detail.getByRole('button', { name: 'Hazırlamaya başla' }).click()
  await expect(detail.getByText('Durum: Hazırlanıyor')).toBeVisible()
  await detail.getByRole('button', { name: 'Hazır işaretle' }).click()
  const ready = detail.getByRole('form', { name: 'Hazır işaretle' })
  await ready.getByLabel('Açıklama (isteğe bağlı)').fill('9–11. sınıf notları e-Okul dökümündedir.')
  await ready.getByRole('button', { name: 'Hazır işaretle' }).click()
  const number = `MB-${istanbulDay().slice(0, 4)}-0001`
  await expect(detail.getByText(number)).toBeVisible()

  await detail.getByRole('button', { name: 'Belgeyi görüntüle' }).click()
  const preview = page.getByRole('dialog', { name: 'Mezun belgesi · Önizleme' })
  await expect(preview.getByRole('img', { name: 'Mezun belgesi, sayfa 1' })).toBeVisible()
  const downloading = page.waitForEvent('download')
  await preview.getByRole('button', { name: 'PDF’yi indir' }).click()
  const file = await downloading
  expect(file.suggestedFilename()).toBe(`not-dokumu-${number.toLowerCase()}.pdf`)
  const text = await pdfText(file)
  for (const expected of [
    'NOT DÖKÜMÜ',
    GRADUATE.name,
    GRADUATE.number,
    'Matematik',
    '88',
    number,
    'e-Okul dökümündedir',
    'Bilgilendirme amaçlıdır',
  ])
    expect(text, expected).toContain(expected)
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()

  await detail.getByRole('button', { name: 'Teslim et' }).click()
  const deliver = detail.getByRole('form', { name: 'Teslim et' })
  await deliver.getByLabel('Kimlik doğrulama notu').fill('Nüfus cüzdanı görüldü')
  await deliver.getByRole('button', { name: 'Teslim et' }).click()
  await expect(detail.getByText('Durum: Teslim edildi')).toBeVisible()

  const admin = await api(school.user('yonetici'))
  const audit = await admin.get(
    '/api/v1/audit-events?entityType=alumni_document_requests&pageSize=100',
  )
  expect(audit.status).toBe(200)
  const actions = (audit.body as { data: { action: string }[] }).data.map((event) => event.action)
  for (const action of [
    'alumni_document_request.create',
    'alumni_document_request.ready',
    'alumni_document.issue',
    'alumni_document_request.deliver',
  ])
    expect(actions).toContain(action)
})

test('ON-260 DOM-KAY-044: yönetici belge ücretini girer, ücretli talep ödeme yöntemi olmadan teslim edilmez; 390 px taşma yok', async ({
  loginAs,
  tenant,
}) => {
  const school = await tenant({ roles: [], records, birthDates: { [GRADUATE.id]: '2007-01-15' } })
  const page = await loginAs(school.user('yonetici'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/yonetici/kayit-islemleri')
  const section = page.getByRole('region', { name: 'Mezun belge talepleri' })
  await expect(section.getByRole('heading', { name: 'Mezun belge talepleri' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await section.getByRole('button', { name: 'Belge ücretleri' }).click()
  const fees = page.getByRole('dialog', { name: 'Belge ücretleri' })
  await fees.getByLabel('Öğrenim belgesi (₺)').fill('150,00')
  await fees.getByRole('button', { name: 'Kaydet' }).click()
  await expect(fees).toBeHidden()

  await section.getByRole('button', { name: 'Yeni belge talebi' }).click()
  const form = page.getByRole('dialog', { name: 'Yeni belge talebi' })
  await form.getByLabel('Öğrenci', { exact: true }).selectOption(GRADUATE.id)
  await form.getByLabel('Adet').fill('2')
  await expect(form.getByText('Belge başı 150,00 ₺; toplam 300,00 ₺.')).toBeVisible()
  await form.getByRole('button', { name: 'Talebi kaydet' }).click()

  const detail = page.getByRole('dialog', { name: `${GRADUATE.name} · Öğrenim belgesi` })
  await expect(detail.getByText('300,00 ₺ · ödenmedi')).toBeVisible()
  await detail.getByRole('button', { name: 'Hazırlamaya başla' }).click()
  await detail.getByRole('button', { name: 'Hazır işaretle' }).click()
  await detail
    .getByRole('form', { name: 'Hazır işaretle' })
    .getByRole('button', { name: 'Hazır işaretle' })
    .click()
  await detail.getByRole('button', { name: 'Teslim et' }).click()
  const deliver = detail.getByRole('form', { name: 'Teslim et' })
  await deliver.getByLabel('Kimlik doğrulama notu').fill('Ehliyet görüldü')
  await deliver.getByRole('button', { name: 'Teslim et' }).click()
  await expect(deliver.getByRole('alert')).toContainText('ödeme yöntemini seçin')
  await deliver.getByLabel(/Ödeme yöntemi/).selectOption({ label: 'Nakit' })
  await deliver.getByRole('button', { name: 'Teslim et' }).click()
  await expect(detail.getByText('300,00 ₺ · ödendi (Nakit)')).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
