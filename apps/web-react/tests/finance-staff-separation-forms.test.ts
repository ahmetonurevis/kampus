import assert from 'node:assert/strict'
import { test } from 'node:test'
import type {
  StaffSeparationDetail,
  StaffSeparationDocument,
} from '@kampus/react-shared/use-finance-staff-separations.ts'
import {
  emptyStaffSeparationForm,
  noticeText,
  staffSeparationBody,
  staffSeparationEditValues,
  staffSeparationFormField,
  staffSeparationFormSchema,
  staffSeparationUpdateBody,
  stepDetailText,
  suggestedCodeText,
  withHireSuggestion,
} from '../src/pages/finance/finance-staff-separation-forms.ts'
import {
  STAFF_SEPARATION_TITLE,
  staffSeparationDocument,
  staffSeparationFilename,
  staffSeparationReference,
} from '../src/lib/pdf/templates/finance-staff-separation.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// ON-180 (DOM-FIN-118): işten ayrılış formu, kontrol listesi metinleri ve ilişik kesme belgesi PDF'i.

const ID = '0a1b2c3d-1111-4222-8333-444455556666'
const base = {
  id: ID,
  membershipId: 'm-selin',
  staffName: 'Selin Kaya',
  staffRole: 'ogretmen',
  staffActive: false,
  separationDate: '2026-09-30',
  reason: 'resignation' as const,
  sgkExitCode: '03' as const,
  hireDate: '2024-03-15',
  noticeGivenDate: null,
  note: null,
  status: 'completed' as const,
  createdAt: '2026-09-20T09:00:00.000Z',
  completedAt: '2026-10-06T09:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  version: 4,
}
const ASSET = {
  assignmentId: 'za-1',
  assetId: 'fa-1',
  assetTagNumber: 'DB-2026-0001',
  assetName: 'Dizüstü bilgisayar',
  assignedDate: '2026-09-10',
  returnDate: '2026-09-30',
  returnCondition: 'intact' as const,
  version: 2,
}
const documentOf = (overrides: Partial<StaffSeparationDocument> = {}): StaffSeparationDocument => ({
  ...base,
  institutionName: 'Akademi Özel Okulları',
  completedByName: 'Ahmet Yönetici',
  steps: [
    { step: 'asset_return', required: true, done: true },
    { step: 'severance', required: false, done: false },
  ],
  assets: [ASSET],
  unusedLeaveDays: 23,
  serviceCertificateLabel: 'PB-2026-1',
  generatedAt: '2026-10-06T10:00:00.000Z',
  ...overrides,
})
const detail = {
  assets: [ASSET, { ...ASSET, assignmentId: 'za-2', returnDate: null, returnCondition: null }],
  deductions: {
    openAdvanceCount: 1,
    openAdvanceCents: 90_000_00,
    activeGarnishmentCount: 1,
    currency: 'TRY' as const,
  },
  leave: { hasProfile: true, unusedDays: 23, frozen: false },
  accountClosedDate: null,
  serviceCertificate: null,
} satisfies Pick<
  StaffSeparationDetail,
  'assets' | 'deductions' | 'leave' | 'accountClosedDate' | 'serviceCertificate'
>

test('DOM-FIN-118: form gövdesi boş alanları null yapar, kod boşsa öneriye bırakır', () => {
  const values = { ...emptyStaffSeparationForm('2026-10-06'), membershipId: 'm-selin' }
  assert.deepEqual(staffSeparationBody({ ...values, note: '  ' }), {
    membershipId: 'm-selin',
    separationDate: '2026-10-06',
    reason: 'resignation',
    sgkExitCode: null,
    hireDate: null,
    noticeGivenDate: null,
    note: null,
  })
  assert.equal(staffSeparationBody({ ...values, sgkExitCode: '29' }).sgkExitCode, '29')
  assert.equal(withHireSuggestion(values, '2024-03-15').hireDate, '2024-03-15')
  assert.equal(
    withHireSuggestion({ ...values, hireDate: '2020-01-01' }, '2024-03-15').hireDate,
    '2020-01-01',
  )
  assert.equal(withHireSuggestion(values, null).hireDate, '')
  assert.equal(suggestedCodeText('retirement'), 'Önerilen (08)')
  assert.equal(staffSeparationFormField('hireDate'), 'hireDate')
  assert.equal(staffSeparationFormField('institutionId'), null)
})

test('DOM-FIN-118: form şeması personeli ve gün sırasını erken denetler', () => {
  const values = emptyStaffSeparationForm('2026-10-06')
  const paths = (value: unknown) =>
    staffSeparationFormSchema.safeParse(value).error?.issues.map((issue) => issue.path.join('.'))
  assert.deepEqual(paths(values), ['membershipId'])
  assert.deepEqual(paths({ ...values, membershipId: 'm', hireDate: '2026-10-07' }), ['hireDate'])
  assert.deepEqual(paths({ ...values, membershipId: 'm', noticeGivenDate: '2026-10-07' }), [
    'noticeGivenDate',
  ])
  assert.equal(paths({ ...values, membershipId: 'm' }), undefined)
})

test('DOM-FIN-118: düzeltme gövdesi yalnız değişenleri taşır; neden değişince kod öneriye kalır', () => {
  const initial = staffSeparationEditValues(base)
  assert.deepEqual(staffSeparationUpdateBody(initial, initial), {})
  assert.deepEqual(
    staffSeparationUpdateBody(initial, { ...initial, reason: 'retirement', sgkExitCode: '' }),
    { reason: 'retirement' },
  )
  assert.deepEqual(
    staffSeparationUpdateBody(initial, { ...initial, hireDate: '', note: 'Teslim alındı' }),
    { hireDate: null, note: 'Teslim alındı' },
  )
  assert.deepEqual(
    staffSeparationUpdateBody(initial, {
      ...initial,
      separationDate: '2026-09-29',
      sgkExitCode: '22',
      noticeGivenDate: '2026-08-01',
    }),
    { separationDate: '2026-09-29', sgkExitCode: '22', noticeGivenDate: '2026-08-01' },
  )
})

