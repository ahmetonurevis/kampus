import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import {
  assignTask,
  expireAssignment,
  inHours,
  markSecondRatingSampled,
  QUIZ_QUESTIONS,
  requestSecondRating,
  seedHomework,
  seedQuiz,
  seedRubric,
  userIdOf,
} from './support/tasks.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğrencinin beceri görevleri (W22a; IST-051; DOM-BEC-040, 042, 043, 044, 045): kendi atamaları,
// quiz denemesi (başlat, cevapla, otomatik kayıt, teslim, sonuç), yazma taslağı, teslim ve yeni
// sürüm, açılmamış puanın görünmemesi, kapsam ve kapalı modül. Her test kendi kurumunu kurar.
// İçerik, rubrik ve ikinci puanlama isteği doğrudan veritabanına yazılır (içerik yazma ucu
// henüz yok); atama, puan ve yeniden teslim isteği yönetici API'siyle yapılır.

const ESSAY =
  'Last weekend I visited my grandmother in the village. We cooked soup together and walked to the river.'
const SECOND_ESSAY =
  'On Sunday I wrote the text again. I fixed my verbs, and I added a new closing sentence about the river.'
const FEEDBACK = 'GIZLI-GERI-BILDIRIM paragraf düzeni iyi'

const scoreBody = (versionNumber = 1) => ({
  versionNumber,
  criteria: [
    { criterionId: 'task', band: 4, comment: null },
    { criterionId: 'grammar', band: 2, comment: 'GIZLI-KRITER zaman uyumuna dikkat' },
  ],
  overallComment: FEEDBACK,
})

interface School {
  tenant: Tenant
  admin: ApiClient
  student: ApiClient
  ownerId: string
}

async function schoolOf(
  tenantFactory: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal | null, options?: { fresh?: boolean }) => Promise<ApiClient>,
  students: string[] = [],
): Promise<School> {
  const tenant = await tenantFactory({ roles: ['yonetici', 'ogrenci'], students })
  const admin = await api(tenant.user('yonetici'))
  const student = await api(tenant.user('ogrenci'))
  return { tenant, admin, student, ownerId: await userIdOf(admin) }
}

const taskTable = (page: Page, caption: string) => page.getByRole('table', { name: caption })

/** Satırdaki başlıktan sağ paneli açar ve birincil düğmenin adıyla çalışma alanına geçer. */
async function openFromList(page: Page, title: string, button: string) {
  await page.getByRole('button', { name: `${title} ayrıntısını aç` }).click()
  const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
  await expect(panel.getByRole('heading', { name: title })).toBeVisible()
  await panel.getByRole('button', { name: button }).click()
}

const main = (page: Page) => page.getByRole('main')

async function submissionOf(admin: ApiClient, assignmentId: string) {
  const list = await admin.get(
    `/api/v1/task-submissions?assignmentId=${assignmentId}&page=1&pageSize=20`,
  )
  expect(list.status).toBe(200)
  const id = (list.body as { data: { id: string }[] }).data[0]?.id
  expect(id).toBeTruthy()
  const detail = await admin.get(`/api/v1/task-submissions/${id}`)
  expect(detail.status).toBe(200)
  return {
    id: id as string,
    rowVersion: (detail.body as { data: { rowVersion: number } }).data.rowVersion,
  }
}

async function post(admin: ApiClient, path: string, rowVersion: number, body: unknown) {
  const response = await admin.post(path, body, {
    'idempotency-key': randomUUID(),
    'if-match': `"${rowVersion}"`,
  })
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return (response.body as { data: { rowVersion: number } }).data.rowVersion
}

