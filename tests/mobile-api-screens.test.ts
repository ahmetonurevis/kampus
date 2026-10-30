import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { apiCategories, apiPages, canOpenScreen } from '../apps/mobile/src/api/pages.ts'
import { clampPageIndex, withSearch, API_PAGE_SIZE } from '../apps/mobile/src/api/list-state.ts'
import { classSubtitle, gradeView } from '../apps/mobile/src/api/presentation.ts'

const open = { academic: true }
const closed = { academic: false }

describe('API modu sayfaları', () => {
  test('öğretmen Sınıflarım, veli Akademik Takip ekranını görür', () => {
    assert.deepEqual(
      apiPages({ role: 'ogretmen', modules: open }).map((page) => [page.title, page.screen]),
      [['Sınıflarım', 'TeacherClasses']],
    )
    assert.deepEqual(
      apiPages({ role: 'veli', modules: open }).map((page) => [page.title, page.screen]),
      [['Akademik Takip', 'ParentGrades']],
    )
  })

  test('taşınmamış rolde sayfa yoktur', () => {
    assert.deepEqual(apiPages({ role: 'yonetici', modules: open }), [])
    assert.deepEqual(apiPages({ role: 'ogrenci', modules: open }), [])
  })

  test('modül kapanınca menü ve doğrudan erişim kapanır', () => {
    assert.deepEqual(apiPages({ role: 'ogretmen', modules: closed }), [])
    assert.equal(canOpenScreen({ role: 'ogretmen', modules: open }, 'TeacherClasses'), true)
    assert.equal(canOpenScreen({ role: 'ogretmen', modules: closed }, 'TeacherClasses'), false)
    // Başka rolün ekranı açılmaz.
    assert.equal(canOpenScreen({ role: 'ogretmen', modules: open }, 'ParentGrades'), false)
  })

  test('kategori kartları yalnız açık sayfası olan kategorilerdir', () => {
    assert.deepEqual(apiCategories(apiPages({ role: 'veli', modules: open })), [
      { key: 'AKADEMİK', label: 'Akademik', icon: 'GraduationCap', count: 1 },
    ])
    assert.deepEqual(apiCategories([]), [])
  })
})

describe('liste durumu', () => {
  test('arama değişince sayfa başa döner, aynı aramada korunur', () => {
    const state = { search: 'a', index: 3 }
    assert.deepEqual(withSearch(state, 'ab'), { search: 'ab', index: 0 })
    assert.equal(withSearch(state, 'a'), state)
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
