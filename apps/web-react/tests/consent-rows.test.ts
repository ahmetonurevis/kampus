import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConsentView } from '@kampus/react-shared/use-consents.ts'
import {
  WITHDRAW_COPY,
  consentRow,
  consentRows,
  objectionCandidates,
} from '../src/pages/settings/consent-rows.ts'

// IST-017, DOM-YTK-059, DOM-YTK-062: Rızalarım satırları.
const NOW = Date.parse('2026-11-02T09:00:00Z')

function consent(over: Partial<ConsentView> = {}): ConsentView {
  return {
    id: 'c1',
    subjectKind: 'student',
    subjectId: 's1',
    purpose: 'photo_video_sharing',
    decision: 'granted',
    grantorRelation: 'guardian',
    textId: 'tx-1',
    textVersion: 2,
    channel: 'web',
    givenAt: '2026-10-01T09:00:00Z',
    expiresAt: '2027-08-31T21:00:00Z',
    withdrawnAt: null,
    withdrawalReason: null,
    canWithdraw: true,
    rowVersion: 1,
    ...over,
  }
}

test('IST-017: açık rıza "Geçerli" görünür; amaç, tarih, metin sürümü ve verenin ilişkisi satırda', () => {
  const row = consentRow(consent(), NOW, [{ purpose: 'photo_video_sharing', valid: true }])
  assert.equal(row.statusText, 'Geçerli')
  assert.equal(row.tone, 'green')
  assert.equal(row.label, 'Fotoğraf ve video: kurum içi platform ve sınıf panosu')
  assert.equal(row.version, 2)
  assert.equal(row.grantor, 'Veli')
  assert.equal(row.givenLabel, '1 Eki 2026')
  assert.equal(row.expiresLabel, '1 Eyl 2027')
  assert.equal(row.canWithdraw, true)
  assert.equal(
    row.withdrawName,
    'Fotoğraf ve video: kurum içi platform ve sınıf panosu rızasını geri çek',
  )
})

test('IST-017: satır verenin hesap kimliğini taşımaz', () => {
  const row = consentRow(
    { ...consent(), grantedByUserId: 'usr-secret' } as ConsentView,
    NOW,
    undefined,
  )
  assert.ok(!JSON.stringify(row).includes('usr-secret'))
  assert.equal(consentRow(consent({ grantorRelation: 'self' }), NOW, undefined).grantor, 'Kendisi')
})

test('DOM-YTK-059: geri çekilmiş satır rıza sayılmaz ve yeniden geri çekilemez; yenilenen ayrı etiketlenir', () => {
  const withdrawn = consentRow(
    consent({ withdrawnAt: '2026-10-20T09:00:00Z', withdrawalReason: 'withdrawn' }),
    NOW,
    [{ purpose: 'photo_video_sharing', valid: true }],
  )
  assert.equal(withdrawn.statusText, 'Geri çekildi')
  assert.equal(withdrawn.canWithdraw, false)
  assert.equal(withdrawn.withdrawnLabel, '20 Eki 2026')
  const renewed = consentRow(
    consent({ withdrawnAt: '2026-10-20T09:00:00Z', withdrawalReason: 'renewed' }),
    NOW,
    undefined,
  )
  assert.equal(renewed.statusText, 'Yenilendi')
})

test('DOM-YTK-058: süresi dolan rıza "Süresi doldu" görünür ve geri çekilecek bir şeyi kalmaz', () => {
  const row = consentRow(consent({ expiresAt: '2026-10-31T21:00:00Z' }), NOW, undefined)
  assert.equal(row.statusText, 'Süresi doldu')
  assert.equal(row.canWithdraw, false)
})

