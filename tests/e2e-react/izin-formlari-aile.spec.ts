import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// Veli ve öğrenci izin karar ekranları (IST-067; docs/domain/iletisim-ve-veli.md DOM-ILT-030,
// -031, -036…038). Her test kendi kurumunu kurar; veli Ayşe Yılmaz'ın çocukları Deniz (s1, 7-A) ve
// Ece (s2, 7-B); öğretmen Selin Kaya (t1) yalnız 7-A'nın rehberidir. Kalıcılık her adımda API ile
// doğrulanır; formlar kuruluma API'den yazılır.

const PARENT_PAGE = '/veli/izin-formlari'
const STUDENT_PAGE = '/ogrenci/izin-formlari'
const STAFF_PAGE = '/ogretmen/izin-formlari'

interface DecisionView {
  decision: 'approved' | 'rejected'
  note: string
  relation: 'guardian' | 'self'
  mine: boolean
}
interface StudentView {
  studentId: string
  status: 'pending' | 'approved' | 'rejected'
  decisions: DecisionView[]
}
interface FormDetail {
  id: string
  version: number
  title: string
  status: 'open' | 'closed'
  students: StudentView[]
}

const istanbulDay = (days: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + days * 86_400_000),
  )

async function openForm(client: ApiClient, title: string, classIds: string[]) {
  const result = await client.post(
    '/api/v1/permission-forms',
    {
      topic: 'trip',
      title,
      description: 'Servisle gidilir, öğle yemeği okuldan.',
      deadline: istanbulDay(7),
      classIds,
    },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(201)
  return (result.body as { data: { id: string; version: number } }).data
}

async function detailOf(client: ApiClient, id: string): Promise<FormDetail> {
  const result = await client.get(`/api/v1/permission-forms/${id}`)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as { data: FormDetail }).data
}

const entryOf = (form: FormDetail, studentId: string) => {
  const entry = form.students.find((item) => item.studentId === studentId)
  expect(entry, `${studentId} formda yok`).toBeDefined()
  return entry as StudentView
}

const cardOf = (page: Page, title: string) => page.getByRole('article', { name: title })

