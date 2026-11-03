import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import {
  ATTENDANCE_CHANGED_MESSAGE,
  ATTENDANCE_MESSAGES,
} from '../packages/react-shared/src/use-academic-commands.ts'
import {
  ATTENDANCE_CHOICES,
  attendanceFailureText,
  attendanceMarks,
  attendancePayload,
  attendanceTargets,
  CHANGED_ELSEWHERE_NOTICE,
  changedElsewhere,
  isStaleDay,
  markAll,
  markCounts,
  markStudent,
  pendingEdits,
  pinnedClassVersion,
  teachingClassIds,
  todayLessons,
  unsavedCount,
} from '../apps/mobile/src/api/attendance.ts'

// Europe/Istanbul UTC+3: 06:00Z yerel 09:00; 22:30Z ertesi günün 01:30'udur.
const TODAY = '2026-11-03'

type LessonInput = Parameters<typeof attendanceTargets>[0]['lessons'] & object
type LessonRow = LessonInput[number]

const lesson = (id: string, overrides: Partial<LessonRow> = {}): LessonRow => ({
  id,
  classId: 'test-class-7a',
  subjectId: 'test-sub-mat',
  title: null,
  date: '2026-11-03T06:00:00.000Z',
  duration: 40,
  room: '101',
  status: 'planned',
  ...overrides,
})

const names = new Map([
  ['test-class-7a', '7-A'],
  ['test-class-7b', '7-B'],
  ['test-class-10a', '10-A'],
])
const subjects = new Map([['test-sub-mat', 'Matematik']])

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message, requestId: 'test-req' })

