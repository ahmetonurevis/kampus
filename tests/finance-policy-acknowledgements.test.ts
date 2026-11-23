import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  acknowledgementRate,
  assertPolicyAcknowledgement,
  audienceIncludesRole,
  planPolicyVersion,
  policyAcknowledgementInputSchema,
  policyDocumentInputSchema,
  type PolicyAckChecks,
} from '../packages/school-core/src/lib/finance-policy-acknowledgements.ts'
import { DomainError } from '../packages/school-core/src/lib/errors.ts'

/** Politika belgesi okundu onayı kuralları (DOM-FIN-127; ON-190; K-436…K-438). */

const TODAY = '2026-10-06'
const FILE = '00000000-0000-4000-8000-000000000001'
const DOC = '00000000-0000-4000-8000-000000000002'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return 'none'
}

const checks = (overrides: Partial<PolicyAckChecks> = {}): PolicyAckChecks => ({
  document: { audience: 'all_staff', publishedOn: '2026-09-01', supersededAt: null },
  staff: { role: 'ogretmen', active: true },
  alreadyAcknowledged: false,
  today: TODAY,
  ...overrides,
})

describe('DOM-FIN-127: politika onayı kuralı', () => {
  test('hedef kitle rolleri (K-438)', () => {
    assert.equal(audienceIncludesRole('all_staff', 'onburo'), true)
    assert.equal(audienceIncludesRole('teachers', 'ogretmen'), true)
    assert.equal(audienceIncludesRole('teachers', 'yonetici'), false)
    assert.equal(audienceIncludesRole('administrative', 'yonetici'), true)
    assert.equal(audienceIncludesRole('administrative', 'ogretmen'), false)
    assert.equal(audienceIncludesRole('all_staff', 'veli'), false)
  })

  test('onay oranı yuvarlanır; hedef yoksa null', () => {
    assert.equal(acknowledgementRate(1, 3), 33)
    assert.equal(acknowledgementRate(2, 3), 67)
    assert.equal(acknowledgementRate(0, 0), null)
  })

  test('belge şeması: PDF zorunlu, yeni sürüm isteğe bağlı', () => {
    const parsed = policyDocumentInputSchema.parse({
      title: ' Personel yönetmeliği ',
      policyType: 'staff_regulation',
      audience: 'all_staff',
      publishedOn: '2026-09-01',
      fileId: FILE,
    })
    assert.equal(parsed.title, 'Personel yönetmeliği')
    assert.equal(parsed.replacesDocumentId, null)
    assert.equal(
      policyDocumentInputSchema.safeParse({ ...parsed, fileId: undefined }).success,
      false,
    )
  })

  test('onay şeması personel kendi kanalını (self_service) kabul etmez (K-437)', () => {
    const base = {
      policyDocumentId: DOC,
      membershipId: 'm-1',
      acknowledgedOn: '2026-09-15',
      channel: 'wet_signature',
    }
    assert.equal(policyAcknowledgementInputSchema.parse(base).scanFileId, null)
    assert.equal(
      policyAcknowledgementInputSchema.safeParse({ ...base, channel: 'self_service' }).success,
      false,
    )
  })

  test('yeni sürüm planı (K-436)', () => {
    const input = { publishedOn: '2026-10-01', replacesDocumentId: null }
    assert.deepEqual(planPolicyVersion(input, { previous: null, today: TODAY }), {
      seriesId: null,
      version: 1,
      supersedes: null,
    })
    const previous = {
      id: DOC,
      seriesId: 's-1',
      version: 2,
      publishedOn: '2026-09-01',
      supersededAt: null,
    }
    assert.deepEqual(
      planPolicyVersion({ ...input, replacesDocumentId: DOC }, { previous, today: TODAY }),
      { seriesId: 's-1', version: 3, supersedes: DOC },
    )
    assert.equal(
      code(() =>
        planPolicyVersion({ ...input, publishedOn: '2026-10-07' }, { previous, today: TODAY }),
      ),
      'policy_published_in_future',
    )
    assert.equal(
      code(() =>
        planPolicyVersion({ ...input, replacesDocumentId: DOC }, { previous: null, today: TODAY }),
      ),
      'policy_previous_not_found',
    )
    assert.equal(
      code(() =>
        planPolicyVersion(
          { ...input, replacesDocumentId: DOC },
          { previous: { ...previous, supersededAt: '2026-09-10T00:00:00.000Z' }, today: TODAY },
        ),
      ),
      'policy_previous_superseded',
    )
    assert.equal(
      code(() =>
        planPolicyVersion(
          { publishedOn: '2026-08-01', replacesDocumentId: DOC },
          { previous, today: TODAY },
        ),
      ),
      'policy_published_before_previous',
    )
  })

  test('onay kaydı kuralları (K-436…K-438)', () => {
    const input = { acknowledgedOn: '2026-09-15' }
    assert.equal(
      code(() => assertPolicyAcknowledgement(input, checks())),
      'none',
    )
    const cases: [Partial<PolicyAckChecks>, string, string?][] = [
      [{ document: null }, 'policy_not_found'],
      [
        {
          document: {
            audience: 'all_staff',
            publishedOn: '2026-09-01',
            supersededAt: '2026-10-01T00:00:00.000Z',
          },
        },
        'policy_version_superseded',
      ],
      [{ staff: null }, 'policy_staff_not_found'],
      [{ staff: { role: 'veli', active: true } }, 'policy_not_staff'],
      [{ staff: { role: 'ogretmen', active: false } }, 'policy_staff_inactive'],
      [
        { document: { audience: 'administrative', publishedOn: '2026-09-01', supersededAt: null } },
        'policy_not_in_audience',
      ],
      [{}, 'policy_ack_in_future', '2026-10-07'],
      [{}, 'policy_ack_before_publish', '2026-08-31'],
      [{ alreadyAcknowledged: true }, 'policy_already_acknowledged'],
    ]
    for (const [overrides, expected, day] of cases)
      assert.equal(
        code(() =>
          assertPolicyAcknowledgement({ acknowledgedOn: day ?? '2026-09-15' }, checks(overrides)),
        ),
        expected,
      )
  })
})
