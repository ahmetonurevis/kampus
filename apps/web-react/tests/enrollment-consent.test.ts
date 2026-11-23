import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ConsentPurpose } from '@kampus/school-core/lib/consent-purposes.ts'
import { learnerWords } from '@kampus/school-core/lib/enrollment-learner.ts'
import { STAFF_CONSENT_INFO } from '../src/components/consent/consent-model.ts'
import {
  accountLinkNote,
  accountNote,
  enrollmentConsentNote,
  GUARDIAN_GUIDANCE,
  guardianAccountInvitedNote,
  guardianAccountMissingNote,
  NO_NOTICE_LABEL,
  selfGuidance,
  staffConsentInfo,
  unknownGrantorGuidance,
  enrollmentConsentSummary,
  isAdultOnForm,
  prospectNoticeLabel,
  type ConsentTextState,
} from '../src/pages/crm/enrollment-consent.ts'

const learner = learnerWords('school')
const kursiyer = learnerWords('language_school')

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
    learner,
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
    learner,
  })
  assert.equal(summary.awaiting[0]?.guidance, selfGuidance(learner))
})

test('DOM-YTK-057: formdaki doğum tarihi yetişkinse sunucunun bilinmeyen yaş yanıtı veliyi göstermez', () => {
  // Kesin kayıt doğum tarihini öğrenci kaydına yazmaz; sunucu yeni yetişkini `guardian` sayar.
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: false, grantor: 'guardian' }],
    textState: ready,
    adult: true,
    learner,
  })
  assert.equal(summary.awaiting[0]?.guidance, selfGuidance(learner))
})

test('IST-017: metni yayımlanmamış amaç beklenmez, ayrı listelenir', () => {
  const summary = enrollmentConsentSummary({
    statuses: [
      { purpose: 'photo_video_sharing', valid: false, grantor: 'guardian' },
      { purpose: 'speaking_recording', valid: false, grantor: 'guardian' },
    ],
    textState: only('speaking_recording', 'missing'),
    adult: false,
    learner,
  })
  assert.deepEqual(summary.unavailable, ['speaking_recording'])
  assert.deepEqual(summary.awaiting[0]?.purposes, ['photo_video_sharing'])
})

test('DOM-YTK-061: geçerli rızası olan amaç beklenmez; metni olmasa da geçerli sayılır', () => {
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: true, grantor: 'guardian' }],
    textState: only('photo_video_sharing', 'missing'),
    adult: false,
    learner,
  })
  assert.deepEqual(summary, { awaiting: [], unavailable: [], granted: ['photo_video_sharing'] })
})

test('DOM-YTK-057: rızayı vereni bildirmeyen yanıtta kişi tahmin edilmez', () => {
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: false }],
    textState: ready,
    adult: false,
    learner,
  })
  assert.equal(summary.awaiting[0]?.guidance, unknownGrantorGuidance(learner))
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
  assert.match(enrollmentConsentNote(learner), /kaydı engellemez/)
  assert.match(enrollmentConsentNote(learner), /veli ya da öğrenci kendi hesabından verir/)
})

test('ON-290, DOM-YTK-071: veli hesabı yokken açılması gerektiği, davet açılınca hesabın açıldığı yazılır', () => {
  const missing = guardianAccountMissingNote(learner)
  const invited = guardianAccountInvitedNote(learner)
  assert.equal(accountNote({ adult: false, invited: false, learner }), missing)
  assert.match(missing, /veli rıza veremez/)
  assert.match(missing, /Veli hesabı aç/)
  assert.equal(accountNote({ adult: false, invited: true, learner }), invited)
  assert.match(invited, /Veli hesabı açıldı/)
  // Yetişkin kursiyer rızayı kendi hesabıyla verir; veli daveti notu gösterilmez.
  assert.equal(accountNote({ adult: true, invited: true, learner }), accountLinkNote(learner))
})

test('DOM-KAY-012: okulda rıza metinleri "öğrenci" der; ortak personel bilgisiyle aynıdır', () => {
  assert.equal(staffConsentInfo(learner), STAFF_CONSENT_INFO)
  assert.equal(
    selfGuidance(learner),
    'Öğrenci 18 yaşını doldurduğu için rızayı kendisi verir: kendi hesabıyla web panelinde hesap menüsü, Ayarlar, Rızalarım.',
  )
  assert.equal(
    accountLinkNote(learner),
    'Hesap bu öğrenciye bağlı değilse öğrenci Rızalarım bölümünde görünmez; önce hesap bağlantısı kurulmalıdır.',
  )
  assert.equal(
    guardianAccountMissingNote(learner),
    'Velinin bu öğrenciye bağlı bir hesabı yoksa öğrenci Rızalarım bölümünde görünmez ve veli rıza veremez. Hesabı "Veli hesabı aç" ile açabilirsiniz.',
  )
})

test('DOM-KAY-012: dil okulu ve kursta rıza metinleri "öğrenci" yerine "kursiyer" der', () => {
  assert.equal(staffConsentInfo(kursiyer), 'Rızayı veli ya da kursiyer kendi hesabından verir.')
  assert.equal(
    enrollmentConsentNote(kursiyer),
    'Açık rıza bu formda alınmaz ve kaydı engellemez. Rızayı veli ya da kursiyer kendi hesabından verir. Kayıt tamamlanınca beklenen rızalar listelenir.',
  )
  assert.equal(
    selfGuidance(kursiyer),
    'Kursiyer 18 yaşını doldurduğu için rızayı kendisi verir: kendi hesabıyla web panelinde hesap menüsü, Ayarlar, Rızalarım.',
  )
  assert.equal(
    unknownGrantorGuidance(kursiyer),
    'Rızayı veli ya da kursiyer kendi hesabından verir. Yeri: web panelinde hesap menüsü, Ayarlar, Rızalarım.',
  )
  assert.equal(
    accountLinkNote(kursiyer),
    'Hesap bu kursiyere bağlı değilse kursiyer Rızalarım bölümünde görünmez; önce hesap bağlantısı kurulmalıdır.',
  )
  assert.equal(
    guardianAccountMissingNote(kursiyer),
    'Velinin bu kursiyere bağlı bir hesabı yoksa kursiyer Rızalarım bölümünde görünmez ve veli rıza veremez. Hesabı "Veli hesabı aç" ile açabilirsiniz.',
  )
  assert.equal(
    guardianAccountInvitedNote(kursiyer),
    'Veli hesabı açıldı. Veli e-postadaki bağlantıyla parolasını belirleyip giriş yapınca bu kursiyer Rızalarım bölümünde görünür ve rızayı oradan verir.',
  )
  const summary = enrollmentConsentSummary({
    statuses: [{ purpose: 'photo_video_sharing', valid: false, grantor: 'guardian' }],
    textState: ready,
    adult: true,
    learner: kursiyer,
  })
  assert.equal(summary.awaiting[0]?.guidance, selfGuidance(kursiyer))
  for (const text of [
    enrollmentConsentNote(kursiyer),
    selfGuidance(kursiyer),
    accountNote({ adult: true, invited: false, learner: kursiyer }),
    accountNote({ adult: false, invited: false, learner: kursiyer }),
    accountNote({ adult: false, invited: true, learner: kursiyer }),
  ])
    assert.doesNotMatch(text, /öğrenci/i)
})
