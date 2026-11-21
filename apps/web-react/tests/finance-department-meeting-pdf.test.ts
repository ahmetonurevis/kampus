import assert from 'node:assert/strict'
import test from 'node:test'

import {
  meetingMinutesTitle,
  departmentDecisionRows,
  departmentMeetingMinutesDocument,
  departmentMeetingMinutesFilename,
} from '../src/lib/pdf/templates/finance-department-meeting-minutes.ts'
import { meetingFixture } from './finance-department-meeting-fixture.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Kurul ve zümre toplantısı tutanağı PDF'i (DOM-FIN-132, DOM-FIN-135; ON-217, ON-218; K-452,
// K-453, K-462).

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
      board: 'department',
      meetingDate: '2026-09-10',
      subjectName: 'Türk Dili ve Edebiyatı',
      className: null,
    }),
    'zumre-tutanagi-2026-09-10-turk-dili-ve-edebiyati.pdf',
  )
  assert.equal(
    departmentMeetingMinutesFilename({
      board: 'department',
      meetingDate: '2026-09-10',
      subjectName: '***',
      className: null,
    }),
    'zumre-tutanagi-2026-09-10.pdf',
  )
})

test('DOM-FIN-135: K-462 tutanak başlığı ve hedef alanı kurul türüne göre', () => {
  const zumre = allTexts(departmentMeetingMinutesDocument(measurer, meetingFixture(), OPTIONS))
  assert.ok(zumre.some((item) => item.includes('Matematik zümresi tutanağı')))
  assert.ok(zumre.includes('Zümre'))
  assert.ok(!zumre.includes('Sınıf / şube'))

  const board = meetingFixture({ board: 'teachers', subjectId: null, subjectName: null })
  const boardTexts = allTexts(departmentMeetingMinutesDocument(measurer, board, OPTIONS))
  for (const text of ['ÖĞRETMENLER KURULU TUTANAĞI', 'Öğretmenler kurulu tutanağı', 'Kurul'])
    assert.ok(
      boardTexts.some((item) => item.includes(text)),
      text,
    )
  assert.ok(!boardTexts.includes('Zümre'))
  assert.ok(!boardTexts.includes('Sınıf / şube'))
  assert.equal(
    departmentMeetingMinutesFilename(board),
    'ogretmenler-kurulu-tutanagi-2026-09-10.pdf',
  )

  const section = meetingFixture({
    board: 'class',
    subjectId: null,
    subjectName: null,
    classId: 'c-9a',
    className: '9-A',
  })
  const sectionTexts = allTexts(departmentMeetingMinutesDocument(measurer, section, OPTIONS))
  for (const text of [
    'ŞUBE ÖĞRETMENLER KURULU TUTANAĞI',
    '9-A şube öğretmenler kurulu tutanağı',
    'Sınıf / şube',
  ])
    assert.ok(
      sectionTexts.some((item) => item.includes(text)),
      text,
    )
  assert.equal(departmentMeetingMinutesFilename(section), 'sube-kurulu-tutanagi-2026-09-10-9-a.pdf')
  assert.equal(meetingMinutesTitle('class'), 'Şube öğretmenler kurulu tutanağı')
  assert.equal(meetingMinutesTitle('department'), 'Zümre toplantısı tutanağı')
})
