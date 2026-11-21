import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { FILE_PURPOSES } from '../packages/school-core/src/content/taxonomy.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertLostItemDisposal,
  assertLostItemOpen,
  DEFAULT_LOST_ITEM_SETTINGS,
  LOST_ITEM_PHOTO_PURPOSE,
  lostItemCreateSchema,
  lostItemDisposalSchema,
  lostItemHandoverSchema,
  lostItemRetentionDueOn,
  lostItemSettingsSchema,
  lostItemUpdateSchema,
  lostReportCreateSchema,
  planLostItemHandover,
  planLostItemPhotoAdd,
  planLostItemRecord,
  planLostItemSettings,
  planLostItemUpdate,
  planLostReport,
  planLostReportClose,
  planLostReportMatch,
  planLostReportUnmatch,
  type LostItemDisposalTarget,
  type StoredLostItemState,
} from '../packages/school-core/src/lib/finance-lost-items.ts'

/** Kayıp eşya kuralları (DOM-FIN-145; ON-171; K-490…K-492). */

const TODAY = '2026-10-06'
const ID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'

const staff = { role: 'onburo', active: true }
const item = (overrides: Partial<StoredLostItemState> = {}): StoredLostItemState => ({
  status: 'pending',
  description: 'Lacivert mont',
  category: 'clothing',
  foundLocation: 'Spor salonu',
  foundOn: '2026-10-05',
  storageLocation: 'Ön büro dolabı',
  finderMembershipId: null,
  ...overrides,
})

function rejects(run: () => unknown, code: string, path?: string[]) {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError)
    assert.equal(error.code, code)
    if (path !== undefined) assert.deepEqual(error.path, path)
    return true
  })
}

describe('DOM-FIN-145: bulunan eşya kaydı (K-490)', () => {
  test('şema kırpar, fotoğraf en çok üç ve tekil; bilinmeyen alan reddedilir', () => {
    const parsed = lostItemCreateSchema.parse({
      description: ' Lacivert mont ',
      category: 'clothing',
      foundLocation: ' Spor salonu ',
      foundOn: TODAY,
      storageLocation: 'Dolap 2',
    })
    assert.equal(parsed.description, 'Lacivert mont')
    assert.equal(parsed.finderMembershipId, null)
    assert.deepEqual(parsed.photoFileIds, [])
    const base = { ...parsed }
    assert.equal(lostItemCreateSchema.safeParse({ ...base, photoFileIds: [ID, ID] }).success, false)
    assert.equal(
      lostItemCreateSchema.safeParse({
        ...base,
        photoFileIds: [ID, OTHER, ID.replace('1', '3'), ID.replace('1', '4')],
      }).success,
      false,
    )
    assert.equal(lostItemCreateSchema.safeParse({ ...base, category: 'food' }).success, false)
    assert.equal(lostItemCreateSchema.safeParse({ ...base, ownerName: 'Deniz' }).success, false)
    assert.equal(lostItemCreateSchema.safeParse({ ...base, foundOn: '2026-02-30' }).success, false)
    assert.equal(lostItemCreateSchema.safeParse({ ...base, description: 'a' }).success, false)
  })

  test('bulunma günü gelecekte ve 90 günden eski olamaz; bulan etkin personel', () => {
    planLostItemRecord(
      { foundOn: TODAY, finderMembershipId: null },
      { today: TODAY, finder: undefined },
    )
    planLostItemRecord(
      { foundOn: '2026-07-08', finderMembershipId: 'm1' },
      { today: TODAY, finder: staff },
    )
    rejects(
      () =>
        planLostItemRecord(
          { foundOn: '2026-10-07', finderMembershipId: null },
          { today: TODAY, finder: undefined },
        ),
      'lost_item_found_future',
      ['foundOn'],
    )
    rejects(
      () =>
        planLostItemRecord(
          { foundOn: '2026-07-07', finderMembershipId: null },
          { today: TODAY, finder: undefined },
        ),
      'lost_item_found_too_old',
    )
    const withFinder = (finder: { role: string; active: boolean } | null) => () =>
      planLostItemRecord({ foundOn: TODAY, finderMembershipId: 'm1' }, { today: TODAY, finder })
    rejects(withFinder(null), 'lost_item_finder_not_found', ['finderMembershipId'])
    rejects(withFinder({ role: 'veli', active: true }), 'lost_item_finder_not_staff')
    rejects(withFinder({ role: 'ogretmen', active: false }), 'lost_item_finder_inactive')
  })

  test('düzeltme yalnız bekleyen eşyada, değişen alanları döndürür; değişiklik yoksa 422', () => {
    const input = lostItemUpdateSchema.parse({ storageLocation: 'Depo', finderMembershipId: null })
    const plan = planLostItemUpdate(item(), input, { today: TODAY, finder: undefined })
    assert.deepEqual(plan.changed, ['storageLocation'])
    assert.equal(plan.next.storageLocation, 'Depo')
    assert.equal(plan.next.description, 'Lacivert mont')
    rejects(
      () =>
        planLostItemUpdate(item(), lostItemUpdateSchema.parse({ category: 'clothing' }), {
          today: TODAY,
          finder: undefined,
        }),
      'lost_item_unchanged',
    )
    rejects(
      () =>
        planLostItemUpdate(item(), lostItemUpdateSchema.parse({ foundOn: '2026-10-09' }), {
          today: TODAY,
          finder: undefined,
        }),
      'lost_item_found_future',
    )
    rejects(
      () =>
        planLostItemUpdate(item(), lostItemUpdateSchema.parse({ finderMembershipId: 'm9' }), {
          today: TODAY,
          finder: null,
        }),
      'lost_item_finder_not_found',
    )
    for (const status of ['handed_over', 'donated', 'destroyed'] as const)
      rejects(
        () => planLostItemUpdate(item({ status }), input, { today: TODAY, finder: undefined }),
        'lost_item_closed',
      )
    assert.equal(lostItemUpdateSchema.safeParse({}).success, false)
  })

  test('fotoğraf en çok üç; kapanmış eşyaya eklenmez', () => {
    planLostItemPhotoAdd(item(), 2)
    rejects(() => planLostItemPhotoAdd(item(), 3), 'lost_item_photo_limit', ['fileId'])
    rejects(() => planLostItemPhotoAdd(item({ status: 'handed_over' }), 0), 'lost_item_closed')
    assert.ok(FILE_PURPOSES[LOST_ITEM_PHOTO_PURPOSE].mimeTypes.includes('image/webp'))
  })
})