test('DOM-YTK-060: geçerlilik sonucu geçersiz diyorsa açık satır "Geçerli değil" görünür', () => {
  const row = consentRow(consent(), NOW, [{ purpose: 'photo_video_sharing', valid: false }])
  assert.equal(row.statusText, 'Geçerli değil')
  assert.equal(row.tone, 'amber')
  // Başka amacın sonucu bu satırı etkilemez; sonuç gelmediyse satır geçerli sayılır.
  assert.equal(
    consentRow(consent(), NOW, [{ purpose: 'photo_video_print', valid: false }]).statusText,
    'Geçerli',
  )
  assert.equal(consentRow(consent(), NOW, undefined).statusText, 'Geçerli')
})

test('DOM-YTK-062: itiraz satırı "İtiraz kayıtlı" görünür ve geri çekme metni itiraza özeldir', () => {
  const row = consentRow(consent({ decision: 'objected', grantorRelation: 'self' }), NOW, undefined)
  assert.equal(row.kind, 'objection')
  assert.equal(row.statusText, 'İtiraz kayıtlı')
  assert.match(row.withdrawName, /itirazını geri çek$/)
  assert.equal(WITHDRAW_COPY[row.kind].confirm, 'İtirazı geri çek')
  assert.equal(WITHDRAW_COPY.consent.confirm, 'Rızayı geri çek')
})

test('IST-017: satırlar yeni kayıt önce sıralanır', () => {
  const rows = consentRows(
    [
      consent({ id: 'eski', givenAt: '2026-09-01T09:00:00Z' }),
      consent({ id: 'yeni', givenAt: '2026-10-25T09:00:00Z' }),
    ],
    NOW,
    undefined,
  )
  assert.deepEqual(
    rows.map((row) => row.id),
    ['yeni', 'eski'],
  )
})

test('DOM-YTK-062: itiraz yalnız itiraz edilebilir amaçta, açık rıza varken ve açık itiraz yokken önerilir', () => {
  const views = [
    consent({ id: 'a', purpose: 'photo_video_sharing' }),
    consent({ id: 'b', purpose: 'photo_video_print' }),
    consent({ id: 'c', purpose: 'speaking_recording' }),
    consent({ id: 'd', purpose: 'photo_video_website', withdrawnAt: '2026-10-02T09:00:00Z' }),
    consent({ id: 'e', purpose: 'photo_video_social_media', expiresAt: '2026-10-31T21:00:00Z' }),
    consent({
      id: 'f',
      purpose: 'photo_video_print',
      decision: 'objected',
      grantorRelation: 'self',
    }),
  ]
  // c itiraz edilemez, d geri çekilmiş, e süresi dolmuş, b için itiraz zaten açık.
  assert.deepEqual(objectionCandidates(views, NOW), ['photo_video_sharing'])
  // Geri çekilmiş itiraz yeniden itiraz edilmesini engellemez.
  const withdrawnObjection = views.map((view) =>
    view.id === 'f' ? { ...view, withdrawnAt: '2026-10-03T09:00:00Z' } : view,
  )
  assert.deepEqual(objectionCandidates(withdrawnObjection, NOW), [
    'photo_video_sharing',
    'photo_video_print',
  ])
})

test('DOM-YTK-059 DOM-YTK-062: öğrenci velinin satırını geri çekemez; düğme sunucunun canWithdraw kararını izler', () => {
  // 18 yaş altı öğrencinin oturumunda velinin rızası: API canWithdraw=false döndürür.
  const guardianRow = consentRow(consent({ canWithdraw: false }), NOW, undefined)
  assert.equal(guardianRow.grantor, 'Veli')
  assert.equal(guardianRow.canWithdraw, false)
  // Aynı oturumda kendi itirazı geri çekilir.
  const objection = consentRow(
    consent({ decision: 'objected', grantorRelation: 'self', canWithdraw: true }),
    NOW,
    undefined,
  )
  assert.equal(objection.canWithdraw, true)
  assert.equal(
    objection.withdrawName,
    'Fotoğraf ve video: kurum içi platform ve sınıf panosu itirazını geri çek',
  )
  // Yetki olsa da süresi dolan satırda düğme çıkmaz.
  const expired = consentRow(consent({ expiresAt: '2026-10-31T21:00:00Z' }), NOW, undefined)
  assert.equal(expired.canWithdraw, false)
})
