import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Öğretmen görev ve puanlama ekranları (W22b; DOM-YTK-028, DOM-BEC-020…023, 040, 045): Ödevler &
// Değerlendirme sayfasındaki Görevler ve Puanlama kuyruğu sekmeleri. İçerik, rubrik, atama ve
// öğrenci teslimi API ile kurulur (UI'dan kurulum yok); sınanan ekran öğretmenin akışıdır. Her test
// kendi kurumunu kurar; 7-A sınıfında Deniz Yılmaz (`s1`) vardır ve öğretmen (`t1`) o sınıfa girer.

/** Seed'de 7-A'nın İngilizcesini başka öğretmen verir; t1 de verir ki içerik dersinde atayabilsin. */
const TEACHES_ENGLISH = [
  {
    collection: 'assignments' as const,
    data: { id: 'assign-c1-english-t1', classId: 'c1', subjectId: 'english', teacherId: 't1' },
  },
]

const WRITING = 'Hafta sonu yazısı'
const STUDENT_TEXT = 'Last weekend I visited my grandmother and we baked a small cake together.'
const DENIZ = 'Deniz Yılmaz'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const bands = (aspect: string) =>
  [0, 1, 2, 3, 4, 5].map((band) => ({
    band,
    description: `${aspect} için bant ${band} tanımı`,
    alignment: { kind: 'cefr', scale: 'Overall written production', level: 'B1', index: 1 },
  }))

const idempotent = () => ({ 'idempotency-key': randomUUID() })
const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

async function expectOk(result: { status: number; body: unknown }, status = 201) {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Json }).data
}

/** Yayındaki yazma ödevi şablonu ve yayındaki yazma rubriği; kimlikleri döner. */
async function publishContent(author: ApiClient, admin: ApiClient = author) {
  const resource = await expectOk(
    await author.post(
      '/api/v1/resources',
      {
        title: WRITING,
        content: {
          type: 'homework_template',
          instructions: 'Hafta sonunu anlatan kısa bir metin yaz.',
          submissionKinds: ['text'],
          criteria: 'Zaman ifadeleri, paragraf düzeni ve yazım.',
          rubricId: null,
        },
        tags: {
          subjectId: 'english',
          gradeLevels: [7],
          primarySkill: 'writing',
          cefrLevel: 'A2',
          outcomes: [{ outcomeId: 'YAZ.7.1', outcomeSource: 'institution' }],
        },
        license: { kind: 'institution_original' },
      },
      idempotent(),
    ),
  )
  // Kaynak sahibi öğretmendir (yönetici başkasının kaynağını atamaz); yazar onaya gönderir,
  // yönetici onaylar (DOM-KYN-030, 031).
  const draft = resource.version as Json
  const reviewing = (
    await expectOk(
      await author.post(
        `/api/v1/resources/${resource.resource.id}/versions/${draft.id}/submit`,
        {},
        versioned(draft.rowVersion),
      ),
      200,
    )
  ).version as Json
  const version = (
    await expectOk(
      await admin.post(
        `/api/v1/resources/${resource.resource.id}/versions/${reviewing.id}/approve`,
        {},
        versioned(reviewing.rowVersion),
      ),
      200,
    )
  ).version as Json
  const rubric = await expectOk(
    await admin.post(
      '/api/v1/rubrics',
      {
        title: 'Yazma rubriği',
        kind: 'analytic',
        skill: 'writing',
        criteria: [
          { id: 'task', aspect: 'task_fulfilment', bands: bands('Görev') },
          { id: 'grammar', aspect: 'grammatical_accuracy', bands: bands('Dilbilgisi') },
        ],
      },
      idempotent(),
    ),
  )
  const rubricVersion = rubric.version as Json
  await expectOk(
    await admin.post(
      `/api/v1/rubrics/${rubric.rubric.id}/versions/${rubricVersion.id}/publish`,
      {},
      versioned(rubricVersion.rowVersion),
    ),
    200,
  )
  return { versionId: version.id as string, rubricVersionId: rubricVersion.id as string }
}

