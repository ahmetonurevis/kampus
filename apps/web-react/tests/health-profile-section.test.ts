import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import { actionLabel, entityLabel } from '../src/pages/settings/audit-labels.ts'

// OG-090: sağlık ve acil bilgi ekranı (DOM-ILT-035, DOM-YTK-052). Görünüm, yetki, 409 ve
// 403/404 kararları `packages/react-shared/test/health-profile.test.ts`'te; burada ekran
// bağlantıları ve denetim etiketleri.
const read = (path: string) =>
  readFileSync(new URL(`../src/pages/${path}`, import.meta.url), 'utf8')

test('DOM-YTK-052: sağlık okuma ve güncelleme denetim kayıtları Türkçe etiketlenir', () => {
  assert.equal(actionLabel('health_profile.read'), 'Sağlık bilgisi görüntülendi')
  assert.equal(actionLabel('health_profile.read_emergency'), 'Acil bilgi görüntülendi')
  assert.equal(actionLabel('health_profile.update'), 'Sağlık bilgisi güncellendi')
  assert.equal(entityLabel('student'), 'Öğrenci sağlık kaydı')
})

test('DOM-ILT-035: bölüm öğretmen profilinde ve veli çocuk görünümünde yer alır', () => {
  assert.match(
    read('academic/TeacherStudentProfilePage.tsx'),
    /<HealthProfileSection studentId=\{student\.id\} \/>/,
  )
  assert.match(
    read('academic/ChildrenPage.tsx'),
    /<HealthProfileSection\s+studentId=\{healthChild\.id\}/,
  )
})

test('DOM-ILT-035: bölüm 403/404 durumunda nötr metin çizer ve rol yazma kararı modelden gelir', () => {
  const source = read('academic/HealthProfileSection.tsx')
  assert.match(source, /canEditHealthProfile\(session\.role\)/)
  assert.match(source, /healthPanelMode\(data, canWrite\)/)
  // Düzenleme formu yalnız `editable` kipte ve düzenleme açıkken çizilir.
  assert.match(source, /mode === 'editable' && editing/)
})

test('DOM-ILT-035: form çekirdek kısmi şemayı kullanır ve taslak saklanmaz', () => {
  const form = read('academic/HealthProfileForm.tsx')
  assert.match(form, /zodResolver\(healthProfileFormSchema\(hasRecord\)\)/)
  assert.match(form, /toHealthPatch\(parsed, data\)/)
  for (const file of ['academic/HealthProfileForm.tsx', 'academic/HealthProfileSection.tsx']) {
    const source = read(file)
    assert.doesNotMatch(source, /localStorage|sessionStorage|useDraftAutosave|\bfetch\(/)
  }
})

test('DOM-YTK-052: bölüm kapalı başlar, düğmeyle tek okur, gizle veriyi atar', () => {
  const source = read('academic/HealthProfileSection.tsx')
  // Okuma yalnız kancanın `revealed` bayrağıyla etkinleşir; sayfa açılışında sorgu yoktur.
  assert.match(source, /useHealthProfileReveal\(studentId\)/)
  assert.doesNotMatch(source, /useHealthProfile\(/)
  assert.match(source, /if \(!revealed\)/)
  assert.match(source, /onClick=\{show\}/)
  assert.match(source, /Sağlık bilgisini göster/)
  assert.match(source, /onClick=\{hide\}/)
  assert.match(source, /Gizle/)
  // Kapalı hâlde veri bileşeni hiç çizilmez: gövde `revealed` dalının arkasındadır.
  assert.ok(source.indexOf('if (!revealed)') < source.indexOf('<HealthProfileBody'))
  // 403/404: düğmeye basan kullanıcı sessiz kalmaz, nötr metin görür.
  assert.match(source, /state === 'hidden' \?[\s\S]*HEALTH_NO_ACCESS/)
})

test('DOM-YTK-052: kanca öğrenci değişince kapanır, veriyi atar, otomatik okumaz', () => {
  const hook = readFileSync(
    new URL('../../../packages/react-shared/src/use-health-profile.ts', import.meta.url),
    'utf8',
  )
  assert.match(hook, /enabled: revealed/)
  assert.match(hook, /revealedFor !== studentId\) setRevealedFor\(null\)/)
  assert.match(hook, /forgetHealthProfile\(queryClient, institutionId, studentId\)/)
  assert.match(hook, /removeQueries/)
  assert.match(hook, /invalidateOnSuccess: false/)
  assert.match(hook, /setQueryData/)
})
