import { randomUUID } from 'node:crypto'

import type { Page } from '@playwright/test'

import type { ApiClient } from './support/api.ts'
import { expect, test } from './support/fixtures.ts'
import { expectNoHorizontalOverflow } from './support/ui.ts'

// Rızalarım (IST-017, DOM-YTK-057…062): veli çocuğu için rıza verir, listede görür ve geri çeker;
// güncel olmayan metin yeniden gösterilir; öğrenci kendi kayıtlarını verenin kimliği olmadan görür.
// Kurum teste özeldir (`tenant`); rıza metinleri yönetici ucuyla yayımlanır (kurulum UI'dan değil).
// Veli Ayşe Yılmaz'ın çocukları Deniz (s1) ve Ece (s2); seed öğrencilerinde doğum tarihi yoktur,
// yani 18 yaş altı sayılırlar.

const PURPOSE = 'photo_video_sharing'
const LABEL = 'Fotoğraf ve video: kurum içi platform ve sınıf panosu'
const TEXT_TITLE = 'Fotoğraf ve video kullanımı rızası'
const TEXT_BODY =
  'Çocuğumun fotoğraf ve videolarının kurum içi platformda paylaşılmasını onaylıyorum.'

async function publishText(admin: ApiClient, body: string = TEXT_BODY) {
  const result = await admin.post(
    '/api/v1/privacy-notices',
    { kind: 'consent_text', purpose: PURPOSE, title: TEXT_TITLE, body, requiresReconsent: false },
    { 'idempotency-key': randomUUID() },
  )
  expect(result.status).toBe(201)
}

interface ConsentRowBody {
  id: string
  purpose: string
  decision: string
  withdrawnAt: string | null
  grantedByUserId?: string
}

async function consentsOf(client: ApiClient, studentId: string): Promise<ConsentRowBody[]> {
  const result = await client.get(`/api/v1/consents?studentId=${studentId}&status=all`)
  expect(result.status).toBe(200)
  return (result.body as { data: ConsentRowBody[] }).data
}

const subject = (page: Page, name: string) => page.getByRole('group', { name: `${name} rızaları` })

