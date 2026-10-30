import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { collectionQueryFromList, sortableColumns } from '../src/lib/collection-list.ts'
import { initialListState } from '../src/lib/list-state.ts'
import {
  ABSENCE_LIST,
  absenceCsvRow,
  absenceRow,
  dateRange,
  REQUEST_LIST,
  requestCsvRow,
  requestRow,
} from '../src/pages/requests/request-rows.ts'

const NOW = new Date('2026-10-15T09:00:00.000Z')

const wrap = <T extends { id: string }>(record: T, joined?: { studentName?: string }) => ({
  id: record.id,
  version: 1,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  archivedAt: null,
  record,
  ...(joined ? { joined } : {}),
})

test('requestRow: talep kaydı satıra döner, öğrenci adı bağlı alandan gelir (DOM-ILT-053 kapsamı sunucuda)', () => {
  const [first] = createSeed(NOW).requests
  assert.ok(first)
  const row = requestRow(wrap(first, { studentName: 'Deniz Yılmaz' }))
  assert.equal(row.id, first.id)
  assert.equal(row.student, 'Deniz Yılmaz')
  assert.equal(row.title, first.title)
  assert.equal(row.status, first.status)
  assert.equal(row.assignedTo, first.assignedTo)
  assert.equal(requestRow(wrap(first)).student, '')
})

test('requestCsvRow: tarih ekrandaki Türkçe metindir', () => {
  const [first] = createSeed(NOW).requests
  assert.ok(first)
  const csv = requestCsvRow(requestRow(wrap({ ...first, date: '2026-10-13T09:00:00.000Z' })))
  assert.equal(csv.date, '13 Eki 2026')
})

test('liste yapılandırması: yalnız sunucunun bildiği alanlar sıralanır ve süzülür', () => {
  assert.deepEqual(sortableColumns(REQUEST_LIST).sort(), ['date', 'status', 'student', 'title'])
  const state = { ...initialListState(8), filters: { status: 'Yeni', category: 'Şikayet' } }
  const query = collectionQueryFromList(state, REQUEST_LIST, '')
  assert.deepEqual(query.filters, { status: 'Yeni', category: 'Şikayet' })
  assert.deepEqual(query.sort, ['-date'])
  assert.deepEqual(sortableColumns(ABSENCE_LIST).sort(), ['sentAt', 'status'])
})

test('dateRange: tek günlük bildirim tek tarih yazar', () => {
  assert.equal(dateRange('2026-11-02', '2026-11-02'), '2 Kas 2026')
  assert.equal(dateRange('2026-11-02', '2026-11-04'), '2 Kas 2026 – 4 Kas 2026')
})

test('absenceRow: durumu olmayan telefon bildirimi "İletildi" sayılır, gönderim zamanı createdAt', () => {
  const base = {
    id: 'a1',
    studentId: 's1',
    startDate: '2026-11-02',
    endDate: '2026-11-03',
    category: 'Sağlık',
    reason: 'Doktor kontrolü',
  }
  const phone = absenceRow(wrap({ ...base, createdAt: '2026-10-14T08:00:00.000Z' }))
  assert.equal(phone.status, 'İletildi')
  assert.equal(phone.sentAt, '2026-10-14T08:00:00.000Z')
  const web = absenceRow(
    wrap(
      { ...base, status: 'Onaylandı', date: '2026-10-13T08:00:00.000Z' },
      { studentName: 'Deniz' },
    ),
  )
  assert.equal(web.status, 'Onaylandı')
  assert.equal(web.sentAt, '2026-10-13T08:00:00.000Z')
  assert.equal(web.student, 'Deniz')
  assert.equal(absenceCsvRow(web).sentAt, '13 Eki 2026')
})

test('DOM-ILT-053: absenceRow gerekçe kategorisinin etiketini gösterir; eski kayıt kendi metnini', () => {
  const notice = absenceRow(
    wrap({
      id: 'a2',
      studentId: 's1',
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      reasonCategory: 'health' as const,
      category: 'Sağlık nedeniyle',
    }),
  )
  assert.equal(notice.category, 'Sağlık nedeniyle')
  assert.equal(notice.reason, '')
  const legacy = absenceRow(
    wrap({
      id: 'a3',
      studentId: 's1',
      startDate: '2026-11-02',
      endDate: '2026-11-02',
      category: 'Seyahat',
      reason: 'Aile ziyareti',
    }),
  )
  assert.equal(legacy.category, 'Seyahat')
  assert.equal(legacy.reason, 'Aile ziyareti')
})
