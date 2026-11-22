import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Erken çıkış (ON-168; DOM-FIN-161). Kural dalları birim ve API testlerindedir
// (`tests/finance-early-dismissals.test.ts`, `apps/api/test/finance-early-dismissals.test.ts`);
// burada veli API'den talep açar, ön büro dar ekranda talebi onaylar ve öğrenciyi teslim formuyla
// kimliği görerek veliye teslim eder (K-538, K-539); veli talebin teslim edildiğini ve bildirimi
// görür.

const DESK = '/onburo/tahsilat-takip?gorunum=erken-cikis'

/** Europe/Istanbul gün ve saat (SS:DD); sunucu saati gerçek saattir. */
function istanbulNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  )
  return {
    date: `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}`,
    time: `${String(parts.hour)}:${String(parts.minute)}`,
  }
}

type Row = { id: string; status: string; releasedToName: string | null }

test.describe('DOM-FIN-161: erken çıkış', () => {
  test('DOM-FIN-161: veli talep açar, ön büro onaylar ve kimliği görerek teslim eder (K-538, K-539)', async ({
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo', 'veli'], childIds: ['s1'] })
    const parent = await api(school.user('veli'))
    const { date, time } = istanbulNow()
    const created = await parent.context.post('/api/v1/finance/early-dismissals', {
      data: { studentId: 's1', date, time, reason: 'appointment', pickup: { kind: 'self' } },
      headers: { 'idempotency-key': crypto.randomUUID() },
    })
    expect(created.status()).toBe(201)
    const request = ((await created.json()) as { data: Row }).data
    expect(request.status).toBe('pending')

    const page = await loginAs(school.user('onburo'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(DESK)
    const section = page.getByRole('region', { name: 'Erken çıkış' })
    await section.getByRole('button', { name: /talebini onayla$/ }).click()
    const release = section.getByRole('button', { name: /öğrencisini teslim et$/ })
    await expect(release).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await release.click()

    const form = page
      .getByRole('dialog', { name: 'Öğrenciyi teslim et' })
      .getByRole('form', { name: 'Teslim formu' })
    // Kimlik işaretlenmeden teslim edilmez.
    await form.getByRole('button', { name: 'Teslimi kaydet' }).click()
    await expect(form.getByText('Teslim alan kişinin kimliğini görüp işaretleyin.')).toBeVisible()
    await form.getByLabel('Teslim alanın kimliğini gördüm').check()
    await form.getByRole('button', { name: 'Teslimi kaydet' }).click()
    await expect(page.getByRole('dialog', { name: 'Öğrenciyi teslim et' })).toHaveCount(0)
    await expect(section.getByText('Teslim edildi', { exact: true }).first()).toBeVisible()

    await expect
      .poll(async () => {
        const mine = await parent.context.get('/api/v1/finance/my-early-dismissals')
        const [row] = ((await mine.json()) as { data: Row[] }).data
        return row?.status
      })
      .toBe('released')
    const notices = await parent.context.get('/api/v1/notifications')
    const kinds = ((await notices.json()) as { data: { kind: string }[] }).data.map(
      (item) => item.kind,
    )
    expect(kinds).toContain('early_dismissal_released')
    expect(kinds).toContain('early_dismissal_decided')
  })
})
