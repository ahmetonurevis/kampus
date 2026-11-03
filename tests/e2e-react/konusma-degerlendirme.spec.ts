import type { Locator } from '@playwright/test'

import { expect, test } from './support/fixtures.ts'
import { grantSpeakingConsent, useFakeMicrophone } from './support/speaking.ts'
import { assignTask, seedSpeakingHomework, seedSpeakingRubric, userIdOf } from './support/tasks.ts'

// Konuşma değerlendirmesi (IST-052; DOM-BEC-021, 045, 053): öğrenci kaydını tarayıcıda yükler,
// öğretmen puanlama kuyruğundan teslimi açıp kaydı dinler (imzalı bağlantı yalnız "Kaydı dinle"
// ile istenir), rubrikle puanlar ve yazılı geri bildirim verir; öğrenci ve veli puanı, kriter
// bantlarını ve geri bildirimi görür, kendi kaydını dinler. Öğretmen puanla birlikte sesli geri
// bildirim kaydeder (DOM-BEC-056); öğrenci ve veli onu geri bildirim açılınca dinler. Sahte
// mikrofon `support/speaking.ts`.

useFakeMicrophone('konusma-degerlendirme')

const TITLE = 'Okulumu anlatıyorum'
const DENIZ = 'Deniz Yılmaz'
const FEEDBACK = 'Akıcı konuştunuz; geçmiş zaman eklerine dikkat edin.'
const VOICE = 'Öğretmenin sesli geri bildirimi'
const HEAR_VOICE = 'Sesli geri bildirimi dinle'

/** Seed'de 7-A'nın İngilizcesini başka öğretmen verir; t1 de verir ki Deniz kapsamında olsun. */
const TEACHES_ENGLISH = [
  {
    collection: 'assignments' as const,
    data: { id: 'assign-c1-english-t1', classId: 'c1', subjectId: 'english', teacherId: 't1' },
  },
]

async function chooseBand(dialog: Locator, aspect: string, band: number) {
  await dialog
    .getByRole('radiogroup', { name: `${aspect} bandı` })
    .getByLabel(new RegExp(`^${band} ·`))
    .check()
}

/** Oynatıcıda kaydı açar ve sesin yüklendiğini (süresi okunur) doğrular. */
async function listen(player: Locator, button = 'Kaydı dinle') {
  await player.getByRole('button', { name: button }).click()
  const audio = player.locator('audio')
  await expect(audio).toBeVisible()
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.duration), {
      timeout: 15_000,
    })
    .toBeGreaterThan(1)
  return audio
}

