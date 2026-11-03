import { randomUUID } from 'node:crypto'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// OG-078 (IST-058; DOM-DIL-010…012): dil okulunda seviye tespit sınavı ekranı. Yönetici kişi seçip
// oturum açar, üç otomatik bölüme kursiyerin cevaplarını girer, yazma ve konuşmayı rubrikle puanlar,
// tespiti bitirir, önerilen CEFR seviyesini görür ve gerekçeli yerleştirme kararı verir. Örnek veride
// tespit formu yoktur; soru, quiz ve rubrikler API ile kurulur (UI'dan kurulum yok). Genel öneri
// için okuma ve dinlemede en az 10 madde gerekir (`cefr/suggestion.ts`). Kurallar API testindedir
// (`apps/api/test/cefr.test.ts`), sunum birim testindedir (`apps/web-react/tests/placement-model.test.ts`).

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const FORM_TITLE = 'E2E seviye tespit formu'
const RATIONALE = 'E2E yazma ve konuşma bölümleri B1 düzeyinde'
const SECTIONS = [
  { skill: 'language_use', label: 'Dil kullanımı', count: 2 },
  { skill: 'reading', label: 'Okuma', count: 10 },
  { skill: 'listening', label: 'Dinleme', count: 10 },
] as const
const CORRECT = 'Correct answer'

const idempotent = () => ({ 'idempotency-key': randomUUID() })
const versioned = (version: number) => ({ ...idempotent(), 'if-match': `"${version}"` })

async function expectOk(result: { status: number; body: unknown }, status = 201) {
  expect(result.status, JSON.stringify(result.body)).toBe(status)
  return (result.body as { data: Json }).data
}

/** Kaynağı oluşturur ve yayımlar; yayındaki sürümün kimliğini döner. */
async function publish(admin: ApiClient, body: Json): Promise<string> {
  const created = await expectOk(await admin.post('/api/v1/resources', body, idempotent()))
  const draft = created.version as Json
  const published = await expectOk(
    await admin.post(
      `/api/v1/resources/${created.resource.id}/versions/${draft.id}/publish`,
      {},
      versioned(draft.rowVersion),
    ),
    200,
  )
  return (published.version as Json).id as string
}

const bands = (aspect: string) =>
  [0, 1, 2, 3, 4, 5].map((band) => ({
    band,
    description: `${aspect} için bant ${band} tanımı`,
    alignment: { kind: 'cefr', scale: 'Overall production', level: 'B1', index: 1 },
  }))

async function publishRubric(
  admin: ApiClient,
  skill: 'writing' | 'speaking',
  aspects: readonly [string, string],
) {
  const rubric = await expectOk(
    await admin.post(
      '/api/v1/rubrics',
      {
        title: `E2E ${skill} rubriği`,
        kind: 'analytic',
        skill,
        criteria: aspects.map((aspect, index) => ({
          id: `c${index}`,
          aspect,
          bands: bands(aspect),
        })),
      },
      idempotent(),
    ),
  )
  const version = rubric.version as Json
  await expectOk(
    await admin.post(
      `/api/v1/rubrics/${rubric.rubric.id}/versions/${version.id}/publish`,
      {},
      versioned(version.rowVersion),
    ),
    200,
  )
}

/** Üç otomatik bölümün B1 soruları, hepsini içeren quiz ve iki rubrik; örnek veride yoktur. */
async function seedPlacementContent(admin: ApiClient) {
  const tags = (skill: string) => ({
    subjectId: 'english',
    gradeLevels: [9],
    primarySkill: skill,
    cefrLevel: 'B1',
  })
  const questionIds: string[] = []
  for (const { skill, count } of SECTIONS) {
    for (let n = 1; n <= count; n += 1) {
      questionIds.push(
        await publish(admin, {
          title: `Tespit sorusu ${skill} ${n}`,
          content: {
            type: 'question',
            question: {
              questionType: 'multiple_choice',
              stem: `${skill} ${n}?`,
              options: [
                { id: 'a', text: CORRECT },
                { id: 'b', text: 'Wrong one' },
                { id: 'c', text: 'Wrong two' },
                { id: 'd', text: 'Wrong three' },
              ],
            },
          },
          answerKey: {
            questionType: 'multiple_choice',
            correctOptionId: 'a',
            explanation: 'İlk seçenek doğrudur.',
          },
          license: { kind: 'institution_original' },
          tags: tags(skill),
        }),
      )
    }
  }
  await publish(admin, {
    title: FORM_TITLE,
    content: {
      type: 'quiz',
      items: questionIds.map((questionVersionId) => ({ questionVersionId, points: 1 })),
    },
    license: { kind: 'institution_original' },
    tags: tags('language_use'),
  })
  await publishRubric(admin, 'writing', ['task_fulfilment', 'grammatical_accuracy'])
  await publishRubric(admin, 'speaking', ['range', 'accuracy'])
}