describe('IST-124 mobil öğretmen yoklaması: bugünün dersleri', () => {
  test('DOM-AKD-030 iptal ders ve başka günün dersi süzülür, kalanlar saate göre sıralanır', () => {
    const rows = todayLessons(
      [
        lesson('test-l-3', { date: '2026-11-03T09:00:00.000Z' }),
        lesson('test-l-cancel', { status: 'cancelled' }),
        lesson('test-l-1', { date: '2026-11-03T05:00:00.000Z' }),
        // 2 Kasım 22:30Z İstanbul'da 3 Kasım 01:30'dur, bugüne girer.
        lesson('test-l-0', { date: '2026-11-02T22:30:00.000Z' }),
        // 3 Kasım 21:30Z İstanbul'da 4 Kasım 00:30'dur, yarına aittir.
        lesson('test-l-late', { date: '2026-11-03T21:30:00.000Z' }),
        lesson('test-l-yesterday', { date: '2026-11-02T06:00:00.000Z' }),
        lesson('test-l-sub', { status: 'substituted', date: '2026-11-03T07:00:00.000Z' }),
      ],
      TODAY,
    )
    assert.deepEqual(
      rows.map((row) => row.id),
      ['test-l-0', 'test-l-1', 'test-l-sub', 'test-l-3'],
    )
  })

  test('DOM-YTK-022 ders satırı saat, ders ve dersliği gösterir; yedek derste yoklama açılmaz', () => {
    const targets = attendanceTargets({
      lessons: [
        lesson('test-l-1'),
        lesson('test-l-2', { classId: 'test-class-7b', title: 'Geometri', room: '' }),
      ],
      today: TODAY,
      classNames: names,
      subjectNames: subjects,
      teachingClassIds: new Set(['test-class-7a']),
      takenClassIds: new Set(['test-class-7a']),
    })
    assert.deepEqual(targets, {
      lessons: [
        {
          key: 'lesson:test-l-1',
          classId: 'test-class-7a',
          title: '7-A',
          subtitle: '09:00–09:40 · Matematik · Derslik 101',
          canTake: true,
          taken: true,
        },
        {
          key: 'lesson:test-l-2',
          classId: 'test-class-7b',
          title: '7-B',
          subtitle: '09:00–09:40 · Geometri',
          canTake: false,
          taken: false,
        },
      ],
      classes: [],
    })
  })

  test('DOM-YTK-022 bugün dersi olmayan ders verilen sınıflar ayrı bölümde listelenir', () => {
    const targets = attendanceTargets({
      lessons: [
        lesson('test-l-1'),
        // İptal ders sınıfı "bugün dersi var" saymaz; sınıf ikinci bölüme düşer.
        lesson('test-l-cancel', { classId: 'test-class-10a', status: 'cancelled' }),
      ],
      today: TODAY,
      classNames: names,
      subjectNames: subjects,
      teachingClassIds: new Set(['test-class-7a', 'test-class-10a', 'test-class-7b']),
      takenClassIds: new Set(['test-class-10a']),
    })
    assert.deepEqual(
      targets.lessons.map((row) => row.key),
      ['lesson:test-l-1'],
    )
    assert.deepEqual(
      targets.classes.map((row) => [row.key, row.title, row.subtitle, row.canTake, row.taken]),
      [
        ['class:test-class-7b', '7-B', 'Bugün programda dersi yok', true, false],
        ['class:test-class-10a', '10-A', 'Bugün programda dersi yok', true, true],
      ],
    )
  })

  test('IST-124 ders programı kapalıyken ders verilen sınıflar ad sırasıyla listelenir', () => {
    const targets = attendanceTargets({
      lessons: null,
      today: TODAY,
      classNames: names,
      subjectNames: subjects,
      teachingClassIds: new Set(['test-class-10a', 'test-class-7b']),
      takenClassIds: new Set(['test-class-7b']),
    })
    assert.deepEqual(targets.lessons, [])
    assert.deepEqual(
      targets.classes.map((row) => [row.title, row.subtitle, row.canTake, row.taken]),
      [
        ['7-B', 'Bugünkü yoklama', true, true],
        ['10-A', 'Bugünkü yoklama', true, false],
      ],
    )
  })

  test('DOM-AKD-035 gün Europe/Istanbul gece yarısında değişir; eski günün dersleri düşer', () => {
    // İstanbul gece yarısı 21:00Z'dir.
    assert.equal(isStaleDay(TODAY, new Date('2026-11-03T20:59:59.000Z')), false)
    assert.equal(isStaleDay(TODAY, new Date('2026-11-03T21:00:00.000Z')), true)
    assert.equal(isStaleDay(TODAY, new Date('2026-11-02T21:00:00.000Z')), false)
    // Uygulama öne gelince yeni gün hesaplanır; dünün dersi listede kalmaz.
    const tomorrow = '2026-11-04'
    const rows = [
      lesson('test-l-today'),
      lesson('test-l-tomorrow', { date: '2026-11-04T06:00:00.000Z' }),
    ]
    assert.deepEqual(
      todayLessons(rows, tomorrow).map((row) => row.id),
      ['test-l-tomorrow'],
    )
  })

  test('DOM-YTK-022 yalnız rehberi olduğu sınıf ders verilen sınıf sayılmaz', () => {
    const assignments = [
      { classId: 'test-class-7a', teacherId: 'test-t-selin' },
      { classId: 'test-class-7a', teacherId: 'test-t-selin' },
      { classId: 'test-class-7b', teacherId: 'test-t-other' },
    ]
    assert.deepEqual([...teachingClassIds(assignments, 'test-t-selin')], ['test-class-7a'])
    assert.equal(teachingClassIds(assignments, '').size, 0)
  })
})

