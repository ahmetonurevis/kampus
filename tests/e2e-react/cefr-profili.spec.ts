import { assignCoordinator, seedLevelDecision, seedTeacherGroup } from './support/cefr.ts'
import { expect, test } from './support/fixtures.ts'
import { userIdOf } from './support/tasks.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// OG-054, OG-079 (IST-060; DOM-DIL-010, DOM-BEC-034): dil okulunda CEFR profili ve zaman
// çizelgesi. Öğrenci ve veli Akademik Gelişim'de gerekçesiz, kararı vereni ve kanıtı görmeden
// görür; öğretmen grubundaki, koordinatör seviyesindeki kursiyerin çizelgesini kim ve hangi
// kanıtla bilgisiyle görür.
// Kapsam ve görünüm taraması API testindedir (`apps/api/test/cefr.test.ts`), sunum birim
// testindedir (`apps/web-react/tests/cefr-profile-model.test.ts`).

const RATIONALE = 'E2E yazma ve konuşma bölümleri B1 düzeyinde'
const GROUP = 'B1 Akşam'

test('IST-060: öğrenci profilini gerekçesiz, öğretmen grubundaki kursiyerin profilini gerekçeli görür', async ({
  api,
  loginAs,
  page,
  tenant,
}) => {
  const school = await tenant({ type: 'language_school', roles: ['ogretmen', 'ogrenci'] })
  const admin = await api(school.user('yonetici'))
  await seedTeacherGroup(admin, {
    institutionId: school.institutionId,
    teacherName: school.user('ogretmen').name,
    studentId: 's1',
    groupName: GROUP,
  })
  await seedLevelDecision({
    institutionId: school.institutionId,
    studentId: 's1',
    decidedByUserId: await userIdOf(admin),
    level: 'B1',
    rationale: RATIONALE,
  })

  // Öğrenci: güncel seviye ve karar geçmişi görünür; gerekçe sunucudan hiç gelmez.
  await loginAs(school.user('ogrenci'))
  await page.goto('/ogrenci/seviye-takibi')
  await expect(page.getByRole('heading', { name: 'Akademik Gelişim', level: 1 })).toBeVisible()
  const current = page.getByRole('list', { name: 'Güncel seviyeler' })
  await expect(current.getByText('Genel seviye', { exact: true })).toBeVisible()
  await expect(current.getByText('B1', { exact: true })).toBeVisible()
  const timeline = page.getByRole('list', { name: 'Seviye kararları' })
  await expect(timeline.getByText('Genel seviye: B1', { exact: true })).toBeVisible()
  await expect(timeline.getByText('Düzeltme', { exact: true })).toBeVisible()
  await expect(page.getByText('Henüz seviye tespiti yok.', { exact: true })).toBeVisible()
  await expect(page.getByText(RATIONALE)).toHaveCount(0)
  await expect(page.getByText(/^Gerekçe:/)).toHaveCount(0)

  // Öğretmen: grup özetindeki "Seviye profili" sekmesi kursiyerin gerekçeli kararını gösterir.
  await page.context().clearCookies()
  await loginAs(school.user('ogretmen'))
  await page.goto('/ogretmen/gruplar')
  await expect(page.getByRole('heading', { name: 'Gruplar', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: `${GROUP} özeti` }).click()
  const panel = page.getByRole('dialog', { name: 'Grup özeti' })
  await panel.getByRole('button', { name: 'Seviye profili' }).click()
  await expect(panel.getByLabel('Kursiyer')).toHaveValue('s1')
  await expect(
    panel.getByRole('list', { name: 'Seviye kararları' }).getByText(`Gerekçe: ${RATIONALE}`, {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    panel.getByRole('list', { name: 'Güncel seviyeler' }).getByText('B1', { exact: true }),
  ).toBeVisible()
})

test('IST-060 OG-079: koordinatör çizelgeyi kim ve hangi kanıtla görür, veli çocuğununkini sade görür', async ({
  api,
  loginAs,
  page,
  tenant,
}) => {
  const school = await tenant({
    type: 'language_school',
    roles: ['ogretmen', 'veli'],
    childIds: ['s1'],
  })
  const admin = await api(school.user('yonetici'))
  const coordinator = school.user('ogretmen')
  // Grup öğretmensizdir: öğretmen kursiyere yalnız B1 koordinatörlüğüyle ulaşır.
  await seedTeacherGroup(admin, {
    institutionId: school.institutionId,
    teacherName: null,
    studentId: 's1',
    groupName: GROUP,
  })
  await assignCoordinator(admin, coordinator.name, 'B1')
  const decidedByUserId = await userIdOf(admin)
  const base = { institutionId: school.institutionId, studentId: 's1', decidedByUserId }
  await seedLevelDecision({
    ...base,
    kind: 'progression',
    level: 'B1',
    rationale: 'E2E yerleştirme gerekçesi',
    daysAgo: 30,
  })
  await seedLevelDecision({
    ...base,
    kind: 'progression',
    skill: 'speaking',
    level: 'A2',
    rationale: 'E2E konuşma yerleştirmesi',
    daysAgo: 30,
  })
  await seedLevelDecision({
    ...base,
    skill: 'speaking',
    level: 'B1',
    rationale: RATIONALE,
    daysAgo: 2,
    evidence: [{ title: 'E2E sunum görevi', skill: 'speaking', percent: 82, successful: true }],
  })

  // Koordinatör: grup özetindeki "Seviye profili" sekmesinde çizelge, süzgeç ve mini grafik.
  await loginAs(coordinator)
  await page.goto('/ogretmen/gruplar')
  await expect(page.getByRole('heading', { name: 'Gruplar', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: `${GROUP} özeti` }).click()
  const panel = page.getByRole('dialog', { name: 'Grup özeti' })
  await panel.getByRole('button', { name: 'Seviye profili' }).click()
  const timeline = panel.getByRole('list', { name: 'Seviye kararları' })
  await expect(timeline.getByRole('listitem')).toHaveCount(3)
  const latest = timeline.getByRole('listitem').first()
  await expect(latest.getByText('Konuşma: B1', { exact: true })).toBeVisible()
  await expect(latest.getByText('A2 → B1', { exact: true })).toBeVisible()
  await expect(latest.getByText(`Karar veren: ${school.user('yonetici').name}`)).toBeVisible()
  await expect(latest.getByText(`Gerekçe: ${RATIONALE}`, { exact: true })).toBeVisible()
  await latest.getByText('1 kanıt görevi, 1 başarılı', { exact: true }).click()
  await expect(
    latest.getByRole('list', { name: 'Kanıt görevleri' }).getByText('E2E sunum görevi'),
  ).toBeVisible()
  // Kanıt listesi kapanır; çizelge sayımı yalnız karar satırlarını görür.
  await latest.getByText('1 kanıt görevi, 1 başarılı', { exact: true }).click()
  await expect(latest.getByRole('list', { name: 'Kanıt görevleri' })).toBeHidden()

  const filter = panel.getByRole('toolbar', { name: 'Beceri süzgeci' })
  await filter.getByRole('button', { name: /^Konuşma/ }).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(2)
  await expect(
    panel.getByRole('figure', {
      name: /^Konuşma seviye grafiği: 2 karar: A2 \(.+\) → B1 \(.+\)$/,
    }),
  ).toBeVisible()
  await filter.getByRole('button', { name: /^Genel seviye/ }).click()
  await expect(timeline.getByRole('listitem')).toHaveCount(1)
  await expect(timeline.getByText('Genel seviye: B1', { exact: true })).toBeVisible()
  // Tek kararlı beceride grafik yoktur.
  await expect(panel.getByRole('figure')).toHaveCount(0)

  // Veli: çocuğunun çizelgesi; değişim görünür, gerekçe, karar veren ve kanıt görünmez.
  await page.context().clearCookies()
  await page.setViewportSize({ width: 390, height: 844 })
  await loginAs(school.user('veli'))
  await page.goto('/veli/seviye-takibi')
  await expect(page.getByRole('heading', { name: 'Akademik Gelişim', level: 1 })).toBeVisible()
  const childTimeline = page.getByRole('list', { name: 'Seviye kararları' })
  await expect(childTimeline.getByRole('listitem')).toHaveCount(3)
  await expect(childTimeline.getByText('Konuşma: B1', { exact: true })).toBeVisible()
  await expect(childTimeline.getByText('A2 → B1', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Karar veren:/)).toHaveCount(0)
  await expect(page.getByText(/^Gerekçe:/)).toHaveCount(0)
  await expect(page.getByText(/kanıt görevi/)).toHaveCount(0)
  await expect(page.getByText('E2E sunum görevi')).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})
