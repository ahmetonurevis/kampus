import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { GroupWaitlist, GroupWaitlistItem } from '@kampus/react-shared/language-groups.ts'
import {
  canReadWaitlist,
  suggestionSummary,
  WAITLIST_STATUS_LABELS,
  waitlistRows,
  waitlistStatusTone,
} from '../src/pages/language/waitlist-rows.ts'

const COURSE_ID = '00000000-0000-4000-8000-000000000001'
const GROUP_ID = '00000000-0000-4000-8000-0000000000a1'

function entry(overrides: Partial<GroupWaitlistItem> = {}): GroupWaitlistItem {
  return {
    id: '00000000-0000-4000-8000-0000000000b1',
    courseId: COURSE_ID,
    groupId: GROUP_ID,
    studentId: 's1',
    prospectId: null,
    requestedAt: '2026-11-01T09:00:00.000Z',
    status: 'waiting',
    position: 1,
    offerGroupId: null,
    offeredAt: null,
    offerExpiresAt: null,
    ...overrides,
  }
}

function waitlist(
  entries: GroupWaitlistItem[],
  suggestion: Partial<GroupWaitlist['suggestion']> = {},
): GroupWaitlist {
  return { entries, suggestion: { expire: [], offers: [], ...suggestion } }
}

const names = new Map([['s1', 'Lale Sezer']])

test('DOM-DIL-043: bekleme sırası sekmesini yalnız yönetici ve ön büro görür', () => {
  assert.equal(canReadWaitlist('yonetici'), true)
  assert.equal(canReadWaitlist('onburo'), true)
  for (const role of ['ogretmen', 'ogrenci', 'veli', undefined] as const)
    assert.equal(canReadWaitlist(role), false, String(role))
})

test('DOM-DIL-043: sıra satırı sırayı, kişiyi, kapsamı ve durumu gösterir', () => {
  const rows = waitlistRows(
    waitlist([
      entry(),
      entry({
        id: '00000000-0000-4000-8000-0000000000b2',
        groupId: null,
        studentId: 's9',
        position: 2,
      }),
      entry({
        id: '00000000-0000-4000-8000-0000000000b3',
        studentId: null,
        prospectId: 'pr1',
        position: 3,
      }),
    ]),
    names,
  )
  assert.deepEqual(
    rows.map((row) => [row.position, row.person, row.scope, row.status, row.note]),
    [
      ['1.', 'Lale Sezer', 'Bu grup', 'Sırada', null],
      // Kapsam dışı öğrencinin adı yok; kurun herhangi bir grubu için bekliyor.
      ['2.', 'Kursiyer', 'Kurun herhangi bir grubu', 'Sırada', null],
      ['3.', 'Aday', 'Bu grup', 'Sırada', null],
    ],
  )
  assert.match(rows[0]!.requested, /1 Kas 2026 12:00/)
})

test('DOM-DIL-043: açık teklifin son anı ve core önerisi bilgi notu olur', () => {
  const offered = entry({
    id: '00000000-0000-4000-8000-0000000000c1',
    status: 'offered',
    position: null,
    offerGroupId: GROUP_ID,
    offeredAt: '2026-11-01T10:00:00.000Z',
    offerExpiresAt: '2026-11-03T10:00:00.000Z',
  })
  const expired = { ...offered, id: '00000000-0000-4000-8000-0000000000c2' }
  const waiting = entry()
  const rows = waitlistRows(
    waitlist([waiting, offered, expired], {
      offers: [{ entryId: waiting.id, offerExpiresAt: '2026-11-04T09:00:00.000Z' }],
      expire: [expired.id],
    }),
    names,
  )
  assert.match(rows[0]!.note ?? '', /^Teklif önerisi: 4 Kas 2026 12:00 tarihine kadar\.$/)
  assert.equal(rows[1]!.position, '—')
  assert.equal(rows[1]!.status, 'Teklif edildi')
  assert.match(rows[1]!.note ?? '', /^Teklif son günü: 3 Kas 2026 13:00$/)
  assert.equal(rows[2]!.note, 'Teklif süresi doldu; sonuçlandırılmalı.')
})

test('DOM-DIL-043: öneri özeti teklif ve süresi dolan sayısını verir; öneri yoksa null', () => {
  assert.equal(suggestionSummary(waitlist([entry()])), null)
  assert.equal(
    suggestionSummary(
      waitlist([entry()], {
        offers: [{ entryId: entry().id, offerExpiresAt: '2026-11-04T09:00:00.000Z' }],
        expire: ['00000000-0000-4000-8000-0000000000c2'],
      }),
    ),
    'Boş yer için 1 kişiye 48 saatlik teklif önerilir · 1 teklifin süresi doldu',
  )
})

test('DOM-DIL-043: her bekleme durumunun etiketi ve tonu var', () => {
  for (const status of Object.keys(
    WAITLIST_STATUS_LABELS,
  ) as (keyof typeof WAITLIST_STATUS_LABELS)[])
    assert.ok(waitlistStatusTone(status), status)
  assert.equal(waitlistStatusTone('accepted'), 'green')
})
