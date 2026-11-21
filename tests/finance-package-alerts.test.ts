import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  PACKAGE_ALERTS,
  PACKAGE_NOTICE_TYPES,
  packageAlertNotices,
  packageLowBalanceHours,
  packageSaleAlerts,
  type PackageAlertSale,
} from '../packages/school-core/src/lib/finance-package-alerts.ts'
import { PACKAGE_NOTIFICATION_TYPES } from '../packages/school-core/src/lib/finance-notifications.ts'
import {
  notificationTypeSpec,
  ONUR_NOTIFICATION_TYPES,
} from '../packages/school-core/src/modules/notification-types.ts'

/**
 * Paket saat uyarıları (IST-078, IST-114; DOM-FIN-058, DOM-DIL-051; K-248, K-249). Bugün
 * 2026-10-06; 40 saatlik pakette saat azaldı eşiği 8 saattir.
 */

const TODAY = '2026-10-06'
const sale = (overrides: Partial<PackageAlertSale> = {}): PackageAlertSale => ({
  purchasedHours: 40,
  remainingHours: 20,
  expiresDate: '2027-04-01',
  ...overrides,
})
const listed = (id: string, overrides: Partial<PackageAlertSale> = {}) => ({
  id,
  studentId: 's3',
  ...sale(overrides),
})

describe('DOM-FIN-058, K-248: saat azaldı eşiği', () => {
  test('eşik satın alınanın %20si, aşağı yuvarlanır, en az 1 saat', () => {
    assert.equal(packageLowBalanceHours(40), 8)
    assert.equal(packageLowBalanceHours(12), 2)
    assert.equal(packageLowBalanceHours(4), 1)
    assert.equal(packageLowBalanceHours(1), 1)
  })

  test('kalan eşikte ya da altında, kullanım başlamışsa işaretlenir', () => {
    assert.deepEqual(packageSaleAlerts(sale({ remainingHours: 9 }), TODAY), [])
    assert.deepEqual(packageSaleAlerts(sale({ remainingHours: 8 }), TODAY), ['low_balance'])
    assert.deepEqual(packageSaleAlerts(sale({ remainingHours: 1 }), TODAY), ['low_balance'])
  })

  test('kullanılan saat girilmemiş satış (kalan = satın alınan) işaretlenmez', () => {
    assert.deepEqual(packageSaleAlerts(sale({ purchasedHours: 4, remainingHours: 4 }), TODAY), [])
    assert.deepEqual(packageSaleAlerts(sale({ purchasedHours: 4, remainingHours: 1 }), TODAY), [
      'low_balance',
    ])
  })

  test('saati biten ya da iade edilen (kalan 0) satış uyarı taşımaz', () => {
    assert.deepEqual(packageSaleAlerts(sale({ remainingHours: 0, expiresDate: TODAY }), TODAY), [])
  })
})

describe('DOM-DIL-051, K-249: süre doluyor ve süre doldu', () => {
  test('son kullanma 14 gün içindeyse (bugün dahil) süre doluyor', () => {
    assert.deepEqual(packageSaleAlerts(sale({ expiresDate: '2026-10-21' }), TODAY), [])
    assert.deepEqual(packageSaleAlerts(sale({ expiresDate: '2026-10-20' }), TODAY), ['expiring'])
    assert.deepEqual(packageSaleAlerts(sale({ expiresDate: TODAY }), TODAY), ['expiring'])
  })

  test('süresiz paket süre uyarısı almaz; iki uyarı birlikte olabilir', () => {
    assert.deepEqual(packageSaleAlerts(sale({ expiresDate: null, remainingHours: 2 }), TODAY), [
      'low_balance',
    ])
    assert.deepEqual(
      packageSaleAlerts(sale({ expiresDate: '2026-10-10', remainingHours: 2 }), TODAY),
      [...PACKAGE_ALERTS],
    )
  })

  test('süresi dolmuş satış uyarı taşımaz: durum `expired`, kalan saat silinmez', () => {
    assert.deepEqual(
      packageSaleAlerts(sale({ expiresDate: '2026-10-05', remainingHours: 2 }), TODAY),
      [],
    )
  })
})

describe('K-248, K-249: aile bildirimleri', () => {
  test('her uyarı kendi türüyle; anahtar saat azaldıda satış, sürede son kullanma günüdür', () => {
    const notices = packageAlertNotices(
      [
        listed('a', { remainingHours: 3 }),
        listed('b', { expiresDate: '2026-10-12' }),
        listed('c', { expiresDate: '2026-09-30', remainingHours: 5 }),
        listed('d'),
      ],
      TODAY,
    )
    assert.deepEqual(notices, [
      { type: 'package_hours_low', saleId: 'a', studentId: 's3', dedupeKey: 'a:low' },
      {
        type: 'package_expiring',
        saleId: 'b',
        studentId: 's3',
        dedupeKey: 'b:expiring:2026-10-12',
      },
      {
        type: 'package_expired',
        saleId: 'c',
        studentId: 's3',
        dedupeKey: 'c:expired:2026-09-30',
      },
    ])
  })

  test('süre doldu bildirimi en çok 7 gün geriye bakar; kalan saati olmayana gitmez', () => {
    assert.equal(packageAlertNotices([listed('x', { expiresDate: '2026-09-29' })], TODAY).length, 1)
    assert.deepEqual(packageAlertNotices([listed('x', { expiresDate: '2026-09-28' })], TODAY), [])
    assert.deepEqual(
      packageAlertNotices([listed('x', { expiresDate: '2026-10-01', remainingHours: 0 })], TODAY),
      [],
    )
  })

  test('süre uzatılınca yeni son kullanma günü için yeniden bildirilir', () => {
    const [before] = packageAlertNotices([listed('e', { expiresDate: '2026-10-10' })], TODAY)
    const [after] = packageAlertNotices([listed('e', { expiresDate: '2026-10-19' })], TODAY)
    assert.notEqual(before?.dedupeKey, after?.dedupeKey)
  })

  test('IST-065: türler Onur bloğunda kayıtlı; finans modülü, ödeme konusu, yalnız satış kimliği', () => {
    assert.deepEqual(Object.keys(PACKAGE_NOTIFICATION_TYPES), [...PACKAGE_NOTICE_TYPES])
    for (const type of PACKAGE_NOTICE_TYPES) {
      assert.ok(Object.hasOwn(ONUR_NOTIFICATION_TYPES, type))
      const spec = notificationTypeSpec(type)
      assert.ok(spec)
      assert.equal(spec.module, 'finance')
      assert.equal(spec.topic, 'payment')
      assert.deepEqual(spec.audiences, { minor: ['parent'], adult: ['student'] })
      assert.equal(spec.subjectId({ saleId: 'sale-1' }), 'sale-1')
      assert.equal(spec.data.safeParse({ saleId: 'sale-1', hours: 3 }).success, false)
      assert.doesNotMatch(Object.values(spec.titles).join(' '), /\d/)
    }
  })
})
