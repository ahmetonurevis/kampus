import { clientHeaders, randomIp } from './support/api.ts'
import { assignCoordinator, seedTeacherGroup } from './support/cefr.ts'
import { seedApprovedPass } from './support/certificates.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// OG-088 (IST-081; DOM-DIL-081, DOM-DIL-082): yönetici onaylı geçti kararından kurum başarı
// belgesi düzenler, PDF önizlemesi açılır; oturumsuz doğrulama sayfası belgeyi "Geçerli" gösterir,
// gerekçeli iptalden sonra "İptal edildi". Yetki, kapsam, hız sınırı ve yanıt alanları API
// testindedir (`apps/api/test/certificates.test.ts`), sayfa durumları ve QR adresinin rotaya
// çözülmesi birim testindedir (`apps/web-react/tests/certificate-verification.test.ts`).

const GROUP = 'B1 Akşam'
const COORDINATOR = 'Kerem Aksoy'

test('IST-081 DOM-DIL-082: belge düzenlenir, PDF açılır, doğrulama geçerli; iptal sonrası iptal edildi', async ({
  api,
  browser,
  loginAs,
  page,
  tenant,
}) => {
  const school = await tenant({
    type: 'language_school',
    roles: ['ogretmen'],
    students: ['s1'],
    staff: [{ key: 'koordinator', role: 'ogretmen', name: COORDINATOR }],
  })
  const admin = await api(school.user('yonetici'))
  const { groupId, enrollmentId } = await seedTeacherGroup(admin, {
    institutionId: school.institutionId,
    teacherName: school.user('ogretmen').name,
    studentId: 's1',
    groupName: GROUP,
  })
  await assignCoordinator(admin, COORDINATOR, 'B1')
  await seedApprovedPass({
    institutionId: school.institutionId,
    enrollment: { id: enrollmentId, groupId, studentId: 's1' },
    teacher: await api(school.user('ogretmen')),
    coordinator: await api(school.staff('koordinator')),
  })

  // Yönetici: hak kazananlar sekmesinde gruptan belge düzenler.
  await loginAs(school.user('yonetici'))
  await page.goto('/yonetici/basari-belgeleri?sekme=hak-kazananlar')
  await expect(page.getByRole('heading', { name: 'Başarı Belgeleri', level: 1 })).toBeVisible()
  await page.getByLabel('Grup').selectOption({ label: `E2E Genel İngilizce B1 · ${GROUP}` })
  await page.getByRole('button', { name: 'Deniz Yılmaz için belge düzenle' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Belge düzenle' })
  await confirm.getByRole('button', { name: 'Belgeyi düzenle' }).click()
  await expect(confirm).toBeHidden()

  const listed = await admin.get('/api/v1/course-certificates')
  expect(listed.status).toBe(200)
  const [certificate] = (
    listed.body as { data: { number: string; verificationCode: string; status: string }[] }
  ).data
  expect(certificate?.status).toBe('valid')
  const number = certificate?.number ?? ''
  const code = certificate?.verificationCode ?? ''

  // Belgeler sekmesi: PDF önizlemesi belgenin numarasını ve doğrulama kodunu taşır.
  await page
    .getByRole('toolbar', { name: 'Başarı belgeleri bölümleri' })
    .getByRole('button', { name: 'Belgeler' })
    .click()
  await page.getByRole('button', { name: `${number} belgesini görüntüle` }).click()
  const preview = page.getByRole('dialog', { name: 'Kurum başarı belgesi · Önizleme' })
  await expect(preview.getByRole('img', { name: 'Kurum başarı belgesi, sayfa 1' })).toBeVisible()
  const viewer = preview.getByLabel('PDF sayfa görünümü')
  await expect(viewer).toContainText(number)
  await expect(viewer).toContainText(code)
  await page.keyboard.press('Escape')
  await expect(preview).toBeHidden()

  // Oturumsuz yeni bağlam (QR'ı okutan kişi): geçerli belge, yalnız baş harfler.
  const visitor = await browser.newContext({
    baseURL: e2e.webOrigin,
    extraHTTPHeaders: clientHeaders(randomIp()),
    viewport: { width: 390, height: 844 },
  })
  const anonymous = await visitor.newPage()
  const consoleErrors: string[] = []
  anonymous.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await anonymous.goto(`/belge-dogrula/${code}`)
  await expect(anonymous.getByRole('heading', { name: 'Belge doğrulama', level: 1 })).toBeVisible()
  const result = anonymous.getByRole('region', { name: 'Doğrulama sonucu' })
  await expect(result.getByText('Geçerli', { exact: true })).toBeVisible()
  await expect(result).toContainText('D. Y.')
  await expect(result).toContainText('E2E Genel İngilizce B1')
  await expect(result).not.toContainText('Deniz Yılmaz')
  await expect(result).not.toContainText(number)
  await expectNoHorizontalOverflow(anonymous)

  // Yönetici belgeyi gerekçeyle iptal eder.
  await page.getByRole('button', { name: `${number} belgesini iptal et` }).click()
  const cancel = page.getByRole('dialog', { name: 'Belgeyi iptal et' })
  await cancel.getByLabel('Gerekçe').fill('Kursiyerin adı yanlış yazıldı.')
  await cancel.getByRole('button', { name: 'Belgeyi iptal et' }).click()
  await expect(cancel).toBeHidden()
  await expect(page.getByText(`${number} iptal edildi.`)).toBeVisible()

  // Kod elle, küçük harf ve tiresiz girilir; form kanonik adrese taşır ve iptali gösterir.
  await anonymous.goto('/belge-dogrula')
  await anonymous.getByLabel('Doğrulama kodu').fill(code.toLowerCase().replaceAll('-', ' '))
  await anonymous.getByRole('button', { name: 'Doğrula' }).click()
  await expect(anonymous).toHaveURL(new RegExp(`/belge-dogrula/${code}$`))
  await expect(result.getByText('İptal edildi', { exact: true })).toBeVisible()
  await expect(result).toContainText('geçerli bir belge olarak kullanılamaz')
  expect(consoleErrors).toEqual([])
  await visitor.close()
})
