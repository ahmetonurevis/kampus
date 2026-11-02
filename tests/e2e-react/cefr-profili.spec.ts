import { seedLevelDecision, seedTeacherGroup } from './support/cefr.ts'
import { expect, test } from './support/fixtures.ts'
import { userIdOf } from './support/tasks.ts'

// OG-054 (IST-060; DOM-DIL-010, DOM-BEC-034): dil okulunda CEFR profili. Öğrenci kendi profilini
// Akademik Gelişim'de gerekçesiz görür; öğretmen grubundaki kursiyerin profilini gerekçeyle görür.
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