test.describe('İzin formları: veli kararı', () => {
  test('veli çocuğu için notla onaylar, sonra reddeder; kararlar kalıcıdır, durum personele yansır (DOM-ILT-030, DOM-ILT-037, DOM-ILT-038)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen', 'veli'], classes: ['c1', 'c2'] })
    const admin = await api(school.user('yonetici'))
    const parent = await api(school.user('veli'), { fresh: true })
    const created = await openForm(admin, 'Bilim müzesi gezisi', ['c1'])

    await loginAs(school.user('veli'), { fresh: true })
    await page.goto(`${PARENT_PAGE}?cocuk=s1`)
    await expect(page.getByRole('heading', { name: 'Onay Bekleyenler', level: 1 })).toBeVisible()
    const card = cardOf(page, 'Bilim müzesi gezisi')
    await expect(card).toContainText('Henüz karar vermediniz.')
    await expect(card).toContainText('Bekliyor')

    // Onay, isteğe bağlı notla.
    await card.getByLabel('Not (isteğe bağlı)').fill('Servisle gönderiyorum.')
    await card.getByRole('button', { name: 'Onayla' }).click()
    await expect(page.getByText('Onayınız kaydedildi.')).toBeVisible()
    await expect(card).toContainText('Onayladınız.')
    await expect(card).toContainText('Notunuz: Servisle gönderiyorum.')
    const approved = entryOf(await detailOf(parent, created.id), 's1')
    expect(approved.status).toBe('approved')
    expect(approved.decisions).toHaveLength(1)
    expect(approved.decisions[0]).toMatchObject({
      decision: 'approved',
      note: 'Servisle gönderiyorum.',
      relation: 'guardian',
      mine: true,
    })

    // Son güne kadar karar değişir; eski karar silinmez, yeni satır açılır (DOM-ILT-038).
    await card.getByRole('button', { name: 'Kararını değiştir' }).click()
    await expect(card.getByLabel('Not (isteğe bağlı)')).toHaveValue('Servisle gönderiyorum.')
    await card.getByLabel('Not (isteğe bağlı)').fill('Vazgeçtim, kendim götüreceğim.')
    await card.getByRole('button', { name: 'Reddet' }).click()
    await expect(page.getByText('Retiniz kaydedildi.')).toBeVisible()
    await expect(card).toContainText('Reddettiniz.')
    await expect(card).toContainText('Reddedildi')
    const rejected = entryOf(await detailOf(parent, created.id), 's1')
    expect(rejected.status).toBe('rejected')
    expect(rejected.decisions.map((item) => item.decision)).toEqual(['approved', 'rejected'])

    // Rehber öğretmen durumu ve notu görür; sayılar kararı yansıtır.
    await loginAs(school.user('ogretmen'), { fresh: true })
    await page.goto(`${STAFF_PAGE}?izin=${created.id}`)
    const panel = page.getByRole('dialog', { name: 'İzin formu ayrıntısı' })
    await expect(
      panel.locator('dt', { hasText: 'Ret' }).locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('1')
    await expect(panel).toContainText('Vazgeçtim, kendim götüreceğim.')
  })

  test('veli yalnız seçili çocuğunun formlarını görür; hedef dışı çocuk ve başka rol karar formu açamaz (DOM-ILT-037)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogretmen', 'veli'], classes: ['c1', 'c2'] })
    const admin = await api(school.user('yonetici'))
    await openForm(admin, 'Yalnız Ece için gezi', ['c2'])

    await loginAs(school.user('veli'), { fresh: true })
    await page.goto(`${PARENT_PAGE}?cocuk=s1`)
    await expect(page.getByRole('heading', { name: 'İzin formu yok.' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Onayla' })).toHaveCount(0)

    await page.goto(`${PARENT_PAGE}?cocuk=s2`)
    await expect(
      cardOf(page, 'Yalnız Ece için gezi').getByRole('button', { name: 'Onayla' }),
    ).toBeVisible()

    // Öğretmen veli adresini açarsa karar formu çizilmez.
    await loginAs(school.user('ogretmen'), { fresh: true })
    await page.goto(PARENT_PAGE)
    await expect(page.getByRole('button', { name: 'Onayla' })).toHaveCount(0)
    await expect(page.getByRole('article')).toHaveCount(0)
  })

  test('kapatılmış formda düğmeler gerekçeyle kapalıdır; yazılan not silinmez (DOM-ILT-038)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'veli'], classes: ['c1'] })
    const admin = await api(school.user('yonetici'))
    const parent = await api(school.user('veli'), { fresh: true })
    const created = await openForm(admin, 'Kapanacak gezi', ['c1'])
    await loginAs(school.user('veli'), { fresh: true })
    await page.goto(`${PARENT_PAGE}?cocuk=s1`)
    const card = cardOf(page, 'Kapanacak gezi')
    await card.getByLabel('Not (isteğe bağlı)').fill('Yarım kalan not')
    await expect(card.getByRole('button', { name: 'Onayla' })).toBeEnabled()

    // Form arada kapatılır; sunucu hakemdir. Veli yine de göndermeyi dener.
    const closed = await admin.post(`/api/v1/permission-forms/${created.id}/close`, undefined, {
      'idempotency-key': randomUUID(),
      'if-match': `"${created.version}"`,
    })
    expect(closed.status, JSON.stringify(closed.body)).toBe(200)
    await card.getByRole('button', { name: 'Onayla' }).click()
    await expect(card).toContainText('Bu izin formu kapatılmış')
    // Sunucu yanıtı geldi, form yenilendi: düğmeler kapalı, gerekçe görünür, not korunur.
    await expect(card.getByRole('button', { name: 'Onayla' })).toBeDisabled()
    await expect(card.getByRole('button', { name: 'Reddet' })).toBeDisabled()
    await expect(card).toContainText('Form kapatıldı; artık karar verilemez ya da değiştirilemez.')
    await expect(card.getByLabel('Not (isteğe bağlı)')).toHaveValue('Yarım kalan not')
    expect(entryOf(await detailOf(parent, created.id), 's1').decisions).toHaveLength(0)

    // Sayfa yeniden açılınca da kapalı.
    await page.reload()
    await expect(
      cardOf(page, 'Kapanacak gezi').getByRole('button', { name: 'Onayla' }),
    ).toBeDisabled()
  })

  test('rehber olmayan öğretmen velinin notunu ve karar satırını görmez, yalnız durumu görür (DOM-ILT-037)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    // Selin Kaya 9-A'ya (c5) yalnız ders verir, rehberi değildir; velinin çocuğu 9-A'dadır.
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'veli'],
      classes: ['c5'],
      childIds: ['s197'],
    })
    const admin = await api(school.user('yonetici'))
    const parent = await api(school.user('veli'), { fresh: true })
    const teacher = await api(school.user('ogretmen'), { fresh: true })
    const created = await openForm(admin, 'Dokuzuncu sınıf gezisi', ['c5'])
    const decided = await parent.post(
      `/api/v1/permission-forms/${created.id}/decisions`,
      { studentId: 's197', decision: 'approved', note: 'Gizli veli notu' },
      { 'idempotency-key': randomUUID() },
    )
    expect(decided.status, JSON.stringify(decided.body)).toBe(201)

    const seen = entryOf(await detailOf(teacher, created.id), 's197')
    expect(seen.status).toBe('approved')
    expect(seen.decisions).toEqual([])
    // Yönetici karar satırını ve notu görür.
    expect(entryOf(await detailOf(admin, created.id), 's197').decisions[0]?.note).toBe(
      'Gizli veli notu',
    )

    await loginAs(school.user('ogretmen'), { fresh: true })
    await page.goto(`${STAFF_PAGE}?izin=${created.id}`)
    const panel = page.getByRole('dialog', { name: 'İzin formu ayrıntısı' })
    await expect(panel).toContainText('Onaylandı')
    await expect(panel).not.toContainText('Gizli veli notu')
  })
})