test.describe('konuşma değerlendirmesi', () => {
  test('IST-052, DOM-BEC-021, DOM-BEC-045, DOM-BEC-053, DOM-BEC-056: öğrenci kaydı yükler, öğretmen dinleyip rubrikle ve sesli geri bildirimle puanlar, öğrenci ve veli sonucu görüp sesi dinler', async ({
    page,
    context,
    loginAs,
    tenant,
    api,
  }) => {
    const school = await tenant({
      roles: ['yonetici', 'ogretmen', 'veli', 'ogrenci'],
      students: ['s1'],
      records: TEACHES_ENGLISH,
    })
    const admin = await api(school.user('yonetici'))
    await grantSpeakingConsent(school, admin, api)
    const ownerId = await userIdOf(admin)
    const rubricVersionId = await seedSpeakingRubric(school.institutionId, ownerId)
    const homework = await seedSpeakingHomework(school.institutionId, ownerId, TITLE)
    const assignmentId = await assignTask(admin, {
      resourceVersionId: homework,
      settings: {
        submission: {
          submissionKind: 'audio',
          maxVersions: 3,
          speakingAttempts: 2,
          preparationSeconds: 3,
          speakingSeconds: 10,
        },
        rubricVersionId,
      },
    })

    // Öğrenci kaydeder ve gönderir; dosya sunucuda işlenip teslim edilir.
    await context.grantPermissions(['microphone'])
    await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/odevler?yaz=${assignmentId}`)
    const box = page.getByRole('region', { name: 'Ses kaydı' })
    await box.getByRole('button', { name: 'Hazırlığa başla' }).click()
    await box.getByRole('button', { name: 'Hazırım, kayda başla' }).click()
    await expect(box.getByRole('timer')).toContainText(/00:0[2-9] \/ 00:10/)
    await box.getByRole('button', { name: 'Kaydı bitir' }).click()
    await box.getByRole('button', { name: 'Kaydı gönder' }).click()
    await expect(box.getByText('Kaydınız teslim edildi.')).toBeVisible({ timeout: 25_000 })
    const ownVersions = page.getByRole('list', { name: 'Gönderilen sürümler' })
    // Puan açılmadan sürümde puana dair iz yoktur (DOM-BEC-045).
    await expect(ownVersions.getByText('Öğretmen geri bildirimi')).toHaveCount(0)

    // Öğretmen kuyruktan açar, kaydı dinler, hızı değiştirir, rubrikle puanlar.
    await context.clearCookies()
    await loginAs(school.user('ogretmen'))
    await page.goto('/ogretmen/odevler?sekme=puanlama')
    const rows = page.getByRole('table', { name: 'Puanlama kuyruğu' }).locator('tbody tr')
    await expect(rows).toHaveCount(1)
    await rows
      .getByRole('button', { name: `${DENIZ} teslimini puanla` })
      .first()
      .click()
    const dialog = page.getByRole('dialog', { name: 'Teslimi puanla' })
    await expect(dialog.getByRole('heading', { name: 'Konuşma kayıtları' })).toBeVisible()
    await expect(dialog.getByText('Puanlanacak kayıt')).toBeVisible()
    // Konuşmada metin karşılaştırması yoktur.
    await expect(dialog.getByRole('heading', { name: 'Sürümleri karşılaştır' })).toHaveCount(0)
    const player = dialog.getByRole('group', { name: 'Sürüm 1 · Öğrencinin kaydı' })
    // Bağlantı dinlemeden önce istenmez: oynatıcı henüz yok.
    await expect(player.locator('audio')).toHaveCount(0)
    const audio = await listen(player)
    await player.getByLabel('Oynatma hızı').selectOption('0.75')
    await expect
      .poll(() => audio.evaluate((element: HTMLAudioElement) => element.playbackRate))
      .toBe(0.75)

    await chooseBand(dialog, 'Akıcılık', 4)
    await chooseBand(dialog, 'Doğruluk', 3)
    await dialog.getByLabel('Genel geri bildirim').fill(FEEDBACK)

    // Sesli geri bildirim: kayıt bitince yüklenir; işlenene kadar puan kaydedilmez.
    const voice = dialog.getByRole('region', { name: 'Sesli geri bildirim (isteğe bağlı)' })
    await voice.getByRole('button', { name: 'Sesli geri bildirim kaydet' }).click()
    await expect(voice.getByRole('timer')).toContainText(/00:0[2-9] \/ 03:00/)
    await voice.getByRole('button', { name: 'Kaydı bitir' }).click()
    await expect(dialog.getByRole('button', { name: 'Puanı kaydet' })).toBeDisabled()
    await expect(voice.getByText('puanla birlikte kaydedilecek')).toBeVisible({ timeout: 25_000 })
    await expect(voice.getByRole('button', { name: 'Sesi sil' })).toBeVisible()
    await dialog.getByRole('button', { name: 'Puanı kaydet' }).click()
    const card = dialog.getByRole('group', { name: 'Verilen puan' })
    // Toplam sunucuda: 4 + 3 = 7 / 10 → %70.
    await expect(card).toContainText('7 / 10')
    await expect(card).toContainText('Kesinleşti')
    await expect(card).toContainText(FEEDBACK)
    await listen(card.getByRole('group', { name: VOICE }), HEAR_VOICE)
    await expect(dialog.getByText('Puanlanacak kayıt')).toHaveCount(0)

    // Öğrenci puanı, bantları ve geri bildirimi görür; kendi kaydını dinler.
    await context.clearCookies()
    await loginAs(school.user('ogrenci'))
    await page.goto(`/ogrenci/odevler?yaz=${assignmentId}`)
    const versions = page.getByRole('list', { name: 'Gönderilen sürümler' })
    await expect(versions.getByText('Puan 70 / 100')).toBeVisible()
    await expect(versions.getByRole('heading', { name: 'Öğretmen geri bildirimi' })).toBeVisible()
    await expect(versions.getByText(FEEDBACK)).toBeVisible()
    await expect(versions.getByText('1. kriter: 4. bant')).toBeVisible()
    await listen(versions.getByRole('group', { name: 'Sürüm 1 · Kaydınız' }))
    await listen(versions.getByRole('group', { name: VOICE }), HEAR_VOICE)

    // Veli bağlı çocuğunun sonucunu görür ve kaydı dinler (18 yaş altı, DOM-BEC-053).
    await context.clearCookies()
    await loginAs(school.user('veli'))
    await page.goto(`/veli/akademik-takip?cocuk=s1&sekme=gorevler&gorev=${assignmentId}`)
    const panel = page.getByRole('dialog', { name: 'Görev ayrıntısı' })
    await expect(panel.getByText('Puan 70 / 100')).toBeVisible()
    await expect(panel.getByText(FEEDBACK)).toBeVisible()
    await listen(panel.getByRole('group', { name: 'Sürüm 1 · Çocuğunuzun kaydı' }))
    await listen(panel.getByRole('group', { name: VOICE }), HEAR_VOICE)
  })
})
