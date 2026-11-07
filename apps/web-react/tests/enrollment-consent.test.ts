import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import {
  ACCOUNT_LINK_NOTE,
  accountNote,
  ENROLLMENT_CONSENT_NOTE,
  GUARDIAN_ACCOUNT_INVITED_NOTE,
  GUARDIAN_ACCOUNT_MISSING_NOTE,
  GUARDIAN_GUIDANCE,
  NO_NOTICE_LABEL,
  SELF_GUIDANCE,
  UNKNOWN_GRANTOR_GUIDANCE,
  enrollmentConsentSummary,
  isAdultOnForm,
  prospectNoticeLabel,
  type ConsentTextState,
} from '../src/pages/crm/enrollment-consent.ts'

const ready = (): ConsentTextState => 'ready'
const only =
  (purpose: ConsentPurpose, state: ConsentTextState) =>
  (candidate: ConsentPurpose): ConsentTextState =>
    candidate === purpose ? state : 'ready'

test('IST-017, DOM-YTK-057: 18 yaş altı öğrencide beklenen rızalar veliyi ve yerini söyler', () => {
  const summary = enrollmentConsentSummary({
    statuses: [
      { purpose: 'photo_video_sharing', valid: false, grantor: 'guardian' },
      { purpose: 'speaking_recording', valid: false, grantor: 'guardian' },
    ],
    textState: ready,
    adult: false,
  })
  assert.deepEqual(summary, {
    awaiting: [
      { guidance: GUARDIAN_GUIDANCE, purposes: ['photo_video_sharing', 'speaking_recording'] },
    ],
    unavailable: [],
    granted: [],
  })
  assert.match(GUARDIAN_GUIDANCE, /Ayarlar, Rızalarım/)
})

test('DOM-YTK-057: 18 yaşını doldurmuş öğrencide rızayı öğrenci verir', () => {
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: false, grantor: 'self' }],
    textState: ready,
    adult: false,
  })
  assert.equal(summary.awaiting[0]?.guidance, SELF_GUIDANCE)
})

test('DOM-YTK-057: formdaki doğum tarihi yetişkinse sunucunun bilinmeyen yaş yanıtı veliyi göstermez', () => {
  // Kesin kayıt doğum tarihini öğrenci kaydına yazmaz; sunucu yeni yetişkini `guardian` sayar.
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: false, grantor: 'guardian' }],
    textState: ready,
    adult: true,
  })
  assert.equal(summary.awaiting[0]?.guidance, SELF_GUIDANCE)
})

test('IST-017: metni yayımlanmamış amaç beklenmez, ayrı listelenir', () => {
  const summary = enrollmentConsentSummary({
    statuses: [
      { purpose: 'photo_video_sharing', valid: false, grantor: 'guardian' },
      { purpose: 'speaking_recording', valid: false, grantor: 'guardian' },
    ],
    textState: only('speaking_recording', 'missing'),
    adult: false,
  })
  assert.deepEqual(summary.unavailable, ['speaking_recording'])
  assert.deepEqual(summary.awaiting[0]?.purposes, ['photo_video_sharing'])
})

test('DOM-YTK-061: geçerli rızası olan amaç beklenmez; metni olmasa da geçerli sayılır', () => {
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: true, grantor: 'guardian' }],
    textState: only('photo_video_sharing', 'missing'),
    adult: false,
  })
  assert.deepEqual(summary, { awaiting: [], unavailable: [], granted: ['photo_video_sharing'] })
})

test('DOM-YTK-057: rızayı vereni bildirmeyen yanıtta kişi tahmin edilmez', () => {
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: false }],
    textState: ready,
    adult: false,
  })
  assert.equal(summary.awaiting[0]?.guidance, UNKNOWN_GRANTOR_GUIDANCE)
})

test('DOM-YTK-057: 18 yaş sınırı formdaki doğum gününde Europe/Istanbul gününe göre işler', () => {
  // 2026-03-01 00:30 İstanbul, UTC'de hâlâ 28 Şubat'tır.
  const istanbulBirthday = '2026-02-28T21:30:00.000Z'
  assert.equal(isAdultOnForm('2008-03-01', istanbulBirthday), true)
  assert.equal(isAdultOnForm('2008-03-02', istanbulBirthday), false)
})

test('DOM-KAY-003, IST-016: aday aydınlatması sürüm ve günle, kaydı yoksa açıkça yazılır', () => {
  assert.equal(prospectNoticeLabel(undefined), NO_NOTICE_LABEL)
  assert.equal(
    prospectNoticeLabel({ version: 'aydinlatma-2026-1', shownAt: '2026-02-28T21:30:00.000Z' }),
    'aydinlatma-2026-1 · 1 Mar 2026',
  )
})

test('IST-017: kontrol adımı bilgisi rızanın kaydı engellemediğini söyler', () => {
  assert.match(ENROLLMENT_CONSENT_NOTE, /kaydı engellemez/)
  assert.match(ENROLLMENT_CONSENT_NOTE, /veli ya da öğrenci kendi hesabından verir/)
})

test('ON-290, DOM-YTK-071: veli hesabı yokken açılması gerektiği, davet açılınca hesabın açıldığı yazılır', () => {
  assert.equal(accountNote({ adult: false, invited: false }), GUARDIAN_ACCOUNT_MISSING_NOTE)
  assert.match(GUARDIAN_ACCOUNT_MISSING_NOTE, /veli rıza veremez/)
  assert.match(GUARDIAN_ACCOUNT_MISSING_NOTE, /Veli hesabı aç/)
  assert.equal(accountNote({ adult: false, invited: true }), GUARDIAN_ACCOUNT_INVITED_NOTE)
  assert.match(GUARDIAN_ACCOUNT_INVITED_NOTE, /Veli hesabı açıldı/)
  // Yetişkin kursiyer rızayı kendi hesabıyla verir; veli daveti notu gösterilmez.
  assert.equal(accountNote({ adult: true, invited: true }), ACCOUNT_LINK_NOTE)
})
