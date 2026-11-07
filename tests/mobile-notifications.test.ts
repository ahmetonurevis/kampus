import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { bellLabel, unreadBadgeText } from '../packages/react-shared/src/notification-model.ts'
import {
  countUnread,
  displayUnread,
  emptyNotificationsText,
  notificationBellVisible,
  notificationDetail,
  notificationPress,
  notificationRoute,
  notificationRowLabel,
  notificationTarget,
  notificationTopicLabel,
  unreadSummary,
} from '../apps/mobile/src/api/notifications.ts'
import { bindAppStateFocus, isAppFocused } from '../apps/mobile/src/api/app-focus.ts'
import { RESERVED_SCREENS, apiPages } from '../apps/mobile/src/api/pages.ts'
import { SCREEN_REGISTRY } from '../apps/mobile/src/api/screen-registry.ts'

// IST-065, DOM-ILT-020: mobil bildirim merkezi.
const allOpen = {}
const READ = '2026-11-02T10:00:00.000Z'

describe('IST-065 zil görünürlüğü', () => {
  test('yalnız bildirim alan rolde ve iletişim modülü kapalı değilken görünür', () => {
    assert.equal(notificationBellVisible({ role: 'ogrenci', modules: allOpen }), true)
    assert.equal(notificationBellVisible({ role: 'veli', modules: allOpen }), true)
    assert.equal(
      notificationBellVisible({ role: 'veli', modules: { communication: false } }),
      false,
    )
    assert.equal(notificationBellVisible({ role: 'ogretmen', modules: allOpen }), false)
    assert.equal(notificationBellVisible({ role: 'yonetici', modules: allOpen }), false)
  })

  test('rozet ve erişilebilir ad web ile aynı kurallardır', () => {
    assert.equal(unreadBadgeText(0), null)
    assert.equal(unreadBadgeText(7), '7')
    assert.equal(unreadBadgeText(120), '99+')
    assert.equal(bellLabel(3), 'Bildirimler, 3 okunmamış')
    assert.equal(bellLabel(undefined), 'Bildirimler')
  })
})

