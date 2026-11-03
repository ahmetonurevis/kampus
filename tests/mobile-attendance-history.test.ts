import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_HISTORY_FILTER,
  countsFromGroups,
  decodeHistoryFilter,
  emptyHistoryText,
  encodeHistoryFilter,
  historyQueryFilters,
  historyRangeFilters,
  historyRangeText,
  historyRanges,
  historyRowView,
  presentedHistoryRanges,
  resolveHistoryClass,
  resolveHistoryRange,
} from '../apps/mobile/src/api/attendance-history.ts'
import { withFilter, withSearch } from '../apps/mobile/src/api/list-state.ts'
import {
  notificationPress,
  notificationRoute,
  notificationTarget,
} from '../apps/mobile/src/api/notifications.ts'
import { dayKey } from '../packages/school-core/src/lib/format.ts'

// DOM-AKD-036 (yoklama geçmişi aralığı, IST-093), DOM-AKD-035 (geçmiş günü yalnız yönetici düzeltir).
const TERM = { startDate: '2026-09-14', endDate: '2027-01-22' }
const allOpen = {}
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('DOM-AKD-036 tarih aralığı hesabı', () => {
  test('bu hafta pazartesiden bugüne, iki uç dahil', () => {
    // 2026-11-04 Çarşamba; hafta 2 Kasım Pazartesi'dir.
    assert.deepEqual(historyRangeFilters('week', '2026-11-04', null), {
      dateFrom: '2026-11-02',
      dateTo: '2026-11-04',
    })
    // Pazartesi günü hafta tek günlüktür.
    assert.deepEqual(historyRangeFilters('week', '2026-11-02', null), {
      dateFrom: '2026-11-02',
      dateTo: '2026-11-02',
    })
    // Pazar günü hafta aynı pazartesi başlar, ertesi haftaya taşmaz.
    assert.deepEqual(historyRangeFilters('week', '2026-11-08', null), {
      dateFrom: '2026-11-02',
      dateTo: '2026-11-08',
    })
  })

  test('son 30 gün bugün ve önceki 29 gündür; ay ve yıl sınırı aşılır', () => {
    assert.deepEqual(historyRangeFilters('last30', '2026-11-03', null), {
      dateFrom: '2026-10-05',
      dateTo: '2026-11-03',
    })
    assert.deepEqual(historyRangeFilters('last30', '2027-01-10', null), {
      dateFrom: '2026-12-12',
      dateTo: '2027-01-10',
    })
  })

  test('dönem başlangıcından bugüne; bitiş gelecekteyse bugünle kesilir', () => {
    assert.deepEqual(historyRangeFilters('term', '2026-11-03', TERM), {
      dateFrom: '2026-09-14',
      dateTo: '2026-11-03',
    })
    // Dönem bitişi geçmişteyse bitiş dönem bitişidir.
    assert.deepEqual(historyRangeFilters('term', '2027-02-01', TERM), {
      dateFrom: '2026-09-14',
      dateTo: '2027-01-22',
    })
  })

  test('dönem 1 yıldan uzunsa başlangıç sunucu sınırına (364 gün) çekilir', () => {
    const range = historyRangeFilters('term', '2026-11-03', {
      startDate: '2025-01-01',
      endDate: '2026-12-31',
    })
    assert.equal(range.dateTo, '2026-11-03')
    assert.equal(range.dateFrom, '2025-11-04')
  })

  test('dönem yoksa (tatil) varsayılan haftaya düşer, süzgeçsiz istenmez', () => {
    assert.deepEqual(historyRangeFilters('term', '2026-11-04', null), {
      dateFrom: '2026-11-02',
      dateTo: '2026-11-04',
    })
    assert.deepEqual(historyRanges(null), ['week', 'last30'])
    assert.deepEqual(historyRanges(TERM), ['week', 'last30', 'term'])
  })

  test('gün sınırı Europe/Istanbul: 21:00 UTC sonrası ertesi gündür', () => {
    // 2026-11-03 20:59 UTC = 23:59 İstanbul (aynı gün); 21:00 UTC = 00:00 ertesi gün.
    assert.equal(dayKey(new Date('2026-11-03T20:59:59Z')), '2026-11-03')
    assert.equal(dayKey(new Date('2026-11-03T21:00:00Z')), '2026-11-04')
    // Pazar gecesi 21:30 UTC İstanbul'da pazartesi 00:30'dur: yeni hafta başlar.
    const monday = dayKey(new Date('2026-11-08T21:30:00Z'))
    assert.equal(monday, '2026-11-09')
    assert.deepEqual(historyRangeFilters('week', monday, null), {
      dateFrom: '2026-11-09',
      dateTo: '2026-11-09',
    })
  })

  test('dönem bilinmeden "Dönem" bekletilir, bilgi gelince süzülür', () => {
    assert.deepEqual(resolveHistoryRange('term', 'loading', null), {
      range: 'term',
      wait: 'loading',
    })
    assert.deepEqual(resolveHistoryRange('term', 'error', null), { range: 'term', wait: 'error' })
    assert.deepEqual(resolveHistoryRange('term', 'ready', TERM), { range: 'term', wait: null })
    assert.deepEqual(resolveHistoryRange('term', 'ready', null), { range: 'week', wait: null })
    // Dönemsiz aralıklar dönem bilgisini beklemez.
    assert.deepEqual(resolveHistoryRange('last30', 'loading', null), {
      range: 'last30',
      wait: null,
    })
    assert.deepEqual(presentedHistoryRanges('loading', null), ['week', 'last30', 'term'])
    assert.deepEqual(presentedHistoryRanges('ready', null), ['week', 'last30'])
  })

  test('aralık metni uçları Türkçe gün olarak yazar', () => {
    assert.match(
      historyRangeText({ dateFrom: '2026-11-02', dateTo: '2026-11-04' }),
      /2 Kas 2026 – 4 Kas 2026/,
    )
    assert.match(historyRangeText({ dateFrom: '2026-11-02', dateTo: '2026-11-02' }), /^2 Kas 2026$/)
  })
})