describe('IST-124 mobil öğretmen yoklaması: durum değişimi', () => {
  const ids = ['test-s-deniz', 'test-s-ece', 'test-s-can']

  test('DOM-AKD-030 web ile aynı dört seçenek', () => {
    assert.deepEqual(
      ATTENDANCE_CHOICES.map((choice) => [choice.value, choice.label]),
      [
        ['present', 'Geldi'],
        ['absent', 'Gelmedi'],
        ['late', 'Geç geldi'],
        ['excused', 'Mazeretli'],
      ],
    )
  })

  test('DOM-AKD-035 kayıtlı durum yüklenir, yoksa "Geldi"; dokunulan işaret üstüne biner', () => {
    const saved = [
      { studentId: 'test-s-ece', status: 'absent' },
      { studentId: 'test-s-can', status: 'bilinmeyen' },
      { studentId: 'test-s-gone', status: 'late' },
    ]
    assert.deepEqual(attendanceMarks(ids, saved), {
      'test-s-deniz': 'present',
      'test-s-ece': 'absent',
      'test-s-can': 'present',
    })
    assert.deepEqual(attendanceMarks(ids, saved, { 'test-s-ece': 'excused' }), {
      'test-s-deniz': 'present',
      'test-s-ece': 'excused',
      'test-s-can': 'present',
    })
  })

  test('DOM-AKD-036 tek işaret ve "Tümünü geldi" girdiyi değiştirmez, yeni nesne döner', () => {
    const edits = Object.freeze({ 'test-s-ece': 'absent' as const })
    assert.deepEqual(markStudent(edits, 'test-s-deniz', 'late'), {
      'test-s-ece': 'absent',
      'test-s-deniz': 'late',
    })
    assert.deepEqual(markAll(edits, ids, 'present'), {
      'test-s-deniz': 'present',
      'test-s-ece': 'present',
      'test-s-can': 'present',
    })
    assert.deepEqual(edits, { 'test-s-ece': 'absent' })
  })

  test('IST-124 sayım ve kaydedilmemiş değişiklik kayıtlı hâle göre hesaplanır', () => {
    const base = attendanceMarks(ids, [{ studentId: 'test-s-ece', status: 'absent' }])
    const marks = attendanceMarks(ids, [{ studentId: 'test-s-ece', status: 'absent' }], {
      'test-s-ece': 'absent',
      'test-s-can': 'late',
    })
    assert.deepEqual(markCounts(marks), { present: 1, absent: 1, late: 1, excused: 0 })
    assert.equal(unsavedCount(base, marks), 1)
    assert.equal(unsavedCount(base, base), 0)
  })
})

describe('IST-124 mobil öğretmen yoklaması: kaydetme', () => {
  test('DOM-AKD-035 yük bugünü, bütün işaretleri ve sınıf sürümünü taşır; dakika gönderilmez', () => {
    const marks = { 'test-s-deniz': 'present', 'test-s-ece': 'late' } as const
    const payload = attendancePayload({
      classId: 'test-class-7a',
      today: TODAY,
      marks,
      classVersion: 4,
    })
    assert.deepEqual(payload, {
      classId: 'test-class-7a',
      date: TODAY,
      marks: { 'test-s-deniz': 'present', 'test-s-ece': 'late' },
      classVersion: 4,
    })
    // `lateMinutes` yoksa sunucu kayıtlı dakikaları korur (DOM-AKD-036).
    assert.equal('lateMinutes' in payload, false)
    assert.notEqual(payload.marks, marks)
    assert.equal(
      attendancePayload({ classId: 'c', today: TODAY, marks, classVersion: undefined })
        .classVersion,
      null,
    )
  })

  test('DOM-AKD-035 409 sonrası işaretler korunur; sunucunun yeni hâlinden farklı olanlar kalır', () => {
    const ids = ['test-s-deniz', 'test-s-ece', 'test-s-can']
    // Öğretmen Ece'yi "Gelmedi", Can'ı "Geç geldi" işaretledi; kayıt 409 aldı.
    const edits = { 'test-s-ece': 'absent', 'test-s-can': 'late' } as const
    // Bu arada başkası Ece'yi "Gelmedi", Deniz'i "Mazeretli" kaydetmişti; sorgu tazelendi.
    const fresh = [
      { studentId: 'test-s-ece', status: 'absent' },
      { studentId: 'test-s-deniz', status: 'excused' },
    ]
    const base = attendanceMarks(ids, fresh)
    const marks = attendanceMarks(ids, fresh, edits)
    // Ekran sunucunun son hâlini gösterir (Deniz "Mazeretli"), öğretmenin işi silinmez (Can "Geç").
    assert.deepEqual(marks, {
      'test-s-deniz': 'excused',
      'test-s-ece': 'absent',
      'test-s-can': 'late',
    })
    // Sunucuyla aynı olan Ece düşer; yalnız Can kaydedilmemiş görünür.
    assert.deepEqual(pendingEdits(base, edits), { 'test-s-can': 'late' })
    assert.equal(unsavedCount(base, marks), 1)
    // Sınıftan ayrılan öğrencinin eski işareti kaydedilmemiş sayılmaz.
    assert.deepEqual(pendingEdits(base, { 'test-s-gone': 'absent' }), {})
  })

  test('IST-124 hata metni web ile aynı Türkçe eşlemeden gelir', () => {
    assert.equal(
      attendanceFailureText(apiError(409, 'version_conflict')),
      ATTENDANCE_CHANGED_MESSAGE,
    )
    assert.equal(
      attendanceFailureText(apiError(403, 'attendance_correction_admin_only')),
      ATTENDANCE_MESSAGES.attendance_correction_admin_only,
    )
    assert.equal(
      attendanceFailureText(apiError(500, 'internal', 'Bir sorun oluştu.')),
      'Bir sorun oluştu.',
    )
    assert.equal(attendanceFailureText(apiError(401, 'unauthorized')), null)
  })
})