function dueIn(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

/** Yönetici 7-A sınıfına yazma görevi atar; atama kimliğini döner. */
async function assignWriting(
  admin: ApiClient,
  content: Awaited<ReturnType<typeof publishContent>>,
) {
  const assignment = await expectOk(
    await admin.post(
      '/api/v1/task-assignments',
      {
        resourceVersionId: content.versionId,
        targets: [{ kind: 'class', id: 'c1' }],
        settings: {
          attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
          deadline: { dueAt: dueIn(10), lateAcceptanceDays: 0 },
          submission: { submissionKind: 'text', maxVersions: 3 },
          rubricVersionId: content.rubricVersionId,
        },
      },
      idempotent(),
    ),
  )
  return assignment.id as string
}

interface Setup {
  school: Tenant
  admin: ApiClient
  assignmentId: string
  submissionId: string
}

/** Kurum, içerik, rubrik, atama ve Deniz'in teslimi. */
async function setUp(
  tenant: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal) => Promise<ApiClient>,
): Promise<Setup> {
  const school = await tenant({
    roles: ['yonetici', 'ogretmen', 'ogrenci'],
    classes: ['c1'],
    records: TEACHES_ENGLISH,
  })
  const admin = await api(school.user('yonetici'))
  const teacher = await api(school.user('ogretmen'))
  const content = await publishContent(teacher, admin)
  const assignmentId = await assignWriting(admin, content)
  const student = await api(school.user('ogrenci'))
  const submitted = await expectOk(
    await student.post(
      `/api/v1/task-assignments/${assignmentId}/submissions`,
      { submissionKind: 'text', body: STUDENT_TEXT },
      idempotent(),
    ),
  )
  return { school, admin, assignmentId, submissionId: submitted.id as string }
}

const queueRows = (page: Page) =>
  page.getByRole('table', { name: 'Puanlama kuyruğu' }).locator('tbody tr')
const toasts = (page: Page) => page.locator('[data-sonner-toast]')

async function openQueue(page: Page) {
  await page.goto('/ogretmen/odevler?sekme=puanlama')
  await expect(page.getByRole('heading', { name: 'Puanlama kuyruğu', level: 2 })).toBeVisible()
}

/** Puanlama penceresinde kriter bandı seçer. */
async function chooseBand(dialog: ReturnType<Page['getByRole']>, aspect: string, band: number) {
  await dialog
    .getByRole('radiogroup', { name: `${aspect} bandı` })
    .getByLabel(new RegExp(`^${band} ·`))
    .check()
}

