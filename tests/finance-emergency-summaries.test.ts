import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { DomainError } from '../packages/school-core/src/lib/errors.ts'
import {
  assertEmergencyClassVisible,
  canViewEmergencyClass,
  emergencyAlertFlags,
  emergencyAlertLabels,
  emergencyCardPurposeSchema,
  emergencyContactPhone,
  emergencyContactPositionSchema,
  emergencyContacts,
  emergencySummaryCreateSchema,
  emergencySummaryNeedsReview,
  emergencySummaryState,
  emergencySummaryUpdateSchema,
  emergencyViewerClasses,
  planEmergencySummaryApproval,
  planEmergencySummaryCreate,
  planEmergencySummaryUpdate,
  type EmergencyContactSource,
} from '../packages/school-core/src/lib/finance-emergency-summaries.ts'

/** Acil durum özeti kuralları (DOM-FIN-155; ON-165; K-520…K-522). */

const ACTION = 'Arı sokmasında adrenalin kalem çantada; 112 ara.'

function rejects(run: () => unknown, code: string, kind: DomainError['kind'] = 'rule') {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof DomainError, String(error))
    assert.equal(error.code, code)
    assert.equal(error.kind, kind)
    return true
  })
}

describe('DOM-FIN-155: şemalar', () => {
  test('DOM-FIN-155: acil eylem 10–500 karakter, kırpılır; bilinmeyen alan reddedilir', () => {
    assert.equal(
      emergencySummaryCreateSchema.parse({ studentId: ' s-1 ', actionText: `  ${ACTION} ` })
        .actionText,
      ACTION,
    )
    assert.equal(emergencySummaryUpdateSchema.safeParse({ actionText: 'kısa' }).success, false)
    assert.equal(
      emergencySummaryUpdateSchema.safeParse({ actionText: 'a'.repeat(501) }).success,
      false,
    )
    assert.equal(
      emergencySummaryCreateSchema.safeParse({ studentId: 's-1', actionText: ACTION, x: 1 })
        .success,
      false,
    )
    assert.equal(
      emergencySummaryCreateSchema.safeParse({ studentId: '', actionText: ACTION }).success,
      false,
    )
  })

  test('DOM-FIN-155: kart amacı varsayılan view; kişi sırası 1 ya da 2', () => {
    assert.equal(emergencyCardPurposeSchema.parse(undefined), 'view')
    assert.equal(emergencyCardPurposeSchema.safeParse('csv').success, false)
    assert.equal(emergencyContactPositionSchema.parse('2'), 2)
    assert.equal(emergencyContactPositionSchema.safeParse('3').success, false)
    assert.equal(emergencyContactPositionSchema.safeParse('0').success, false)
  })
})

describe('DOM-FIN-155: durum ve onay (K-520)', () => {
  test('K-520: durum taslak, yayında ya da değişiklik onay bekliyor', () => {
    assert.equal(emergencySummaryState({ hasDraft: true, hasPublished: false }), 'draft')
    assert.equal(emergencySummaryState({ hasDraft: false, hasPublished: true }), 'published')
    assert.equal(emergencySummaryState({ hasDraft: true, hasPublished: true }), 'pending_revision')
  })

  test('K-520: yeni özet taslaktır; olmayan, ayrılmış öğrenci ve ikinci özet reddedilir', () => {
    const input = emergencySummaryCreateSchema.parse({ studentId: 's-1', actionText: ACTION })
    assert.deepEqual(
      planEmergencySummaryCreate(input, { student: { active: true }, summaryExists: false }),
      { studentId: 's-1', draft: ACTION },
    )
    rejects(
      () => planEmergencySummaryCreate(input, { student: null, summaryExists: false }),
      'emergency_summary_student_not_found',
    )
    rejects(
      () => planEmergencySummaryCreate(input, { student: { active: false }, summaryExists: false }),
      'emergency_summary_student_inactive',
    )
    rejects(
      () => planEmergencySummaryCreate(input, { student: { active: true }, summaryExists: true }),
      'emergency_summary_exists',
      'conflict',
    )
  })

  test('K-520: düzeltme taslak olur; yayındaki metne dönüş taslağı kaldırır; aynı metin 422', () => {
    const next = { actionText: 'Astım krizinde inhaler sırt çantasında; veliyi ara.' }
    assert.deepEqual(planEmergencySummaryUpdate({ draft: ACTION, published: null }, next), {
      draft: next.actionText,
    })
    assert.deepEqual(planEmergencySummaryUpdate({ draft: null, published: ACTION }, next), {
      draft: next.actionText,
    })
    assert.deepEqual(
      planEmergencySummaryUpdate(
        { draft: next.actionText, published: ACTION },
        { actionText: ACTION },
      ),
      { draft: null },
    )
    rejects(
      () => planEmergencySummaryUpdate({ draft: ACTION, published: null }, { actionText: ACTION }),
      'emergency_summary_unchanged',
    )
    rejects(
      () => planEmergencySummaryUpdate({ draft: null, published: ACTION }, { actionText: ACTION }),
      'emergency_summary_unchanged',
    )
  })

  test('K-520: onay taslağı yayına alır ve profil damgasını saklar', () => {
    const stamp = { version: 3, updatedAt: '2026-10-05T08:00:00.000Z' }
    assert.deepEqual(
      planEmergencySummaryApproval({ draft: ACTION, published: null, reviewed: null }, stamp),
      { published: ACTION, reviewed: stamp },
    )
  })

  test('K-520: profil değişince gözden geçirilmeli; metni değiştirmeden yeniden onaylanır', () => {
    const before = { version: 2, updatedAt: '2026-10-01T08:00:00.000Z' }
    const after = { version: 3, updatedAt: '2026-10-05T08:00:00.000Z' }
    assert.equal(emergencySummaryNeedsReview(before, before), false)
    assert.equal(emergencySummaryNeedsReview(before, after), true)
    // Arşivlenip yeniden açılan profil aynı sürümle başlar: an farkı da sayılır.
    assert.equal(
      emergencySummaryNeedsReview(before, { version: 2, updatedAt: '2026-10-09T08:00:00.000Z' }),
      true,
    )
    assert.equal(emergencySummaryNeedsReview(null, after), false)
    assert.deepEqual(
      planEmergencySummaryApproval({ draft: null, published: ACTION, reviewed: before }, after),
      { published: ACTION, reviewed: after },
    )
    rejects(
      () =>
        planEmergencySummaryApproval({ draft: null, published: ACTION, reviewed: after }, after),
      'emergency_summary_nothing_to_approve',
    )
  })
})