describe('DOM-FIN-145: teslim (K-490)', () => {
  const handover = (body: Record<string, unknown>) => lostItemHandoverSchema.parse(body)
  test('teslim alan türüne göre alanlar zorunlu ya da yasak', () => {
    assert.equal(handover({ recipientType: 'student', studentId: 's1' }).recipientName, null)
    const bad = (body: Record<string, unknown>) =>
      lostItemHandoverSchema.safeParse(body).error?.issues.map((issue) => issue.path.join('.'))
    assert.deepEqual(bad({ recipientType: 'student' }), ['studentId'])
    assert.deepEqual(bad({ recipientType: 'guardian', studentId: 's1' }), ['guardianLinkId'])
    assert.deepEqual(bad({ recipientType: 'other', recipientName: ' A ' }), ['recipientName'])
    assert.deepEqual(bad({ recipientType: 'other', recipientName: 'Ali Usta', studentId: 's1' }), [
      'studentId',
    ])
    assert.deepEqual(
      bad({
        recipientType: 'student',
        studentId: 's1',
        guardianLinkId: 'g1',
        recipientName: 'X Y',
      }),
      ['guardianLinkId', 'recipientName'],
    )
  })

  test('öğrenci kurumda, veli öğrencinin kısıtsız bağı olmalı; kapanmış eşya teslim edilmez', () => {
    planLostItemHandover(item(), handover({ recipientType: 'student', studentId: 's1' }), {
      studentExists: true,
      guardian: undefined,
    })
    planLostItemHandover(item(), handover({ recipientType: 'other', recipientName: 'Ali Usta' }), {
      studentExists: undefined,
      guardian: undefined,
    })
    const guardian = handover({ recipientType: 'guardian', studentId: 's1', guardianLinkId: 'g1' })
    planLostItemHandover(item(), guardian, {
      studentExists: true,
      guardian: { contactRestricted: false },
    })
    rejects(
      () => planLostItemHandover(item(), guardian, { studentExists: false, guardian: null }),
      'lost_item_student_not_found',
    )
    rejects(
      () => planLostItemHandover(item(), guardian, { studentExists: true, guardian: null }),
      'lost_item_guardian_not_found',
    )
    rejects(
      () =>
        planLostItemHandover(item(), guardian, {
          studentExists: true,
          guardian: { contactRestricted: true },
        }),
      'lost_item_guardian_restricted',
    )
    rejects(
      () =>
        planLostItemHandover(item({ status: 'handed_over' }), guardian, {
          studentExists: true,
          guardian: { contactRestricted: false },
        }),
      'lost_item_closed',
    )
    rejects(() => assertLostItemOpen({ status: 'donated' }), 'lost_item_closed')
  })
})