test.describe('öğrenci görevleri: liste ve kapsam', () => {
  test('IST-051: öğrenci yalnız kendisine atananı görür; başkasının görevi bulunamaz ve API 404 döner', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api, ['s2'])
    const own = await seedQuiz(school.tenant.institutionId, school.ownerId, 'Kendi okuma quizim')
    const foreign = await seedQuiz(school.tenant.institutionId, school.ownerId, 'Başkasının quizi')
    const foreignWriting = await seedHomework(
      school.tenant.institutionId,
      school.ownerId,
      'Başkasının yazma ödevi',
    )
    await assignTask(school.admin, { resourceVersionId: own })
    const foreignId = await assignTask(school.admin, {
      resourceVersionId: foreign,
      studentIds: ['s2'],
    })
    const rubric = await seedRubric(school.tenant.institutionId, school.ownerId)
    const foreignWritingId = await assignTask(school.admin, {
      resourceVersionId: foreignWriting,
      studentIds: ['s2'],
      settings: { submission: { submissionKind: 'text', maxVersions: 1 }, rubricVersionId: rubric },
    })

    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/soru-coz')
    const table = taskTable(page, 'Atanan quizler')
    await expect(table.getByText('Kendi okuma quizim')).toBeVisible()
    await expect(page.getByText('Başkasının quizi')).toHaveCount(0)
    await expect(table.locator('tbody tr')).toHaveCount(1)

    // Sağ panel, çalışma alanı ve API: kapsam dışı görev bulunamaz.
    await page.goto(`/ogrenci/soru-coz?gorev=${foreignId}`)
    await expect(
      page.getByRole('dialog', { name: 'Görev ayrıntısı' }).getByText('Görev bulunamadı.'),
    ).toBeVisible()
    await page.goto(`/ogrenci/soru-coz?coz=${foreignId}`)
    await expect(page.getByText('Görev bulunamadı.').first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Denemeyi başlat/ })).toHaveCount(0)
    await page.goto(`/ogrenci/odevler?yaz=${foreignWritingId}`)
    await expect(page.getByText('Görev bulunamadı.').first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Teslim et' })).toHaveCount(0)

    expect((await school.student.get(`/api/v1/task-assignments/${foreignId}`)).status).toBe(404)
    expect(
      (
        await school.student.post(
          `/api/v1/task-assignments/${foreignId}/attempts`,
          {},
          {
            'idempotency-key': randomUUID(),
          },
        )
      ).status,
    ).toBe(404)
  })
})

