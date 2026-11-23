import { money } from '../../packages/school-core/src/lib/format.ts'
import { assignCoordinator, seedTeacherGroup } from './support/cefr.ts'
import { seedApprovedPass } from './support/certificates.ts'
import { seedPackageTariff } from './support/finance-terms.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Kur yenileme ve üst kur teklifi (IST-088, ON-082; DOM-DIL-070, DOM-DIL-050, DOM-FIN-020): ön büro
// onaylı kur sonu kararı olan kursiyeri listede görür ve teklifi paket satışıyla açar. Karar
// dalları (tekrar, onaysız karar, üst seviye yok, kapsam) birim ve API testlerindedir
// (`tests/renewal-course-offer-list.test.ts`, `apps/api/test/finance-course-offers.test.ts`).

const COORDINATOR = 'Kerem Aksoy'
const PACKAGE = 'B1+ 24 saatlik paket'
const HOURS = 24
const HOURLY = 50_000

test('IST-088 DOM-DIL-070: ön büro onaylı geçti kararından üst seviye teklifini tarifeyle açar', async ({
  api,
  loginAs,
  tenant,
}) => {
  const school = await tenant({
    type: 'language_school',
    roles: ['ogretmen', 'onburo'],
    students: ['s1'],
    staff: [{ key: 'koordinator', role: 'ogretmen', name: COORDINATOR }],
  })
  await seedPackageTariff(school.institutionId)
  const admin = await api(school.user('yonetici'))
  const { groupId, enrollmentId } = await seedTeacherGroup(admin, {
    institutionId: school.institutionId,
    teacherName: school.user('ogretmen').name,
    studentId: 's1',
    groupName: 'B1 Akşam',
  })
  await assignCoordinator(admin, COORDINATOR, 'B1')
  await seedApprovedPass({
    institutionId: school.institutionId,
    enrollment: { id: enrollmentId, groupId, studentId: 's1' },
    teacher: await api(school.user('ogretmen')),
    coordinator: await api(school.staff('koordinator')),
  })
  // Zincirsiz B1 kurundan geçen kursiyere bir üst seviye (B1+) teklif edilir.
  const made = await admin.post('/api/v1/finance/packages', {
    kind: 'hours',
    name: PACKAGE,
    level: 'B1+',
    lessonHours: HOURS,
  })
  expect(made.status, 'paket tanımı').toBe(201)
  await admin.dispose()

  const page = await loginAs(school.user('onburo'))
  await page.goto('/onburo/tahsilat-takip?gorunum=kur-yenileme')
  const offers = page.getByRole('region', { name: 'Kur yenileme teklifleri' })
  const row = offers.getByRole('row', { name: /Deniz Yılmaz/ })
  await expect(row.getByText('Geçti', { exact: true })).toBeVisible()
  await expect(row.getByText('B1+ seviyesi')).toBeVisible()
  await expect(row.getByText(`${money(HOURS * HOURLY)} · ${String(HOURS)} saat`)).toBeVisible()
  await expect(row.getByText('Teklif hazır')).toBeVisible()
  // Öğretmenin gerekçesi teklif ekranına gelmez.
  await expect(offers).not.toContainText('tam devamla')

  await offers.getByRole('button', { name: 'Deniz Yılmaz için teklif aç' }).click()
  const dialog = page.getByRole('dialog', { name: 'Yenileme teklifi aç' })
  await expect(dialog.getByLabel('Kursiyer')).toHaveValue('s1')
  await expect(dialog.getByLabel('Paket', { exact: true })).toHaveValue(/.+/)
  await dialog.getByLabel('Taksit sayısı').selectOption('2')
  await dialog.getByRole('button', { name: 'Ücreti göster' }).click()
  await expect(dialog.getByRole('heading', { name: 'Ücret önizlemesi' })).toBeVisible()
  // İlan ücreti tarifeden; indirim yalnız ilanlı ödeme koşulundan gelir (DOM-FIN-020).
  await expect(dialog).toContainText(money(HOURS * HOURLY))
  await dialog.getByRole('button', { name: 'Satışı onayla' }).click()
  await expect(page.getByText('Paket satışı kaydedildi. Sözleşme onay bekliyor.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Paket satışı ayrıntısı' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(row.getByText('Satıldı')).toBeVisible()
  await expect(offers.getByRole('button', { name: 'Deniz Yılmaz için teklif aç' })).toHaveCount(0)

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(offers.getByText('Deniz Yılmaz').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
})