test('IST-058 DOM-DIL-010: yönetici tespiti açar, bölümleri puanlar, bitirir, önerilen seviyeyi görür ve yerleştirir', async ({
  api,
  loginAs,
  page,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: [], students: ['s1'] })
  await seedPlacementContent(await api(school.user('yonetici')))

  await loginAs(school.user('yonetici'))
  await page.goto('/yonetici/seviye-tespiti')
  await expect(page.getByRole('heading', { name: 'Seviye Tespiti', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kişi seçin', level: 2 })).toBeVisible()

  // Oturum açma: kişi, form ve yer seçilir.
  await page.getByRole('button', { name: 'Seviye tespiti aç' }).click()
  const openPanel = page.getByRole('dialog', { name: 'Seviye tespiti aç' })
  await openPanel.getByLabel('Kişi', { exact: true }).selectOption('s1')
  await openPanel.getByLabel('Tespit formu').selectOption({ label: FORM_TITLE })
  await openPanel.getByRole('button', { name: 'Tespiti aç' }).click()

  const panel = page.getByRole('dialog', { name: 'Seviye tespiti' })
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Öneri için eksik bölüm', { exact: false })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Yerleştirme kararı ver' })).toHaveCount(0)

  // Otomatik bölümler: cevaplar girilir, puan sunucuda hesaplanır.
  for (const { label, count } of SECTIONS) {
    if (label === 'Dinleme') {
      // Girilmemiş otomatik bölüm varken bitirme onay ister ve eksik bölümü adıyla söyler.
      await panel.getByRole('button', { name: 'Tespiti bitir' }).click()
      const confirm = page.getByRole('alertdialog', { name: 'Tespiti bitir' })
      await expect(confirm).toContainText('Girilmemiş otomatik bölüm var: Dinleme')
      await confirm.getByRole('button', { name: 'Vazgeç' }).click()
      await expect(confirm).toHaveCount(0)
    }
    await panel.getByRole('button', { name: `${label} bölümünü puanla` }).click()
    const form = page.getByRole('dialog', { name: `${label} bölümünü puanla` })
    await expect(form.getByRole('status')).toHaveText(`0 / ${count} soru cevaplandı`)
    const radios = form.getByRole('radio', { name: CORRECT })
    await expect(radios).toHaveCount(count)
    for (const radio of await radios.all()) await radio.check()
    await expect(form.getByRole('status')).toHaveText(`${count} / ${count} soru cevaplandı`)
    await form.getByRole('button', { name: 'Cevapları kaydet' }).click()
    const row = page
      .getByRole('dialog', { name: 'Seviye tespiti' })
      .getByRole('list', { name: 'Bölüm sonuçları' })
      .getByRole('listitem')
      .filter({ hasText: label })
    await expect(row.getByText('%100')).toBeVisible()
  }
  await expect(panel.getByText('Öneri için eksik bölüm', { exact: false })).toBeVisible()

  // Yazma ve konuşma: rubrik bantları, hedef seviye B1.
  for (const label of ['Yazma', 'Konuşma']) {
    await panel.getByRole('button', { name: `${label} bölümünü puanla` }).click()
    const form = page.getByRole('dialog', { name: `${label} bölümünü puanla` })
    await form.getByLabel('Görevin hedef seviyesi').selectOption('B1')
    for (const group of await form.getByRole('radiogroup').all())
      await group.getByRole('radio', { name: /^4 ·/ }).check()
    await form.getByRole('button', { name: 'Puanı kaydet' }).click()
    await expect(
      page
        .getByRole('dialog', { name: 'Seviye tespiti' })
        .getByRole('list', { name: 'Bölüm sonuçları' })
        .getByRole('listitem')
        .filter({ hasText: label })
        .getByText('Puanlandı'),
    ).toBeVisible()
  }

  // Bitirme: önerilen seviye görünür; karar henüz verilmedi.
  await panel.getByRole('button', { name: 'Tespiti bitir' }).click()
  await expect(panel.getByRole('button', { name: 'Tespiti bitir' })).toHaveCount(0)
  await expect(panel.getByText('Bölüm sonuçlarına göre öneri; karar değildir.')).toBeVisible()
  const suggested = panel.getByText('Önerilen seviye', { exact: true }).locator('..')
  await expect(suggested).toContainText('B1')
  await expect(panel.getByText('Karar verilmedi', { exact: true })).toBeVisible()

  // Karar: genel seviye öneriden gelir, gerekçe zorunludur.
  await panel.getByRole('button', { name: 'Yerleştirme kararı ver' }).click()
  const decision = page.getByRole('dialog', { name: 'Yerleştirme kararı' })
  await expect(decision.getByLabel('Genel seviye')).toHaveValue('B1')
  await decision.getByRole('button', { name: 'Kararı kaydet' }).click()
  await expect(decision.getByText('Yerleştirme gerekçesini yazın.')).toBeVisible()
  await decision.getByLabel('Gerekçe').fill(RATIONALE)
  await decision.getByRole('button', { name: 'Kararı kaydet' }).click()

  const done = page.getByRole('dialog', { name: 'Seviye tespiti' })
  // Genel seviye ve öneriden gelen beceri seviyeleri aynı gerekçeyle kaydedilir.
  const decisions = done.getByRole('list', { name: 'Yerleştirme kararları' }).getByRole('listitem')
  await expect(decisions.filter({ hasText: 'Genel seviye' })).toContainText('B1')
  await expect(decisions.filter({ hasText: `Gerekçe: ${RATIONALE}` })).toHaveCount(
    await decisions.count(),
  )
  await expect(done.getByText('B1', { exact: true }).first()).toBeVisible()
  await expect(done.getByRole('button', { name: 'Yerleştirme kararı ver' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})