test.describe('öğrenci görevleri: quiz denemesi', () => {
  test('DOM-BEC-042, 043, 045: deneme başlar, cevaplar kaydedilir, yenilemede sürer, teslimde puan görünür; doğru cevap ve açıklama açılmaz, hak dolunca yeni deneme yok', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const quiz = await seedQuiz(
      school.tenant.institutionId,
      school.ownerId,
      'Okuma değerlendirmesi',
    )
    const assignmentId = await assignTask(school.admin, {
      resourceVersionId: quiz,
      settings: { attempts: { kind: 'evaluation', maxAttempts: 1 } },
    })

    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/soru-coz')
    const row = taskTable(page, 'Atanan quizler').locator('tbody tr').filter({
      hasText: 'Okuma değerlendirmesi',
    })
    await expect(row).toContainText('Başlanmadı')
    await expect(row).toContainText('0 / 1 deneme')

    await openFromList(page, 'Okuma değerlendirmesi', 'Göreve başla')
    await expect(page).toHaveURL(new RegExp(`coz=${assignmentId}`))
    await page.getByRole('button', { name: 'Denemeyi başlat' }).click()

    // 1. soru: doğru seçenek. Cevap otomatik kaydedilir; sonuç ya da doğru cevap gösterilmez.
    await expect(page.getByText(`1 / 2 soru`)).toBeVisible()
    await expect(page.getByText(QUIZ_QUESTIONS[0])).toBeVisible()
    await page.getByLabel('In London.').check()
    await expect(page.getByText('Cevaplarınız kaydedildi.')).toBeVisible()
    await expect(main(page)).not.toContainText('GIZLI-ACIKLAMA')
    await page.getByRole('button', { name: 'Sonraki' }).click()
    await expect(page.getByText(QUIZ_QUESTIONS[1])).toBeVisible()

    // Sayfa yenilenince deneme sürer, kayıtlı cevap geri gelir.
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Okuma değerlendirmesi', level: 2 }),
    ).toBeVisible()
    await expect(page.getByLabel('In London.')).toBeChecked()

    // 2. soru yanlış seçenek; teslim onayı cevapsız soru olmadığını söyler.
    await page.getByRole('button', { name: '2. soruya git' }).click()
    await page.getByLabel('In Rome.').check()
    await expect(page.getByText('Cevaplarınız kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: 'Denemeyi teslim et' }).first().click()
    const confirm = page.getByRole('dialog', { name: 'Deneme teslim edilsin mi?' })
    await expect(confirm.getByText('Bütün sorular cevaplandı.')).toBeVisible()
    await confirm.getByRole('button', { name: 'Teslim et' }).click()

    // Sonuç: yalnız toplam puan (1 / 4 puan = %25). Anahtar ve açıklama sunucuda kapalıdır.
    await expect(page.getByRole('heading', { name: '1. deneme sonucu' })).toBeVisible()
    await expect(page.getByLabel('Puan 100 üzerinden 25')).toBeVisible()
    await expect(page.getByText('1 / 4 puan')).toBeVisible()
    await expect(main(page)).not.toContainText('GIZLI-ACIKLAMA')
    await expect(page.getByText('Doğru cevap:')).toHaveCount(0)
    await expect(page.getByText('Deneme hakkınız doldu.')).toBeVisible()
    await expect(page.getByRole('button', { name: /deneme başlat/i })).toHaveCount(0)

    // Liste güncel durumu gösterir; hak dolduğu için API de yeni denemeyi reddeder.
    await page.getByRole('button', { name: 'Listeye dön' }).click()
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    await expect(panel).toContainText('Tamamlandı')
    await expect(panel).toContainText('25 / 100')
    await page.keyboard.press('Escape')
    await expect(row).toContainText('Tamamlandı')
    await expect(row).toContainText('25 / 100')
    await expect(row).toContainText('1 / 1 deneme')
    const again = await school.student.post(
      `/api/v1/task-assignments/${assignmentId}/attempts`,
      {},
      { 'idempotency-key': randomUUID() },
    )
    expect(again.status).toBe(422)
  })

  test('DOM-BEC-044: alıştırmada deneme sınırsızdır, "Yeni deneme başlat" görünür', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const quiz = await seedQuiz(school.tenant.institutionId, school.ownerId, 'Alıştırma quizi')
    const assignmentId = await assignTask(school.admin, {
      resourceVersionId: quiz,
      settings: { attempts: { kind: 'practice' } },
    })
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto(`/ogrenci/soru-coz?coz=${assignmentId}`)
    await page.getByRole('button', { name: 'Denemeyi başlat' }).click()
    await page.getByLabel('In London.').check()
    await expect(page.getByText('Cevaplarınız kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: 'Sonraki' }).click()
    await page.getByLabel('In Paris.').check()
    await expect(page.getByText('Cevaplarınız kaydedildi.')).toBeVisible()
    await page.getByRole('button', { name: 'Denemeyi teslim et' }).first().click()
    await page
      .getByRole('dialog', { name: 'Deneme teslim edilsin mi?' })
      .getByRole('button', { name: 'Teslim et' })
      .click()
    await expect(page.getByLabel('Puan 100 üzerinden 100')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Yeni deneme başlat' })).toBeVisible()
  })

  test('DOM-BEC-042: son tarihi geçmiş görevde deneme başlatılamaz ve neden yazılır', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const quiz = await seedQuiz(school.tenant.institutionId, school.ownerId, 'Kapanmış quiz')
    const assignmentId = await assignTask(school.admin, { resourceVersionId: quiz })
    await expireAssignment(assignmentId)
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto(`/ogrenci/soru-coz?coz=${assignmentId}`)
    await expect(page.getByText('Teslim süresi doldu; yeni deneme başlatılamaz.')).toBeVisible()
    await expect(page.getByRole('button', { name: /deneme başlat/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Denemeyi başlat' })).toHaveCount(0)
  })
})

test.describe('öğrenci görevleri: yazma', () => {
  test('DOM-BEC-040, 043: taslak otomatik kaydedilir ve yenilemede döner; sözcük uyarısı gönderimi engellemez; teslim sürüm olarak listelenir', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const homework = await seedHomework(
      school.tenant.institutionId,
      school.ownerId,
      'Hafta sonu yazısı',
    )
    const assignmentId = await assignTask(school.admin, {
      resourceVersionId: homework,
      settings: {
        submission: { submissionKind: 'text', maxVersions: 1, minWords: 10, maxWords: 60 },
        rubricVersionId: await seedRubric(school.tenant.institutionId, school.ownerId),
      },
    })
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/odevler')
    await expect(taskTable(page, 'Atanan yazma ödevleri')).toContainText('Hafta sonu yazısı')
    await openFromList(page, 'Hafta sonu yazısı', 'Yazmaya başla')
    await expect(page).toHaveURL(new RegExp(`yaz=${assignmentId}`))
    // Kaynak öğrenciyle paylaşılmadığı için yönerge okunamaz: açık yedek metin görünür (DOM-KYN-024).
    await expect(page.getByText(/Yönerge bu ekranda gösterilemiyor/)).toBeVisible()

    const editor = page.getByLabel('Metniniz')
    await editor.fill('Too short text.')
    await expect(page.getByText('Sözcük sayınız beklenen aralığın dışında.')).toBeVisible()
    await expect(page.getByText(/Taslak kaydedildi/)).toBeVisible()

    await page.reload()
    await expect(page.getByLabel('Metniniz')).toHaveValue('Too short text.')

    await page.getByLabel('Metniniz').fill(ESSAY)
    await expect(page.getByText('Sözcük sayınız beklenen aralığın dışında.')).toHaveCount(0)
    await page.getByRole('button', { name: 'Teslim et' }).click()
    await expect(page.getByRole('heading', { name: 'Gönderdikleriniz' })).toBeVisible()
    const versions = page.getByRole('list', { name: 'Gönderilen sürümler' })
    await expect(versions.getByRole('heading', { name: '1. sürüm' })).toBeVisible()
    await expect(versions).toContainText('Gönderdiğiniz metni göster')
    // Hak doldu: yeni teslim kapalı, neden yazılır.
    await expect(page.getByText('Sürüm hakkınız doldu.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Teslim et' })).toBeDisabled()
  })

  test('DOM-BEC-040, 045: puanlanan teslimde puan ve geri bildirim görünür; yeniden teslim istenince yeni sürüm gönderilir', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const homework = await seedHomework(school.tenant.institutionId, school.ownerId, 'Puanlı yazı')
    const rubric = await seedRubric(school.tenant.institutionId, school.ownerId)
    const assignmentId = await assignTask(school.admin, {
      resourceVersionId: homework,
      settings: { submission: { submissionKind: 'text', maxVersions: 1 }, rubricVersionId: rubric },
    })
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto(`/ogrenci/odevler?yaz=${assignmentId}`)
    await page.getByLabel('Metniniz').fill(ESSAY)
    await page.getByRole('button', { name: 'Teslim et' }).click()
    await expect(page.getByRole('heading', { name: '1. sürüm' })).toBeVisible()

    // Puan henüz yok: ipucu da yok.
    await expect(main(page)).not.toContainText('Öğretmen geri bildirimi')

    // Öğretmen puanlar: 4 + 2 / 10 = %60. Teslim değerlendirildi; yeni sürüm kendiliğinden açılmaz.
    const submission = await submissionOf(school.admin, assignmentId)
    const afterScore = await post(
      school.admin,
      `/api/v1/task-submissions/${submission.id}/scores`,
      submission.rowVersion,
      scoreBody(),
    )
    await page.reload()
    await expect(page.getByText('Puan 60 / 100')).toBeVisible()
    await expect(page.getByText(FEEDBACK)).toBeVisible()
    await expect(page.getByText('Teslim değerlendirildi;', { exact: false })).toBeVisible()
    await expect(page.getByLabel('Metniniz')).toHaveAttribute('readonly', '')
    await expect(page.getByRole('button', { name: 'Teslim et' })).toBeDisabled()

    // Yeniden teslim isteği: editör son sürümle açılır, yeni sürüm gönderilir.
    await post(
      school.admin,
      `/api/v1/task-submissions/${submission.id}/resubmission-requests`,
      afterScore,
      { versionNumber: 1, dueAt: inHours(72) },
    )
    await page.reload()
    await expect(page.getByText('Öğretmeniniz yeniden teslim istedi')).toBeVisible()
    await expect(page.getByLabel('Metniniz')).toHaveValue(ESSAY)
    await page.getByLabel('Metniniz').fill(SECOND_ESSAY)
    await page.getByRole('button', { name: 'Teslim et' }).click()
    const versions = page.getByRole('list', { name: 'Gönderilen sürümler' })
    await expect(versions.getByRole('heading', { name: '2. sürüm' })).toBeVisible()
    await expect(versions.getByRole('heading', { name: '1. sürüm' })).toBeVisible()
    // Eski sürümün puanı korunur; yeni sürüm puansız.
    await expect(versions.getByText('Puan 60 / 100')).toHaveCount(1)
  })

  test('DOM-BEC-045: ikinci puanlama beklerken ilk puan ve geri bildirim öğrenciye hiçbir ipucu vermeden kapalıdır', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const homework = await seedHomework(school.tenant.institutionId, school.ownerId, 'Sınav yazısı')
    const rubric = await seedRubric(school.tenant.institutionId, school.ownerId)
    const assignmentId = await assignTask(school.admin, {
      resourceVersionId: homework,
      settings: {
        submission: { submissionKind: 'text', maxVersions: 2 },
        rubricVersionId: rubric,
        highStakes: true,
        secondRatingPercent: 100,
      },
    })
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto(`/ogrenci/odevler?yaz=${assignmentId}`)
    await page.getByLabel('Metniniz').fill(ESSAY)
    await page.getByRole('button', { name: 'Teslim et' }).click()
    await expect(page.getByRole('heading', { name: '1. sürüm' })).toBeVisible()

    const submission = await submissionOf(school.admin, assignmentId)
    // Örneklemli değerlendirmede ilk puan örneklem çekilmeden 409 alır (DOM-BEC-024).
    await markSecondRatingSampled(assignmentId)
    await requestSecondRating(school.tenant.institutionId, submission.id, school.ownerId)
    await post(
      school.admin,
      `/api/v1/task-submissions/${submission.id}/scores`,
      submission.rowVersion,
      scoreBody(),
    )

    for (const url of [`/ogrenci/odevler?yaz=${assignmentId}`, '/ogrenci/odevler']) {
      await page.goto(url)
      await expect(
        page.getByRole('heading', { name: /Ödevlerim|Sınav yazısı/ }).first(),
      ).toBeVisible()
      if (url.includes('yaz='))
        await expect(page.getByRole('heading', { name: '1. sürüm' })).toBeVisible()
      const text = (await main(page).innerText()).toLocaleLowerCase('tr')
      for (const leak of [
        'gizli-geri-bildirim',
        'geri bildirimi',
        '60 / 100',
        'değerlendirildi',
        'ikinci',
      ])
        expect(text, `sızıntı: ${leak}`).not.toContain(leak)
    }
    // Sunucu da puanı ve engel nedenini açmaz: sürüm hakkı kalan teslim hâlâ yeni sürüme açıktır.
    const detail = await school.student.get(`/api/v1/task-submissions/${submission.id}`)
    expect(detail.status).toBe(200)
    const body = (detail.body as { data: { latestVersion: { score: unknown } } }).data
    expect(body.latestVersion.score).toBeNull()
    expect(JSON.stringify(detail.body)).not.toContain('GIZLI-GERI-BILDIRIM')
  })
})

