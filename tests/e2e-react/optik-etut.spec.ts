import type { Page } from '@playwright/test'

import { createSeed } from '../../packages/school-core/src/data/seed.ts'
import {
  exampleOpticalFile,
  runAssessment,
} from '../../packages/school-core/src/lib/assessment-automation.ts'
import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Optik değerlendirme ve otomatik etüt. Veri yazan testler kendi kurumunu `tenant()` ile kurar.
// Optik ön kontrol saf işlemdir (core `previewOptical`, istemcide); kaydetme ucu API'de yoktur
// (TODO(api-optical-evaluate)), bu yüzden test ön kontrolü ve kilitli kaydı doğrular.

const OPTICAL_DATA = ['mockExams', 'mockResults', 'opticalProfiles', 'opticalEvaluations'] as const
const HEADER = 'student;booklet;answers'

test.describe('optik değerlendirme', () => {
  test('yönetici dosya yükler; ön kontrol hatası satır numarasıyla çıkar, düzgün dosya önizlenir', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await expect(page.getByRole('heading', { name: 'Optik Değerlendirme', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Okuyucu profilleri' })).toBeVisible()

    const upload = page.getByLabel('Optik cevap dosyası', { exact: true })
    const content = page.getByLabel('Optik dosya içeriği', { exact: true })
    const preview = page.getByRole('button', { name: 'Sonuçları önizle', exact: true })

    // Eşleşmeyen öğrenci numarası: hata satır numarasıyla, hiçbir sonuç gösterilmeden.
    await upload.setInputFiles({
      name: 'cevaplar.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`${HEADER}\n9999999;A;BBBDABCDABCD\n`, 'utf8'),
    })
    await expect(content).toHaveValue(/9999999/)
    await preview.click()
    await expect(page.getByRole('alert')).toContainText(
      '2. satırdaki öğrenci tekil eşleşmedi: 9999999',
    )
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toHaveCount(0)

    // Cevap sayısı anahtarla uyuşmuyor: yine satır numarası.
    await content.fill(`${HEADER}\n2026001;A;BBB\n`)
    await preview.click()
    await expect(page.getByRole('alert')).toContainText('2. satırda 12 cevap bekleniyor')

    // Düzgün dosya: önizleme açılır, kayıt ucu olmadığı için onay kilitli kalır.
    await upload.setInputFiles({
      name: 'cevaplar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`${HEADER}\n2026001;A;BBBDABCDABCD\n`, 'utf8'),
    })
    await preview.click()
    await expect(
      page.getByRole('heading', { name: 'Değerlendirme önizlemesi', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: '1 öğrenci' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'Deniz Yılmaz' }).first()).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Onayla ve sonuçları kaydet', exact: true }),
    ).toBeDisabled()
  })

  test('desteklenmeyen dosya türü reddedilir', async ({ loginAs, tenant }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: OPTICAL_DATA,
    })
    const page = await loginAs(school.user('yonetici'))
    await page.goto('/yonetici/optik-degerlendirme')
    await page.getByLabel('Optik cevap dosyası', { exact: true }).setInputFiles({
      name: 'cevaplar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4', 'utf8'),
    })
    await expect(
      page.getByText('En fazla 1 MB boyutunda CSV, DAT veya TXT dosyası seçin.'),
    ).toBeVisible()
    await expect(page.getByLabel('Optik dosya içeriği', { exact: true })).toHaveValue('')
  })
})

// --- Otomatik etüt ---------------------------------------------------------------------------
// Optik analizi kaydeden API ucu yoktur; etüt planının girdisi olan analiz çekirdek kuralıyla
// üretilip kurumun veritabanına konur (tenant `records`). Plan, iptal ve yoklama gerçek uçlardan
// geçer. Ders programı/randevu/etkinlik konmaz: çakışma kaynağı boştur, istemci ve sunucu aynı
// planı hesaplar.

const TUTORING_DATA = ['mockExams', 'opticalProfiles', 'availability'] as const
const SESSIONS = '/api/v1/collections/tutorSessions?pageSize=100'

interface SessionRow {
  id: string
  version: number
  record: { status: string; attendance: Record<string, string>; cancelReason?: string }
}

