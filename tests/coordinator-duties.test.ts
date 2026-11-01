import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  coordinatesArea,
  coordinatorScopeOf,
  dutyKindFor,
  isCoordinator,
  NO_COORDINATOR_SCOPE,
  planCoordinatorDuty,
} from '../packages/school-core/src/lib/coordinator-duties.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const teacher = { role: 'ogretmen' as const, teacherSubjectId: 'matematik' }
const plan = (input: Partial<Parameters<typeof planCoordinatorDuty>[0]> = {}) =>
  planCoordinatorDuty({
    institutionType: 'school',
    member: teacher,
    active: [],
    input: { membershipId: 'test-m1', scopeId: 'matematik' },
    ...input,
  })

describe('zümre başkanı ve akademik koordinatör (DOM-YTK-027)', () => {
  test('DOM-YTK-027 görev türü kurum türünden gelir; zümre başkanı kendi branşında', () => {
    assert.equal(dutyKindFor('school'), 'subject_head')
    assert.equal(dutyKindFor('language_school'), 'academic_coordinator')
    assert.deepEqual(plan(), {
      membershipId: 'test-m1',
      kind: 'subject_head',
      scopeId: 'matematik',
    })
    assert.throws(
      () => plan({ input: { membershipId: 'test-m1', scopeId: 'fizik' } }),
      isDomainError('duty_outside_branch', 'rule'),
    )
    assert.throws(
      () => plan({ member: { role: 'ogretmen', teacherSubjectId: null } }),
      isDomainError('teacher_record_required', 'rule'),
    )
  })

  test('DOM-YTK-027 yalnız öğretmene verilir; dil okulunda geçerli CEFR seviyesi', () => {
    for (const role of ['yonetici', 'onburo', 'ogrenci', 'veli'] as const)
      assert.throws(
        () => plan({ member: { role, teacherSubjectId: 'matematik' } }),
        isDomainError('duty_requires_teacher', 'rule'),
      )
    const language = (scopeId: string) =>
      plan({
        institutionType: 'language_school',
        member: { role: 'ogretmen', teacherSubjectId: null },
        input: { membershipId: 'test-m1', scopeId },
      })
    assert.deepEqual(language('B1+'), {
      membershipId: 'test-m1',
      kind: 'academic_coordinator',
      scopeId: 'B1+',
    })
    assert.throws(() => language('C1+'), isDomainError('invalid_cefr_level', 'rule'))
  })

  test('DOM-YTK-027 aynı görev ikinci kez verilmez (409); boş ve fazladan alan Zod hatası', () => {
    const active = [
      {
        id: 'test-d1',
        membershipId: 'test-m1',
        kind: 'subject_head' as const,
        scopeId: 'matematik',
      },
    ]
    assert.throws(() => plan({ active }), isDomainError('coordinator_duty_exists', 'conflict'))
    assert.doesNotThrow(() =>
      plan({ active, input: { membershipId: 'test-m2', scopeId: 'matematik' } }),
    )
    assert.throws(() => plan({ input: { membershipId: 'test-m1', scopeId: ' ' } }), ZodError)
    assert.throws(
      () => plan({ input: { membershipId: 'test-m1', scopeId: 'matematik', extra: 1 } }),
      ZodError,
    )
  })

  test('DOM-YTK-027 kapsam: ders zümre başkanının, seviye koordinatörün; etiketsiz alan kapsam dışı', () => {
    const scope = coordinatorScopeOf([
      { kind: 'subject_head', scopeId: 'matematik' },
      { kind: 'academic_coordinator', scopeId: 'B1' },
      { kind: 'academic_coordinator', scopeId: 'bilinmeyen' },
    ])
    assert.deepEqual(scope, { subjectIds: ['matematik'], cefrLevels: ['B1'] })
    assert.equal(isCoordinator(scope), true)
    assert.equal(isCoordinator(NO_COORDINATOR_SCOPE), false)
    assert.equal(coordinatesArea(scope, { subjectId: 'matematik', cefrLevel: null }), true)
    assert.equal(coordinatesArea(scope, { subjectId: 'ingilizce', cefrLevel: 'B1' }), true)
    assert.equal(coordinatesArea(scope, { subjectId: 'ingilizce', cefrLevel: 'B1+' }), false)
    assert.equal(coordinatesArea(scope, { subjectId: null, cefrLevel: null }), false)
  })
})
