import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { AnnouncementRecord } from '@kampus/react-shared/announcement-model.ts'
import {
  CollectionTooLargeError,
  type CollectionPage,
  type CollectionRow,
} from '@kampus/react-shared/collections.ts'
import {
  gradeTrendPending,
  gradeTrendSummary,
  hasGradeTrend,
  monthlyGradePoints,
} from '../src/pages/dashboard/dashboard-grade-trend-model.ts'
import {
  fetchNewsRows,
  newsExcerpt,
  newsItems,
} from '../src/pages/dashboard/dashboard-news-model.ts'
import { queryErrorMessage } from '../src/components/query-error-message.ts'
import {
  openQuestionsNote,
  type OpenQuestions,
} from '../src/pages/dashboard/dashboard-teacher-model.ts'

// Genel Bakış "Kampüsten haberler", "Yanıt bekleyen sorular" ve not ortalaması eğilimi (OG-226):
// haber seçimi, aylık ortalama kovaları, az veri ve soru sayacı.

const NOW = new Date('2026-10-15T09:00:00.000Z')
const wrap = <T extends { id: string }>(record: T): CollectionRow<T> => ({
  id: record.id,
  version: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  archivedAt: null,
  record,
})

const news = (id: string, extra: Partial<AnnouncementRecord> = {}) =>
  wrap<AnnouncementRecord>({
    id,
    title: `Duyuru ${id}`,
    text: 'Metin',
    date: '2026-10-10T09:00:00.000Z',
    category: 'Etkinlik',
    ...extra,
  })

test('haber: gelen sırayla ilk üç duyuru seçilir, sunucu sırası değiştirilmez', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id) => news(id))
  assert.deepEqual(
    newsItems(rows).map((row) => row.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(
    newsItems(rows, 5).map((row) => row.id),
    ['a', 'b', 'c', 'd', 'e'],
  )
})

test('haber: geri çekilen duyuru atlanır ve yerine sıradaki girer (DOM-ILT-004)', () => {
  const rows = [
    news('a', { withdrawnAt: '2026-10-11T09:00:00.000Z' }),
    news('b'),
    news('c'),
    news('d'),
  ]
  assert.deepEqual(
    newsItems(rows).map((row) => row.id),
    ['b', 'c', 'd'],
  )
})

test('haber: duyuru yoksa liste boştur', () => {
  assert.deepEqual(newsItems([]), [])
  assert.deepEqual(newsItems([news('a', { withdrawnAt: '2026-10-11T09:00:00.000Z' })]), [])
})

test('haber: özet kelime ortasında kesilmez, kısa metin olduğu gibi kalır', () => {
  assert.equal(newsExcerpt('  Kısa   metin  '), 'Kısa metin')
  const text =
    'Cuma günü müze gezisi var; öğrenciler formalarıyla gelsin ve yanlarında su getirsin.'
  const cut = newsExcerpt(text, 40)
  assert.ok(cut.endsWith('…'))
  assert.ok(text.startsWith(cut.slice(0, -1)))
  assert.ok(cut.length <= 41)
  assert.ok(!cut.slice(0, -1).endsWith(' '))
})

test('eğilim: aylar kovalanır, ortalama toplam/sayıdan yuvarlanır, eskiden yeniye sıralanır', () => {
  const points = monthlyGradePoints([
    { value: '2026-10', count: 13, sum: 874 },
    { value: '2026-05', count: 10, sum: 540 },
    { value: '2026-09', count: 10, sum: 620 },
  ])
  assert.deepEqual(
    points.map((point) => point.value),
    [54, 62, 67],
  )
  assert.equal(points.length, 3)
  assert.match(points[0]?.label ?? '', /May/)
  assert.match(points[2]?.label ?? '', /Eki/)
})

test('eğilim: tarihsiz grup, geçersiz ay ve notsuz ay serisine girmez', () => {
  const points = monthlyGradePoints([
    { value: null, count: 4, sum: 200 },
    { value: '2026-13', count: 1, sum: 10 },
    { value: 'bilinmiyor', count: 1, sum: 10 },
    { value: '2026-08', count: 0, sum: 0 },
    { value: '2026-09', count: 2, sum: 101 },
  ])
  assert.deepEqual(
    points.map((point) => point.value),
    [51],
  )
})

test('eğilim: yalnız son altı ay gösterilir', () => {
  const groups = Array.from({ length: 9 }, (_, index) => ({
    value: `2026-${String(index + 1).padStart(2, '0')}`,
    count: 1,
    sum: 40 + index,
  }))
  const points = monthlyGradePoints(groups)
  assert.equal(points.length, 6)
  assert.deepEqual(
    points.map((point) => point.value),
    [43, 44, 45, 46, 47, 48],
  )
})

test('eğilim: iki aydan az veride grafik çizilmez', () => {
  assert.equal(hasGradeTrend([]), false)
  assert.equal(hasGradeTrend([{ label: 'Eki 26', value: 70 }]), false)
  assert.equal(
    hasGradeTrend([
      { label: 'Eyl 26', value: 60 },
      { label: 'Eki 26', value: 70 },
    ]),
    true,
  )
  assert.equal(gradeTrendSummary([], 'Not ortalaması'), '')
})

test('eğilim: metin özeti ilk, son, değişim ve en yüksek ayı söyler', () => {
  const text = gradeTrendSummary(
    [
      { label: 'May 26', value: 54 },
      { label: 'Haz 26', value: 80 },
      { label: 'Eki 26', value: 67 },
    ],
    'Not ortalaması',
  )
  assert.equal(
    text,
    'Not ortalaması May 26 ayında 54, Eki 26 ayında 67 (13 puan arttı). En yüksek ay: Haz 26 (80).',
  )
  assert.match(
    gradeTrendSummary(
      [
        { label: 'Eyl 26', value: 70 },
        { label: 'Eki 26', value: 60 },
      ],
      'X',
    ),
    /10 puan azaldı/,
  )
  assert.match(
    gradeTrendSummary(
      [
        { label: 'Eyl 26', value: 70 },
        { label: 'Eki 26', value: 70 },
      ],
      'X',
    ),
    /değişmedi/,
  )
})