function istanbulDay(offsetDays: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  )
}

/** s1 için optik analiz: Deniz matematik kazanımlarında zayıftır (etüt adayı). */
function evaluatedRecords(now: Date) {
  const state = createSeed(now)
  const profile = state.opticalProfiles[0]
  if (!profile) throw new Error('Seed optik profili yok.')
  const text = exampleOpticalFile(state, profile)
  let counter = 0
  runAssessment(
    state,
    { role: 'yonetici' },
    'evaluate',
    { profileId: profile.id, text },
    (prefix) => `${prefix}-e2e-${++counter}`,
    '',
    now.toISOString(),
  )
  return [
    ...state.opticalEvaluations
      .filter((item) => item.studentId === 's1')
      .map((data) => ({ collection: 'opticalEvaluations' as const, data })),
    ...state.mockResults
      .filter((item) => item.studentId === 's1')
      .map((data) => ({ collection: 'mockResults' as const, data })),
  ]
}

/** s1'in sınıfında, öğretmen t1'in matematik etüdü (yoklama/iptal testleri için hazır kayıt). */
function tutorSession(id: string, date: Date) {
  const state = createSeed(new Date())
  const student = state.students.find((item) => item.id === 's1')
  const room = state.classes.find((item) => item.id === student?.classId)
  if (!student || !room) throw new Error('Seed öğrenci/sınıf yok.')
  const stamp = new Date().toISOString()
  return {
    collection: 'tutorSessions' as const,
    data: {
      id,
      examId: 'exam-7-1',
      branchId: room.branchId,
      grade: 7,
      subjectId: 'math',
      topic: 'Denklemler',
      studentIds: ['s1'],
      scores: [{ studentId: 's1', percent: 25 }],
      teacherId: 't1',
      date: date.toISOString(),
      duration: 30,
      room: room.room,
      roomClassId: room.id,
      capacity: 6,
      status: 'Planlandı',
      attendance: {},
      threshold: 70,
      createdAt: stamp,
      updatedAt: stamp,
    },
  }
}

async function sessionsOf(client: ApiClient): Promise<SessionRow[]> {
  const result = await client.get(SESSIONS)
  expect(result.status).toBe(200)
  return (result.body as { data: SessionRow[] }).data
}

async function openPlanForm(page: Page) {
  await page.goto('/yonetici/otomatik-etut')
  await page.getByRole('button', { name: 'Etüt planla' }).click()
  await page.getByLabel('Deneme', { exact: true }).selectOption('exam-7-1')
  await page.getByLabel('Başarı eşiği (%)').fill('100')
  await page.getByLabel('Bitiş tarihi').fill(istanbulDay(14))
}