describe('IST-065 hedef ekran eşleme', () => {
  test('öğrenci konuları telefonda kayıtlı ekrana gider', () => {
    const session = { role: 'ogrenci', modules: allOpen } as const
    assert.equal(notificationTarget(session, 'homework'), 'StudentHomework')
    assert.equal(notificationTarget(session, 'grade'), 'StudentGrades')
    assert.equal(notificationTarget(session, 'message'), 'Messages')
    assert.equal(notificationTarget(session, 'announcement'), 'Announcements')
    // Öğrenci randevusu telefondadır (IST-124): bildirim Etüt Randevusu ekranını açar.
    assert.equal(notificationTarget(session, 'appointment'), 'StudentAppointments')
  })

  test('IST-124 öğrenci randevu bildirimi iletişim modülü kapalıysa ayrıntıya düşer', () => {
    assert.equal(
      notificationTarget({ role: 'ogrenci', modules: { communication: false } }, 'appointment'),
      null,
    )
    assert.deepEqual(notificationRoute('StudentAppointments', 'appointment'), {
      screen: 'StudentAppointments',
    })
  })

  test('veli akademik konuları Akademik Takip, mesaj Mesajlar ekranına gider', () => {
    const session = { role: 'veli', modules: allOpen } as const
    for (const topic of ['homework', 'grade', 'attendance'] as const)
      assert.equal(notificationTarget(session, topic), 'ParentTracking', topic)
    assert.equal(notificationTarget(session, 'message'), 'Messages')
    assert.equal(notificationTarget(session, 'announcement'), 'Announcements')
  })

  test('telefonda karşılığı olmayan konu ve randevu ayrıntıya düşer', () => {
    // Öğrenci Devamsızlık sayfası mobilde kayıtlı değil.
    assert.equal(notificationTarget({ role: 'ogrenci', modules: allOpen }, 'attendance'), null)
    // Veli randevusu telefonda yok; veli mesaj ekranına yönlendirilmez.
    assert.equal(notificationTarget({ role: 'veli', modules: allOpen }, 'appointment'), null)
    // Kayıt, ödeme ve onay konularının sayfası yoktur.
    for (const topic of ['enrollment', 'payment', 'consent', 'bulletin'] as const)
      assert.equal(notificationTarget({ role: 'veli', modules: allOpen }, topic), null, topic)
  })

  test('DOM-YTK-040 hedef modülü kapalıysa ekrana gidilmez', () => {
    assert.equal(
      notificationTarget({ role: 'ogrenci', modules: { learning: false } }, 'homework'),
      null,
    )
    assert.equal(
      notificationTarget({ role: 'veli', modules: { communication: false } }, 'announcement'),
      null,
    )
  })

  test('hedef ekranların hepsi o rolün menü sayfasıdır', () => {
    for (const role of ['ogrenci', 'veli'] as const) {
      const screens = new Set(apiPages({ role, modules: allOpen }).map((page) => page.screen))
      for (const topic of ['homework', 'grade', 'attendance', 'message', 'announcement'] as const) {
        const target = notificationTarget({ role, modules: allOpen }, topic)
        if (target) assert.ok(screens.has(target), `${role}/${topic}`)
      }
    }
  })

  test('okunmamış bildirime dokununca okundu yazılır, okunmuşa yazılmaz', () => {
    const session = { role: 'ogrenci', modules: allOpen } as const
    assert.deepEqual(notificationPress(session, { topic: 'homework', readAt: null }), {
      markRead: true,
      screen: 'StudentHomework',
      route: { screen: 'StudentHomework' },
      childId: null,
    })
    assert.deepEqual(notificationPress(session, { topic: 'attendance', readAt: READ }), {
      markRead: false,
      screen: null,
      route: null,
      childId: null,
    })
  })

  test('veli çocuğa özgü bildirimde hedef ekran o çocuk seçili açılır', () => {
    const session = { role: 'veli', modules: allOpen, childIds: ['s-deniz', 's-ece'] } as const
    const press = (topic: 'grade' | 'announcement', studentId: string) =>
      notificationPress(session, { topic, readAt: null, studentId })
    assert.equal(press('grade', 's-ece').childId, 's-ece')
    assert.equal(press('grade', 's-ece').screen, 'ParentTracking')
    // Çocuğa özgü olmayan konuda ya da hesabın çocuğu değilse seçim değişmez.
    assert.equal(press('announcement', 's-ece').childId, null)
    assert.equal(press('grade', 's-baska').childId, null)
    // Öğrencide çocuk seçimi yoktur.
    assert.equal(
      notificationPress(
        { role: 'ogrenci', modules: allOpen, childIds: ['s-deniz'] },
        { topic: 'homework', readAt: null, studentId: 's-deniz' },
      ).childId,
      null,
    )
  })
})

describe('IST-065 okunmamış sayımı', () => {
  const items = [{ readAt: null }, { readAt: READ }, { readAt: null }]

  test('yüklü listede okunmamışlar sayılır', () => {
    assert.equal(countUnread(items), 2)
    assert.equal(countUnread([]), 0)
  })

  test('sunucu sayısı esastır; yoksa yüklü liste, o da yoksa bilinmez', () => {
    assert.equal(displayUnread(9, items), 9)
    assert.equal(displayUnread(0, items), 0)
    assert.equal(displayUnread(undefined, items), 2)
    assert.equal(displayUnread(undefined, undefined), undefined)
  })

  test('özet metni sayıya göre değişir', () => {
    assert.equal(unreadSummary(3), '3 okunmamış bildirim')
    assert.equal(unreadSummary(0), 'Okunmamış bildirim yok.')
    assert.equal(unreadSummary(undefined), 'Bildirimlerin burada listelenir.')
  })
})

