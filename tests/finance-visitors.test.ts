import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertVisitorAnonymization,
  badgeOutstanding,
  DEFAULT_VISITOR_SETTINGS,
  maskVisitorPhone,
  planVisitorBadgeRelease,
  planVisitorCheckIn,
  planVisitorCheckOut,
  planVisitorSettings,
  visitorAnonymizationSchema,
  visitorCheckInSchema,
  visitorCheckOutSchema,
  visitorOverdue,
  visitorRetentionDueOn,
  visitorSettingsSchema,
  type StoredVisitorState,
  type VisitorAnonymizationTarget,
  type VisitorCheckInChecks,
} from '../packages/school-core/src/lib/finance-visitors.ts'

/** Ziyaretçi kaydı kuralları (DOM-FIN-141; ON-166; K-478…K-480). */

const NOW = new Date('2026-10-06T09:00:00.000Z')
const TODAY = '2026-10-06'
const ID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

const base = {
  visitorName: ' Ayşe Ziyaretçi ',
  identityVerified: true,
  identityDocumentType: 'national_id',
  purpose: 'supplier',
  privacyNoticeVersion: ' v1 ',
}
const checks = (overrides: Partial<VisitorCheckInChecks> = {}): VisitorCheckInChecks => ({
  now: NOW,
  host: undefined,
  studentExists: undefined,
  badgePool: ['A1', 'A2'],
  badgeInUse: false,
  ...overrides,
})
const ruleCode = (run: () => unknown, code: string, kind: 'rule' | 'conflict' = 'rule') =>
  assert.throws(run, (error) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
const issues = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []

describe('DOM-FIN-141: giriş şeması (K-478)', () => {
  test('DOM-FIN-141: varsayılanlar, kırpma, telefon ve kart numarası biçimi', () => {
    const parsed = visitorCheckInSchema.parse({
      ...base,
      phone: '0532 123 45 67',
      badgeNumber: ' a-1 ',
    })
    assert.equal(parsed.visitorName, 'Ayşe Ziyaretçi')
    assert.equal(parsed.privacyNoticeVersion, 'v1')
    assert.equal(parsed.phone, '05321234567')
    assert.equal(parsed.badgeNumber, 'A-1')
    assert.equal(parsed.checkedInAt, null)
    assert.equal(parsed.hostMembershipId, null)
    assert.equal(parsed.studentId, null)
    assert.equal(parsed.purposeNote, null)
    assert.equal(visitorCheckInSchema.parse({ ...base, phone: '' }).phone, null)
  })

  test('DOM-FIN-141: kimlik numarası alanı kabul edilmez; aydınlatma sürümü zorunlu', () => {
    assert.deepEqual(
      issues(visitorCheckInSchema.safeParse({ ...base, identityNumber: '12345678901' })),
      [''],
    )
    assert.deepEqual(
      issues(visitorCheckInSchema.safeParse({ ...base, privacyNoticeVersion: ' ' })),
      ['privacyNoticeVersion'],
    )
  })

  test('DOM-FIN-141: belge türü yalnız kimlik görüldüyse ve o zaman zorunlu', () => {
    assert.deepEqual(
      issues(visitorCheckInSchema.safeParse({ ...base, identityDocumentType: null })),
      ['identityDocumentType'],
    )
    assert.deepEqual(issues(visitorCheckInSchema.safeParse({ ...base, identityVerified: false })), [
      'identityDocumentType',
    ])
    assert.equal(
      visitorCheckInSchema.safeParse({
        ...base,
        identityVerified: false,
        identityDocumentType: null,
      }).success,
      true,
    )
  })

  test('DOM-FIN-141: "diğer" amacı açıklama ister; öğrenci yalnız veli görüşmesinde', () => {
    assert.deepEqual(issues(visitorCheckInSchema.safeParse({ ...base, purpose: 'other' })), [
      'purposeNote',
    ])
    assert.deepEqual(issues(visitorCheckInSchema.safeParse({ ...base, studentId: 's1' })), [
      'studentId',
    ])
    assert.equal(
      visitorCheckInSchema.safeParse({ ...base, purpose: 'parent_meeting', studentId: 's1' })
        .success,
      true,
    )
    assert.deepEqual(issues(visitorCheckInSchema.safeParse({ ...base, phone: '532' })), ['phone'])
    assert.deepEqual(issues(visitorCheckInSchema.safeParse({ ...base, badgeNumber: 'A 1' })), [
      'badgeNumber',
    ])
  })
})

describe('DOM-FIN-141: giriş kuralı (K-478, K-479)', () => {
  const input = (overrides: Partial<Parameters<typeof planVisitorCheckIn>[0]> = {}) => ({
    checkedInAt: null,
    hostMembershipId: null,
    studentId: null,
    badgeNumber: null,
    ...overrides,
  })

  test('DOM-FIN-141: boş giriş anı şimdidir, ziyaret günü İstanbul günüdür', () => {
    assert.deepEqual(planVisitorCheckIn(input(), checks()), {
      checkedInAt: NOW.toISOString(),
      visitOn: TODAY,
    })
    // 2026-10-05T22:30Z İstanbul'da 6 Ekim 01:30'dur.
    assert.equal(
      planVisitorCheckIn(input({ checkedInAt: '2026-10-05T22:30:00.000Z' }), checks()).visitOn,
      '2026-10-06',
    )
  })

  test('DOM-FIN-141: gelecekteki ve 24 saatten eski giriş reddedilir', () => {
    ruleCode(
      () => planVisitorCheckIn(input({ checkedInAt: '2026-10-06T09:01:00.000Z' }), checks()),
      'visitor_check_in_future',
    )
    ruleCode(
      () => planVisitorCheckIn(input({ checkedInAt: '2026-10-05T08:59:00.000Z' }), checks()),
      'visitor_check_in_too_old',
    )
    assert.equal(
      planVisitorCheckIn(input({ checkedInAt: '2026-10-05T09:00:00.000Z' }), checks()).visitOn,
      '2026-10-05',
    )
  })

  test('DOM-FIN-141: ziyaret edilen kişi kurumun etkin personeli olmalı', () => {
    const host = input({ hostMembershipId: 'm1' })
    ruleCode(() => planVisitorCheckIn(host, checks({ host: null })), 'visitor_host_not_found')
    ruleCode(
      () => planVisitorCheckIn(host, checks({ host: { role: 'veli', active: true } })),
      'visitor_host_not_staff',
    )
    ruleCode(
      () => planVisitorCheckIn(host, checks({ host: { role: 'ogretmen', active: false } })),
      'visitor_host_inactive',
    )
    assert.ok(planVisitorCheckIn(host, checks({ host: { role: 'ogretmen', active: true } })))
  })

  test('DOM-FIN-141: öğrenci kurumda olmalı', () => {
    const student = input({ studentId: 's1' })
    ruleCode(
      () => planVisitorCheckIn(student, checks({ studentExists: false })),
      'visitor_student_not_found',
    )
    assert.ok(planVisitorCheckIn(student, checks({ studentExists: true })))
  })

  test('DOM-FIN-141: kart havuzda olmalı, iade edilmemiş kart 409 (K-479)', () => {
    ruleCode(
      () => planVisitorCheckIn(input({ badgeNumber: 'B9' }), checks()),
      'visitor_badge_unknown',
    )
    ruleCode(
      () => planVisitorCheckIn(input({ badgeNumber: 'A1' }), checks({ badgeInUse: true })),
      'visitor_badge_in_use',
      'conflict',
    )
    assert.ok(planVisitorCheckIn(input({ badgeNumber: 'A1' }), checks()))
  })
})

describe('DOM-FIN-141: çıkış ve kart (K-479)', () => {
  const inside: StoredVisitorState = {
    checkedInAt: '2026-10-06T07:00:00.000Z',
    checkedOutAt: null,
    badgeNumber: 'A1',
    badgeReleasedAt: null,
    anonymizedAt: null,
  }
  const out = visitorCheckOutSchema.parse({})

  test('DOM-FIN-141: çıkış şimdi, kart varsayılan olarak iade edilir', () => {
    assert.deepEqual(planVisitorCheckOut(inside, out, NOW), {
      checkedOutAt: NOW.toISOString(),
      badgeRelease: 'returned',
    })
    assert.deepEqual(
      planVisitorCheckOut(inside, visitorCheckOutSchema.parse({ badgeReturned: false }), NOW),
      { checkedOutAt: NOW.toISOString(), badgeRelease: null },
    )
    assert.equal(planVisitorCheckOut({ ...inside, badgeNumber: null }, out, NOW).badgeRelease, null)
  })

  test('DOM-FIN-141: ikinci çıkış, gelecek ve girişten önceki çıkış reddedilir', () => {
    ruleCode(
      () => planVisitorCheckOut({ ...inside, checkedOutAt: NOW.toISOString() }, out, NOW),
      'visitor_already_checked_out',
    )
    ruleCode(
      () =>
        planVisitorCheckOut(
          inside,
          visitorCheckOutSchema.parse({ checkedOutAt: '2026-10-06T09:30:00.000Z' }),
          NOW,
        ),
      'visitor_check_out_future',
    )
    ruleCode(
      () =>
        planVisitorCheckOut(
          inside,
          visitorCheckOutSchema.parse({ checkedOutAt: '2026-10-06T06:59:00.000Z' }),
          NOW,
        ),
      'visitor_check_out_before_check_in',
    )
    ruleCode(
      () => planVisitorCheckOut({ ...inside, anonymizedAt: NOW.toISOString() }, out, NOW),
      'visitor_anonymized',
    )
  })

  test('DOM-FIN-141: kart iadesi ya da kayıp; kartsız ve kapanmış kart reddedilir', () => {
    assert.equal(planVisitorBadgeRelease(inside, { outcome: 'lost' }), 'lost')
    assert.equal(badgeOutstanding(inside), true)
    ruleCode(
      () => planVisitorBadgeRelease({ ...inside, badgeNumber: null }, { outcome: 'returned' }),
      'visitor_no_badge',
    )
    ruleCode(
      () =>
        planVisitorBadgeRelease(
          { ...inside, badgeReleasedAt: NOW.toISOString() },
          { outcome: 'returned' },
        ),
      'visitor_badge_already_released',
    )
  })

  test('DOM-FIN-141: önceki günden içeride kalan gün sonu uyarısıdır', () => {
    const row = { checkedOutAt: null, anonymizedAt: null, visitOn: '2026-10-05' }
    assert.equal(visitorOverdue(row, TODAY), true)
    assert.equal(visitorOverdue({ ...row, visitOn: TODAY }, TODAY), false)
    assert.equal(visitorOverdue({ ...row, checkedOutAt: NOW.toISOString() }, TODAY), false)
  })

  test('DOM-FIN-141: telefon yalnız maskeli gösterilir', () => {
    assert.equal(maskVisitorPhone(null), null)
    const masked = maskVisitorPhone('05321234567')
    assert.ok(masked?.startsWith('0532'))
    assert.ok(masked.endsWith('67'))
    assert.ok(!masked.includes('12345'))
  })
})

describe('DOM-FIN-141: ayar ve saklama (K-479, K-480)', () => {
  test('DOM-FIN-141: ayar şeması sınırları ve en az bir alan', () => {
    assert.equal(visitorSettingsSchema.safeParse({}).success, false)
    assert.deepEqual(issues(visitorSettingsSchema.safeParse({ retentionDays: 0 })), [
      'retentionDays',
    ])
    assert.deepEqual(issues(visitorSettingsSchema.safeParse({ retentionDays: 366 })), [
      'retentionDays',
    ])
    assert.deepEqual(issues(visitorSettingsSchema.safeParse({ badgeNumbers: ['a1', 'A1'] })), [
      'badgeNumbers',
    ])
    assert.deepEqual(visitorSettingsSchema.parse({ badgeNumbers: [' z-3 '] }).badgeNumbers, ['Z-3'])
  })

  test('DOM-FIN-141: değişiklik yoksa 422; iade edilmemiş kart havuzdan çıkmaz', () => {
    const current = { ...DEFAULT_VISITOR_SETTINGS, badgeNumbers: ['A1', 'A2'] }
    ruleCode(
      () => planVisitorSettings(current, { retentionDays: 30 }, []),
      'visitor_settings_unchanged',
    )
    ruleCode(
      () => planVisitorSettings(current, { badgeNumbers: ['A2'] }, ['A1']),
      'visitor_settings_badge_in_use',
    )
    assert.deepEqual(
      planVisitorSettings(current, { retentionDays: 15, badgeNumbers: ['A1', 'A3'] }, ['A1']),
      {
        next: { retentionDays: 15, privacyNoticeVersion: null, badgeNumbers: ['A1', 'A3'] },
        changed: ['retentionDays', 'badgeNumbers'],
      },
    )
    assert.deepEqual(planVisitorSettings(current, { privacyNoticeVersion: 'v2' }, []).changed, [
      'privacyNoticeVersion',
    ])
  })

  test('DOM-FIN-141: süre ziyaret gününden sayılır (K-480)', () => {
    assert.equal(visitorRetentionDueOn('2026-09-06', 30), '2026-10-06')
  })

  test('DOM-FIN-141: anonimleştirme kuralı; biri uymazsa hata yolu sırasıdır (K-480)', () => {
    const due: VisitorAnonymizationTarget = {
      id: ID,
      visitOn: '2026-09-06',
      checkedOutAt: '2026-09-06T10:00:00.000Z',
      anonymizedAt: null,
    }
    const found = new Map([[ID, due]])
    const settings = { retentionDays: 30, today: TODAY }
    const run = (input: unknown, map = found) =>
      assertVisitorAnonymization(visitorAnonymizationSchema.parse(input), map, settings)
    run({ visitorIds: [ID], reason: 'retention_expired' })
    ruleCode(
      () => run({ visitorIds: [ID, OTHER], reason: 'retention_expired' }),
      'visitor_not_found',
    )
    ruleCode(
      () =>
        run(
          { visitorIds: [ID], reason: 'retention_expired' },
          new Map([[ID, { ...due, visitOn: '2026-09-07' }]]),
        ),
      'visitor_retention_not_due',
    )
    run(
      { visitorIds: [ID], reason: 'data_subject_request' },
      new Map([[ID, { ...due, visitOn: TODAY }]]),
    )
    ruleCode(
      () =>
        run(
          { visitorIds: [ID], reason: 'data_subject_request' },
          new Map([[ID, { ...due, checkedOutAt: null }]]),
        ),
      'visitor_still_inside',
    )
    ruleCode(
      () =>
        run(
          { visitorIds: [ID], reason: 'data_subject_request' },
          new Map([[ID, { ...due, anonymizedAt: NOW.toISOString() }]]),
        ),
      'visitor_already_anonymized',
    )
    assert.equal(
      visitorAnonymizationSchema.safeParse({ visitorIds: [ID, ID], reason: 'retention_expired' })
        .success,
      false,
    )
  })
})