test('soru sayacı: not sunucunun süre aşımı sayısını söyler, sıfırda sakin metin (DOM-ILT-013)', () => {
  const items: OpenQuestions['items'] = []
  assert.equal(openQuestionsNote({ total: 4, overdue: 2, items }), '2 sorunun yanıt süresi aşıldı')
  assert.equal(openQuestionsNote({ total: 4, overdue: 0, items }), 'Yanıt süresi aşılan soru yok')
  assert.equal(openQuestionsNote(null), 'Yanıt süresi aşılan soru yok')
})

test('IST-116: soru kartları özetin questions bölümünü okur, soru kayıtlarını çekmez', () => {
  const source = readFileSync(
    new URL('../src/pages/dashboard/TeacherQuestionCards.tsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /useCoreAll|TODO\(api-question-status-filter\)/)
  assert.equal(source.match(/section: \(data\) => data\.questions/g)?.length, 2)
  assert.match(source, /module: 'learning'/)
})

test('eğilim: önceki çocuğun sayımı (placeholder) yeni çocuğun başlığı altında gösterilmez', () => {
  const ready = { isPending: false }
  // Çocuk değişti, yeni sayım gelmedi: sorgu önceki sayımı yer tutucu olarak veriyor.
  assert.equal(gradeTrendPending(ready, { isPending: false, isPlaceholderData: true }), true)
  assert.equal(gradeTrendPending(ready, { isPending: true, isPlaceholderData: false }), true)
  assert.equal(
    gradeTrendPending({ isPending: true }, { isPending: false, isPlaceholderData: false }),
    true,
  )
  assert.equal(gradeTrendPending(ready, { isPending: false, isPlaceholderData: false }), false)
})

/** Sayfalı sahte uç: `rows` sırayla `pageSize`'lık sayfalara bölünür, çağrılan sayfalar kaydedilir. */
function pager(rows: CollectionRow<AnnouncementRecord>[], pageSize = 2) {
  const calls: number[] = []
  const fetchPage = async (page: number): Promise<CollectionPage<AnnouncementRecord>> => {
    calls.push(page)
    return {
      rows: rows.slice((page - 1) * pageSize, page * pageSize),
      page,
      pageSize,
      total: rows.length,
    }
  }
  return { calls, fetchPage }
}

const withdrawn = (id: string) => news(id, { withdrawnAt: '2026-10-11T09:00:00.000Z' })

test('haber: ilk sayfa tamamen geri çekilmişse daha eski yayındaki duyuru için sonraki sayfa okunur', async () => {
  const rows = [
    withdrawn('g1'),
    withdrawn('g2'),
    withdrawn('g3'),
    withdrawn('g4'),
    news('y1'),
    news('y2'),
  ]
  const { calls, fetchPage } = pager(rows)
  const items = newsItems(await fetchNewsRows(fetchPage))
  assert.deepEqual(
    items.map((row) => row.id),
    ['y1', 'y2'],
  )
  assert.deepEqual(calls, [1, 2, 3])
})

test('haber: yeterli yayında duyuru bulununca sayfa okuması durur', async () => {
  const { calls, fetchPage } = pager(['a', 'b', 'c', 'd', 'e', 'f'].map((id) => news(id)))
  const items = newsItems(await fetchNewsRows(fetchPage))
  assert.deepEqual(
    items.map((row) => row.id),
    ['a', 'b', 'c'],
  )
  assert.deepEqual(calls, [1, 2])
})

test('haber: kayıt bitince durur ve hiç yayında duyuru yoksa liste boş döner', async () => {
  const { calls, fetchPage } = pager([withdrawn('g1'), withdrawn('g2'), withdrawn('g3')])
  assert.deepEqual(newsItems(await fetchNewsRows(fetchPage)), [])
  assert.deepEqual(calls, [1, 2])
})

test('haber: sayfa üst sınırında durur, hata vermez ve bulunanı döner', async () => {
  const rows = [...Array.from({ length: 8 }, (_, i) => withdrawn(`g${i}`)), news('y1')]
  const { calls, fetchPage } = pager(rows)
  const items = newsItems(await fetchNewsRows(fetchPage, 3, 3))
  assert.deepEqual(items, [])
  assert.deepEqual(calls, [1, 2, 3])
})

test('haber: boş sayfa gelirse (okuma sırasında silinme) sonsuz döngüye girmez', async () => {
  const calls: number[] = []
  const rows = await fetchNewsRows(async (page) => {
    calls.push(page)
    return { rows: [], page, pageSize: 2, total: 10 }
  })
  assert.deepEqual(rows, [])
  assert.deepEqual(calls, [1])
})

test('soru kartı: liste sayfa sınırını aşınca sakin ve doğru yönlendiren bir metin gösterilir', () => {
  const message = queryErrorMessage(new CollectionTooLargeError())
  assert.match(message, /çok fazla/)
  assert.match(message, /Tam listeyi sayfasından açın/)
  assert.doesNotMatch(message, /yeniden deneyin/i)
  // Bilinmeyen teknik hata yine genel metindedir; teknik ayrıntı sızmaz.
  assert.equal(
    queryErrorMessage(new Error('ECONNRESET')),
    'Kayıtlar yüklenemedi. Lütfen yeniden deneyin.',
  )
})