test.describe('öğrenci görevleri: modül ve ekran', () => {
  test('kapalı öğrenme modülünde menü, route ve API kapanır', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/dashboard')
    const nav = page.getByRole('navigation', { name: 'Menü' })
    await expect(nav.getByRole('link').first()).toBeVisible()
    const group = nav.getByRole('button', { name: /derslerim/i })
    if ((await group.count()) > 0 && (await group.getAttribute('aria-expanded')) === 'false')
      await group.click()
    await expect(nav.getByRole('link', { name: 'Ödevlerim' })).toBeVisible()
    expect((await school.student.get('/api/v1/task-assignments')).status).toBe(200)

    const settings = await school.admin.get('/api/v1/modules')
    const response = await school.admin.context.patch('/api/v1/modules/learning', {
      data: { enabled: false },
      headers: {
        'if-match': `"${(settings.body as { data: { version: number } }).data.version}"`,
        'idempotency-key': randomUUID(),
      },
    })
    expect(response.status()).toBe(200)

    await page.goto('/ogrenci/odevler')
    await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
    await expect(page).toHaveURL(/\/ogrenci\/dashboard/)
    await expect(nav.getByRole('link', { name: 'Ödevlerim' })).toHaveCount(0)
    await expect(nav.getByRole('link', { name: 'Quiz & Testler' })).toHaveCount(0)
    expect((await school.student.get('/api/v1/task-assignments')).status).toBe(403)
  })

  test('dar ekranda liste, panel ve çözme ekranı yatay taşmaz', async ({
    page,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await schoolOf(tenant, api)
    const quiz = await seedQuiz(school.tenant.institutionId, school.ownerId, 'Dar ekran quizi')
    const assignmentId = await assignTask(school.admin, { resourceVersionId: quiz })
    await page.setViewportSize({ width: 390, height: 800 })
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/soru-coz')
    await expect(page.getByText('Dar ekran quizi').first()).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(`/ogrenci/soru-coz?gorev=${assignmentId}`)
    await expect(
      page
        .getByRole('dialog', { name: 'Görev ayrıntısı' })
        .getByRole('button', { name: 'Göreve başla' }),
    ).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.goto(`/ogrenci/soru-coz?coz=${assignmentId}`)
    await page.getByRole('button', { name: 'Denemeyi başlat' }).click()
    await expect(page.getByText(QUIZ_QUESTIONS[0])).toBeVisible()
    await expectNoHorizontalOverflow(page)
  })
})
