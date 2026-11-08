import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { FixedAssetAssignment } from '@kampus/react-shared/use-finance-fixed-asset-assignments.ts'
import {
  assignBody,
  assignDefaults,
  assigneeOptionLabel,
  assignFormField,
  assignFormSchema,
  returnBody,
  returnFormSchema,
} from '../src/pages/finance/finance-fixed-asset-assignment-forms.ts'
import {
  FIXED_ASSET_ASSIGNMENT_TITLE,
  fixedAssetAssignmentDocument,
  fixedAssetAssignmentFilename,
} from '../src/lib/pdf/templates/finance-fixed-asset-assignment.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// ON-236 (DOM-FIN-086): zimmet tutanağı PDF'i ve zimmet/iade form modeli.

const OPTIONS = {
  institution: 'Akademi Özel Okulları',
  generatedAt: new Date('2026-10-06T15:00:00.000Z'),
}
const assignment = (overrides: Partial<FixedAssetAssignment> = {}): FixedAssetAssignment => ({
  id: 'za-1',
  assetId: 'fa-1',
  assetTagNumber: 'DB-2026-0001',
  assetName: 'Dizüstü bilgisayar',
  assetCategory: 'it',
  assigneeType: 'staff',
  membershipId: 'm-selin',
  staffName: 'Selin Kaya',
  staffRole: 'ogretmen',
  staffActive: true,
  campusId: null,
  campusName: null,
  location: null,
  assignedDate: '2026-09-10',
  note: 'Şarj aletiyle',
  assignedAt: '2026-09-10T09:00:00.000Z',
  returnDate: null,
  returnCondition: null,
  returnNote: null,
  returnedAt: null,
  version: 1,
  ...overrides,
})
const joined = (items: FixedAssetAssignment[]) =>
  allTexts(fixedAssetAssignmentDocument(measurer, items, OPTIONS)).join('\n')

test('DOM-FIN-086: personel tutanağı kurum, teslim alan, demirbaş, tarih ve iki imza alanı taşır', () => {
  const text = joined([assignment()])
  for (const part of [
    'DEMİRBAŞ ZİMMET TUTANAĞI',
    FIXED_ASSET_ASSIGNMENT_TITLE,
    'Akademi Özel Okulları',
    'Teslim alan',
    'Selin Kaya',
    'Öğretmen',
    'DB-2026-0001',
    'Dizüstü bilgisayar',
    'Bilgisayar ve',
    'Şarj aletiyle',
    '1 adet',
    'ZİMMET',
  ])
    assert.ok(text.includes(part), part)
  assert.match(text, /10 Eyl(ül)? 2026/)
  assert.match(text, /Teslim eden \(kurum adına\)/)
  assert.match(text, /Teslim alan — Selin Kaya, imza/)
  assert.equal(text.includes('İade günü'), false)
})

test('DOM-FIN-086: iade edilmiş tek zimmette iade bilgisi ve rozeti; personel listesinde bütün demirbaşlar', () => {
  const returned = joined([
    assignment({
      returnDate: '2026-09-20',
      returnCondition: 'damaged',
      returnNote: 'Klavyede eksik tuş',
      returnedAt: '2026-09-20T09:00:00.000Z',
    }),
  ])
  for (const part of ['İADE EDİLDİ', 'İade günü', 'Hasarlı', 'Klavyede eksik tuş'])
    assert.ok(returned.includes(part), part)
  const list = joined([
    assignment(),
    assignment({ id: 'za-2', assetTagNumber: 'DB-2026-0002', assetName: 'Projektör', note: null }),
  ])
  assert.ok(list.includes('DB-2026-0002'))
  assert.ok(list.includes('2 adet'))
  assert.ok(list.includes('2 demirbaş'))
})

test('DOM-FIN-086: konum tutanağı teslim yeri ve kampüsü yazar; dosya adında kişi adı yok', () => {
  const room = assignment({
    assigneeType: 'location',
    membershipId: null,
    staffName: null,
    staffRole: null,
    staffActive: null,
    campusId: 'kadikoy',
    campusName: 'Kadıköy Kampüsü',
    location: 'Fen laboratuvarı',
  })
  const text = joined([room])
  for (const part of ['Teslim yeri', 'Fen laboratuvarı', 'Kadıköy Kampüsü', 'konum sorumlusu'])
    assert.ok(text.includes(part), part)
  assert.equal(
    fixedAssetAssignmentFilename([room], OPTIONS.generatedAt),
    'zimmet-tutanagi-DB-2026-0001.pdf',
  )
  assert.equal(
    fixedAssetAssignmentFilename([room, room], OPTIONS.generatedAt),
    'zimmet-tutanagi-2026-10-06.pdf',
  )
  assert.throws(() => fixedAssetAssignmentDocument(measurer, [], OPTIONS))
})

test('DOM-FIN-086: zimmet formu türe göre gövde kurar; eksik personel ve kısa konum alan hatasıdır', () => {
  const defaults = assignDefaults(
    { campusId: 'kadikoy', location: 'Öğretmenler odası' },
    '2026-10-06',
  )
  assert.equal(assignFormSchema.safeParse(defaults).success, false)
  const staff = { ...defaults, membershipId: 'm-selin', note: '  ' }
  assert.equal(assignFormSchema.safeParse(staff).success, true)
  assert.deepEqual(assignBody(staff), {
    assigneeType: 'staff',
    membershipId: 'm-selin',
    assignedDate: '2026-10-06',
    note: null,
  })
  const room = { ...defaults, assigneeType: 'location' as const, campusId: '', note: 'Dolapta' }
  assert.deepEqual(assignBody(room), {
    assigneeType: 'location',
    campusId: null,
    location: 'Öğretmenler odası',
    assignedDate: '2026-10-06',
    note: 'Dolapta',
  })
  const short = assignFormSchema.safeParse({ ...room, location: 'A' })
  assert.deepEqual(short.error?.issues[0]?.path, ['location'])
  assert.equal(assignFormField('membershipId'), 'membershipId')
  assert.equal(assignFormField('assetId'), undefined)
  assert.equal(
    assigneeOptionLabel({ name: 'Selin Kaya', role: 'ogretmen' }),
    'Selin Kaya · Öğretmen',
  )
  assert.equal(assigneeOptionLabel({ name: 'X', role: 'muhasebe' }), 'X · —')
})

test('DOM-FIN-086: iade formu hasarlıda not ister; boş not null gider (K-212)', () => {
  const base = { returnDate: '2026-10-06', condition: 'intact' as const, note: '' }
  assert.deepEqual(returnBody(base), { returnDate: '2026-10-06', condition: 'intact', note: null })
  const damaged = returnFormSchema.safeParse({ ...base, condition: 'damaged', note: 'kır' })
  assert.deepEqual(damaged.error?.issues[0]?.path, ['note'])
  assert.equal(
    returnFormSchema.safeParse({ ...base, condition: 'damaged', note: 'Ekran çizik' }).success,
    true,
  )
})
