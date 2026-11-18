import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İzin talebi ve onayı (ON-182; DOM-FIN-116; K-397…K-399). Kural dalları birim ve API
// testlerindedir (`tests/finance-leave-requests.test.ts`, `apps/api/test/finance-leave-requests.test.ts`);
// burada yönetici öğretmen adına evlilik izni talebi açar, izin aralığındaki dersi ders
// programından görür ve aynı saatte dersi olan öğretmeni uyarıyla yedek seçer, talebi onaylar;
// onay kullanılmış izne yazılır ve kayıt orada iptal edilemez. Ön büro sekmeyi görmez. Tarihler
// İstanbul gününe göredir: izin üç hafta sonra başlar (seed ders programı iki haftalıktır).

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const istanbulDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const at = new Date(`${today}T00:00:00.000Z`)
  at.setUTCDate(at.getUTCDate() + offset)
  return at.toISOString().slice(0, 10)
}
const START = istanbulDay(21)
const END = istanbulDay(23)
/** İstanbul 09.00 (UTC 06.00). */
const lesson = (id: string, classId: string, teacherId: string, subjectId: string) => ({
  collection: 'schedule' as const,
  data: {
    id,
    classId,
    teacherId,
    subjectId,
    date: `${START}T06:00:00.000Z`,
    duration: 40,
    title: subjectId === 'math' ? 'Matematik' : 'Türkçe',
    room: `${classId}-oda`,
  },
})

test.describe('DOM-FIN-116: izin talebi ve onayı', () => {
  test('DOM-FIN-116: yönetici öğretmen adına talep açar, derse yedek seçer ve onaylar; onay izin kaydına yazılır; ön büro sekmeyi görmez', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen', 'onburo'],
      records: [
        lesson('e2e-leave-l1', 'c1', 't1', 'math'),
        lesson('e2e-leave-l2', 'c2', 't2', 'turkish'),
      ],
    })
    const teacher = school.user('ogretmen').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=izin-talep`)
    const section = page.getByRole('region', { name: 'İzin talepleri' })
    await expect(section.getByText('Henüz izin talebi yok.')).toBeVisible()

    await section.getByRole('button', { name: 'Yeni talep' }).click()
    const form = page.getByRole('form', { name: 'İzin talebi' })
    await form.getByLabel('Personel').selectOption({ label: `${teacher} (Öğretmen)` })
    await form.getByLabel('İzin türü').selectOption({ label: 'Evlilik izni' })
    await form.getByLabel('İlk gün').fill(START)
    await form.getByLabel('Son gün').fill(END)
    await form.getByLabel('İş günü').fill('4')
    const lessons = form.getByRole('list', { name: 'Etkilenen dersler' })
    const substitute = lessons.getByLabel(/Yedek öğretmen: .*7-A · Matematik/)
    await expect(substitute).toBeVisible()
    await expect(
      substitute.getByRole('option', {
        name: 'Ahmet Yıldırım (bu saatte başka dersi var, başka branştan)',
      }),
    ).toHaveCount(1)
    await substitute.selectOption({
      label: 'Ahmet Yıldırım (bu saatte başka dersi var, başka branştan)',
    })
    await expect(
      lessons.getByText('Uyarı: Bu saatte başka dersi var, Başka branştan'),
    ).toBeVisible()
    await form.getByRole('button', { name: 'Talebi aç' }).click()
    await expect(
      form.getByText('İş günü sayısı seçilen tarih aralığındaki gün sayısını aşamaz.'),
    ).toBeVisible()
    await form.getByLabel('İş günü').fill('3')
    await form.getByRole('button', { name: 'Talebi aç' }).click()
    await expect(form).toBeHidden()

    const detail = page.getByRole('dialog', { name: 'İzin talebi' })
    await expect(detail.getByText('Onay bekliyor')).toBeVisible()
    await expect(detail.getByLabel('Talep')).toContainText('Evlilik izni')
    await expect(detail.getByLabel(/Yedek öğretmen: .*Matematik/)).toHaveValue('t2')
    await detail.getByRole('button', { name: 'Onayla' }).click()
    const approve = page.getByRole('form', { name: 'Onay' })
    await approve.getByRole('button', { name: 'Onayla' }).click()
    await expect(approve).toBeHidden()
    await expect(detail.getByText('Onaylandı', { exact: true })).toBeVisible()
    await expect(detail.getByRole('button', { name: 'Talebi iptal et' })).toBeVisible()
    await page.keyboard.press('Escape')
    const row = section.getByRole('row', { name: new RegExp(teacher) })
    await expect(row).toContainText('1 ders · 1 yedek')
    await expect(row).toContainText('Onaylandı')

    await page.goto(`${ADMIN}?gorunum=personel-izin`)
    const staff = page.getByRole('region', { name: 'Personel izinleri' })
    await staff.getByRole('button', { name: `${teacher} izinlerini aç` }).click()
    const person = page.getByRole('dialog', { name: 'Personel izni' })
    const used = person.getByRole('list', { name: 'Kullanılan izinler' })
    await expect(used).toContainText('Evlilik izni')
    await expect(used).toContainText('Onaylanan izin talebinden')
    await expect(used.getByRole('button', { name: 'İptal et' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(`${ADMIN}?gorunum=izin-talep`)
    await expect(page.getByRole('region', { name: 'İzin talepleri' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const desk = await loginAs(school.user('onburo'))
    await desk.goto(`${DESK}?gorunum=izin-talep`)
    const tabs = desk.getByRole('toolbar', { name: 'Finans görünümü' })
    await expect(tabs.getByRole('button', { name: 'Taksitler' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(tabs.getByRole('button', { name: 'İzin talepleri' })).toHaveCount(0)
  })
})