describe('DOM-AKD-036 süzgeç kodlaması ve sorgu', () => {
  test('süzgeç kodlanıp çözülür; bozuk kod varsayılana düşer', () => {
    const filter = { range: 'last30', classId: 'c-9a', status: 'absent' } as const
    assert.deepEqual(decodeHistoryFilter(encodeHistoryFilter(filter)), filter)
    assert.deepEqual(decodeHistoryFilter(''), DEFAULT_HISTORY_FILTER)
    assert.deepEqual(decodeHistoryFilter('yok|c-1|toString'), {
      range: 'week',
      classId: 'c-1',
      status: '',
    })
  })

  test('sınıf seçimi öğretmenin sınıfları arasında değilse bütün sınıflara döner', () => {
    assert.equal(resolveHistoryClass('c-9a', ['c-9a', 'c-9b']), 'c-9a')
    assert.equal(resolveHistoryClass('c-eski', ['c-9a']), '')
    assert.equal(resolveHistoryClass('', ['c-9a']), '')
  })

  test('sunucu süzgeci aralık, sınıf, durum ve öğrenciyi içerir; boş olanı göndermez', () => {
    const range = { dateFrom: '2026-11-02', dateTo: '2026-11-04' }
    assert.deepEqual(historyQueryFilters(DEFAULT_HISTORY_FILTER, range), range)
    assert.deepEqual(
      historyQueryFilters({ range: 'week', classId: 'c-9a', status: 'absent' }, range, 's-deniz'),
      { ...range, classId: 'c-9a', status: 'absent', studentId: 's-deniz' },
    )
  })

  test('süzgeç ya da arama değişince sayfa başa döner', () => {
    const state = { search: 'ali', index: 3, filter: encodeHistoryFilter(DEFAULT_HISTORY_FILTER) }
    const next = withFilter(
      state,
      encodeHistoryFilter({ ...DEFAULT_HISTORY_FILTER, status: 'absent' }),
    )
    assert.equal(next.index, 0)
    assert.equal(withSearch(state, 'veli').index, 0)
    assert.equal(withFilter(state, state.filter).index, 3)
  })
})

describe('DOM-AKD-036 sayılar ve satır', () => {
  test('sunucu grupları durum sayılarına çevrilir; bilinmeyen durum sayılmaz', () => {
    assert.deepEqual(
      countsFromGroups([
        { value: 'present', count: 40 },
        { value: 'absent', count: 3 },
        { value: 'late', count: 2 },
        { value: 'toString', count: 9 },
        { value: null, count: 5 },
      ]),
      { present: 40, absent: 3, late: 2, excused: 0 },
    )
    assert.deepEqual(countsFromGroups([]), { present: 0, absent: 0, late: 0, excused: 0 })
  })

  test('satır öğrenci, sınıf, gün, durum, geç dakikası ve notu gösterir', () => {
    const row = historyRowView(
      {
        date: '2026-11-03T09:00:00.000Z',
        status: 'late',
        lateMinutes: 12,
        reason: 'Servis gecikti',
      },
      { studentName: 'Deniz Yılmaz', className: '9-A' },
    )
    assert.equal(row.title, 'Deniz Yılmaz')
    assert.equal(row.eyebrow, '9-A')
    assert.equal(row.status, 'Geç geldi')
    assert.match(row.subtitle, /3 Kas.*Salı.*12 dk · Servis gecikti/)
    assert.match(row.label, /^Deniz Yılmaz, 9-A, Geç geldi, /)
  })

  test('geç dakikası yalnız geç geldi kaydında; mazeret yoksa genel metin; ad yoksa genel ad', () => {
    const row = historyRowView(
      { date: '2026-11-03T09:00:00.000Z', status: 'absent', lateMinutes: 5 },
      undefined,
    )
    assert.equal(row.title, 'Öğrenci')
    assert.equal(row.eyebrow, undefined)
    assert.ok(!row.subtitle.includes('5 dk'))
    assert.ok(row.subtitle.endsWith('Kayıtlı mazeret yok'))
  })

  test('boş geçmiş metni süzgece göre değişir', () => {
    assert.equal(emptyHistoryText(true).title, 'Bu süzgeçte yoklama kaydı yok')
    assert.equal(emptyHistoryText(false).title, 'Bu aralıkta yoklama kaydı yok')
  })
})

