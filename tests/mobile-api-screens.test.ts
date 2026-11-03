import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { apiCategories, apiPages, canOpenScreen } from '../apps/mobile/src/api/pages.ts'
import {
  clampPageIndex,
  withFilter,
  withSearch,
  API_PAGE_SIZE,
  EMPTY_LIST_STATE,
} from '../apps/mobile/src/api/list-state.ts'
import {
  classSubtitle,
  fileSummary,
  gradeSummary,
  gradeView,
  homeworkView,
  matchesSearch,
} from '../apps/mobile/src/api/presentation.ts'

const open = { academic: true }
const closed = { academic: false }

describe('API modu sayfaları', () => {
  test('öğretmen Sınıflarım, veli Akademik Takip ekranını görür', () => {
    assert.deepEqual(
      apiPages({ role: 'ogretmen', modules: open }).map((page) => [page.title, page.screen]),
      [
        ['Sınıflarım', 'TeacherClasses'],
        ['Duyurular', 'Announcements'],
        ['Mesajlar', 'Messages'],
      ],
    )
    assert.deepEqual(
      apiPages({ role: 'veli', modules: open }).map((page) => [page.title, page.screen]),
      [
        ['Akademik Takip', 'ParentGrades'],
        ['Mesajlar', 'Messages'],
        ['Duyurular', 'Announcements'],
      ],
    )
  })

  test('duyurular beş rolde de vardır; yönetici ve ön büroda yalnız bu sayfa', () => {
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const)
      assert.ok(
        apiPages({ role, modules: open }).some((page) => page.screen === 'Announcements'),
        role,
      )
    assert.deepEqual(
      apiPages({ role: 'yonetici', modules: open }).map((page) => page.screen),
      ['Announcements'],
    )
  })

  test('mesaj ekranı yalnız öğretmen, öğrenci ve veli menüsündedir', () => {
    for (const role of ['ogretmen', 'ogrenci', 'veli'] as const)
      assert.ok(
        apiPages({ role, modules: open }).some((page) => page.screen === 'Messages'),
        role,
      )
    for (const role of ['yonetici', 'onburo'] as const) {
      assert.ok(!apiPages({ role, modules: open }).some((page) => page.screen === 'Messages'), role)
      assert.equal(canOpenScreen({ role, modules: open }, 'Messages'), false)
    }
  })

  test('iletişim modülü kapanınca duyuru sayfası ve kategorisi gizlenir', () => {
    const modules = { academic: true, communication: false }
    assert.deepEqual(
      apiPages({ role: 'ogrenci', modules }).map((page) => page.screen),
      ['StudentHomework', 'StudentGrades'],
    )
    assert.equal(canOpenScreen({ role: 'ogrenci', modules }, 'Announcements'), false)
    assert.equal(canOpenScreen({ role: 'ogrenci', modules }, 'Messages'), false)
    assert.equal(canOpenScreen({ role: 'veli', modules }, 'Messages'), false)
    assert.deepEqual(apiCategories(apiPages({ role: 'yonetici', modules })), [])
    assert.deepEqual(apiCategories(apiPages({ role: 'yonetici', modules: open })), [
      { key: 'İLETİŞİM', label: 'İletişim', icon: 'MessagesSquare', count: 1 },
    ])
  })

  test('modül kapanınca menü ve doğrudan erişim kapanır', () => {
    assert.deepEqual(
      apiPages({ role: 'ogretmen', modules: closed }).map((page) => page.screen),
      ['Announcements', 'Messages'],
    )
    assert.equal(canOpenScreen({ role: 'ogretmen', modules: open }, 'TeacherClasses'), true)
    assert.equal(canOpenScreen({ role: 'ogretmen', modules: closed }, 'TeacherClasses'), false)
    // Başka rolün ekranı açılmaz.
    assert.equal(canOpenScreen({ role: 'ogretmen', modules: open }, 'ParentGrades'), false)
  })

  test('IST-124 öğrenci Ödevlerim ve Notlarım ekranlarını menü sırasıyla görür', () => {
    assert.deepEqual(
      apiPages({ role: 'ogrenci', modules: open }).map((page) => [page.title, page.screen]),
      [
        ['Ödevlerim', 'StudentHomework'],
        ['Notlarım', 'StudentGrades'],
        ['Mesajlar', 'Messages'],
        ['Duyurular', 'Announcements'],
      ],
    )
    assert.deepEqual(apiCategories(apiPages({ role: 'ogrenci', modules: open })), [
      { key: 'DERSLERİM', label: 'Derslerim', icon: 'School', count: 1 },
      { key: 'GELİŞİMİM', label: 'Gelişimim', icon: 'Award', count: 1 },
      { key: 'İLETİŞİM', label: 'İletişim', icon: 'MessagesSquare', count: 2 },
    ])
    // Telefonda ödeme sayfası yoktur; ödevin açıklaması teslimi vaat etmez.
    const pages = apiPages({ role: 'ogrenci', modules: open })
    assert.ok(!pages.some((page) => page.path === 'odemelerim'))
    assert.doesNotMatch(
      pages.find((page) => page.path === 'odevler')?.description ?? '',
      /teslim et/,
    )
  })

  test('IST-124 öğrenme veya akademik modül kapanınca öğrenci ekranı ve kategorisi kapanır', () => {
    const noLearning = { learning: false }
    assert.equal(canOpenScreen({ role: 'ogrenci', modules: noLearning }, 'StudentHomework'), false)
    assert.equal(canOpenScreen({ role: 'ogrenci', modules: noLearning }, 'StudentGrades'), true)
    assert.ok(
      !apiCategories(apiPages({ role: 'ogrenci', modules: noLearning })).some(
        (category) => category.key === 'DERSLERİM',
      ),
    )
    assert.equal(canOpenScreen({ role: 'ogrenci', modules: closed }, 'StudentGrades'), false)
    assert.equal(canOpenScreen({ role: 'ogrenci', modules: closed }, 'StudentHomework'), true)
    // Başka rolün öğrenci ekranı açılmaz.
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'veli'] as const) {
      assert.equal(canOpenScreen({ role, modules: open }, 'StudentGrades'), false, role)
      assert.equal(canOpenScreen({ role, modules: open }, 'StudentHomework'), false, role)
    }
  })

  test('kategori kartları yalnız açık sayfası olan kategorilerdir', () => {
    assert.deepEqual(apiCategories(apiPages({ role: 'veli', modules: open })), [
      { key: 'AKADEMİK', label: 'Akademik', icon: 'GraduationCap', count: 1 },
      { key: 'İLETİŞİM', label: 'İletişim', icon: 'MessagesSquare', count: 2 },
    ])
    assert.deepEqual(apiCategories([]), [])
  })
})

