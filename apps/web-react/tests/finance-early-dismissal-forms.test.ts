import assert from 'node:assert/strict'
import test from 'node:test'

import {
  authorizedPickupText,
  dismissalStatusBadge,
  dismissalTimeText,
  effectText,
  OTHER_PICKUP,
  pickupText,
  rejectFormSchema,
  releaseBody,
  releaseDefaults,
  releaseFormField,
  releaseFormSchema,
  requestBody,
  requestDefaults,
  requestFormField,
  requestFormSchema,
} from '../src/pages/finance/finance-early-dismissal-forms.ts'

// Erken çıkış sekmesinin saf mantığı (DOM-FIN-161; ON-168; K-538…K-540).

const issuesOf = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((issue) => issue.path.join('.')) ?? []
const LINK = '00000000-0000-4000-8000-000000000001'
// İstanbul 12:03.
const NOW = new Date('2026-10-06T09:03:00.000Z')

test('DOM-FIN-161: acil talep varsayılanı bugün, yarım saat sonrası; teslim alan zorunlu (K-538)', () => {
  const values = requestDefaults(NOW)
  assert.equal(values.date, '2026-10-06')
  assert.equal(values.time, '12:35')
  assert.deepEqual(issuesOf(requestFormSchema.safeParse(values)), ['studentId', 'guardianLinkId'])
  const ready = { ...values, studentId: 's-1', guardianLinkId: LINK }
  assert.equal(requestFormSchema.safeParse(ready).success, true)
  assert.deepEqual(requestBody(ready), {
    studentId: 's-1',
    date: '2026-10-06',
    time: '12:35',
    reason: 'appointment',
    reasonNote: null,
    pickup: { kind: 'guardian', guardianLinkId: LINK },
  })
  assert.deepEqual(issuesOf(requestFormSchema.safeParse({ ...ready, reason: 'other' })), [
    'reasonNote',
  ])
  // Gece yarısını aşan varsayılan aynı güne sıkışır.
  assert.equal(requestDefaults(new Date('2026-10-06T20:50:00.000Z')).time, '23:55')
})

test('DOM-FIN-161: kayıtlı olmayan kişi ad, son dört hane ve yakınlık ister; tam numara geçmez (K-538)', () => {
  const values = {
    ...requestDefaults(NOW),
    studentId: 's-1',
    pickupKind: 'other' as const,
  }
  assert.deepEqual(issuesOf(requestFormSchema.safeParse(values)), [
    'pickupName',
    'idLast4',
    'relationship',
  ])
  const filled = {
    ...values,
    pickupName: 'Hasan Yılmaz',
    idLast4: 'ab12',
    relationship: 'grandparent' as const,
  }
  assert.equal(requestFormSchema.safeParse(filled).success, true)
  assert.deepEqual(requestBody(filled).pickup, {
    kind: 'other',
    name: 'Hasan Yılmaz',
    idLast4: 'AB12',
    relationship: 'grandparent',
  })
  assert.deepEqual(issuesOf(requestFormSchema.safeParse({ ...filled, idLast4: '12345678901' })), [
    'idLast4',
  ])
  assert.equal(requestFormField('pickup.idLast4'), 'idLast4')
  assert.equal(requestFormField('pickup.guardianLinkId'), 'guardianLinkId')
  assert.equal(requestFormField('time'), 'time')
  assert.equal(requestFormField('studentId'), 'studentId')
  assert.equal(requestFormField('bilinmeyen'), null)
})

