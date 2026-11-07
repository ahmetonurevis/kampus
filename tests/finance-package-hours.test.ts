import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  PACKAGE_HOURS_EXPIRED_NOTE,
  packageHourRows,
  type PackageHourSale,
} from '../packages/react-shared/src/finance-package-hours.ts'
import { ownPackageHoursStudent } from '../apps/mobile/src/api/finance-package-hours.ts'

const sale = (overrides: Partial<PackageHourSale> = {}): PackageHourSale => ({
  id: 'test-sale-1',
  packageName: 'Genel İngilizce 40 saat',
  remainingHours: 12,
  expiresDate: '2027-09-12',
  status: 'active',
  ...overrides,
})

const session = (overrides: Partial<Parameters<typeof ownPackageHoursStudent>[0]> = {}) => ({
  role: 'ogrenci' as const,
  studentId: 'test-student-1',
  institution: {
    id: 'test-inst-1',
    name: 'Kampüs Dil Akademisi',
    type: 'language_school' as const,
  },
  modules: { finance: true },
  ...overrides,
})

describe('ON-302 kalan paket saati (K-24)', () => {
  test('K-24 DOM-DIL-051 satır paket adı, kalan saat ve son kullanmayı verir', () => {
    assert.deepEqual(packageHourRows([sale()]), [
      {
        id: 'test-sale-1',
        name: 'Genel İngilizce 40 saat',
        remaining: '12 saat',
        expires: '12 Eyl 2027',
        statusLabel: 'Etkin',
        statusTone: 'green',
        note: null,
      },
    ])
  })

  test('K-24 sunucu tutar gönderse de satıra hiçbir tutar geçmez', () => {
    const withAmounts = { ...sale(), hourlyCents: 25_000, grossCents: 1_000_000, netCents: 900_000 }
    const [row] = packageHourRows([withAmounts])
    assert.ok(row)
    assert.deepEqual(Object.keys(row).sort(), [
      'expires',
      'id',
      'name',
      'note',
      'remaining',
      'statusLabel',
      'statusTone',
    ])
    assert.doesNotMatch(JSON.stringify(row), /25000|1000000|900000|₺|Cents/)
  })

  test('DOM-DIL-051 son kullanması olmayan paket süresizdir', () => {
    assert.equal(packageHourRows([sale({ expiresDate: null })])[0]?.expires, 'Süresiz')
  })

  test('DOM-DIL-051 H-19 süresi dolan pakette kalan saat durur, not uzatmayı anlatır', () => {
    const [row] = packageHourRows([
      sale({ status: 'expired', expiresDate: '2026-01-31', remainingHours: 7 }),
    ])
    assert.equal(row?.remaining, '7 saat')
    assert.equal(row?.statusLabel, 'Süresi doldu')
    assert.equal(row?.statusTone, 'amber')
    assert.equal(row?.note, PACKAGE_HOURS_EXPIRED_NOTE)
  })

  test('DOM-DIL-051 saati biten paket sıfır saat gösterir', () => {
    const [row] = packageHourRows([sale({ status: 'depleted', remainingHours: 0 })])
    assert.equal(row?.remaining, '0 saat')
    assert.equal(row?.statusLabel, 'Saati bitti')
    assert.equal(row?.note, null)
  })

  test('K-24 etkin paket önce, biten sonda; aynı durumda sunucu sırası korunur', () => {
    const input = [
      sale({ id: 'test-depleted', status: 'depleted', remainingHours: 0 }),
      sale({ id: 'test-expired', status: 'expired' }),
      sale({ id: 'test-active-new' }),
      sale({ id: 'test-active-old' }),
    ]
    const snapshot = structuredClone(input)
    assert.deepEqual(
      packageHourRows(input).map((row) => row.id),
      ['test-active-new', 'test-active-old', 'test-expired', 'test-depleted'],
    )
    assert.deepEqual(input, snapshot)
  })

  test('K-24 boş liste boş satır verir', () => {
    assert.deepEqual(packageHourRows([]), [])
  })

  test('K-24 bölüm yalnız finans modülü açık dil okulu öğrencisinde açılır', () => {
    assert.equal(ownPackageHoursStudent(session()), 'test-student-1')
    // Modül anahtarı `/me` yanıtında yoksa açık sayılır (`isModuleOpen`).
    assert.equal(ownPackageHoursStudent(session({ modules: {} })), 'test-student-1')
    assert.equal(ownPackageHoursStudent(session({ modules: { finance: false } })), null)
    assert.equal(ownPackageHoursStudent(session({ studentId: null })), null)
    assert.equal(
      ownPackageHoursStudent(
        session({ institution: { id: 'test-inst-2', name: 'Akademi', type: 'school' } }),
      ),
      null,
    )
    for (const role of ['yonetici', 'onburo', 'ogretmen', 'veli'] as const)
      assert.equal(ownPackageHoursStudent(session({ role })), null, role)
  })

  test('K-24 bölüm varsayılan bileşen verir, tutar ve ödeme verisi okumaz', () => {
    const source = readFileSync(
      new URL('../apps/mobile/src/api/screens/finance-package-hours.tsx', import.meta.url),
      'utf8',
    )
    assert.match(source, /^export default function StudentPackageHours\(\)/m)
    assert.doesNotMatch(source, /Cents|money\(|useInvoice|usePayment/)
  })
})