describe('liste durumu', () => {
  test('arama değişince sayfa başa döner, aynı aramada korunur', () => {
    const state = { search: 'a', index: 3, filter: 'math' }
    assert.deepEqual(withSearch(state, 'ab'), { search: 'ab', index: 0, filter: 'math' })
    assert.equal(withSearch(state, 'a'), state)
  })

  test('süzgeç değişince sayfa başa döner, arama korunur', () => {
    const state = { search: 'a', index: 3, filter: '' }
    assert.deepEqual(withFilter(state, 'math'), { search: 'a', index: 0, filter: 'math' })
    assert.equal(withFilter(state, ''), state)
    assert.deepEqual(EMPTY_LIST_STATE, { search: '', index: 0, filter: '' })
  })

  test('veri azalınca geçersiz sayfada kalınmaz', () => {
    assert.equal(API_PAGE_SIZE, 10)
    assert.equal(clampPageIndex(4, 25), 2)
    assert.equal(clampPageIndex(2, 0), 0)
    assert.equal(clampPageIndex(1, 25), 1)
    assert.equal(clampPageIndex(-1, 25), 0)
  })

  test('toplam bilinmiyorken (yükleniyor) sayfa korunur', () => {
    assert.equal(clampPageIndex(4, undefined), 4)
  })
})

describe('satır metinleri', () => {
  test('sınıf alt başlığı eksik parçaları atlar', () => {
    assert.equal(
      classSubtitle({ level: '9. sınıf', room: '204' }, 'Merkez'),
      'Merkez · 9. sınıf · Derslik 204',
    )
    assert.equal(classSubtitle({ level: '9. sınıf' }, undefined), '9. sınıf')
  })

  test('not görünümü puan ve başarı durumunu verir', () => {
    const passed = gradeView({
      title: 'Deneme 1',
      score: 70,
      date: '2026-10-12',
      topic: 'Kesirler',
    })
    assert.equal(passed.title, 'Deneme 1')
    assert.equal(passed.score, '70 / 100')
    assert.equal(passed.status, 'Başarılı')
    assert.match(passed.subtitle, /Kesirler$/)
    assert.equal(gradeView({ score: 69 }).status, 'Tekrar önerilir')
  })

  test('puansız not boş durumla, başlıksız not ders adıyla görünür', () => {
    assert.deepEqual(gradeView({ subject: 'Matematik' }), {
      title: 'Matematik',
      subtitle: '',
      score: '—',
      status: '',
    })
    assert.equal(gradeView({}).title, 'Değerlendirme')
  })
})

