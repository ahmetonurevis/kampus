import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import type { ApiClient, Principal } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { assignTask, seedSpeakingHomework, seedSpeakingRubric, userIdOf } from './support/tasks.ts'
import type { Tenant, TenantOptions } from './support/tenant.ts'

// Konuşma görevi (IST-051; DOM-BEC-050, 051, 052, 054): öğrenci tarayıcıda ses kaydeder, dinler,
// gönderir; dosya sunucuda işlenir (`processing` → `ready`) ve teslim görünür. Ses rızası yoksa
// kayıt düğmesi hiç çıkmaz, görev yüz yüze değerlendirilir. Tarayıcı sahte mikrofonla koşar
// (Chromium `--use-fake-device-for-media-stream`); sahte mikrofon 440 Hz sinüs çalar, böylece
// sunucunun sessizlik reddi (`recording_empty`) tetiklenmez. e2e API'sinde iş kuyruğu kapalıdır:
// dönüşüm süreç içinde, arka planda çalışır ve istemci dosya durumunu yoklayarak bekler.
// Dönüşüm `ffmpeg`/`ffprobe` ister; ikisi PATH'te yoksa senaryolar atlanır.

const hasFfmpeg = (() => {
  try {
    for (const tool of ['ffmpeg', 'ffprobe'])
      execFileSync(tool, ['-version'], { stdio: 'ignore', timeout: 10_000 })
    return true
  } catch {
    return false
  }
})()

/** 48 kHz, 16 bit, tek kanallı `seconds` saniyelik 440 Hz sinüs (WAV). */
function sineWav(seconds: number): Buffer {
  const rate = 48_000
  const samples = rate * seconds
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i += 1)
    data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12_000), i * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const wavPath = join(tmpdir(), `kampus-e2e-konusma-${process.pid}.wav`)
writeFileSync(wavPath, sineWav(4))