describe('IST-065 devamsızlık bildirimi yönlendirmesi', () => {
  test('veli devamsızlık bildirimi Akademik Takip Devamsızlık sekmesini açar', () => {
    const session = { role: 'veli', modules: allOpen, childIds: ['s-deniz', 's-ece'] } as const
    const press = notificationPress(session, {
      topic: 'attendance',
      readAt: null,
      studentId: 's-ece',
    })
    assert.deepEqual(press.route, { screen: 'ParentTracking', params: { tab: 'devamsizlik' } })
    assert.equal(press.childId, 's-ece')
  })

  test('bildirim çocuğu taşımıyorsa ya da hesabın çocuğu değilse yalnız sekme açılır', () => {
    const session = { role: 'veli', modules: allOpen, childIds: ['s-deniz'] } as const
    for (const studentId of [undefined, 's-baska']) {
      const press = notificationPress(session, {
        topic: 'attendance',
        readAt: null,
        ...(studentId ? { studentId } : {}),
      })
      assert.equal(press.childId, null)
      assert.deepEqual(press.route, { screen: 'ParentTracking', params: { tab: 'devamsizlik' } })
    }
  })

  test('öğretmende devamsızlık geçmiş sekmesini açar', () => {
    const session = { role: 'ogretmen', modules: allOpen } as const
    assert.equal(notificationTarget(session, 'attendance'), 'TeacherAttendance')
    assert.deepEqual(notificationPress(session, { topic: 'attendance', readAt: null }).route, {
      screen: 'TeacherAttendance',
      params: { tab: 'gecmis' },
    })
  })

  test('DOM-YTK-040 akademik modül kapalıysa ekran açılmaz, ayrıntıya düşer', () => {
    for (const role of ['veli', 'ogretmen'] as const) {
      const press = notificationPress(
        { role, modules: { academic: false }, childIds: ['s-deniz'] },
        { topic: 'attendance', readAt: null, studentId: 's-deniz' },
      )
      assert.equal(press.route, null, role)
      assert.equal(press.screen, null, role)
      assert.equal(press.childId, null, role)
    }
  })

  test('diğer konular sekme parametresi taşımaz', () => {
    const session = { role: 'veli', modules: allOpen } as const
    assert.deepEqual(notificationRoute(notificationTarget(session, 'grade'), 'grade'), {
      screen: 'ParentTracking',
      params: undefined,
    })
    assert.deepEqual(
      notificationRoute(notificationTarget(session, 'announcement'), 'announcement'),
      { screen: 'Announcements' },
    )
    assert.equal(notificationRoute(null, 'attendance'), null)
  })

  test('öğrencinin devamsızlık sayfası telefonda yoktur; bildirim ayrıntıya düşer', () => {
    assert.equal(
      notificationPress(
        { role: 'ogrenci', modules: allOpen },
        { topic: 'attendance', readAt: null },
      ).route,
      null,
    )
  })
})

describe('Ekran bağları (kaynak denetimi)', () => {
  test('bildirim ekranı hedefi sekme parametresiyle açar', () => {
    const screen = source('apps/mobile/src/api/screens/Notifications.tsx')
    assert.match(screen, /navigation\.navigate\(route\.screen, route\.params\)/)
  })

  test('veli ve öğretmen ekranı sekmeyi gezinme parametresinden alır', () => {
    const parent = source('apps/mobile/src/api/screens/ParentTracking.tsx')
    const teacher = source('apps/mobile/src/api/screens/TeacherAttendance.tsx')
    assert.match(parent, /useRouteTab<ParentTab>\(route\.params/)
    assert.match(teacher, /useRouteTab<TeacherAttendanceTab>\(\s*route\.params/)
    assert.match(teacher, /<AttendanceHistory \/>/)
  })

  test('geçmiş salt okunurdur: yazma kancası ve cihaz kalıcılığı yoktur', () => {
    const history = source('apps/mobile/src/api/screens/attendance-history.tsx')
    assert.ok(!/useRecordAttendance|useApiCommand|AsyncStorage/.test(history))
    assert.match(history, /HISTORY_READ_ONLY_NOTICE/)
  })
})
