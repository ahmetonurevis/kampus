import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// İzin takvimi ve çakışma uyarısı (ON-183; DOM-FIN-123; K-420…K-422). Kural dalları birim ve API
// testlerindedir (`tests/finance-leave-calendar.test.ts`, `apps/api/test/finance-leave-calendar.test.ts`);
// burada yönetici sınav haftası tanımlar, iki matematik öğretmenine aynı günlere izin açar ve
// talep formunda, ayrıntıda ve onayda uyarıları görür (engel değil); takvimde izinler, sınav
// haftası ve eşzamanlı izin işaretlidir. Ön büro yalnız onaylı izni türsüz görür. Tarihler
// İstanbul gününe göredir.

const ADMIN = '/yonetici/finans'
const DESK = '/onburo/tahsilat-takip'
const istanbulDay = (offset: number) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date())
  const at = new Date(`${today}T00:00:00.000Z`)
  at.setUTCDate(at.getUTCDate() + offset)
  return at.toISOString().slice(0, 10)
}
const TODAY = istanbulDay(0)
const START = istanbulDay(21)
const END = istanbulDay(23)
const EXAM_END = istanbulDay(27)
/** Takvimde START'ın ayına gidilecek "Sonraki ay" tıklaması. */
const MONTHS_AHEAD =
  (Number(START.slice(0, 4)) - Number(TODAY.slice(0, 4))) * 12 +
  Number(START.slice(5, 7)) -
  Number(TODAY.slice(5, 7))
const dayLabel = (day: string) =>
  new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${day}T00:00:00.000Z`))

test.describe('DOM-FIN-123: izin takvimi ve çakışma uyarısı', () => {
  test('DOM-FIN-123: aynı branşta eşzamanlı izin ve sınav haftası uyarılır; takvim işaretler; ön büro türsüz görür', async ({
    loginAs,
    tenant,
  }) => {
    const school = await tenant({
      roles: ['ogretmen', 'onburo'],
      staff: [{ key: 'ikinci', role: 'ogretmen', name: 'Aylin Özer', teacherId: 't17' }],
    })
    const teacher = school.user('ogretmen').name
    const second = school.staff('ikinci').name
    const page = await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN}?gorunum=izin-talep`)
    const section = page.getByRole('region', { name: 'İzin talepleri' })
    await section.getByRole('button', { name: 'Takvim', exact: true }).click()
    await section.getByRole('button', { name: 'Takvim ayarı' }).click()
    const settings = page.getByRole('form', { name: 'İzin takvimi ayarı' })
    await expect(settings.getByLabel(/Eşzamanlı izin eşiği/)).toHaveValue('2')
    await settings.getByRole('button', { name: 'Sınav haftası ekle' }).click()
    await settings.getByLabel('1. sınav haftası adı').fill('Ara sınavlar')
    await settings.getByLabel('İlk gün').fill(START)
    await settings.getByLabel('Son gün').fill(EXAM_END)
    await settings.getByRole('button', { name: 'Ayarı kaydet' }).click()
    await expect(settings).toBeHidden()

    await section.getByRole('button', { name: 'Talepler', exact: true }).click()
    for (const name of [second, teacher]) {
      await section.getByRole('button', { name: 'Yeni talep' }).click()
      const form = page.getByRole('form', { name: 'İzin talebi' })
      await form.getByLabel('Personel').selectOption({ label: `${name} (Öğretmen)` })
      await form.getByLabel('İzin türü').selectOption({ label: 'Evlilik izni' })
      await form.getByLabel('İlk gün').fill(START)
      await form.getByLabel('Son gün').fill(END)
      await form.getByLabel('İş günü').fill('3')
      const warnings = form.getByRole('region', { name: 'Çakışma uyarıları' })
      await expect(warnings).toContainText('İzin sınav haftasına denk geliyor: Ara sınavlar')
      if (name === teacher)
        await expect(warnings).toContainText(
          new RegExp(`Matematik branşında .* en çok 2 personel izinli \\(eşik 2\\): ${second}`),
        )
      await form.getByRole('button', { name: 'Talebi aç' }).click()
      await expect(form).toBeHidden()
      const detail = page.getByRole('dialog', { name: 'İzin talebi' })
      await expect(detail.getByRole('region', { name: 'Çakışma uyarıları' })).toContainText(
        'Ara sınavlar',
      )
      if (name === teacher) {
        await detail.getByRole('button', { name: 'Onayla' }).click()
        const approve = page.getByRole('form', { name: 'Onay' })
        await expect(approve.getByRole('region', { name: 'Çakışma uyarıları' })).toContainText(
          second,
        )
        await approve.getByRole('button', { name: 'Onayla' }).click()
        await expect(approve).toBeHidden()
        await expect(detail.getByText('Onaylandı', { exact: true })).toBeVisible()
      }
      await page.keyboard.press('Escape')
      await expect(detail).toBeHidden()
    }

    await section.getByRole('button', { name: 'Takvim', exact: true }).click()
    for (let step = 0; step < MONTHS_AHEAD; step += 1)
      await section.getByRole('button', { name: 'Sonraki ay' }).click()
    const grid = section.getByRole('table', { name: /İzin takvimi/ })
    const cell = grid.getByRole('cell', { name: new RegExp(dayLabel(START)) })
    await expect(cell).toContainText(`${teacher}Evlilik izni`)
    await expect(cell).toContainText(`${second}Evlilik izni · Onay bekliyor`)
    await expect(cell).toContainText('Sınav haftası: Ara sınavlar')
    await expect(cell).toContainText('Eşzamanlı izin: Matematik: 2 kişi')
    await section.getByLabel('Durum', { exact: true }).selectOption({ label: 'Onay bekliyor' })
    await expect(cell).not.toContainText(teacher)
    await expect(cell).toContainText(second)

    const desk = await loginAs(school.user('onburo'))
    await desk.setViewportSize({ width: 390, height: 844 })
    await desk.goto(`${DESK}?gorunum=izin-talep`)
    const deskSection = desk.getByRole('region', { name: 'Personel izin takvimi' })
    await expect(deskSection.getByRole('button', { name: 'Yeni talep' })).toHaveCount(0)
    for (let step = 0; step < MONTHS_AHEAD; step += 1)
      await deskSection.getByRole('button', { name: 'Sonraki ay' }).click()
    const list = deskSection.getByRole('list', { name: /İzin listesi/ })
    const item = list.getByRole('listitem').filter({ hasText: dayLabel(START) })
    await expect(item).toContainText(`${teacher}İzinli`)
    await expect(item).toContainText('Sınav haftası: Ara sınavlar')
    await expect(list).not.toContainText(second)
    await expect(list).not.toContainText('Evlilik')
    await expect(list).not.toContainText('Eşzamanlı izin')
    await expectNoHorizontalOverflow(desk)
  })
})