test.describe('otomatik etüt', () => {
  test('yönetici planı önizler ve onaylar; öğrenci kendi etüdünü salt okunur görür', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await openPlanForm(page)

    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Etüt planı önizlemesi', exact: true }),
    ).toBeVisible()
    // Önizleme saf işlemdir: sunucuda hiç etüt yoktur.
    expect(await sessionsOf(client)).toHaveLength(0)

    await page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true }).click()
    await expect(page.getByText(/\d+ etüt oluşturuldu\./).first()).toBeVisible()
    await expect.poll(async () => (await sessionsOf(client)).length).toBeGreaterThan(0)

    const student = await loginAs(school.user('ogrenci'))
    await student.goto('/ogrenci/otomatik-etut')
    await expect(student.getByRole('heading', { name: 'Otomatik Etüt', level: 1 })).toBeVisible()
    const first = student.getByRole('button', { name: /Matematik · /i }).first()
    await expect(first).toBeVisible()
    await expect(student.getByRole('button', { name: 'Etüt planla' })).toHaveCount(0)
    await first.click()
    const dialog = student.getByRole('dialog')
    await expect(dialog).toContainText('Deniz Yılmaz')
    for (const name of ['Yoklama al / güncelle', 'Etüdü iptal et'])
      await expect(dialog.getByRole('button', { name })).toHaveCount(0)
  })

  test('onay sırasında plan değişirse fark gösterilir ve çift etüt oluşmaz', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici'],
      students: ['s1'],
      collections: TUTORING_DATA,
      records: evaluatedRecords(new Date()),
    })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await openPlanForm(page)
    await page.getByRole('button', { name: 'Etüt planını önizle', exact: true }).click()
    const confirm = page.getByRole('button', { name: 'Onayla ve etütleri oluştur', exact: true })
    await expect(confirm).toBeEnabled()

    // Önizlemeden sonra başka biri aynı planı onaylar: sunucu planı artık farklı hesaplar.
    const created = await client.post('/api/v1/tutor-sessions', {
      examId: 'exam-7-1',
      threshold: 100,
      fromDate: istanbulDay(0),
      toDate: istanbulDay(14),
      duration: 30,
      maxGroupSize: 6,
    })
    expect(created.status).toBe(200)
    const before = (await sessionsOf(client)).length
    expect(before).toBeGreaterThan(0)

    await confirm.click()
    await expect(page.getByRole('alert').filter({ hasText: 'Plan değişmiş' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Önceki plan' })).toBeVisible()
    // Güncel plan zaten etütte olanları atlar; onay yeniden istenir ve boş plan onaylanamaz.
    await expect(confirm).toBeDisabled()
    expect(await sessionsOf(client)).toHaveLength(before)
  })

  test('yönetici geçmiş etüdün yoklamasını alır; tamamlanan etüt iptal edilemez', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const past = tutorSession('tutor-e2e-past', new Date(Date.now() - 2 * 86_400_000))
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], records: [past] })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Yoklama al / güncelle', exact: true }).click()
    await dialog.getByRole('combobox', { name: 'Deniz Yılmaz', exact: true }).selectOption('İzinli')
    await dialog.getByRole('button', { name: 'Yoklamayı kaydet', exact: true }).click()
    await expect(dialog).toContainText('Tamamlandı')
    await expect(dialog).toContainText('İzinli')
    await expect(dialog.getByRole('button', { name: 'Etüdü iptal et' })).toHaveCount(0)
    await expect
      .poll(async () => (await sessionsOf(client))[0]?.record)
      .toMatchObject({ status: 'Tamamlandı', attendance: { s1: 'İzinli' } })
  })

  test('iptal gerekçesi zorunludur ve iptal edilen etüt geçmişte kalır', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const future = tutorSession('tutor-e2e-future', new Date(Date.now() + 3 * 86_400_000))
    const school = await tenant({ roles: ['yonetici'], students: ['s1'], records: [future] })
    const page = await loginAs(school.user('yonetici'))
    const client = await api(school.user('yonetici'))
    await page.goto('/yonetici/otomatik-etut')
    await page.getByRole('button', { name: 'Matematik · Denklemler', exact: true }).click()
    const dialog = page.getByRole('dialog')
    // Gelecek etütte yoklama açılmaz.
    await expect(dialog.getByRole('button', { name: 'Yoklama al / güncelle' })).toHaveCount(0)
    await dialog.getByRole('button', { name: 'Etüdü iptal et', exact: true }).click()
    await dialog.getByRole('button', { name: 'İptali onayla', exact: true }).click()
    await expect(dialog.getByText('İptal nedenini girin.')).toBeVisible()
    expect((await sessionsOf(client))[0]?.record.status).toBe('Planlandı')

    await dialog.getByLabel('İptal nedeni').fill('Öğretmen izinli')
    await dialog.getByRole('button', { name: 'İptali onayla', exact: true }).click()
    await expect(dialog).toContainText('Öğretmen izinli')
    await expect
      .poll(async () => (await sessionsOf(client))[0]?.record)
      .toMatchObject({ status: 'İptal', cancelReason: 'Öğretmen izinli' })
  })

  test('dil okulunda optik ve etüt adresleri kullanıma kapalı der', async ({ loginAs }) => {
    const page = await loginAs({ email: 'ozan.er@kampus.example' })
    for (const path of ['optik-degerlendirme', 'otomatik-etut']) {
      await page.goto(`/ogretmen/${path}`)
      await expect(page.getByRole('heading', { name: 'Modül kullanıma kapalı' })).toBeVisible()
    }
  })
})
