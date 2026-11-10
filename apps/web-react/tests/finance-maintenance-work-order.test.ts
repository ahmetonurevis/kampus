import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MaintenanceRequestDetail } from '@kampus/react-shared/use-finance-maintenance-requests.ts'
import {
  assignBody,
  assignDefaults,
  assigneeText,
  assignFormField,
  assignFormSchema,
  cancelFormSchema,
  noteBody,
  reportBody,
  reportDefaults,
  reportFormField,
  reportFormSchema,
  resolveBody,
  resolveDefaults,
  resolveFormField,
  resolveFormSchema,
} from '../src/pages/finance/finance-maintenance-forms.ts'
import {
  MAINTENANCE_WORK_ORDER_TITLE,
  maintenanceWorkOrderDocument,
  maintenanceWorkOrderFilename,
} from '../src/lib/pdf/templates/finance-maintenance-work-order.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// ON-239 (DOM-FIN-089): arıza iş emri PDF'i ve bildirim, atama, çözüm form modeli.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const SUPPLIER = '6b0d3c1e-0a4e-4d8f-9a55-0b3e1c2d4f60'
const request = (overrides: Partial<MaintenanceRequestDetail> = {}): MaintenanceRequestDetail => ({
  id: 'mr-1',
  number: 'AT-0007',
  title: 'Projektör açılmıyor',
  description: 'Güç düğmesine basınca ışık yanmıyor.',
  campusId: 'kadikoy',
  campusName: 'Kadıköy Kampüsü',
  location: '2. kat 5-A sınıfı',
  asset: { id: 'fa-1', tagNumber: 'DB-2026-0001', name: 'Projektör', category: 'audiovisual' },
  priority: 'urgent',
  status: 'resolved',
  reportedByName: 'Selin Kaya',
  reportedByMe: false,
  reportedAt: '2026-10-05T07:30:00.000Z',
  assignee: { type: 'supplier', id: SUPPLIER, name: 'Beta Teknik Servis Ltd.' },
  assignedAt: '2026-10-05T08:00:00.000Z',
  startedAt: '2026-10-05T09:00:00.000Z',
  resolvedAt: '2026-10-06T10:00:00.000Z',
  resolvedDate: '2026-10-06',
  resolution: 'Lamba değiştirildi.',
  resolutionCostCents: 125_000,
  resolutionSupplier: { id: SUPPLIER, name: 'Beta Teknik Servis Ltd.' },
  closedAt: null,
  cancelledAt: null,
  cancelReason: null,
  actions: { assign: false, start: false, resolve: false, close: true, cancel: false },
  version: 4,
  events: [
    {
      id: 'e-1',
      event: 'reported',
      fromStatus: null,
      toStatus: 'open',
      note: null,
      actorName: 'Selin Kaya',
      assignee: null,
      occurredAt: '2026-10-05T07:30:00.000Z',
    },
    {
      id: 'e-2',
      event: 'assigned',
      fromStatus: 'open',
      toStatus: 'assigned',
      note: 'Servis yarın gelir',
      actorName: 'Ayşe Müdür',
      assignee: { type: 'supplier', id: SUPPLIER, name: 'Beta Teknik Servis Ltd.' },
      occurredAt: '2026-10-05T08:00:00.000Z',
    },
  ],
  ...overrides,
})
const joined = (item: MaintenanceRequestDetail) =>
  allTexts(maintenanceWorkOrderDocument(measurer, item, OPTIONS)).join('\n')

test('DOM-FIN-089: iş emri numara, bildirim, yer, demirbaş, sorumlu, çözüm, geçmiş ve imza alanı taşır', () => {
  const text = joined(request())
  for (const part of [
    'ARIZA İŞ EMRİ',
    MAINTENANCE_WORK_ORDER_TITLE,
    'AT-0007',
    'Akademi Özel Okulları',
    'Selin Kaya',
    'Acil',
    'Kadıköy Kampüsü',
    '2. kat 5-A sınıfı',
    'DB-2026-0001 · Projektör',
    'Beta Teknik Servis Ltd. (tedarikçi)',
    'Lamba değiştirildi.',
    'Maliyet',
    '1.250,00',
    'İş emri geçmişi',
    'Servis yarın gelir',
    'Talep eden',
    'İşi yapan',
  ])
    assert.ok(text.includes(part), part)
  assert.equal(maintenanceWorkOrderFilename(request()), 'is-emri-AT-0007.pdf')
})

test('DOM-FIN-089: maliyet anahtarı olmayan (ön büro, öğretmen) yanıtta iş emri maliyet yazmaz (K-238)', () => {
  const withoutCost: MaintenanceRequestDetail = request()
  delete withoutCost.resolutionCostCents
  const text = joined(withoutCost)
  assert.equal(text.includes('Maliyet'), false)
  assert.equal(text.includes('1.250,00'), false)
})