describe('öğrenci notları ve ödevleri (IST-124)', () => {
  const grade = (subjectId: string, subject: string, score?: number) => ({
    subjectId,
    subject,
    ...(score === undefined ? {} : { score }),
  })

  test('DOM-AKD-003 genel ortalama bütün notlardan, ders ortalaması core ile hesaplanır', () => {
    const summary = gradeSummary([
      grade('math', 'Matematik', 90),
      grade('math', 'Matematik', 61),
      grade('tr', 'Türkçe', 70),
      // Puanı kapsamca gizlenmiş kayıt hesaba girmez.
      grade('tr', 'Türkçe'),
    ])
    // (90 + 61 + 70) / 3 = 73,67 → 74; ders ortalamalarının ortalaması (75,5 + 70) / 2 değil.
    assert.equal(summary.overall, '74 / 100')
    assert.equal(summary.count, 3)
    assert.deepEqual(summary.subjects, [
      { subjectId: 'math', name: 'Matematik', average: '76 / 100', count: 2 },
      { subjectId: 'tr', name: 'Türkçe', average: '70 / 100', count: 1 },
    ])
  })

  test('notsuz öğrencide özet boştur', () => {
    assert.deepEqual(gradeSummary([]), { overall: '—', count: 0, subjects: [] })
  })

  test('DOM-AKD-072 ödev durumu teslim kaydından ve son tarihten hesaplanır', () => {
    const now = new Date('2026-10-10T09:00:00.000Z')
    const homework = (id: string, dueDate: string) => ({
      id,
      title: `Ödev ${id}`,
      subject: 'Matematik',
      dueDate,
    })
    const submissions = [
      { homeworkId: 'h1', studentId: 's1', score: 85 },
      { homeworkId: 'h2', studentId: 's1', score: null, late: true },
      // Başka öğrencinin teslimi bu öğrencinin durumunu değiştirmez.
      { homeworkId: 'h3', studentId: 's2', score: 40 },
    ]
    const graded = homeworkView(homework('h1', '2026-10-01T09:00:00.000Z'), submissions, 's1', now)
    assert.equal(graded.status, 'Değerlendirildi')
    assert.equal(graded.score, '85 / 100')
    assert.match(graded.subtitle, /^Matematik · Son teslim /)
    const late = homeworkView(homework('h2', '2026-10-01T09:00:00.000Z'), submissions, 's1', now)
    assert.equal(late.status, 'Teslim edildi')
    assert.equal(late.late, true)
    assert.equal(late.score, null)
    assert.equal(
      homeworkView(homework('h3', '2026-10-01T09:00:00.000Z'), submissions, 's1', now).status,
      'Gecikmiş',
    )
    assert.equal(
      homeworkView(homework('h4', '2026-10-20T09:00:00.000Z'), submissions, 's1', now).status,
      'Bekliyor',
    )
  })

  test('ödev araması Türkçe harf duyarsızdır; boş arama hepsini getirir', () => {
    assert.equal(matchesSearch(['İngilizce okuma'], 'ingilizce'), true)
    assert.equal(matchesSearch(['Matematik'], 'ışık'), false)
    assert.equal(matchesSearch(['Matematik'], '  '), true)
  })

  test('teslim dosyası özeti tek dosyada adı, çoklu dosyada sayıyı verir', () => {
    assert.equal(fileSummary(undefined), '—')
    assert.equal(fileSummary({ fileIds: [], fileName: '' }), '—')
    assert.equal(fileSummary({ fileIds: ['f1'], fileName: 'deniz.pdf' }), 'deniz.pdf')
    assert.equal(fileSummary({ fileIds: ['f1'], fileName: '' }), '1 dosya')
    assert.equal(fileSummary({ fileIds: ['f1', 'f2'], fileName: 'a.pdf' }), '2 dosya')
  })
})