test.use({
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wavPath}`,
    ],
  },
})

test.skip(!hasFfmpeg, 'ffmpeg/ffprobe PATH üzerinde yok: ses dönüşümü denenemez')

const PURPOSE = 'speaking_recording'
const MAIN_TITLE = 'Sevdiğim yer'

interface Setup {
  tenant: Tenant
  admin: ApiClient
  assignmentId: string
}

/** Kurum, konuşma görevi ve ataması; `consent` doluysa veli s1 için ses kaydı rızası verir. */
async function speakingSchool(
  tenantFactory: (options: TenantOptions) => Promise<Tenant>,
  api: (principal: Principal | null) => Promise<ApiClient>,
  options: { consent: boolean },
): Promise<Setup> {
  const tenant = await tenantFactory({ roles: ['yonetici', 'veli', 'ogrenci'], students: ['s1'] })
  const admin = await api(tenant.user('yonetici'))
  if (options.consent) {
    const notice = await admin.post(
      '/api/v1/privacy-notices',
      {
        kind: 'consent_text',
        purpose: PURPOSE,
        title: 'Ses kaydı rızası',
        body: 'Çocuğumun konuşma görevi ses kaydının değerlendirme amacıyla alınmasını onaylıyorum.',
        requiresReconsent: false,
      },
      { 'idempotency-key': randomUUID() },
    )
    expect(notice.status, JSON.stringify(notice.body)).toBe(201)
    const veli = await api(tenant.user('veli'))
    const text = await veli.get(`/api/v1/consent-texts/${PURPOSE}`)
    const textId = (text.body as { data: { text: { id: string } } }).data.text.id
    const given = await veli.post(
      '/api/v1/consents',
      { purpose: PURPOSE, studentId: 's1', textId, channel: 'web' },
      { 'idempotency-key': randomUUID() },
    )
    expect(given.status, JSON.stringify(given.body)).toBe(201)
  }
  const ownerId = await userIdOf(admin)
  const homework = await seedSpeakingHomework(tenant.institutionId, ownerId, MAIN_TITLE)
  const assignmentId = await assignTask(admin, {
    resourceVersionId: homework,
    settings: {
      submission: {
        submissionKind: 'audio',
        maxVersions: 3,
        speakingAttempts: 2,
        preparationSeconds: 3,
        speakingSeconds: 10,
      },
      rubricVersionId: await seedSpeakingRubric(tenant.institutionId, ownerId),
    },
  })
  return { tenant, admin, assignmentId }
}

const recorder = (page: Page) => page.getByRole('region', { name: 'Ses kaydı' })

test.describe('öğrenci konuşma görevi', () => {
  test('IST-051, DOM-BEC-050, 052: öğrenci kaydeder, dinler ve gönderir; dosya işlenir ve teslim görünür', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await speakingSchool(tenant, api, { consent: true })
    await context.grantPermissions(['microphone'])
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto('/ogrenci/odevler')
    await page.getByRole('button', { name: `${MAIN_TITLE} ayrıntısını aç` }).click()
    await page
      .getByRole('dialog', { name: 'Görev ayrıntısı' })
      .getByRole('button', { name: 'Kayda başla' })
      .click()
    await expect(page).toHaveURL(new RegExp(`yaz=${school.assignmentId}`))

    // Aydınlatma ve sınırlar kayıttan önce görünür; kayıt rıza geçerli olduğundan açıktır.
    await expect(page.getByRole('note').filter({ hasText: 'puanlanması' })).toBeVisible()
    await expect(page.getByText('en çok 10 saniye')).toBeVisible()
    await expect(page.getByText('Kalan deneme:').locator('..')).toContainText('2')
    const box = recorder(page)
    await expect(box).toBeVisible()

    // Hazırlık süresi atlanır; kayıt sürerken saat işler, en az iki saniye kaydedilir.
    await box.getByRole('button', { name: 'Hazırlığa başla' }).click()
    await box.getByRole('button', { name: 'Hazırım, kayda başla' }).click()
    await expect(box.getByText('Kaydediliyor')).toBeVisible()
    await expect(box.getByRole('timer')).toContainText(/00:0[2-9] \/ 00:10/)
    await box.getByRole('button', { name: 'Kaydı bitir' }).click()

    // Göndermeden önce dinlenir; ilk kayıt gönderilir.
    const player = box.getByLabel(/Kaydınızı dinleyin/)
    await expect(player).toBeVisible()
    await expect(
      box.getByText('Kayıt tamamlandı. Göndermeden önce dinleyebilirsiniz.'),
    ).toBeVisible()
    await box.getByRole('button', { name: 'Kaydı gönder' }).click()

    // Dosya arka planda işlenir; istemci bekler, `ready` olunca teslim kendiliğinden yapılır.
    await expect(box.getByText('Kaydınız teslim edildi.')).toBeVisible({ timeout: 25_000 })
    const versions = page.getByRole('list', { name: 'Gönderilen sürümler' })
    await expect(versions.getByRole('heading', { name: '1. sürüm' })).toBeVisible()
    // Hak 2 iken bir kayıt teslim edildi: yeni kayıt yapılabilir.
    await expect(box.getByRole('button', { name: 'Yeni kayıt yap' })).toBeVisible()

    // Sunucuda tek teslim ve tek sürüm var.
    const list = await school.admin.get(
      `/api/v1/task-submissions?assignmentId=${school.assignmentId}&page=1&pageSize=20`,
    )
    expect(list.status).toBe(200)
    const submissions = (list.body as { data: { id: string }[] }).data
    expect(submissions).toHaveLength(1)
    const detail = await school.admin.get(`/api/v1/task-submissions/${submissions[0]?.id}`)
    const body = (detail.body as { data: { versions: unknown[] } }).data
    expect(body.versions).toHaveLength(1)
  })

  test('DOM-BEC-050: ses kaydı rızası yokken kayıt düğmesi çıkmaz, görev yüz yüze değerlendirilir', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await speakingSchool(tenant, api, { consent: false })
    await context.grantPermissions(['microphone'])
    await loginAs(school.tenant.user('ogrenci'))
    await page.goto(`/ogrenci/odevler?yaz=${school.assignmentId}`)

    await expect(page.getByRole('heading', { name: MAIN_TITLE }).first()).toBeVisible()
    await expect(
      page.getByText(
        'Ses kaydı için gerekli onay bulunmuyor; bu görev öğretmeninizle yüz yüze değerlendirilecek.',
      ),
    ).toBeVisible()
    await expect(page.getByText(/veliniz Ayarlar sayfasındaki Rızalarım/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Kayda başla|Hazırlığa başla/ })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Ses kaydı' })).toHaveCount(0)

    // Sunucu da aynısını söyler: dosya kabul edilmez, teslim açılmaz.
    const list = await school.admin.get(
      `/api/v1/task-submissions?assignmentId=${school.assignmentId}&page=1&pageSize=20`,
    )
    expect((list.body as { data: unknown[] }).data).toHaveLength(0)
  })
})