test.describe('öğretmen görevleri: atama listesi ve formu', () => {
  test('öğretmen yazma görevi atar; liste, panel ve atayan rozeti görünür (DOM-YTK-028)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      classes: ['c1'],
      records: TEACHES_ENGLISH,
    })
    const admin = await api(school.user('yonetici'))
    await publishContent(await api(school.user('ogretmen')), admin)
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/odevler?sekme=gorevler')
    await expect(page.getByText('Henüz görev atanmadı.')).toBeVisible()

    await page.getByRole('button', { name: 'Yeni görev' }).click()
    const dialog = page.getByRole('dialog', { name: 'Yeni görev ata' })
    // Boş form gönderilince alan hataları görünür, istek gitmez.
    await dialog.getByRole('button', { name: 'Görevi ata' }).click()
    await expect(dialog.getByText('Atanacak içeriği seçin.')).toBeVisible()
    await expect(dialog.getByText('En az bir sınıf veya grup seçin.')).toBeVisible()
    await expect(dialog.getByText('Bir rubrik seçin.')).toBeVisible()

    await dialog.getByLabel('İçerik', { exact: true }).selectOption({ label: WRITING })
    await dialog.getByLabel('Rubrik').selectOption({ label: 'Yazma rubriği' })
    await dialog.getByLabel('7-A', { exact: true }).check()
    await dialog.getByLabel('Son teslim', { exact: true }).fill('2099-01-15T18:00')
    await dialog.getByRole('button', { name: 'Görevi ata' }).click()

    await expect(toasts(page).filter({ hasText: 'Görev atandı.' })).toBeVisible()
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    await expect(panel.getByRole('heading', { name: WRITING })).toBeVisible()
    await expect(panel.getByText('Siz', { exact: true })).toBeVisible()
    // Atayan, son teslimi uzatabilir.
    await expect(panel.getByRole('button', { name: 'Son teslimi kaydet' })).toBeVisible()
    await panel.getByRole('button', { name: 'Kapat' }).click()

    const row = page.getByRole('table', { name: 'Görev atamaları' }).locator('tbody tr')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText(WRITING)
    await expect(row).toContainText('7-A')
    await expect(row).toContainText('Rubrikle puanlanır')
    await expectNoHorizontalOverflow(page)
  })

  test('atayan olmayan öğretmen sınıfının görevini salt okur görür, API değişikliği 403 verir (DOM-YTK-028)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, assignmentId } = await setUp(tenant, api)
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=gorevler&gorev=${assignmentId}`)
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    await expect(panel.getByRole('heading', { name: WRITING })).toBeVisible()
    await expect(panel.getByText('Başka kullanıcı', { exact: true })).toBeVisible()
    await expect(panel.getByText(/yalnız atayan değiştirebilir/)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Son teslimi kaydet' })).toHaveCount(0)
    // Teslimler görünür: sınıfın öğretmeni puanlayabilir.
    await expect(panel.getByText(DENIZ)).toBeVisible()
    await expect(panel.getByRole('button', { name: `${DENIZ} teslimini aç` })).toBeVisible()

    const teacher = await api(school.user('ogretmen'))
    const detail = await expectOk(
      await teacher.get(`/api/v1/task-assignments/${assignmentId}`),
      200,
    )
    const changed = await teacher.context.patch(`/api/v1/task-assignments/${assignmentId}`, {
      data: { deadline: { dueAt: dueIn(12), lateAcceptanceDays: 0 } },
      headers: versioned(detail.rowVersion),
    })
    expect(changed.status()).toBe(403)
  })

  test('atayan öğretmen son teslimi uzatır; sürüm çakışmasında güncel hâl yüklenir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen'],
      classes: ['c1'],
      records: TEACHES_ENGLISH,
    })
    const admin = await api(school.user('yonetici'))
    const teacher = await api(school.user('ogretmen'))
    const content = await publishContent(teacher, admin)
    const own = await expectOk(
      await teacher.post(
        '/api/v1/task-assignments',
        {
          resourceVersionId: content.versionId,
          targets: [{ kind: 'class', id: 'c1' }],
          settings: {
            attempts: { kind: 'evaluation', maxAttempts: 1, countPolicy: 'first' },
            deadline: { dueAt: dueIn(10), lateAcceptanceDays: 0 },
            submission: { submissionKind: 'text', maxVersions: 3 },
            rubricVersionId: content.rubricVersionId,
          },
        },
        idempotent(),
      ),
    )
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=gorevler&gorev=${own.id}`)
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    await expect(panel.getByRole('button', { name: 'Son teslimi kaydet' })).toBeVisible()
    // Başka pencere son teslimi uzatır: ekrandaki sürüm eskir.
    const other = await teacher.context.patch(`/api/v1/task-assignments/${own.id}`, {
      data: { deadline: { dueAt: dueIn(11), lateAcceptanceDays: 0 } },
      headers: versioned(own.rowVersion),
    })
    expect(other.status()).toBe(200)
    await panel.getByLabel('Son teslim', { exact: true }).fill('2099-02-01T18:00')
    await panel.getByRole('button', { name: 'Son teslimi kaydet' }).click()
    await expect(toasts(page).filter({ hasText: 'başkası tarafından değiştirildi' })).toBeVisible()
    // Güncel sürüm yüklendi: yeniden kaydetmek başarılı olur.
    await panel.getByLabel('Son teslim', { exact: true }).fill('2099-02-01T18:00')
    await panel.getByRole('button', { name: 'Son teslimi kaydet' }).click()
    await expect(toasts(page).filter({ hasText: 'Son teslim güncellendi.' })).toBeVisible()
  })
})

