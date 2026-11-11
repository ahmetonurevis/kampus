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
  saleId: 'test-sale-1',
  packageName: 'Genel İngilizce 40 saat',
  remainingHours: 12,
  expiredHours: 0,
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

describe('ON-302, ON-310 kalan paket saati (K-24)', () => {
  test('K-24 DOM-DIL-051 satır paket adı, kalan saat ve son kullanmayı verir', () => {
    assert.deepEqual(packageHourRows([sale()]), [
      {
        id: 'test-sale-1',
        name: 'Genel İngilizce 40 saat',
        remaining: '12 saat',
        expired: null,
        expires: '12 Eyl 2027',
        statusLabel: 'Etkin',
        statusTone: 'green',
        note: null,
      },
    ])
  })

  test('K-24 sunucu tutar gönderse de satıra hiçbir tutar geçmez', () => {
    const withAmounts = {
      ...sale(),
      amounts: {
        netCents: 900_000,
        recognizedCents: 250_000,
        returnedCents: 0,
        deferredCents: 650_000,
      },
    }
    const [row] = packageHourRows([withAmounts])
    assert.ok(row)
    assert.deepEqual(Object.keys(row).sort(), [
      'expired',
      'expires',
      'id',
      'name',
      'note',
      'remaining',
      'statusLabel',
      'statusTone',
    ])
    assert.doesNotMatch(JSON.stringify(row), /900000|250000|650000|₺|Cents/)
  })

  test('DOM-DIL-051 son kullanması olmayan paket süresizdir', () => {
    assert.equal(packageHourRows([sale({ expiresDate: null })])[0]?.expires, 'Süresiz')
  })

  test('DOM-DIL-051 H-19 süresi dolan pakette kalan saat durur, süresi dolan saat ayrıca yazılır, not uzatmayı anlatır', () => {
    const [row] = packageHourRows([
      sale({ status: 'expired', expiresDate: '2026-01-31', remainingHours: 7, expiredHours: 7 }),
    ])
    assert.equal(row?.remaining, '7 saat')
    assert.equal(row?.expired, '7 saat')
    assert.equal(row?.statusLabel, 'Süresi doldu')
    assert.equal(row?.statusTone, 'amber')
    assert.equal(row?.note, PACKAGE_HOURS_EXPIRED_NOTE)
  })

  test('DOM-DIL-051 saati biten paket sıfır saat gösterir', () => {
    const [row] = packageHourRows([sale({ status: 'depleted', remainingHours: 0 })])
    assert.equal(row?.remaining, '0 saat')
    assert.equal(row?.expired, null)
    assert.equal(row?.statusLabel, 'Saati bitti')
    assert.equal(row?.note, null)
  })

  test('K-24 etkin paket önce, biten sonda; aynı durumda sunucu sırası korunur', () => {
    const input = [
      sale({ saleId: 'test-depleted', status: 'depleted', remainingHours: 0 }),
      sale({ saleId: 'test-expired', status: 'expired', expiredHours: 12 }),
      sale({ saleId: 'test-active-new' }),
      sale({ saleId: 'test-active-old' }),
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
    // ON-310: saat bakiye ucundan okunur, satış listesinden hesaplanmaz.
    assert.match(source, /useStudentPackageBalance\(/)
    assert.doesNotMatch(source, /usePackageSales/)
    assert.doesNotMatch(source, /Cents|money\(|useInvoice|usePayment/)
  })

  test('ON-310 web aile bölümü saati bakiye ucundan okur, satış listesinden hesaplamaz', () => {
    const source = readFileSync(
      new URL('../apps/web-react/src/pages/finance/FamilyPackagesSection.tsx', import.meta.url),
      'utf8',
    )
    assert.match(source, /useStudentPackageBalance\(studentId\)/)
    assert.match(source, /expiredHours/)
    assert.doesNotMatch(source, /usePackageSales|Cents/)
  })
})
