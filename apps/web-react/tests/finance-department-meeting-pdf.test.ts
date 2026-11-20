import assert from 'node:assert/strict'
import test from 'node:test'

import {
  departmentDecisionRows,
  departmentMeetingMinutesDocument,
  departmentMeetingMinutesFilename,
} from '../src/lib/pdf/templates/finance-department-meeting-minutes.ts'
import { meetingFixture } from './finance-department-meeting-fixture.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Zümre toplantısı tutanağı PDF'i (DOM-FIN-132; ON-217; K-452, K-453).

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T09:00:00.000Z'),
}

test('DOM-FIN-132: tutanak PDF gündem, katılım, numaralı karar ve imza alanlarını yazar', () => {
  const all = allTexts(departmentMeetingMinutesDocument(measurer, meetingFixture(), OPTIONS))
  for (const text of [
    'ZÜMRE TUTANAĞI',
    'KESİNLEŞTİ',
    'Gündem',
    '1. Açılış ve yoklama',
    '2. Yıllık planların incelenmesi',
    'Planlar kazanımlara göre gözden geçirildi.',
    'Katılım',
    'Selin Kaya (başkan)',
    'Mazeretli',
    'Kararlar',
    '2.1',
    '2.2',
    'Tamamlandı',
    'İmzalar',
    'Selin Kaya — Başkan',
    'Mert Aydın — Üye',
  ])
    assert.ok(
      all.some((item) => item.includes(text)),
      text,
    )
  // Mazeretli katılımcı imza alanına girmez.
  assert.ok(!all.some((item) => item.includes('Zeynep Arslan — Üye')))
})

test('DOM-FIN-132: K-453 taslak tutanak "TASLAK" ibaresiyle; takip notu yalnız kesinleşmişte', () => {
  const draft = meetingFixture({ status: 'draft', signedDate: null, finalizedAt: null })
  const all = allTexts(departmentMeetingMinutesDocument(measurer, draft, OPTIONS))
  assert.ok(all.includes('TASLAK'))
  assert.ok(all.some((item) => item.includes('Kesinleşmedi')))
  assert.deepEqual(
    departmentDecisionRows(draft).map((row) => row[1]),
    ['Ortak yazılı sınav takvimi hazırlanacak.', 'Ders planları paylaşılacak.'],
  )
  assert.deepEqual(departmentDecisionRows(meetingFixture())[1], [
    '2.2',
    'Ders planları paylaşılacak. — Takip: Paylaşıldı.',
    'Selin Kaya',
    '—',
    'Tamamlandı',
  ])
})

test('DOM-FIN-132: kararsız tutanak ve dosya adı', () => {
  const none = meetingFixture({ decisions: [] })
  const all = allTexts(departmentMeetingMinutesDocument(measurer, none, OPTIONS))
  assert.ok(all.some((item) => item.includes('Bu toplantıda karar alınmadı.')))
  assert.equal(
    departmentMeetingMinutesFilename({
      meetingDate: '2026-09-10',
      subjectName: 'Türk Dili ve Edebiyatı',
    }),
    'zumre-tutanagi-2026-09-10-turk-dili-ve-edebiyati.pdf',
  )
  assert.equal(
    departmentMeetingMinutesFilename({ meetingDate: '2026-09-10', subjectName: '***' }),
    'zumre-tutanagi-2026-09-10.pdf',
  )
})