describe('DOM-AKD-035 yoklama penceresi: sürüm sabitleme ve başka yerde değişiklik', () => {
  test('sınıf sürümü açılışta sabitlenir; sonraki tazeleme göndereceği sürümü değiştirmez', () => {
    // Sabitleme gelene kadar kayıt beklemededir.
    assert.deepEqual(pinnedClassVersion(null, 'l1'), { version: undefined, pending: true })
    const pin = { key: 'l1', version: 4 }
    assert.deepEqual(pinnedClassVersion(pin, 'l1'), { version: 4, pending: false })
    // Başka cihaz kaydedip sınıf sürümü 5 olsa da (odak tazelemesi) sabit sürüm 4 kalır: eski
    // işaretler 409 almadan üzerine yazılmaz.
    const payload = attendancePayload({
      classId: 'c1',
      today: '2026-11-02',
      marks: { s1: 'absent' },
      classVersion: pinnedClassVersion(pin, 'l1').version,
    })
    assert.equal(payload.classVersion, 4)
  })

  test('başka hedefe ait sabitleme geçerli sayılmaz (hedef değişince yeniden okunur)', () => {
    assert.equal(pinnedClassVersion({ key: 'l1', version: 4 }, 'l2').pending, true)
  })

  test('düzenleme varken sunucu içeriği değişirse uyarı çıkar, aynı içerik uyarmaz', () => {
    const baseline = { s1: 'present', s2: 'present' } as const
    const edits = { s1: 'absent' } as const
    // Aynı içerikli odak tazelemesi: uyarı yok.
    assert.equal(changedElsewhere(baseline, { s1: 'present', s2: 'present' }, edits), false)
    // Başka cihaz s2'yi gelmedi yaptı.
    assert.equal(changedElsewhere(baseline, { s1: 'present', s2: 'absent' }, edits), true)
    // Öğrenci listesi değiştiyse de değişmiş sayılır.
    assert.equal(changedElsewhere(baseline, { s1: 'present' }, edits), true)
  })

  test('düzenleme yokken ya da ilk durum alınmamışken uyarı çıkmaz', () => {
    const changed = { s1: 'absent' } as const
    assert.equal(changedElsewhere({ s1: 'present' }, changed, {}), false)
    assert.equal(changedElsewhere(null, changed, { s1: 'late' }), false)
  })

  test('uyarı metni başka yerde değiştiğini söyler', () => {
    assert.match(CHANGED_ELSEWHERE_NOTICE, /^Bu yoklama başka bir yerde değişti/)
  })
})