test('DOM-FIN-161: teslim formu kimlik onayını ve onaylanan kişide son dört haneyi ister (K-539)', () => {
  const detail = {
    pickupKind: 'other' as const,
    pickupGuardianLinkId: null,
    authorizedPickups: [],
  }
  const values = releaseDefaults(detail)
  assert.equal(values.pickup, OTHER_PICKUP)
  assert.deepEqual(issuesOf(releaseFormSchema.safeParse(values)), ['identityVerified', 'idLast4'])
  const filled = { ...values, identityVerified: true, idLast4: '1234', time: '11:45' }
  assert.equal(releaseFormSchema.safeParse(filled).success, true)
  assert.deepEqual(releaseBody(filled, '2026-10-06'), {
    pickup: { kind: 'other', idLast4: '1234' },
    identityVerified: true,
    releasedAt: '2026-10-06T08:45:00.000Z',
  })
  const guardian = releaseDefaults({
    pickupKind: 'guardian',
    pickupGuardianLinkId: LINK,
    authorizedPickups: [
      {
        guardianLinkId: LINK,
        name: 'Ayşe Yılmaz',
        relationship: 'mother',
        custody: 'full',
        canPickUp: false,
        isSelf: false,
      },
    ],
  })
  assert.equal(guardian.pickup, LINK)
  assert.deepEqual(releaseBody({ ...guardian, identityVerified: true }, '2026-10-06'), {
    pickup: { kind: 'guardian', guardianLinkId: LINK },
    identityVerified: true,
    releasedAt: null,
  })
  // Planlanan bağ artık yetkili değilse seçim boş gelir.
  assert.equal(
    releaseDefaults({ pickupKind: 'guardian', pickupGuardianLinkId: LINK, authorizedPickups: [] })
      .pickup,
    '',
  )
  assert.equal(releaseFormField('pickup.guardianLinkId'), 'pickup')
  assert.equal(releaseFormField('pickup.idLast4'), 'idLast4')
  assert.equal(releaseFormField('releasedAt'), 'time')
  assert.equal(releaseFormField('identityVerified'), 'identityVerified')
  assert.equal(releaseFormField('x'), null)
  assert.equal(rejectFormSchema.safeParse({ reason: 'kısa' }).success, false)
})

test('DOM-FIN-161: satır metinleri ve yoklamaya yansıma cümlesi (K-540)', () => {
  assert.deepEqual(dismissalStatusBadge({ status: 'pending' }), {
    text: 'Onay bekliyor',
    tone: 'amber',
  })
  assert.equal(dismissalStatusBadge({ status: 'released' }).tone, 'green')
  assert.equal(dismissalStatusBadge({ status: 'rejected' }).tone, 'red')
  assert.equal(dismissalStatusBadge({ status: 'cancelled' }).tone, 'gray')
  assert.equal(dismissalStatusBadge({ status: 'approved' }).tone, 'purple')
  assert.equal(
    pickupText({ pickupKind: 'other', pickupName: 'Hasan', pickupRelationship: 'relative' }),
    'Hasan · Diğer akraba (kayıtlı değil)',
  )
  assert.equal(
    pickupText({ pickupKind: 'guardian', pickupName: null, pickupRelationship: null }),
    'Kaldırılmış veli bağı',
  )
  assert.equal(
    authorizedPickupText({
      guardianLinkId: LINK,
      name: 'Hasan',
      relationship: 'other',
      custody: 'none',
      canPickUp: true,
      isSelf: false,
    }),
    'Hasan · Diğer yakın, teslim yetkili',
  )
  assert.equal(
    dismissalTimeText({
      plannedAt: '2026-10-06T10:40:00.000Z',
      releasedAt: '2026-10-06T10:35:00.000Z',
    }),
    '13:40 · çıktı 13:35',
  )
  const effect = {
    basis: 'released' as const,
    departureAt: '2026-10-06T08:55:00.000Z',
    fromPeriod: 4,
    lessons: [],
  }
  assert.equal(effectText(effect), '4. dersten itibaren izinli ayrıldı.')
  assert.equal(effectText({ ...effect, basis: 'planned' }), '4. dersten itibaren izinli ayrılacak.')
  assert.equal(
    effectText({ ...effect, fromPeriod: null }),
    'Dersler bittikten sonra ayrıldı; yoklamaya yansımaz.',
  )
  assert.equal(effectText(null), null)
})
