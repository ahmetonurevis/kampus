import { randomUUID } from 'node:crypto'

import type { Locator, Page } from '@playwright/test'

import { apiRequest, type ApiClient } from './support/api.ts'
import { e2e } from './support/env.ts'
import { expect, test } from './support/fixtures.ts'

// Sözleşme onayı ve ek protokol (IST-092; docs/domain/finans.md DOM-FIN-010, -012, -051). Her test
// kendi kurumunu kurar; seed sözleşmesi `contract-<öğrenci>` imzasız ve onaysızdır. Kalıcılık API
// sorgusuyla doğrulanır.

const ADMIN_CONTRACTS = '/yonetici/finans?gorunum=sozlesmeler'
const FRONT_OFFICE_CONTRACTS = '/onburo/tahsilat-takip?gorunum=sozlesmeler'
const SIGNATORY = { name: 'Murat Kurucu', role: 'founder_representative' }

type ContractData = {
  version: number
  record: {
    amount: number
    title: string
    signatory?: { name: string; role: string }
    approval?: { method: string; approvedAt: string; plan: unknown[] }
    revision?: number
    amendsContractId?: string
    cancelledAt?: string
    invoiceIds?: string[]
  }
}

async function contractOf(client: ApiClient, id: string): Promise<ContractData> {
  const result = await client.get(`/api/v1/collections/contracts/${id}`)
  expect(result.status, JSON.stringify(result.body)).toBe(200)
  return (result.body as { data: ContractData }).data
}

/** Sözleşme komutu: yeni anahtar ve okunan sürüm. */
async function command(client: ApiClient, id: string, verb: string, body: unknown) {
  const { version } = await contractOf(client, id)
  const result = await client.post(`/api/v1/finance/contracts/${id}/${verb}`, body, {
    'idempotency-key': randomUUID(),
    'if-match': `"${String(version)}"`,
  })
  expect(result.status, JSON.stringify(result.body)).toBeLessThan(300)
  return result.body as { data: { entity: { id: string } | null } }
}

/** Veli hesabını öğrencinin ödeyicisi yapar (DOM-ILT-074); kurulum API'den, arayüzden değil. */
async function makePayer(admin: ApiClient, studentId: string) {
  const list = await admin.get(`/api/v1/students/${studentId}/guardians`)
  expect(list.status).toBe(200)
  const link = (
    list.body as { data: { id: string; membershipId: string | null; rowVersion?: number }[] }
  ).data.find((item) => item.membershipId !== null)
  if (!link) throw new Error('Veli bağı bulunamadı.')
  const result = await apiRequest(
    admin.context,
    'PATCH',
    `/api/v1/students/${studentId}/guardians/${link.id}`,
    { isPayer: true },
    { 'if-match': `"${String(link.rowVersion ?? 1)}"` },
  )
  expect(result.status, JSON.stringify(result.body)).toBe(200)
}

const panelOf = (page: Page) => page.getByRole('dialog', { name: 'Sözleşme ayrıntısı' })