describe('IST-065 metin biçimi', () => {
  test('her konunun Türkçe etiketi vardır', () => {
    assert.equal(notificationTopicLabel('homework'), 'Ödev')
    assert.equal(notificationTopicLabel('attendance'), 'Devamsızlık')
    assert.equal(notificationTopicLabel('enrollment'), 'Kayıt')
  })

  test('satır etiketi okunmamış durumu, konu, başlık, zaman ve sonucu söyler', () => {
    const item = { title: 'Deniz için yeni ödev', topic: 'homework', readAt: null } as const
    assert.equal(
      notificationRowLabel(item, '2 Kas 14:05', true),
      'Okunmamış, Ödev, Deniz için yeni ödev, 2 Kas 14:05, İlgili ekranı açar',
    )
    assert.equal(
      notificationRowLabel({ ...item, readAt: READ }, '2 Kas 14:05', false),
      'Ödev, Deniz için yeni ödev, 2 Kas 14:05, Ayrıntıyı açar',
    )
  })

  test('boş liste metni süzgece göre değişir', () => {
    assert.equal(emptyNotificationsText(true).title, 'Okunmamış bildirim yok')
    assert.equal(emptyNotificationsText(false).title, 'Henüz bildirim yok')
  })
})

describe('IST-065 ayrıntı penceresi', () => {
  test('ayrıntı dokunma anındaki bildirimin anlık görüntüsüdür (okundu listeyi değiştirse de)', () => {
    const now = new Date('2026-11-02T12:00:00Z')
    const item = {
      id: 'n1',
      title: 'Deniz için yeni kayıt bildirimi',
      topic: 'enrollment',
      createdAt: '2026-11-02T11:05:00Z',
    } as const
    const detail = notificationDetail(item, now)
    assert.deepEqual(detail, {
      id: 'n1',
      title: 'Deniz için yeni kayıt bildirimi',
      topicLabel: 'Kayıt',
      time: '14:05',
    })
    // Anlık görüntü kaynak kayıtla paylaşılmaz: listeden düşen kayıt pencereyi etkilemez.
    assert.notEqual(detail, item)
    assert.ok(!('readAt' in detail))
  })

  test('ekran seçili bildirimi nesne olarak tutar; gösterge yalnız kullanıcı çekince döner', () => {
    const screen = readFileSync(
      new URL('../apps/mobile/src/api/screens/Notifications.tsx', import.meta.url),
      'utf8',
    )
    assert.match(screen, /useState<NotificationDetail \| null>/)
    assert.doesNotMatch(screen, /selectedId/)
    assert.match(screen, /refreshing=\{pulling\}/)
    assert.doesNotMatch(screen, /isRefetching/)
  })
})

describe('IST-065 ekran kaydı', () => {
  test('bildirim ekranı menü sayfası değil, ayrılmış yığın ekranıdır', () => {
    assert.ok(RESERVED_SCREENS.includes('ApiNotifications'))
    assert.ok(!SCREEN_REGISTRY.some((entry) => String(entry.screen) === 'ApiNotifications'))
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
      assert.ok(
        !apiPages({ role, modules: allOpen }).some(
          (page) => String(page.screen) === 'ApiNotifications',
        ),
      )
  })

  test('ekran dosyası varsayılan bileşen verir ve cihaza yazmaz', () => {
    const screen = readFileSync(
      new URL('../apps/mobile/src/api/screens/Notifications.tsx', import.meta.url),
      'utf8',
    )
    assert.match(screen, /export default function Notifications/)
    assert.doesNotMatch(screen, /AsyncStorage|SecureStore|persist/i)
  })
})

describe('uygulama odağı (React Query focusManager)', () => {
  test('yalnız active durumu odaktır', () => {
    assert.equal(isAppFocused('active'), true)
    assert.equal(isAppFocused('background'), false)
    assert.equal(isAppFocused('inactive'), false)
  })

  test('AppState değişimi odak olayına çevrilir, temizlikte abonelik kalkar', () => {
    let listener: ((state: string) => void) | undefined
    let removed = 0
    const focused: (boolean | undefined)[] = []
    let cleanup: (() => void) | undefined
    bindAppStateFocus(
      {
        setEventListener: (setup) => {
          cleanup = setup((value) => focused.push(value))
        },
      },
      {
        addEventListener: (_type, handler) => {
          listener = handler
          return { remove: () => removed++ }
        },
      },
    )
    listener?.('background')
    listener?.('active')
    listener?.('inactive')
    assert.deepEqual(focused, [false, true, false])
    cleanup?.()
    assert.equal(removed, 1)
  })
})