test.describe('öğretmen görevleri: puanlama', () => {
  test('öğretmen kuyruktan yazıyı rubrikle puanlar; toplamı sunucu hesaplar (DOM-BEC-020, 021, 045)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, submissionId, assignmentId } = await setUp(tenant, api)
    await loginAs(school.user('ogretmen'))
    await openQueue(page)
    await expect(queueRows(page)).toHaveCount(1)
    await expect(queueRows(page)).toContainText(DENIZ)
    await expect(queueRows(page)).toContainText(WRITING)

    await queueRows(page)
      .getByRole('button', { name: `${DENIZ} teslimini puanla` })
      .first()
      .click()
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await expect(dialog.getByText(STUDENT_TEXT)).toBeVisible()

    // Eksik form: bant, yorum ve genel yorum zorunludur; istek gitmez.
    await dialog.getByRole('button', { name: 'Puanı kaydet' }).click()
    await expect(dialog.getByText('Bu kritere bir bant seçin.')).toHaveCount(2)
    await expect(dialog.getByText('Genel yorumu yazın.')).toBeVisible()

    await chooseBand(dialog, 'Görevin yerine getirilmesi', 4)
    await chooseBand(dialog, 'Dilbilgisel doğruluk', 2)
    await dialog.getByRole('button', { name: 'Puanı kaydet' }).click()
    // Hedefin altındaki bant kriter yorumu ister.
    await expect(dialog.getByText('Hedefin altındaki banda kısa bir yorum yazın.')).toBeVisible()
    await dialog.getByLabel('Kriter yorumu (zorunlu)').fill('Zaman uyumuna dikkat edin.')
    await dialog
      .getByLabel('Genel geri bildirim')
      .fill('Paragraf düzeni iyi, dilbilgisine çalışın.')
    await dialog.getByRole('button', { name: 'Puanı kaydet' }).click()

    await expect(toasts(page).filter({ hasText: 'Puan kaydedildi.' })).toBeVisible()
    // Toplam sunucuda hesaplandı: 4 + 2 = 6 / 10 → %60.
    const card = dialog.getByRole('group', { name: 'Verilen puan' })
    await expect(card).toContainText('6 / 10')
    await expect(card).toContainText('%60')
    await expect(card).toContainText('Kesinleşti')
    await expect(card).toContainText('Zaman uyumuna dikkat edin.')
    await expect(dialog.getByRole('button', { name: 'Puanı kaydet' })).toHaveCount(0)

    // Öğrenci geri bildirimi artık görür; kuyruk boşalır.
    const student = await api(school.user('ogrenci'))
    const own = await expectOk(await student.get(`/api/v1/task-submissions/${submissionId}`), 200)
    expect(own.versions[0].score.percent).toBe(60)
    await dialog.getByRole('button', { name: 'Kapat' }).click()
    await expect(page.getByText('Puanlanmayı bekleyen teslim yok.')).toBeVisible()
    expect(assignmentId).toBeTruthy()
  })

  test('OG-994: görev panelindeki teslim puanlama penceresi panelin içinde açılır; kapanınca odak düğmeye döner, panel açık kalır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, assignmentId, submissionId } = await setUp(tenant, api)
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=gorevler&gorev=${assignmentId}`)
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    const open = panel.getByRole('button', { name: `${DENIZ} teslimini aç` })
    await open.click()
    await expect(page).toHaveURL(/[?&]puanla=/)

    // Pencere panelin içinde: üstteki pencere erişilebilirlik ağacındadır, panelin metni
    // arkada görünür kalır ve panel kapanmaz.
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await expect(dialog.getByText(STUDENT_TEXT)).toBeVisible()
    await expect(
      page.getByRole('heading', { name: WRITING, level: 3, includeHidden: true }),
    ).toBeVisible()
    await expect(page).toHaveURL(/[?&]gorev=/)

    // Esc yalnız puanlama penceresini kapatır; panel açık, odak açan düğmede.
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(panel).toBeVisible()
    await expect(page).toHaveURL(/[?&]gorev=/)
    await expect(page).not.toHaveURL(/[?&]puanla=/)
    await expect(open).toBeFocused()

    // Adres paylaşılabilir: iki parametreyle yenilenince puanlama penceresi erişilebilir kalır;
    // kapatınca panel yerinde durur.
    await open.click()
    await page.reload()
    await expect(dialog.getByText(STUDENT_TEXT)).toBeVisible()
    await dialog.getByRole('button', { name: 'Pencereyi kapat' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(panel.getByRole('heading', { name: WRITING })).toBeVisible()
    expect(submissionId).toBeTruthy()
  })

  test('atama revize edilmiş rubriğin eski sürümüne sabitliyse puanlama açılır; sürüm kimlikle tek çağrıda okunur (DOM-BEC-022)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, submissionId, admin, assignmentId } = await setUp(tenant, api)
    const assignment = await expectOk(
      await admin.get(`/api/v1/task-assignments/${assignmentId}`),
      200,
    )
    const pinnedVersionId = assignment.rubricVersionId as string
    const body = {
      title: 'Yazma rubriği',
      kind: 'analytic',
      skill: 'writing',
      criteria: [
        { id: 'task', aspect: 'task_fulfilment', bands: bands('Görev') },
        { id: 'grammar', aspect: 'grammatical_accuracy', bands: bands('Dilbilgisi') },
      ],
    }
    // Rubriğin v2'si yayımlanınca atamanın v1'i ne baş ne yayındaki sürümdür; ayrıca başka rubrikler
    // vardır. Ekran atamanın sabitlediği v1'i kimlikle okur.
    for (const title of ['Başka rubrik 1', 'Başka rubrik 2']) {
      await expectOk(await admin.post('/api/v1/rubrics', { ...body, title }, idempotent()))
    }
    const list = await expectOk(await admin.get('/api/v1/rubrics?pageSize=100'), 200)
    const rubric = (list as unknown as Json[]).find(
      (item) => (item.head as Json).title === 'Yazma rubriği',
    ) as Json
    const rubricId = (rubric.rubric as Json).id as string
    const second = await expectOk(
      await admin.post(`/api/v1/rubrics/${rubricId}/versions`, body, idempotent()),
    )
    const draft = second.version as Json
    await expectOk(
      await admin.post(
        `/api/v1/rubrics/${rubricId}/versions/${draft.id}/publish`,
        {},
        versioned(draft.rowVersion),
      ),
      200,
    )

    // Sürüm kimlikle tek çağrıda okunur (`GET /rubric-versions/:id`); rubrik listesi taranmaz.
    const rubricReads: string[] = []
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname
      if (/^\/api\/v1\/rubric(s|-versions)(\/|$)/.test(path)) rubricReads.push(path)
    })

    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=puanlama&puanla=${submissionId}`)
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await chooseBand(dialog, 'Görevin yerine getirilmesi', 3)
    await chooseBand(dialog, 'Dilbilgisel doğruluk', 3)
    await dialog.getByLabel('Genel geri bildirim').fill('Sürüm 1 rubriğiyle puanlandı.')
    await dialog.getByRole('button', { name: 'Puanı kaydet' }).click()
    await expect(toasts(page).filter({ hasText: 'Puan kaydedildi.' })).toBeVisible()
    expect(rubricReads).toEqual([`/api/v1/rubric-versions/${pinnedVersionId}`])
  })

  test('puan verilirken başka puan girilmişse 409 uyarısı çıkar ve güncel teslim yüklenir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, submissionId, admin } = await setUp(tenant, api)
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=puanlama&puanla=${submissionId}`)
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await expect(dialog.getByText(STUDENT_TEXT)).toBeVisible()
    await chooseBand(dialog, 'Görevin yerine getirilmesi', 5)
    await chooseBand(dialog, 'Dilbilgisel doğruluk', 4)
    await dialog.getByLabel('Genel geri bildirim').fill('Çok başarılı bir yazı, tebrikler.')

    // Yönetici aynı sürümü ilk puanlar: ekrandaki teslim eskir (409 rubric_score_exists).
    const detail = await expectOk(await admin.get(`/api/v1/task-submissions/${submissionId}`), 200)
    await expectOk(
      await admin.post(
        `/api/v1/task-submissions/${submissionId}/scores`,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band: 3, comment: null },
            { criterionId: 'grammar', band: 3, comment: null },
          ],
          overallComment: 'Yönetici puanı.',
        },
        versioned(detail.rowVersion),
      ),
    )
    await dialog.getByRole('button', { name: 'Puanı kaydet' }).click()
    // Hata tek yerde: uyarı pencerede; formun yerini puan kartı aldığı için "yeniden kaydedin"
    // denmez, toast gösterilmez.
    const notice = dialog.getByRole('alert').filter({ hasText: 'Teslim bu arada değişti' })
    await expect(notice).toContainText('Bu sürüm zaten puanlandı')
    await expect(notice).not.toContainText('yeniden kaydedin')
    await expect(toasts(page)).toHaveCount(0)
    // Güncel teslim yüklendi: yöneticinin puanı görünür, form kalktı, öğretmen puanı ezilmedi.
    const card = dialog.getByRole('group', { name: 'Verilen puan' })
    await expect(card).toContainText('%60')
    await expect(card).toContainText('Yönetici puanı.')
    await expect(dialog.getByRole('button', { name: 'Puanı kaydet' })).toHaveCount(0)
  })

  test('öğretmen puanlanan sürüm için yeniden teslim ister; 14 günden uzak tarih reddedilir (DOM-BEC-040)', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, submissionId, admin } = await setUp(tenant, api)
    const detail = await expectOk(await admin.get(`/api/v1/task-submissions/${submissionId}`), 200)
    await expectOk(
      await admin.post(
        `/api/v1/task-submissions/${submissionId}/scores`,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band: 3, comment: null },
            { criterionId: 'grammar', band: 3, comment: null },
          ],
          overallComment: 'Fena değil, bir kez daha deneyin.',
        },
        versioned(detail.rowVersion),
      ),
    )
    await loginAs(school.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=puanlama&puanla=${submissionId}`)
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await expect(dialog.getByRole('group', { name: 'Verilen puan' })).toContainText('%60')

    const due = dialog.getByLabel('Yeni son teslim')
    await due.fill('2099-12-31T18:00')
    await dialog.getByRole('button', { name: 'Yeniden teslim iste' }).click()
    await expect(dialog.getByText('önümüzdeki 14 gün içinde olmalı')).toBeVisible()
    await expect(dialog.getByText('Sürüm 1 için yeniden teslim istendi.')).toHaveCount(0)

    await due.fill(await defaultDue(page))
    await dialog.getByRole('button', { name: 'Yeniden teslim iste' }).click()
    await expect(toasts(page).filter({ hasText: 'Yeniden teslim istendi.' })).toBeVisible()
    await expect(dialog.getByText('Sürüm 1 için yeniden teslim istendi.')).toBeVisible()

    // Öğrenci artık yeni sürüm gönderebilir.
    const student = await api(school.user('ogrenci'))
    const own = await expectOk(await student.get(`/api/v1/task-submissions/${submissionId}`), 200)
    expect(own.allowance.resubmissionOpen).toBe(true)
  })

  test('sunucu 14 günden uzak yeniden teslim tarihini 422 resubmission_due_invalid ile reddeder (DOM-BEC-040)', async ({
    api,
    tenant,
  }) => {
    // İstemci aşırı tarihi zaten engeller; sunucu eşlemesi uca doğrudan istekle sınanır.
    const { submissionId, admin } = await setUp(tenant, api)
    const detail = await expectOk(await admin.get(`/api/v1/task-submissions/${submissionId}`), 200)
    await expectOk(
      await admin.post(
        `/api/v1/task-submissions/${submissionId}/scores`,
        {
          versionNumber: 1,
          criteria: [
            { criterionId: 'task', band: 3, comment: null },
            { criterionId: 'grammar', band: 3, comment: null },
          ],
          overallComment: 'Fena değil, bir kez daha deneyin.',
        },
        versioned(detail.rowVersion),
      ),
    )
    const fresh = await expectOk(await admin.get(`/api/v1/task-submissions/${submissionId}`), 200)
    const far = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString()
    const rejected = await admin.post(
      `/api/v1/task-submissions/${submissionId}/resubmission-requests`,
      { versionNumber: 1, dueAt: far },
      versioned(fresh.rowVersion),
    )
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(422)
    expect((rejected.body as { code?: string }).code).toBe('resubmission_due_invalid')
  })

  test('başka kurumun teslimi 404 verir ve "bulunamadı" görünür', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const other = await setUp(tenant, api)
    const mine = await tenant({
      roles: ['yonetici', 'ogretmen'],
      classes: ['c1'],
      records: TEACHES_ENGLISH,
    })
    await loginAs(mine.user('ogretmen'))
    await page.goto(`/ogretmen/odevler?sekme=puanlama&puanla=${other.submissionId}`)
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await expect(dialog.getByText(/Kayıt bulunamadı/)).toBeVisible()
    await expect(dialog.getByText(STUDENT_TEXT)).toHaveCount(0)
    const teacher = await api(mine.user('ogretmen'))
    expect((await teacher.get(`/api/v1/task-submissions/${other.submissionId}`)).status).toBe(404)
    expect((await teacher.get(`/api/v1/task-assignments/${other.assignmentId}`)).status).toBe(404)
  })
})