describe('DOM-FIN-145: saklama, bağış ve imha (K-492)', () => {
  const target = (overrides: Partial<LostItemDisposalTarget> = {}): LostItemDisposalTarget => ({
    id: ID,
    status: 'pending',
    foundOn: '2026-09-06',
    matched: false,
    ...overrides,
  })
  test('süre bulunma gününden sayılır; süresi dolan, eşlenmemiş bekleyen eşya kapatılır', () => {
    assert.equal(lostItemRetentionDueOn('2026-09-06', 30), TODAY)
    const checks = { retentionDays: 30, today: TODAY }
    assertLostItemDisposal({ itemIds: [ID] }, new Map([[ID, target()]]), checks)
    const fails = (found: LostItemDisposalTarget, code: string) =>
      rejects(
        () =>
          assertLostItemDisposal(
            { itemIds: [OTHER, ID] },
            new Map([
              [OTHER, target({ id: OTHER })],
              [ID, found],
            ]),
            checks,
          ),
        code,
        ['itemIds', '1'],
      )
    fails(target({ foundOn: '2026-09-07' }), 'lost_item_retention_not_due')
    fails(target({ matched: true }), 'lost_item_matched')
    fails(target({ status: 'handed_over' }), 'lost_item_closed')
    rejects(
      () => assertLostItemDisposal({ itemIds: [ID] }, new Map(), checks),
      'lost_item_not_found',
    )
  })

  test('toplu işlem gerekçe ister, 1–100 tekil eşya', () => {
    const ok = lostItemDisposalSchema.parse({
      itemIds: [ID],
      outcome: 'donated',
      reason: ' Kızılay ',
    })
    assert.equal(ok.reason, 'Kızılay')
    assert.equal(
      lostItemDisposalSchema.safeParse({ itemIds: [ID], outcome: 'donated', reason: '' }).success,
      false,
    )
    assert.equal(
      lostItemDisposalSchema.safeParse({ itemIds: [], outcome: 'destroyed', reason: 'Bozuk' })
        .success,
      false,
    )
    assert.equal(
      lostItemDisposalSchema.safeParse({ itemIds: [ID, ID], outcome: 'destroyed', reason: 'Bozuk' })
        .success,
      false,
    )
    assert.equal(
      lostItemDisposalSchema.safeParse({ itemIds: [ID], outcome: 'sold', reason: 'Satış' }).success,
      false,
    )
  })

  test('ayar: varsayılan 30 gün ve açık galeri; 7–365 gün; değişiklik yoksa 422', () => {
    assert.deepEqual(DEFAULT_LOST_ITEM_SETTINGS, { retentionDays: 30, familyGalleryEnabled: true })
    const plan = planLostItemSettings(
      DEFAULT_LOST_ITEM_SETTINGS,
      lostItemSettingsSchema.parse({ familyGalleryEnabled: false }),
    )
    assert.deepEqual(plan.changed, ['familyGalleryEnabled'])
    assert.equal(plan.next.retentionDays, 30)
    rejects(
      () =>
        planLostItemSettings(
          DEFAULT_LOST_ITEM_SETTINGS,
          lostItemSettingsSchema.parse({ retentionDays: 30 }),
        ),
      'lost_item_settings_unchanged',
    )
    assert.equal(lostItemSettingsSchema.safeParse({ retentionDays: 6 }).success, false)
    assert.equal(lostItemSettingsSchema.safeParse({ retentionDays: 366 }).success, false)
    assert.equal(lostItemSettingsSchema.safeParse({}).success, false)
  })
})

describe('DOM-FIN-145: kayıp bildirimi ve eşleme (K-491)', () => {
  test('bildirim günü gelecekte ve 90 günden eski olamaz; kategori isteğe bağlı', () => {
    const parsed = lostReportCreateSchema.parse({
      studentId: 's1',
      description: 'Mavi suluk',
      lostOn: TODAY,
    })
    assert.equal(parsed.category, null)
    planLostReport(parsed, TODAY)
    rejects(() => planLostReport({ lostOn: '2026-10-07' }, TODAY), 'lost_report_future', ['lostOn'])
    rejects(() => planLostReport({ lostOn: '2026-07-01' }, TODAY), 'lost_report_too_old')
  })

  test('eşleme açık bildirim ve eşlenmemiş bekleyen eşya ister; eşleme kaldırılır, bildirim kapanır', () => {
    const open = { status: 'open' as const, matchedItemId: null }
    planLostReportMatch(open, { status: 'pending', matchedReportId: null })
    rejects(
      () => planLostReportMatch(open, { status: 'pending', matchedReportId: OTHER }),
      'lost_item_already_matched',
    )
    rejects(
      () => planLostReportMatch(open, { status: 'donated', matchedReportId: null }),
      'lost_item_closed',
    )
    rejects(
      () =>
        planLostReportMatch(
          { status: 'matched', matchedItemId: ID },
          { status: 'pending', matchedReportId: null },
        ),
      'lost_report_not_open',
    )
    planLostReportUnmatch({ status: 'matched', matchedItemId: ID })
    rejects(() => planLostReportUnmatch(open), 'lost_report_not_matched')
    planLostReportClose(open)
    planLostReportClose({ status: 'matched', matchedItemId: ID })
    rejects(
      () => planLostReportClose({ status: 'returned', matchedItemId: ID }),
      'lost_report_not_open',
    )
    rejects(
      () => planLostReportClose({ status: 'closed', matchedItemId: null }),
      'lost_report_not_open',
    )
  })
})