test.describe('İzin formları: öğrenci kararı', () => {
  test('18 yaşını doldurmuş öğrenci izni kendisi verir; veli bu öğrenci için karar alanı görmez (DOM-ILT-037)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogrenci', 'veli'],
      classes: ['c1'],
      birthDates: { s1: '2000-03-15' },
    })
    const admin = await api(school.user('yonetici'))
    const student = await api(school.user('ogrenci'), { fresh: true })
    const created = await openForm(admin, 'Yetişkin öğrenci gezisi', ['c1'])

    await loginAs(school.user('ogrenci'), { fresh: true })
    await page.goto(STUDENT_PAGE)
    await expect(page.getByRole('heading', { name: 'İzin Formlarım', level: 1 })).toBeVisible()
    const card = cardOf(page, 'Yetişkin öğrenci gezisi')
    await card.getByLabel('Not (isteğe bağlı)').fill('Katılıyorum.')
    await card.getByRole('button', { name: 'Onayla' }).click()
    await expect(page.getByText('Onayınız kaydedildi.')).toBeVisible()
    await expect(card).toContainText('Onayladınız.')
    const saved = entryOf(await detailOf(student, created.id), 's1')
    expect(saved.status).toBe('approved')
    expect(saved.decisions[0]).toMatchObject({ relation: 'self', note: 'Katılıyorum.', mine: true })

    // Reşit öğrencinin formunu veli görmez (listede de yoktur).
    await loginAs(school.user('veli'), { fresh: true })
    await page.goto(`${PARENT_PAGE}?cocuk=s1`)
    await expect(page.getByRole('heading', { name: 'İzin formu yok.' })).toBeVisible()
  })

  test('18 yaşından küçük öğrenci durumu izler; karar vermeye çalışırsa mesaj formda görünür ve kayıt yazılmaz (DOM-ILT-037)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'ogrenci'], classes: ['c1'] })
    const admin = await api(school.user('yonetici'))
    const student = await api(school.user('ogrenci'), { fresh: true })
    const created = await openForm(admin, 'Küçük öğrenci gezisi', ['c1'])

    await loginAs(school.user('ogrenci'), { fresh: true })
    await page.goto(STUDENT_PAGE)
    const card = cardOf(page, 'Küçük öğrenci gezisi')
    await expect(card).toContainText('Bekliyor')
    await card.getByRole('button', { name: 'Onayla' }).click()
    await expect(card.getByRole('alert')).toContainText(
      '18 yaşından küçük öğrenci için izni velayet sahibi veli verir',
    )
    const unchanged = entryOf(await detailOf(student, created.id), 's1')
    expect(unchanged.status).toBe('pending')
    expect(unchanged.decisions).toHaveLength(0)
  })
})
