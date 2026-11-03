import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { collectionQueryFromList, sortableColumns } from '../src/lib/collection-list.ts'
import { initialListState } from '../src/lib/list-state.ts'
import {
  ABSENCE_LIST,
  ABSENCE_STATUS_FILTERS,
  absenceCsvRow,
  absenceRow,
  absenceStatusLabel,
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

test('DOM-ILT-053: absenceRow onay durumu olmayan telefon bildirimi "Onay bekliyor" sayılır, gönderim zamanı createdAt', () => {
  const base = {
    id: 'a1',
    studentId: 's1',
    startDate: '2026-11-02',
    endDate: '2026-11-03',
    category: 'Sağlık',
    reason: 'Doktor kontrolü',
  }
  const phone = absenceRow(wrap({ ...base, createdAt: '2026-10-14T08:00:00.000Z' }))
  assert.equal(phone.status, 'Onay bekliyor')
  assert.equal(phone.approval, 'pending')
  assert.equal(phone.sentAt, '2026-10-14T08:00:00.000Z')
  const web = absenceRow(
    wrap(
      {
        ...base,
        status: 'Onaylandı',
        approvalStatus: 'approved' as const,
        date: '2026-10-13T08:00:00.000Z',
      },
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

test('DOM-ILT-053, Sabah kararı 72: veli reddi "Onaylanmadı" görür, personel "Reddedildi"', () => {
  const rejected = wrap({
    id: 'a4',
    studentId: 's1',
    startDate: '2026-11-02',
    endDate: '2026-11-02',
    category: 'Sağlık nedeniyle',
    status: 'Reddedildi',
    approvalStatus: 'rejected' as const,
    decidedAt: '2026-11-03T08:00:00.000Z',
  })
  const parent = absenceRow(rejected)
  assert.equal(parent.status, 'Onaylanmadı')
  assert.equal(parent.tone, 'red')
  assert.equal(parent.decidedAt, '2026-11-03T08:00:00.000Z')
  assert.equal(absenceRow(rejected, 'parent').status, 'Onaylanmadı')
  assert.equal(absenceRow(rejected, 'staff').status, 'Reddedildi')
  // Gerekçe kayıtta olmadığı gibi satırda da yoktur.
  assert.equal('rejectReason' in parent, false)
  assert.equal(absenceStatusLabel('pending', 'parent'), 'Onay bekliyor')
  assert.equal(absenceStatusLabel('approved', 'parent'), 'Onaylandı')
  assert.equal(absenceStatusLabel('approved', 'staff'), 'Onaylandı')
})

test('DOM-ILT-053: absenceRow özür belgesi kimliklerini, sınıfı ve okunan sürümü taşır', () => {
  const row = absenceRow(
    {
      ...wrap(
        {
          id: 'a5',
          studentId: 's1',
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          category: 'Sağlık',
          fileIds: ['f1', 'f2'],
        },
        { studentName: 'Deniz' },
      ),
      version: 7,
      joined: { studentName: 'Deniz', className: '7-A' },
    },
    'staff',
  )
  assert.deepEqual(row.fileIds, ['f1', 'f2'])
  assert.equal(row.className, '7-A')
  assert.equal(row.version, 7)
  assert.equal(absenceCsvRow(row).documents, '2')
  assert.deepEqual(
    absenceRow(
      wrap({
        id: 'a6',
        studentId: 's1',
        startDate: '2026-11-02',
        endDate: '2026-11-02',
        category: 'x',
      }),
    ).fileIds,
    [],
  )
})

test('ABSENCE_STATUS_FILTERS: durum süzgeci kayıttaki status değerleriyle eşleşir', () => {
  assert.deepEqual(
    ABSENCE_STATUS_FILTERS.map((item) => [item.value, item.label]),
    [
      ['İletildi', 'Onay bekliyor'],
      ['Onaylandı', 'Onaylandı'],
      ['Reddedildi', 'Reddedildi'],
    ],
  )
})
