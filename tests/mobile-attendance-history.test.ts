import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_HISTORY_FILTER,
  changeHistoryFilter,
  clearHistoryFilters,
  countsFromGroups,
  decodeHistoryFilter,
  emptyHistoryText,
  encodeHistoryFilter,
  historyDay,
  historyQueryFilters,
  historyRangeFilters,
  historyRangeText,
  historyRanges,
  historyRowView,
  presentedHistoryRanges,
  resolveHistoryClass,
  resolveHistoryRange,
} from '../apps/mobile/src/api/attendance-history.ts'
import { EMPTY_LIST_STATE, withFilter, withSearch } from '../apps/mobile/src/api/list-state.ts'
import {
  initialRouteTab,
  shouldConsumeRouteTab,
  syncRouteTab,
} from '../apps/mobile/src/api/route-tab.ts'
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

  test('gün ve dönem sunucudan gelir: bilinmeden hiçbir aralık kurulmaz', () => {
    for (const range of ['week', 'last30', 'term'] as const) {
      assert.deepEqual(resolveHistoryRange(range, 'loading', null), { range, wait: 'loading' })
      assert.deepEqual(resolveHistoryRange(range, 'error', null), { range, wait: 'error' })
    }
    assert.deepEqual(resolveHistoryRange('term', 'ready', TERM), { range: 'term', wait: null })
    assert.deepEqual(resolveHistoryRange('term', 'ready', null), { range: 'week', wait: null })
    assert.deepEqual(resolveHistoryRange('last30', 'ready', null), { range: 'last30', wait: null })
    assert.deepEqual(presentedHistoryRanges('loading', null), ['week', 'last30', 'term'])
    assert.deepEqual(presentedHistoryRanges('ready', null), ['week', 'last30'])
  })

  test('bugün sunucunun gününden alınır; cihaz saati geri kalsa da başlangıç bitişi aşmaz', () => {
    // Sunucu günü 2026-11-04, cihaz saati bir gün geri (2026-11-03): aralık sunucu gününe göre kurulur.
    const fetchedAt = Date.parse('2026-11-03T10:00:00Z')
    const day = historyDay('2026-11-04', fetchedAt, new Date('2026-11-03T10:05:00Z'))
    assert.deepEqual(day, { today: '2026-11-04', stale: false })
    for (const range of ['week', 'last30', 'term'] as const) {
      const { dateFrom, dateTo } = historyRangeFilters(range, day.today!, TERM)
      assert.ok(dateFrom <= dateTo, range)
      assert.equal(dateTo, '2026-11-04')
    }
    // Dönem bilgisi bayatsa (başlangıç bugünden sonra) başlangıç bitişe çekilir, 400 oluşmaz.
    const stale = historyRangeFilters('term', '2026-09-01', TERM)
    assert.deepEqual(stale, { dateFrom: '2026-09-01', dateTo: '2026-09-01' })
  })

  test('gece yarısı geçince (cihaz günü değişince) gün yeniden istenir', () => {
    const fetchedAt = Date.parse('2026-11-03T20:30:00Z') // İstanbul 23:30
    assert.equal(historyDay('2026-11-03', fetchedAt, new Date('2026-11-03T20:59:00Z')).stale, false)
    assert.equal(historyDay('2026-11-03', fetchedAt, new Date('2026-11-03T21:01:00Z')).stale, true)
    // Yanıt yokken gün yoktur, istek de atılmaz.
    assert.deepEqual(historyDay(undefined, undefined), { today: null, stale: false })
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

describe("DOM-AKD-036 süzgeç durumu (ekran reducer'ları)", () => {
  const state = {
    search: 'ali',
    index: 4,
    filter: encodeHistoryFilter({ range: 'last30', classId: 'c-9a', status: 'absent' }),
  }

  test('sınıf, durum ya da aralık değişince sayfa başa döner, arama ve diğer alanlar korunur', () => {
    for (const patch of [{ classId: 'c-9b' }, { status: 'late' }, { range: 'week' }] as const) {
      const next = changeHistoryFilter(state, patch)
      assert.equal(next.index, 0, JSON.stringify(patch))
      assert.equal(next.search, 'ali')
    }
    const next = changeHistoryFilter(state, { classId: 'c-9b' })
    assert.deepEqual(decodeHistoryFilter(next.filter), {
      range: 'last30',
      classId: 'c-9b',
      status: 'absent',
    })
    // Değişmeyen süzgeçte sayfa korunur.
    assert.equal(changeHistoryFilter(state, { classId: 'c-9a' }).index, 4)
  })

  test('süzgeci temizle sınıf, durum ve aramayı sıfırlar; tarih aralığı korunur', () => {
    const cleared = clearHistoryFilters(state)
    assert.deepEqual(decodeHistoryFilter(cleared.filter), {
      range: 'last30',
      classId: '',
      status: '',
    })
    assert.equal(cleared.search, '')
    assert.equal(cleared.index, 0)
    // Süzgeçsiz varsayılan durum zaten temizdir.
    assert.deepEqual(clearHistoryFilters(EMPTY_LIST_STATE).search, '')
  })
})

describe('Sekme parametresi (route-tab)', () => {
  test('parametresiz açılışta varsayılan, parametreyle istenen sekme açılır', () => {
    assert.equal(initialRouteTab<'a' | 'b'>(undefined, 'a').tab, 'a')
    assert.equal(initialRouteTab<'a' | 'b'>({ tab: 'b' }, 'a').tab, 'b')
  })

  test('aynı parametre nesnesinde kullanıcının sonradan seçtiği sekme korunur', () => {
    const params = { tab: 'b' } as const
    const state = { ...initialRouteTab<'a' | 'b' | 'c'>(params, 'a'), tab: 'c' as const }
    assert.equal(syncRouteTab(state, params), state)
  })

  test('yeni parametre nesnesi (aynı sekme olsa da) sekmeyi açar', () => {
    const state = { ...initialRouteTab<'a' | 'b'>({ tab: 'b' }, 'a'), tab: 'a' as const }
    const next = syncRouteTab(state, { tab: 'b' })
    assert.equal(next.tab, 'b')
  })

  test('parametresiz gezinme (menü kartı) ve tüketilmiş parametre sekmeye dokunmaz', () => {
    const state = { ...initialRouteTab<'a' | 'b'>({ tab: 'b' }, 'a'), tab: 'b' as const }
    assert.equal(syncRouteTab(state, undefined).tab, 'b')
    assert.equal(syncRouteTab(state, { tab: undefined }).tab, 'b')
  })

  test('parametre bir kez tüketilir: yalnız sekme taşıyan parametre temizlenir', () => {
    assert.equal(shouldConsumeRouteTab({ tab: 'devamsizlik' }), true)
    assert.equal(shouldConsumeRouteTab({ tab: undefined }), false)
    assert.equal(shouldConsumeRouteTab(undefined), false)
    // Ekran yeniden kurulunca ("Yeniden dene") tüketilmiş parametreyle varsayılana düşer.
    assert.equal(
      initialRouteTab<'notlar' | 'devamsizlik'>({ tab: undefined }, 'notlar').tab,
      'notlar',
    )
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
    assert.match(parent, /useRouteTab<ParentTab>\(\s*route\.params/)
    assert.match(teacher, /useRouteTab<TeacherAttendanceTab>\(\s*route\.params/)
    // Parametre tüketilir (ekran yeniden kurulunca bildirim sekmesine dönülmez).
    for (const screen of [parent, teacher])
      assert.match(screen, /navigation\.setParams\(\{ tab: undefined \}\)/)
    assert.match(teacher, /<AttendanceHistory \/>/)
  })

  test('geçmiş salt okunurdur: yazma kancası ve cihaz kalıcılığı yoktur', () => {
    const history = source('apps/mobile/src/api/screens/attendance-history.tsx')
    assert.ok(!/useRecordAttendance|useApiCommand|AsyncStorage/.test(history))
    assert.match(history, /HISTORY_READ_ONLY_NOTICE/)
  })

  test('geçmiş günü sunucudan alır, cihaz saatinden istek kurmaz; durum kartları düğmedir', () => {
    const history = source('apps/mobile/src/api/screens/attendance-history.tsx')
    assert.ok(!/dayKey\(/.test(history))
    assert.match(history, /historyDay\(period\.data\?\.data\.date/)
    assert.ok(!/accessibilityRole="radio"[\s\S]{0,120}selected \? ''/.test(history))
    assert.match(
      history,
      /accessibilityRole="button"[\s\S]{0,200}accessibilityState=\{\{ selected \}\}/,
    )
    assert.match(history, /clearHistoryFilters\(state\)/)
  })
})
