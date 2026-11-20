import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { istanbulDay } from './support/commands.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Gözlem sonrası görüşme ve gelişim hedefi (ON-209; DOM-FIN-133, K-454…K-456). Kural dalları
// birim ve API testlerindedir (`tests/finance-observation-debriefs.test.ts`,
// `apps/api/test/finance-observation-debriefs.test.ts`); burada tamamlanmış gözlem API'den kurulur,
// yönetici gözlem penceresinde görüşmeyi açar, kesinleştirir, görüşmeden hedef ekler; "Gelişim
// hedefleri" görünümünde takip notuyla durumu ilerletir ve geçmişi görür; ön büro sekmeyi görmez.
// Tarihler İstanbul gününe göredir.

const OBSERVATIONS_URL = '/yonetici/finans?gorunum=ders-gozlemleri'
const GOALS_URL = '/yonetici/finans?gorunum=gelisim-hedefleri'
const DESK_URL = '/onburo/tahsilat-takip'
const GOAL = 'Ders sonunda kazanım yoklaması yapmak'
const LEVELS = [0, 1, 2, 3, 4, 5].map((level) => ({ level, description: `Seviye ${level}` }))

type Data<T> = { data: T }

async function command(
  client: ApiClient,
  method: 'POST' | 'PATCH',
  path: string,
  data: unknown,
  version?: number,
): Promise<Record<string, unknown>> {
  const response = await client.context.fetch(path, {
    method,
    data,
    headers: {
      'idempotency-key': randomUUID(),
      ...(version === undefined ? {} : { 'if-match': `"${String(version)}"` }),
    },
    failOnStatusCode: false,
  })
  expect([200, 201], `${path}: ${await response.text()}`).toContain(response.status())
  return ((await response.json()) as Data<Record<string, unknown>>).data
}

/** Öğretmene tamamlanmış bir ders gözlemi (form ve gözlem API'den). */
async function completedObservation(admin: ApiClient, teacherName: string) {
  const staff = await admin.get('/api/v1/finance/staff-certificate-staff?page=1&pageSize=100')
  const teacher = (staff.body as Data<{ name: string; membershipId: string }[]>).data.find(
    (row) => row.name === teacherName,
  )
  expect(teacher, 'öğretmen üyeliği').toBeDefined()
  const form = await command(admin, 'POST', '/api/v1/finance/lesson-observation-templates', {
    name: 'Ders gözlem formu',
    criteria: [{ title: 'Sınıf yönetimi', levels: LEVELS }],
  })
  let observation = await command(admin, 'POST', '/api/v1/finance/lesson-observations', {
    templateId: form.id,
    teacherMembershipId: teacher?.membershipId,
    observedDate: istanbulDay(-1),
  })
  const url = `/api/v1/finance/lesson-observations/${String(observation.id)}`
  observation = await command(
    admin,
    'PATCH',
    url,
    { ratings: [{ criterionId: 'k1', level: 3 }], generalNote: 'Hedef seviyede bir ders' },
    Number(observation.version),
  )
  await command(admin, 'POST', `${url}/complete`, {}, Number(observation.version))
}