test.describe('Rızalarım', () => {
  test('DOM-YTK-058, DOM-YTK-059: veli çocuğu için rıza verir, listede görür ve onay penceresiyle geri çeker', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'veli'], students: ['s1', 's2'] })
    await publishText(await api(school.user('yonetici')))
    await loginAs(school.user('veli'), { fresh: true })
    await page.goto('/veli/ayarlar')

    const deniz = subject(page, 'Deniz Yılmaz')
    await expect(deniz.getByText('Henüz rıza kaydı yok.')).toBeVisible()
    // Metin okunur; rıza varsayılan değildir: hiçbir seçenek önceden işaretli değil.
    await expect(deniz.getByRole('region', { name: `${LABEL} rıza metni` })).toContainText(
      TEXT_BODY,
    )
    const choice = deniz.getByRole('radiogroup', { name: `${LABEL} kararı` })
    await expect(choice.getByRole('radio', { name: 'Onaylıyorum' })).not.toBeChecked()
    await expect(choice.getByRole('radio', { name: 'Onaylamıyorum' })).not.toBeChecked()
    const save = deniz.getByRole('button', { name: 'Seçimlerimi kaydet' })
    await expect(save).toBeDisabled()

    // Klavye: seçeneğe odaklanıp boşlukla seçilir.
    await choice.getByRole('radio', { name: 'Onaylıyorum' }).focus()
    await page.keyboard.press('Space')
    await expect(choice.getByRole('radio', { name: 'Onaylıyorum' })).toBeChecked()
    await save.click()

    await expect(page.getByText('Rızanız kaydedildi.')).toBeVisible()
    const row = deniz.getByRole('listitem').filter({ hasText: LABEL })
    await expect(row).toContainText('Geçerli')
    await expect(row).toContainText('Metin sürümü 1')
    await expect(row).toContainText('Veli')
    // Karar verilen amaç artık karar beklemez; kardeşin bölümü etkilenmez.
    await expect(deniz.getByRole('radiogroup', { name: `${LABEL} kararı` })).toHaveCount(0)
    await expect(subject(page, 'Ece Yılmaz').getByText('Henüz rıza kaydı yok.')).toBeVisible()

    const veli = await api(school.user('veli'))
    const saved = await consentsOf(veli, 's1')
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ purpose: PURPOSE, decision: 'granted', withdrawnAt: null })
    // Veli verenin hesap kimliğini görmez.
    expect(saved[0]).not.toHaveProperty('grantedByUserId')

    await row.getByRole('button', { name: `${LABEL} rızasını geri çek` }).click()
    const dialog = page.getByRole('dialog', { name: 'Rızayı geri çek' })
    await expect(dialog).toContainText(LABEL)
    // Vazgeç hiçbir şeyi değiştirmez.
    await dialog.getByRole('button', { name: 'Vazgeç' }).click()
    await expect(dialog).toBeHidden()
    expect((await consentsOf(veli, 's1'))[0]?.withdrawnAt).toBeNull()

    await row.getByRole('button', { name: `${LABEL} rızasını geri çek` }).click()
    await dialog.getByRole('button', { name: 'Rızayı geri çek' }).click()
    await expect(page.getByText('Rızanız geri çekildi.')).toBeVisible()
    await expect(dialog).toBeHidden()
    await expect(row).toContainText('Geri çekildi')
    await expect(row.getByRole('button', { name: /geri çek/ })).toHaveCount(0)
    // Geri çekilen amaç yeniden karar bekler.
    await expect(deniz.getByRole('radiogroup', { name: `${LABEL} kararı` })).toBeVisible()

    expect((await consentsOf(veli, 's1'))[0]?.withdrawnAt).not.toBeNull()
    const status = await veli.get('/api/v1/consents/status?studentId=s1')
    expect(
      (status.body as { data: { purpose: string; valid: boolean }[] }).data.find(
        (item) => item.purpose === PURPOSE,
      )?.valid,
    ).toBe(false)
  })

  test('DOM-YTK-060: metin yayımlanınca eski sürüm 409 alır, yeni metin yeniden gösterilir ve karar yeniden istenir', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({ roles: ['yonetici', 'veli'], students: ['s1', 's2'] })
    const admin = await api(school.user('yonetici'))
    await publishText(admin)
    await loginAs(school.user('veli'), { fresh: true })
    await page.goto('/veli/ayarlar')

    const deniz = subject(page, 'Deniz Yılmaz')
    const choice = deniz.getByRole('radiogroup', { name: `${LABEL} kararı` })
    await choice.getByRole('radio', { name: 'Onaylıyorum' }).click()
    // Veli ekranı açıkken yönetici metni günceller.
    await publishText(
      admin,
      'Güncellenmiş metin: fotoğraf ve videolar yalnız sınıf panosunda yer alır.',
    )
    await deniz.getByRole('button', { name: 'Seçimlerimi kaydet' }).click()

    await expect(deniz.getByRole('alert')).toContainText('Rıza metni güncellendi')
    await expect(deniz.getByRole('region', { name: `${LABEL} rıza metni` })).toContainText(
      'Güncellenmiş metin',
    )
    await expect(deniz.getByText('Metin sürümü 2')).toBeVisible()
    // Eski karar düşer: kullanıcı yeni metni okuyup yeniden seçer.
    await expect(choice.getByRole('radio', { name: 'Onaylıyorum' })).not.toBeChecked()
    await expect(deniz.getByRole('button', { name: 'Seçimlerimi kaydet' })).toBeDisabled()
    expect(await consentsOf(await api(school.user('veli')), 's1')).toHaveLength(0)

    await choice.getByRole('radio', { name: 'Onaylıyorum' }).click()
    await deniz.getByRole('button', { name: 'Seçimlerimi kaydet' }).click()
    await expect(deniz.getByRole('listitem').filter({ hasText: LABEL })).toContainText(
      'Metin sürümü 2',
    )
  })

  test('DOM-YTK-057, DOM-YTK-061: "onaylamıyorum" kayıt yazmaz; personel rıza veremez (403)', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'onburo', 'veli'],
      students: ['s1', 's2'],
    })
    const admin = await api(school.user('yonetici'))
    await publishText(admin)
    await loginAs(school.user('veli'), { fresh: true })
    await page.goto('/veli/ayarlar')

    const deniz = subject(page, 'Deniz Yılmaz')
    await deniz
      .getByRole('radiogroup', { name: `${LABEL} kararı` })
      .getByRole('radio', { name: 'Onaylamıyorum' })
      .click()
    await deniz.getByRole('button', { name: 'Seçimlerimi kaydet' }).click()
    // Rıza yokluğu kendisi sonuçtur: kayıt yazılmaz, amaç seçili kalır ve temel hizmet etkilenmez.
    await expect(deniz.getByText('Rıza vermemek temel eğitim hizmetini etkilemez.')).toBeVisible()
    expect(await consentsOf(await api(school.user('veli')), 's1')).toHaveLength(0)

    // Personel oturumu rıza yazamaz; ekranda bu bilgi ConsentStep'te çıkar, API 403 verir.
    const front = await api(school.user('onburo'))
    const texts = await front.get(`/api/v1/consent-texts/${PURPOSE}`)
    const textId = (texts.body as { data: { text: { id: string } } }).data.text.id
    const attempt = await front.post(
      '/api/v1/consents',
      { purpose: PURPOSE, studentId: 's1', textId, channel: 'web' },
      { 'idempotency-key': randomUUID() },
    )
    expect(attempt.status).toBe(403)
    expect(await consentsOf(admin, 's1')).toHaveLength(0)
  })

  test('IST-017, DOM-YTK-057, DOM-YTK-059: öğrenci kayıtlarını verenin kimliği olmadan görür, velinin satırını geri çekemez; dar ekranda taşma yok', async ({
    page,
    tenant,
    loginAs,
    api,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'veli', 'ogrenci'],
      students: ['s1', 's2'],
    })
    await publishText(await api(school.user('yonetici')))
    const veli = await api(school.user('veli'))
    const text = await veli.get(`/api/v1/consent-texts/${PURPOSE}`)
    const textId = (text.body as { data: { text: { id: string } } }).data.text.id
    const given = await veli.post(
      '/api/v1/consents',
      { purpose: PURPOSE, studentId: 's1', textId, channel: 'web' },
      { 'idempotency-key': randomUUID() },
    )
    expect(given.status).toBe(201)

    await loginAs(school.user('ogrenci'), { fresh: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ogrenci/ayarlar')

    const own = subject(page, 'Deniz Yılmaz')
    const row = own.getByRole('listitem').filter({ hasText: LABEL })
    await expect(row).toContainText('Geçerli')
    await expect(row).toContainText('Veli')
    await expect(row).toContainText('Metin sürümü 1')
    // 18 yaş altı öğrenci velinin rızasını geri çekemez (canWithdraw) ve rıza formu görmez.
    await expect(row.getByRole('button', { name: /geri çek/ })).toHaveCount(0)
    await expect(own.getByText('Rızayı veliniz verir.')).toBeVisible()
    await expect(own.getByRole('radiogroup')).toHaveCount(0)
    await expectNoHorizontalOverflow(page)

    const student = await api(school.user('ogrenci'))
    const list = await consentsOf(student, 's1')
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty('grantedByUserId')
    // Veliye giden çocuk bölümü öğrencide yoktur; öğrenci yalnız kendi kaydını görür.
    await expect(page.getByRole('group', { name: 'Ece Yılmaz rızaları' })).toHaveCount(0)
  })
})