test('DOM-FIN-089: çözülmemiş iş emri boş yazma alanı, iptal edilen gerekçe gösterir', () => {
  const open = joined(
    request({
      status: 'open',
      assignee: null,
      resolvedDate: null,
      resolvedAt: null,
      resolution: null,
      resolutionSupplier: null,
      asset: null,
    }),
  )
  assert.ok(open.includes('Yapılan iş (işi yapan doldurur)'))
  assert.ok(open.includes('Bağlı demirbaş yok'))
  assert.ok(open.includes('Atanmadı'))
  const cancelled = joined(
    request({
      status: 'cancelled',
      resolvedDate: null,
      resolution: null,
      cancelReason: 'Yanlış bildirim',
    }),
  )
  assert.ok(cancelled.includes('Yanlış bildirim'))
})

test('DOM-FIN-089: bildirim formu demirbaşın etiketini ve yerini önerir; boş alanlar null olur (K-236)', () => {
  const blank = reportDefaults()
  assert.equal(blank.priority, 'normal')
  assert.equal(blank.assetTagNumber, '')
  const fromAsset = reportDefaults({
    tagNumber: 'DB-2026-0001',
    campusId: 'kadikoy',
    location: 'Fen laboratuvarı',
  })
  assert.equal(fromAsset.location, 'Fen laboratuvarı')
  assert.deepEqual(
    reportBody({ ...blank, title: ' Musluk ', description: 'Damlatıyor sürekli', location: 'WC' }),
    {
      title: 'Musluk',
      description: 'Damlatıyor sürekli',
      campusId: null,
      location: 'WC',
      assetTagNumber: null,
      priority: 'normal',
    },
  )
  assert.equal(reportFormSchema.safeParse({ ...blank, title: 'ab' }).success, false)
  assert.equal(
    reportFormSchema.safeParse({
      ...fromAsset,
      title: 'Kırık',
      description: 'Ayak kırık',
      assetTagNumber: 'ç?',
    }).success,
    false,
  )
  assert.equal(
    reportFormSchema.safeParse({ ...fromAsset, title: 'Kırık', description: 'Ayak kırık' }).success,
    true,
  )
  assert.equal(reportFormField('assetTagNumber'), 'assetTagNumber')
  assert.equal(reportFormField('institutionId'), undefined)
})

test('DOM-FIN-089: atama formu türe göre personel ya da tedarikçi ister; gövde yalnız ilgili alanı taşır (K-237)', () => {
  const defaults = assignDefaults(null)
  assert.equal(defaults.assigneeType, 'staff')
  assert.equal(assignFormSchema.safeParse(defaults).success, false)
  assert.equal(assignFormSchema.safeParse({ ...defaults, assigneeType: 'supplier' }).success, false)
  assert.deepEqual(assignBody({ ...defaults, membershipId: 'm-1', note: ' ' }), {
    assigneeType: 'staff',
    membershipId: 'm-1',
    note: null,
  })
  const supplier = assignDefaults({ type: 'supplier', id: SUPPLIER, name: 'Beta' })
  assert.equal(supplier.supplierId, SUPPLIER)
  assert.deepEqual(assignBody({ ...supplier, note: 'Yarın' }), {
    assigneeType: 'supplier',
    supplierId: SUPPLIER,
    note: 'Yarın',
  })
  assert.equal(assignFormField('supplierId'), 'supplierId')
  assert.equal(assignFormField('x'), undefined)
  assert.equal(assigneeText(null), '—')
  assert.equal(assigneeText({ type: 'staff', id: 'm-1', name: 'Selin Kaya' }), 'Selin Kaya')
})

test('DOM-FIN-089: çözüm formu maliyeti kuruşa çevirir, boş maliyet null olur; atanan tedarikçi önerilir (K-237)', () => {
  const defaults = resolveDefaults({ type: 'supplier', id: SUPPLIER, name: 'Beta' }, '2026-10-06')
  assert.equal(defaults.supplierId, SUPPLIER)
  assert.deepEqual(resolveBody({ ...defaults, resolution: ' Lamba değişti ', cost: '1.250,00' }), {
    resolvedDate: '2026-10-06',
    resolution: 'Lamba değişti',
    costCents: 125_000,
    supplierId: SUPPLIER,
  })
  const plain = resolveDefaults(null, '2026-10-06')
  assert.equal(resolveBody({ ...plain, resolution: 'Vida sıkıldı' }).costCents, null)
  assert.equal(resolveBody({ ...plain, resolution: 'Vida sıkıldı' }).supplierId, null)
  assert.equal(
    resolveFormSchema.safeParse({ ...plain, resolution: 'Vida sıkıldı', cost: '0' }).success,
    false,
  )
  assert.equal(resolveFormSchema.safeParse({ ...plain, resolution: 'ok' }).success, false)
  assert.equal(resolveFormField('costCents'), 'cost')
  assert.equal(resolveFormField('resolution'), 'resolution')
  assert.equal(resolveFormField('x'), undefined)
  assert.equal(cancelFormSchema.safeParse({ reason: 'yok' }).success, false)
  assert.deepEqual(noteBody({ note: '  ' }), { note: null })
})
