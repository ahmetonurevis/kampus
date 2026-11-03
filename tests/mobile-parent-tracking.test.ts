import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays,
  attendanceCounts,
  attendanceLabel,
  attendanceView,
  isAttendanceStatus,
  NO_REASON,
  parentTabs,
  resolveParentTab,
  weekDays,
  weekRange,
  weekSchedule,
  weekStart,
  weekTitle,
} from '../apps/mobile/src/api/parent-tracking.ts'
import { homeworkAudienceView, homeworkEmptyText } from '../apps/mobile/src/api/presentation.ts'

const names = {
  subjects: new Map([['mat', 'Matematik']]),
  teachers: new Map([
    ['t1', 'Selin Kaya'],
    ['t2', 'Mert Aydın'],
  ]),
}

type LessonInput = Parameters<typeof weekSchedule>[0][number]
const lesson = (id: string, overrides: Partial<LessonInput> = {}): LessonInput => ({
  id,
  subjectId: 'mat',
  title: null,
  teacherId: 't1',
  originalTeacherId: null,
  // Europe/Istanbul UTC+3: 06:00Z yerel 09:00.
  date: '2026-11-03T06:00:00.000Z',
  duration: 40,
  room: '101',
  status: 'planned',
  ...overrides,
})

describe('IST-124 mobil veli akademik takip', () => {
  test('IST-124 sekmeler web sırasındadır; kapalı modülün sekmesi çizilmez', () => {
    const all = parentTabs({ academic: true, planning: true, learning: true })
    assert.deepEqual(
      all.map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'program', 'odevler'],
    )
    assert.deepEqual(
      parentTabs({ academic: true, planning: false, learning: true }).map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'odevler'],
    )
    assert.deepEqual(
      parentTabs({ academic: true, learning: false }).map((tab) => tab.value),
      ['notlar', 'devamsizlik', 'program'],
    )
    // Modül anahtarı listede yoksa açık sayılır (kapalı yalnız açıkça `false`).
    assert.equal(parentTabs({}).length, 4)
  })

  test('IST-124 modül kapanınca seçili sekme ilk görünen sekmeye düşer', () => {
    const tabs = parentTabs({ academic: true, planning: false, learning: true })
    assert.equal(resolveParentTab('program', tabs), 'notlar')
    assert.equal(resolveParentTab('odevler', tabs), 'odevler')
    assert.equal(resolveParentTab('notlar', []), 'notlar')
  })

  test('IST-124 devamsızlık özeti kayıtlardan hesaplanır, bilinmeyen durum sayılmaz', () => {
    assert.deepEqual(
      attendanceCounts([
        { status: 'present' },
        { status: 'present' },
        { status: 'absent' },
        { status: 'late' },
        { status: 'excused' },
        { status: 'bilinmeyen' },
        {},
      ]),
      { present: 2, absent: 1, late: 1, excused: 1 },
    )
    assert.deepEqual(attendanceCounts([]), { present: 0, absent: 0, late: 0, excused: 0 })
  })

  test('IST-124 durum etiketleri Türkçe, bilinmeyen durum olduğu gibi kalır', () => {
    assert.equal(attendanceLabel('absent'), 'Gelmedi')
    assert.equal(attendanceLabel('late'), 'Geç geldi')
    assert.equal(attendanceLabel('x'), 'x')
    // Nesne prototipindeki adlar durum sayılmaz, metin olduğu gibi döner.
    assert.equal(attendanceLabel('toString'), 'toString')
    assert.equal(isAttendanceStatus('constructor'), false)
    assert.equal(isAttendanceStatus('excused'), true)
    assert.equal(isAttendanceStatus(''), false)
  })

  test('DOM-AKD-036 geç kalma dakikası yalnız Geç geldi kaydında görünür', () => {
    const late = attendanceView({
      date: '2026-11-02T00:00:00.000Z',
      status: 'late',
      lateMinutes: 12,
      reason: ' Servis gecikti ',
    })
    assert.equal(late.status, 'Geç geldi')
    assert.equal(late.subtitle, '12 dk · Servis gecikti')
    assert.match(late.title, /2 Kas 2026/)
    assert.match(late.title, /Pazartesi/)
    const absent = attendanceView({ date: '2026-11-02', status: 'absent', lateMinutes: 5 })
    assert.equal(absent.subtitle, NO_REASON)
    assert.equal(attendanceView({ status: 'present' }).title, 'Ders günü')
  })

  test('hafta Europe/Istanbul takvimiyle pazartesi başlar', () => {
    assert.equal(weekStart('2026-11-03'), '2026-11-02')
    assert.equal(weekStart('2026-11-02'), '2026-11-02')
    // Pazar önceki pazartesinin haftasındadır.
    assert.equal(weekStart('2026-11-08'), '2026-11-02')
    assert.equal(weekStart('2026-11-09'), '2026-11-09')
    assert.equal(addDays('2026-11-02', -7), '2026-10-26')
    assert.equal(addDays('2026-12-28', 7), '2027-01-04')
    assert.deepEqual(weekRange('2026-11-02'), { dateFrom: '2026-11-02', dateTo: '2026-11-08' })
    assert.equal(weekDays('2026-11-02').length, 7)
    assert.equal(weekTitle('2026-11-02'), '2 Kasım – 8 Kasım 2026')
  })

  test('DOM-YTK-068 iptal edilen ders haftalık programda görünmez', () => {
    const days = weekSchedule(
      [lesson('a'), lesson('b', { status: 'cancelled', date: '2026-11-03T08:00:00.000Z' })],
      '2026-11-02',
      names,
    )
    assert.equal(days.length, 1)
    assert.deepEqual(
      days[0]?.lessons.map((item) => item.id),
      ['a'],
    )
  })

  test('hafta programı günlere ve saate göre sıralanır, boş gün listelenmez', () => {
    const days = weekSchedule(
      [
        lesson('geç', { date: '2026-11-03T10:00:00.000Z' }),
        lesson('erken', { date: '2026-11-03T06:00:00.000Z' }),
        lesson('çarşamba', { date: '2026-11-04T06:00:00.000Z' }),
        // Haftanın dışı.
        lesson('gelecek', { date: '2026-11-10T06:00:00.000Z' }),
      ],
      '2026-11-02',
      names,
    )
    assert.deepEqual(
      days.map((day) => day.day),
      ['2026-11-03', '2026-11-04'],
    )
    assert.deepEqual(
      days[0]?.lessons.map((item) => item.id),
      ['erken', 'geç'],
    )
    assert.match(days[0]?.label ?? '', /Salı/)
  })

  test('gün Europe/Istanbul takvimine göredir: 22:30Z ertesi günün 01:30 dersidir', () => {
    const days = weekSchedule(
      [lesson('gece', { date: '2026-11-03T22:30:00.000Z' })],
      '2026-11-02',
      names,
    )
    assert.equal(days[0]?.day, '2026-11-04')
    assert.equal(days[0]?.lessons[0]?.time, '01:30–02:10')
  })

  test('ders satırı saat aralığı, ders adı, öğretmen ve derslik taşır', () => {
    const [day] = weekSchedule([lesson('a')], '2026-11-02', names)
    assert.deepEqual(day?.lessons[0], {
      id: 'a',
      title: 'Matematik',
      time: '09:00–09:40',
      subtitle: 'Selin Kaya · Derslik 101',
    })
    // Kaydın kendi başlığı ders adından önce gelir; ad bilinmiyorsa genel ad.
    const [titled] = weekSchedule([lesson('b', { title: 'Cebir' })], '2026-11-02', names)
    assert.equal(titled?.lessons[0]?.title, 'Cebir')
    const [unknown] = weekSchedule(
      [lesson('c', { subjectId: 'yok', teacherId: 'yok', room: '' })],
      '2026-11-02',
      names,
    )
    assert.equal(unknown?.lessons[0]?.title, 'Ders')
    assert.equal(unknown?.lessons[0]?.subtitle, '')
  })

  test('DOM-YTK-068 yedek öğretmen yazılır, gerekçe ya da asıl öğretmen gösterilmez', () => {
    const [day] = weekSchedule(
      [
        lesson('a', { teacherId: 't2', originalTeacherId: 't1', status: 'substituted' }),
        lesson('b', {
          teacherId: 'görünmeyen',
          originalTeacherId: 't1',
          status: 'substituted',
          date: '2026-11-03T08:00:00.000Z',
        }),
      ],
      '2026-11-02',
      names,
    )
    assert.equal(day?.lessons[0]?.subtitle, 'Yedek: Mert Aydın · Derslik 101')
    assert.equal(day?.lessons[1]?.subtitle, 'Yedek öğretmen atandı · Derslik 101')
    assert.doesNotMatch(JSON.stringify(day), /Selin/)
  })

  test('IST-124 ödev sekmesi etiketi web ile aynıdır', () => {
    const tab = parentTabs({}).find((item) => item.value === 'odevler')
    assert.equal(tab?.label, 'Ödev durumu')
  })

  test('DOM-AKD-074 velide teslim yönlendirmesi yok, başlık Teslim açıklaması', () => {
    const now = new Date('2026-11-03T09:00:00.000Z')
    const open = { dueDate: '2026-11-10T09:00:00.000Z', allowLate: false }
    const closed = { dueDate: '2026-11-01T09:00:00.000Z', allowLate: false }
    for (const homework of [open, closed]) {
      const parent = homeworkAudienceView('parent', homework, 'Bekliyor', now)
      assert.equal(parent.hint, null)
      assert.equal(parent.submissionTitle, 'Teslim açıklaması')
    }
    // Öğrencide yönlendirme sürer: açık ödev web'e, süresi dolan ödev kapalıya.
    assert.equal(homeworkAudienceView('student', open, 'Bekliyor', now).hint, 'web')
    assert.equal(homeworkAudienceView('student', closed, 'Bekliyor', now).hint, 'closed')
    assert.equal(homeworkAudienceView('student', open, 'Bekliyor', now).submissionTitle, 'Teslimin')
    assert.notEqual(homeworkEmptyText('parent'), homeworkEmptyText('student'))
  })
})