test('DOM-FIN-118 K-405: bildirim satırı süreyi, bitişi ve eksik günü yazar', () => {
  assert.equal(noticeText(null), null)
  assert.match(
    noticeText({ applies: true, weeks: 6, noticeEndDate: '2026-09-12', shortDays: 0 }) ?? '',
    /6 hafta; süre 12 Eyl 2026 günü doluyor\.$/,
  )
  assert.match(
    noticeText({ applies: true, weeks: 8, noticeEndDate: '2026-10-27', shortDays: 27 }) ?? '',
    /27 gün erken/,
  )
  assert.match(
    noticeText({ applies: true, weeks: 4, noticeEndDate: null, shortDays: 0 }) ?? '',
    /bildirim günü girilmedi/,
  )
  assert.match(
    noticeText({ applies: false, weeks: 4, noticeEndDate: null, shortDays: 0 }) ?? '',
    /bildirim aranmaz/,
  )
})

test('DOM-FIN-118 K-404: adım açıklamaları kaynak kayıtlardan', () => {
  assert.equal(stepDetailText('asset_return', detail), '1 zimmet iade bekliyor.')
  assert.equal(
    stepDetailText('asset_return', { ...detail, assets: [ASSET] }),
    '1 zimmetin tamamı iade alındı.',
  )
  assert.equal(
    stepDetailText('asset_return', { ...detail, assets: [] }),
    'Personele zimmetli demirbaş yok.',
  )
  assert.match(stepDetailText('deductions', detail), /kesilecek avans 90\.000,00 ₺, 1 süren icra/)
  assert.equal(
    stepDetailText('deductions', {
      ...detail,
      deductions: { ...detail.deductions, openAdvanceCount: 0, activeGarnishmentCount: 0 },
    }),
    'Kesilecek avans ve süren icra yok.',
  )
  assert.match(stepDetailText('leave', detail), /23 gün\. Ücreti bordroda/)
  assert.match(
    stepDetailText('leave', {
      ...detail,
      leave: { hasProfile: true, unusedDays: 23, frozen: true },
    }),
    /dondurulmuş/,
  )
  assert.match(
    stepDetailText('leave', {
      ...detail,
      leave: { hasProfile: false, unusedDays: null, frozen: false },
    }),
    /İzin bilgisi yok/,
  )
  assert.match(stepDetailText('severance', detail), /sonuç saklanmaz/)
  assert.match(stepDetailText('account_closure', detail), /Hesap açık/)
  assert.match(
    stepDetailText('account_closure', { ...detail, accountClosedDate: '2026-10-01' }),
    /1 Eki 2026 günü kapatıldı/,
  )
  assert.match(stepDetailText('service_certificate', detail), /düzenlenmedi/)
  assert.match(
    stepDetailText('service_certificate', {
      ...detail,
      serviceCertificate: { id: 'c', label: 'PB-2026-1', createdAt: '2026-10-02T09:00:00.000Z' },
    }),
    /PB-2026-1 düzenlendi/,
  )
})

test('DOM-FIN-118: ilişik kesme belgesi kurum, personel, adımlar, zimmet ve imza alanı taşır', () => {
  const text = allTexts(staffSeparationDocument(measurer, documentOf())).join('\n')
  for (const part of [
    STAFF_SEPARATION_TITLE,
    'İLİŞİK KESİLDİ',
    'Akademi Özel Okulları',
    'Selin Kaya',
    'Öğretmen',
    '03 · Belirsiz süreli',
    '23 gün',
    'PB-2026-1',
    'DB-2026-0001',
    'Sağlam',
    'Zimmet iadesi',
    'Yapılmadı (isteğe bağlı)',
    'ilişiği kesilmiştir',
    'Ahmet Yönetici',
    staffSeparationReference(documentOf()),
  ])
    assert.ok(text.includes(part), part)
  assert.equal(staffSeparationFilename(documentOf()), 'ilisik-kesme-2026-09-30-0a1b2c3d.pdf')
})

test('DOM-FIN-118: taslak ve iptal belge ilişiğin kesildiğini söylemez', () => {
  const draft = allTexts(
    staffSeparationDocument(
      measurer,
      documentOf({
        status: 'open',
        completedAt: null,
        completedByName: null,
        assets: [],
        unusedLeaveDays: null,
        serviceCertificateLabel: null,
      }),
    ),
  ).join('\n')
  assert.ok(draft.includes('TASLAK'))
  assert.ok(draft.includes('ilişiğin kesildiğini göstermez'))
  assert.ok(draft.includes('Personele zimmetli demirbaş yok.'))
  assert.ok(draft.includes('İzin bilgisi yok'))
  assert.equal(draft.includes('ilişiği kesilmiştir'), false)
  const cancelled = allTexts(
    staffSeparationDocument(
      measurer,
      documentOf({
        status: 'cancelled',
        completedAt: null,
        cancelledAt: '2026-10-02T09:00:00.000Z',
        cancelReason: 'Yanlış personel seçildi',
        assets: [{ ...ASSET, returnDate: null, returnCondition: null }],
      }),
    ),
  ).join('\n')
  assert.ok(cancelled.includes('İPTAL EDİLDİ'))
  assert.ok(cancelled.includes('İptal gerekçesi: Yanlış personel seçildi'))
  assert.ok(cancelled.includes('İade edilmedi'))
})