describe('DOM-FIN-155: uyarı işaretleri (K-522)', () => {
  test('K-522: işaretler liste varlığından; ad ve tanı dönmez', () => {
    assert.deepEqual(emergencyAlertFlags(null), {
      allergy: false,
      chronic: false,
      medication: false,
    })
    const flags = emergencyAlertFlags({
      allergies: [{ name: 'Arı' }],
      chronicConditions: [],
      medications: [{ name: 'X' }],
    })
    assert.deepEqual(flags, { allergy: true, chronic: false, medication: true })
    assert.deepEqual(emergencyAlertLabels(flags), ['Alerji', 'Düzenli ilaç'])
    assert.ok(!JSON.stringify(flags).includes('Arı'))
  })
})

describe('DOM-FIN-155: görenler (K-521)', () => {
  const teacher = {
    role: 'ogretmen' as const,
    homeroomClassIds: ['9-A'],
    teachingClassIds: ['9-B'],
  }

  test('K-521: yönetici ve ön büro bütün sınıflar; öğretmen sınıf öğretmeni ve derse girdiği', () => {
    assert.equal(emergencyViewerClasses({ role: 'yonetici' }), 'all')
    assert.equal(emergencyViewerClasses({ role: 'onburo' }), 'all')
    assert.deepEqual([...(emergencyViewerClasses(teacher) as Set<string>)], ['9-A', '9-B'])
    assert.equal(canViewEmergencyClass(teacher, '9-A'), true)
    assert.equal(canViewEmergencyClass(teacher, '9-B'), true)
    assert.equal(canViewEmergencyClass(teacher, '10-A'), false)
    assert.equal(canViewEmergencyClass(teacher, null), false)
    assert.equal(canViewEmergencyClass({ role: 'onburo' }, null), true)
  })

  test('K-521: veli, öğrenci ve kapsam dışı öğretmen 404 alır', () => {
    rejects(
      () => assertEmergencyClassVisible({ role: 'veli' }, '9-A'),
      'emergency_summary_not_found',
      'not_found',
    )
    rejects(
      () => assertEmergencyClassVisible({ role: 'ogrenci' }, '9-A'),
      'emergency_summary_not_found',
      'not_found',
    )
    rejects(
      () => assertEmergencyClassVisible(teacher, '10-A'),
      'emergency_summary_not_found',
      'not_found',
    )
    assert.doesNotThrow(() => assertEmergencyClassVisible(teacher, '9-B'))
  })
})

describe('DOM-FIN-155: acil iletişim (K-501)', () => {
  const source = (overrides: Partial<EmergencyContactSource> = {}): EmergencyContactSource => ({
    links: [
      {
        parentId: 'p-1',
        membershipId: null,
        relationship: 'mother',
        custody: 'custodial',
        contactRestricted: false,
      },
      {
        parentId: 'p-2',
        membershipId: null,
        relationship: 'father',
        custody: 'custodial',
        contactRestricted: true,
      },
      {
        parentId: 'p-3',
        membershipId: null,
        relationship: 'other',
        custody: 'joint',
        contactRestricted: false,
      },
    ],
    memberNames: new Map(),
    parents: new Map([
      ['p-1', { id: 'p-1', name: 'Ayşe Yılmaz', phone: '0532 111 22 12', relationship: null }],
      ['p-2', { id: 'p-2', name: 'Kısıtlı Veli', phone: '0533 000 00 00', relationship: null }],
      ['p-3', { id: 'p-3', name: 'Ali Yılmaz', phone: null, relationship: null }],
    ]),
    studentParentId: 'p-2',
    ...overrides,
  })

  test('K-501: velayetli ve kısıtsız en çok iki kişi, telefon maskeli', () => {
    const contacts = emergencyContacts(source())
    assert.deepEqual(contacts, [
      {
        position: 1,
        name: 'Ayşe Yılmaz',
        relationship: 'mother',
        phoneMasked: '0532 *** ** 12',
        hasPhone: true,
      },
      {
        position: 2,
        name: 'Ali Yılmaz',
        relationship: 'other',
        phoneMasked: null,
        hasPhone: false,
      },
    ])
    assert.ok(!JSON.stringify(contacts).includes('Kısıtlı'))
  })

  test('K-521: tam telefon sıradaki kişinin; kişi yoksa 404, telefon yoksa 422', () => {
    assert.deepEqual(emergencyContactPhone(source(), 1), {
      position: 1,
      name: 'Ayşe Yılmaz',
      relationship: 'mother',
      phone: '0532 111 22 12',
    })
    rejects(() => emergencyContactPhone(source(), 2), 'emergency_contact_phone_missing')
    rejects(
      () => emergencyContactPhone(source({ links: [], studentParentId: null }), 1),
      'emergency_contact_not_found',
      'not_found',
    )
  })
})