test.describe('öğretmen görevleri: modül ve erişim', () => {
  test('öğrenme modülü kapanınca sayfa kapanır, görev ve puanlama uçları 403 verir', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, admin } = await setUp(tenant, api)
    const teacher = await api(school.user('ogretmen'))
    expect((await teacher.get('/api/v1/task-assignments')).status).toBe(200)
    expect((await teacher.get('/api/v1/task-submissions/grading-queue')).status).toBe(200)

    const settings = await admin.get('/api/v1/modules')
    const version = (settings.body as { data: { version: number } }).data.version
    const closed = await admin.context.patch('/api/v1/modules/learning', {
      data: { enabled: false },
      headers: versioned(version),
    })
    expect(closed.status()).toBe(200)

    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/odevler?sekme=gorevler')
    await expect(page.getByText('Bu modül kurum ayarlarından kapatılmış.')).toBeVisible()
    await expect(page).toHaveURL(/\/ogretmen\/dashboard/)
    await expect(
      page.getByRole('navigation', { name: 'Menü' }).getByRole('link', { name: /Ödevler/ }),
    ).toHaveCount(0)
    expect((await teacher.get('/api/v1/task-assignments')).status).toBe(403)
    expect((await teacher.get('/api/v1/task-submissions/grading-queue')).status).toBe(403)
  })

  test('öğrenci görev ve puanlama uçlarını yazamaz; öğretmen sayfası öğrenciye kapalıdır', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const { school, submissionId } = await setUp(tenant, api)
    const student = await api(school.user('ogrenci'))
    const denied = await student.post(
      `/api/v1/task-submissions/${submissionId}/scores`,
      {
        versionNumber: 1,
        criteria: [
          { criterionId: 'task', band: 3, comment: null },
          { criterionId: 'grammar', band: 3, comment: null },
        ],
        overallComment: 'Öğrenci puan veremez.',
      },
      versioned(1),
    )
    expect(denied.status, JSON.stringify(denied.body)).toBe(403)
    expect((await student.get('/api/v1/task-submissions/grading-queue')).status).toBe(403)

    // Sayfa da kapalıdır: öğrenci öğretmen sayfasına giremez, kendi panosuna döner.
    await loginAs(school.user('ogrenci'))
    await page.goto('/ogretmen/odevler?sekme=puanlama')
    await expect(page).toHaveURL(/\/ogrenci\/dashboard/)
    await expect(page.getByRole('heading', { name: 'Puanlama kuyruğu', level: 2 })).toHaveCount(0)
  })
})

/** Formun varsayılan yeni son teslimi (bir hafta sonrası) tarayıcı saatiyle `datetime-local`. */
async function defaultDue(page: Page) {
  return page.evaluate(() => {
    const date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date)
    return `${parts}T23:59`
  })
}