test.describe('ON-209: gözlem sonrası görüşme ve gelişim hedefi', () => {
  test('DOM-FIN-133: yönetici görüşmeyi açar, kesinleştirir, hedef ekler ve takip notuyla ilerletir; ön büro sekmeyi görmez', async ({
    api,
    loginAs,
    tenant,
  }) => {
    const school = await tenant({ roles: ['ogretmen', 'onburo'] })
    const teacher = school.user('ogretmen').name
    await completedObservation(await api(school.user('yonetici')), teacher)

    const page = await loginAs(school.user('yonetici'))
    await page.goto(OBSERVATIONS_URL)
    const observations = page.getByRole('region', { name: 'Ders gözlemleri' })
    const row = observations.getByRole('row', { name: new RegExp(teacher) })
    await row.getByRole('button', { name: new RegExp(`${teacher} .* gözlemini görüntüle`) }).click()
    const dialog = page.getByRole('dialog', { name: 'Ders gözlemi' })
    const debrief = dialog.getByRole('region', { name: 'Gözlem sonrası görüşme' })
    await expect(debrief.getByText('Görüşme henüz yapılmadı.', { exact: false })).toBeVisible()
    await expect(debrief.getByRole('checkbox', { name: teacher })).toBeChecked()
    await expect(debrief.getByRole('checkbox', { name: teacher })).toBeDisabled()
    await debrief.getByLabel('Güçlü yönler').fill('Sınıf yönetimi güçlü')
    await debrief.getByRole('button', { name: 'Görüşmeyi aç' }).click()
    await expect(debrief.getByText('Taslak', { exact: true })).toBeVisible()

    // Gelişim alanı yazılmadan kesinleşmez (K-454).
    await debrief.getByRole('button', { name: 'Görüşmeyi kesinleştir' }).click()
    await expect(debrief.getByText(/gelişim alanlarını yazın/)).toBeVisible()
    await debrief.getByLabel('Gelişim alanları').fill('Ölçme ve geri bildirim')
    await debrief.getByLabel('Öğretmenin görüşü').fill('Çıkış kartı deneyeceğim')
    await debrief.getByRole('button', { name: 'Görüşmeyi kaydet' }).click()
    await expect(debrief.getByLabel('Öğretmenin görüşü')).toHaveValue('Çıkış kartı deneyeceğim')
    await debrief.getByRole('button', { name: 'Görüşmeyi kesinleştir' }).click()
    await expect(debrief.getByText('Görüşme kesinleşti; değiştirilemez.')).toBeVisible()
    await expect(debrief.getByText('Çıkış kartı deneyeceğim')).toBeVisible()

    await debrief.getByRole('button', { name: 'Hedef ekle' }).click()
    const goalForm = debrief.getByRole('form', { name: 'Yeni gelişim hedefi' })
    await expect(goalForm.getByText(`Öğretmen: ${teacher}`, { exact: false })).toBeVisible()
    await goalForm.getByLabel('Hedef').fill(GOAL)
    await goalForm.getByLabel('Ölçüt').fill('Üç gözlemde çıkış kartı kullanılmış olmalı')
    await goalForm.getByLabel('Takip tarihi').fill(istanbulDay(14))
    await goalForm.getByRole('button', { name: 'Hedefi aç' }).click()
    const goals = debrief.getByRole('list', { name: 'Görüşmenin gelişim hedefleri' })
    await expect(goals.getByText(GOAL)).toBeVisible()
    await expect(goals.getByText('Açık', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')

    await page.goto(GOALS_URL)
    const section = page.getByRole('region', { name: 'Gelişim hedefleri' })
    const goalRow = section.getByRole('row', { name: new RegExp(GOAL) })
    await expect(goalRow).toContainText(teacher)
    await expect(goalRow).toContainText('Gözlem')
    await goalRow.getByRole('button', { name: `${teacher} hedefini aç: ${GOAL}` }).click()
    const goalDialog = page.getByRole('dialog', { name: 'Gelişim hedefi' })
    await expect(goalDialog.getByText('Henüz takip notu yok.')).toBeVisible()
    const followUp = goalDialog.getByRole('form', { name: 'Takip notu' })
    await followUp.getByLabel('Takip notu').fill('İki derste çıkış kartı kullandı')
    await followUp.getByLabel('Yeni durum').selectOption({ label: 'Sürüyor' })
    await followUp.getByRole('button', { name: 'Notu kaydet' }).click()
    await expect(goalDialog.getByText('İki derste çıkış kartı kullandı')).toBeVisible()
    await expect(goalDialog.getByText(/Açık → Sürüyor/)).toBeVisible()
    // Sürüyor durumundan "Açık"a dönülmez (K-455).
    await expect(
      goalDialog.getByLabel('Yeni durum').locator('option', { hasText: 'Açık' }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(goalRow).toContainText('Sürüyor')

    await page.setViewportSize({ width: 390, height: 844 })
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(DESK_URL)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'Gelişim hedefleri' })).toHaveCount(0)
  })
})
