import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'

// OG-076: öğrenci rehberlik duman testi (DOM-YTK-020). Öğrenci yalnız kendi takip dosyasının
// paylaşılan planını görür; kurum içi not ne ekranda ne yanıtta bulunur, dosya açamaz. Seed
// kurumuna yazılmaz: yalnız okunur (tohumdaki guidance-s1 ve guidance-s2).

const SEED_TITLE = 'Matematik çalışma alışkanlığı'
const OTHER_TITLE = 'Okula uyum takibi'
const SEED_INTERNAL = 'İlk görüşmede çalışma ortamı ve zaman yönetimi konuşuldu.'
const OTHER_INTERNAL = 'Danışman görüşmesi planlandı.'

interface CaseRow {
  record: { title: string; studentId: string; sharedNote: string; internalNote?: string }
}

async function cases(client: ApiClient): Promise<CaseRow[]> {
  const result = await client.get('/api/v1/collections/guidanceCases?pageSize=100')
  expect(result.status).toBe(200)
  return (result.body as { data: CaseRow[] }).data
}

test.describe('öğrenci: rehberlik ve takip', () => {
  test('DOM-YTK-020: öğrenci kendi dosyasının paylaşılan notunu görür; iç not ve başka öğrencinin dosyası yoktur', async ({
    loginAs,
    api,
  }) => {
    const page = await loginAs('ogrenci')
    await page.goto('/ogrenci/rehberlik')
    await expect(page.getByRole('heading', { name: 'Rehberlik & Takip', level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: SEED_TITLE })).toBeVisible()
    // Rol kapsamı: kardeşin (s2) dosyası öğrenciye listelenmez; yeni dosya açma yetkisi yoktur.
    await expect(page.getByRole('button', { name: OTHER_TITLE })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Takip dosyası aç' })).toHaveCount(0)

    await page.getByRole('button', { name: SEED_TITLE }).click()
    const detail = page.getByRole('dialog', { name: SEED_TITLE })
    await expect(detail.getByText('Paylaşılan destek planı')).toBeVisible()
    await expect(detail.getByText('Kısa ve düzenli tekrarlar')).toBeVisible()
    await expect(detail.getByText('Kurum içi görüşme notları')).toHaveCount(0)
    await expect(detail.getByText(SEED_INTERNAL)).toHaveCount(0)
    for (const name of ['Görüşme / sonuç kaydet', 'Dosyayı düzenle'])
      await expect(detail.getByRole('button', { name })).toHaveCount(0)
    await expect(page.getByText(OTHER_INTERNAL)).toHaveCount(0)

    // Sunucu yanıtı da aynıdır: yalnız kendi dosyası, iç not alanı hiç yok.
    const rows = await cases(await api('ogrenci'))
    expect(rows.map((row) => row.record.title)).toEqual([SEED_TITLE])
    expect(rows[0]?.record.studentId).toBe('s1')
    expect(rows[0]?.record).not.toHaveProperty('internalNote')

    // Yenilemede aynı dosya adresten açılır, iç not yine görünmez.
    await page.reload()
    await expect(page.getByRole('dialog', { name: SEED_TITLE })).toBeVisible()
    await expect(
      page.getByText('Kısa ve düzenli tekrarlar üzerinde birlikte çalışacağız.', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(SEED_INTERNAL)).toHaveCount(0)
  })
})