async function openFromList(page: Page, url: string, student: string): Promise<Locator> {
  await page.goto(url)
  await expect(page.getByRole('toolbar', { name: 'Finans görünümü' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Sözleşmeler' })
  await expect(table).toContainText(student)
  await table.getByRole('button', { name: `${student} Sürüm 1 sözleşme ayrıntısını aç` }).click()
  return panelOf(page)
}

test.describe('IST-092 sözleşme onayı', () => {
  test('DOM-FIN-010: yönetici imza yetkilisini işler, ödeyici veli onaylar; onaylı sözleşme değişmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['veli'], childIds: ['s1'] })
    const admin = await api(school.user('yonetici'))
    await makePayer(admin, 's1')
    const before = await contractOf(admin, 'contract-s1')

    await loginAs(school.user('yonetici'))
    const panel = await openFromList(page, ADMIN_CONTRACTS, 'Deniz Yılmaz')
    await expect(panel).toContainText('Kurum imzası bekleniyor')
    await panel.getByRole('button', { name: 'İmza yetkilisini işle' }).click()
    const form = panel.getByRole('form', { name: 'İmza yetkilisi' })
    await form.getByRole('button', { name: 'İmza yetkilisini kaydet' }).click()
    await expect(form.getByLabel('Ad soyad')).toHaveAttribute('aria-invalid', 'true')
    await form.getByLabel('Ad soyad').fill(SIGNATORY.name)
    await form.getByLabel('Sıfat').selectOption({ label: 'Kurucu temsilcisi' })
    await form.getByRole('button', { name: 'İmza yetkilisini kaydet' }).click()
    await expect(page.getByText('İmza yetkilisi işlendi.')).toBeVisible()
    await expect(panel).toContainText('Ödeyici onayı bekleniyor')
    await expect(panel).toContainText(`${SIGNATORY.name} · Kurucu temsilcisi`)
    expect((await contractOf(admin, 'contract-s1')).record.signatory).toMatchObject(SIGNATORY)

    await loginAs(school.user('veli'))
    await page.goto('/veli/sozlesmeler?cocuk=s1')
    await page.getByRole('button', { name: /Sürüm 1 incele ve onayla/ }).click()
    const approval = page.getByRole('dialog', { name: 'Sözleşme onayı' })
    await expect(approval).toContainText('Elektronik onay')
    await expect(approval.getByRole('table', { name: 'Güncel ödeme planı' })).toBeVisible()
    await approval.getByRole('button', { name: 'Sözleşmeyi onayla' }).click()
    await expect(
      approval.getByText('Onay için sözleşmeyi kabul ettiğinizi işaretleyin.'),
    ).toBeVisible()
    await approval
      .getByLabel('Sözleşmeyi ve ödeme planını okudum, ödeyici olarak onaylıyorum')
      .check()

    // Onay borç doğurur; oturum eskidiyse parola sorulur ve onay bir kez tekrarlanır.
    let stale = true
    const sent: string[] = []
    await page.route('**/api/v1/finance/contracts/*/approve', async (route) => {
      sent.push(route.request().headers()['idempotency-key'] ?? '')
      if (!stale) return route.continue()
      stale = false
      return route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'reauthentication_required',
          message: 'Bu işlem için parolanızı yeniden girmeniz gerekiyor.',
          requestId: 'e2e',
        }),
      })
    })
    await approval.getByRole('button', { name: 'Sözleşmeyi onayla' }).click()
    const reauth = page.getByRole('dialog', { name: 'Parolanızı doğrulayın' })
    await reauth.getByLabel('Parola').fill(e2e.password)
    await reauth.getByRole('button', { name: 'Doğrula ve devam et' }).click()
    await expect(page.getByText('Sözleşme onaylandı.')).toBeVisible()
    await expect(approval).toBeHidden()
    expect(sent).toHaveLength(2)
    const documents = page.getByRole('list', { name: 'Belgeler' })
    await expect(documents).toContainText('Onaylandı')
    await expect(documents).toContainText('Elektronik onay')
    await expect(page.getByRole('button', { name: /incele ve onayla/ })).toHaveCount(0)

    const after = await contractOf(admin, 'contract-s1')
    expect(after.record.approval?.method).toBe('electronic')
    expect(after.record.amount).toBe(before.record.amount)
    // Onaylı sözleşme değişmez: imza yetkilisi ve ikinci onay 409 (DOM-FIN-010).
    for (const [verb, body] of [
      ['signatory', SIGNATORY],
      ['approve', { accepted: true }],
    ] as const) {
      const result = await admin.post(`/api/v1/finance/contracts/contract-s1/${verb}`, body, {
        'idempotency-key': randomUUID(),
        'if-match': `"${String(after.version)}"`,
      })
      expect(result.status).toBe(409)
      expect((result.body as { code: string }).code).toBe('contract_already_approved')
    }
    expect((await contractOf(admin, 'contract-s1')).version).toBe(after.version)

    await loginAs(school.user('yonetici'))
    await page.goto(`${ADMIN_CONTRACTS}&sozlesme=contract-s1`)
    await expect(panelOf(page)).toContainText('Onaylandı')
    await expect(panelOf(page).getByRole('table', { name: 'Onaylanan ödeme planı' })).toBeVisible()
    await expect(panelOf(page).getByRole('button', { name: /İmza yetkilisini/ })).toHaveCount(0)
    await expect(panelOf(page).getByRole('button', { name: 'Ek protokol hazırla' })).toBeVisible()
  })

  test('DOM-FIN-010: ön büro ek protokol taslağı açar ve iptal eder; önceki sürüm ve taksitler değişmez', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s21'] })
    const admin = await api(school.user('yonetici'))
    await command(admin, 'contract-s21', 'signatory', SIGNATORY)
    await command(admin, 'contract-s21', 'approve', { accepted: true })
    const approved = await contractOf(admin, 'contract-s21')
    const invoicesBefore = await admin.get(
      '/api/v1/collections/invoices?studentId=s21&pageSize=100',
    )

    await loginAs(school.user('onburo'))
    await page.goto(`${FRONT_OFFICE_CONTRACTS}&sozlesme=contract-s21`)
    const panel = panelOf(page)
    await expect(panel).toContainText('Onaylandı')
    await expect(panel).toContainText('Islak imza')
    // ON-063: kimlik açılışta okunmaz; "Kimliği göster" okur, kesin kaydı olmayan örnek öğrencide
    // kimlik kaydı yoktur.
    const identity = panel.getByRole('region', { name: 'Kimlik bilgisi' })
    await expect(identity).toContainText('her görüntüleme denetim kaydına yazılır')
    await identity.getByRole('button', { name: 'Kimliği göster' }).click()
    await expect(identity).toContainText('Bu öğrenci için kimlik kaydı yok')
    await identity.getByRole('button', { name: 'Gizle' }).click()
    await expect(identity.getByRole('button', { name: 'Kimliği göster' })).toBeVisible()
    // İmza yetkilisini yalnız yönetici işler.
    await expect(panel.getByRole('button', { name: /İmza yetkilisini/ })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Ek protokol hazırla' }).click()
    const form = panel.getByRole('form', { name: 'Ek protokol' })
    await form.getByRole('button', { name: 'Ek protokolü hazırla' }).click()
    await expect(form.getByLabel('Gerekçe')).toHaveAttribute('aria-invalid', 'true')
    await form.getByLabel('Gerekçe').fill('Veli taksit sayısının azaltılmasını istedi.')
    await form.getByLabel('Taksit sayısı').fill('3')
    await form.getByRole('button', { name: 'Ek protokolü hazırla' }).click()
    await expect(page.getByText(/Ek protokol taslağı açıldı/)).toBeVisible()

    await expect(panel).toContainText('Sürüm 2 · Ek protokol')
    await expect(panel).toContainText('Kurum imzası bekleniyor')
    await expect(panel).toContainText(
      'Onay için önce yöneticinin imza yetkilisini işlemesi gerekir.',
    )
    const proposal = panel.getByRole('table', { name: 'Ek protokolün önerdiği ödeme planı' })
    await expect(proposal).toContainText('Korunur')
    await expect(proposal).toContainText('Yeni plan')
    // Taslak taksitleri değiştirmez; önceki sürüm aynı kalır.
    expect((await contractOf(admin, 'contract-s21')).version).toBe(approved.version)
    const invoicesDraft = await admin.get('/api/v1/collections/invoices?studentId=s21&pageSize=100')
    expect(invoicesDraft.body).toEqual(invoicesBefore.body)

    await panel.getByRole('button', { name: 'Ek protokolü iptal et' }).click()
    const cancel = panel.getByRole('form', { name: 'Ek protokol iptali' })
    await cancel.getByLabel('İptal gerekçesi').fill('Veli eski plana devam etmek istedi.')
    await cancel.getByRole('button', { name: 'Ek protokolü iptal et' }).click()
    await expect(page.getByText('Ek protokol iptal edildi.')).toBeVisible()
    await expect(panel).toContainText('İptal edildi')
    await expect(panel).toContainText('Veli eski plana devam etmek istedi.')

    await panel.getByRole('button', { name: 'Önceki sürümü aç' }).click()
    await expect(panel).toContainText('Sürüm 1')
    await expect(panel.getByRole('button', { name: 'Ek protokol hazırla' })).toBeVisible()
    expect((await contractOf(admin, 'contract-s21')).record).toEqual(approved.record)
  })

  test('DOM-FIN-051: ek protokol ıslak imzayla onaylanınca plan taksitlere geçer, önceki sürüm salt okunur', async ({
    page,
    loginAs,
    api,
    tenant,
  }) => {
    const school = await tenant({ roles: ['onburo'], students: ['s21'] })
    const admin = await api(school.user('yonetici'))
    await command(admin, 'contract-s21', 'signatory', SIGNATORY)
    await command(admin, 'contract-s21', 'approve', { accepted: true })
    const approved = await contractOf(admin, 'contract-s21')
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    const created = await command(admin, 'contract-s21', 'amendments', {
      reason: 'Taksit sayısı azaltıldı.',
      installmentCount: 2,
      firstDueDate: due,
    })
    const amendmentId = created.data.entity?.id ?? ''
    await command(admin, amendmentId, 'signatory', SIGNATORY)

    await loginAs(school.user('onburo'))
    await page.goto(`${FRONT_OFFICE_CONTRACTS}&sozlesme=${amendmentId}`)
    const panel = panelOf(page)
    await expect(panel).toContainText('Ödeyici onayı bekleniyor')
    await panel.getByRole('button', { name: 'Islak imzalı onayı işle' }).click()
    const form = panel.getByRole('form', { name: 'Islak imzalı onay' })
    await expect(form).toContainText('Islak imza')
    await form.getByLabel('Ödeyicinin ıslak imzalı sözleşmesini teslim aldım').check()
    await form.getByRole('button', { name: 'Onayı işle' }).click()
    await expect(page.getByText('Ödeyici onayı ıslak imzayla işlendi.')).toBeVisible()
    await expect(panel).toContainText('Onaylandı')
    await expect(panel.getByRole('table', { name: 'Onaylanan ödeme planı' })).toBeVisible()

    const amendment = await contractOf(admin, amendmentId)
    expect(amendment.record.approval?.method).toBe('wet_signature')
    expect(amendment.record.invoiceIds?.length).toBeGreaterThan(0)
    // Önceki sürüm hiç değişmez (DOM-FIN-010).
    expect((await contractOf(admin, 'contract-s21')).record).toEqual(approved.record)

    await panel.getByRole('button', { name: 'Önceki sürümü aç' }).click()
    await expect(panel).toContainText('Ek protokolle değişti')
    await expect(panel).toContainText('salt okunur')
    await expect(panel.getByRole('button', { name: 'Ek protokol hazırla' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Islak imzalı onayı işle' })).toHaveCount(0)

    // Sürümler arası geçiş geçmişe yazılır: ilk kapanış ek protokole döner, ikincisi paneli kapatır.
    await page.keyboard.press('Escape')
    await expect(panel).toContainText('Sürüm 2 · Ek protokol')
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    const table = page.getByRole('table', { name: 'Sözleşmeler' })
    await expect(table).toContainText('Sürüm 2 · Ek protokol')
    await expect(table).toContainText('Ek protokolle değişti')
  })
})
