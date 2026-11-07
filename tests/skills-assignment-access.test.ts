import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import {
  canGradeAssignment,
  canManageAssignment,
  canReadAssignment,
  targetedLearners,
  teacherReachesTarget,
  type AssignmentAccessRow,
  type AssignmentViewer,
} from '../packages/school-core/src/skills/assignment-access.ts'

// DOM-YTK-028: görev atamasının okuma, değiştirme ve puanlama kuralı.

const assignment = (patch: Partial<AssignmentAccessRow> = {}): AssignmentAccessRow => ({
  assignedByUserId: 'u-atayan',
  archivedAt: null,
  targets: [{ kind: 'class', id: 'c-9a' }],
  ...patch,
})

const admin: AssignmentViewer = { kind: 'admin' }
const assigner: AssignmentViewer = {
  kind: 'teacher',
  userId: 'u-atayan',
  classIds: new Set(),
  studentIds: new Set(),
}
const scoped = {
  kind: 'teacher',
  userId: 'u-kapsamda',
  classIds: new Set(['c-9a']),
  studentIds: new Set(['s-deniz']),
} satisfies AssignmentViewer
const outside: AssignmentViewer = {
  kind: 'teacher',
  userId: 'u-disarida',
  classIds: new Set(['c-9b']),
  studentIds: new Set(['s-ece']),
}
const student: AssignmentViewer = {
  kind: 'learner',
  classOf: new Map([['s-deniz', 'c-9a']]),
}
const otherStudent: AssignmentViewer = {
  kind: 'learner',
  classOf: new Map([['s-ece', 'c-9b']]),
}
const guardian: AssignmentViewer = {
  kind: 'learner',
  classOf: new Map([
    ['s-deniz', 'c-9a'],
    ['s-ece', 'c-9b'],
  ]),
}
const frontDesk: AssignmentViewer = { kind: 'none' }

describe('canReadAssignment (DOM-YTK-028)', () => {
  test('yönetici kurumdaki her atamayı görür, arşivli olsa da', () => {
    assert.equal(canReadAssignment(admin, assignment()), true)
    assert.equal(canReadAssignment(admin, assignment({ archivedAt: '2026-01-01T00:00:00Z' })), true)
  })

  test('atayan öğretmen kapsamı dışındaki kendi atamasını görür', () => {
    assert.equal(canReadAssignment(assigner, assignment()), true)
  })

  test('kapsamdaki öğretmen sınıf hedefli atamayı görür, atayan olmasa da', () => {
    assert.equal(canReadAssignment(scoped, assignment()), true)
  })

  test('kapsamdaki öğretmen sınıf hedefi olmayan atamayı o sınıfın öğrencisine hedeflenmişse görür', () => {
    const row = assignment({ targets: [{ kind: 'student', id: 's-deniz' }] })
    assert.equal(canReadAssignment(scoped, row), true)
    assert.equal(canReadAssignment(outside, row), false)
  })

  test('dil okulunda grup hedefi sınıf hedefi gibi okunur', () => {
    const row = assignment({ targets: [{ kind: 'group', id: 'c-9a' }] })
    assert.equal(canReadAssignment(scoped, row), true)
    assert.equal(canReadAssignment(outside, row), false)
  })

  test('kapsam dışı öğretmen başkasının atamasını görmez', () => {
    assert.equal(canReadAssignment(outside, assignment()), false)
  })

  test('sınıf id öğrenci id ile karışmaz: öğrenci hedefi yalnız öğrenci kapsamında aranır', () => {
    const row = assignment({ targets: [{ kind: 'student', id: 'c-9a' }] })
    assert.equal(canReadAssignment(scoped, row), false)
  })

  test('öğrenci güncel sınıfına veya kendisine hedeflenen atamayı görür', () => {
    assert.equal(canReadAssignment(student, assignment()), true)
    assert.equal(
      canReadAssignment(student, assignment({ targets: [{ kind: 'student', id: 's-deniz' }] })),
      true,
    )
    assert.equal(canReadAssignment(otherStudent, assignment()), false)
  })

  test('veli çocuklarından birine hedeflenen atamayı görür', () => {
    assert.equal(canReadAssignment(guardian, assignment()), true)
    assert.equal(
      canReadAssignment(guardian, assignment({ targets: [{ kind: 'class', id: 'c-9b' }] })),
      true,
    )
    assert.equal(
      canReadAssignment(guardian, assignment({ targets: [{ kind: 'class', id: 'c-10a' }] })),
      false,
    )
  })

  test('öğrenci ve veli arşivli atamayı görmez', () => {
    const archived = assignment({ archivedAt: '2026-01-01T00:00:00Z' })
    assert.equal(canReadAssignment(student, archived), false)
    assert.equal(canReadAssignment(guardian, archived), false)
  })

  test('sınıf değiştiren öğrenci eski sınıfın atamasını görmez', () => {
    const moved: AssignmentViewer = { kind: 'learner', classOf: new Map([['s-deniz', 'c-9b']]) }
    assert.equal(canReadAssignment(moved, assignment()), false)
    assert.equal(
      canReadAssignment(moved, assignment({ targets: [{ kind: 'class', id: 'c-9b' }] })),
      true,
    )
  })

  test('ön büro atamayı görmez', () => {
    assert.equal(canReadAssignment(frontDesk, assignment()), false)
  })
})

describe('canManageAssignment (DOM-YTK-028)', () => {
  test('yönetici ve atayan öğretmen değiştirir', () => {
    assert.equal(canManageAssignment({ kind: 'admin' }, assignment()), true)
    assert.equal(canManageAssignment({ kind: 'teacher', userId: 'u-atayan' }, assignment()), true)
  })

  test('atamayı gören ama atayan olmayan öğretmen değiştiremez', () => {
    assert.equal(canReadAssignment(scoped, assignment()), true)
    assert.equal(
      canManageAssignment({ kind: 'teacher', userId: 'u-kapsamda' }, assignment()),
      false,
    )
  })

  test('kapsam dışı öğretmen değiştiremez', () => {
    assert.equal(
      canManageAssignment({ kind: 'teacher', userId: 'u-disarida' }, assignment()),
      false,
    )
  })
})

describe('canGradeAssignment (DOM-YTK-028)', () => {
  test('yönetici puanlar', () => {
    assert.equal(canGradeAssignment(admin, assignment()), true)
  })

  test('atayan ve kapsamdaki öğretmen puanlar', () => {
    assert.equal(canGradeAssignment(assigner, assignment()), true)
    assert.equal(canGradeAssignment(scoped, assignment()), true)
  })

  test('atamayı görmeyen öğretmen puanlayamaz', () => {
    assert.equal(canGradeAssignment(outside, assignment()), false)
  })

  test('öğrenci, veli ve ön büro puanlayamaz', () => {
    assert.equal(canGradeAssignment(student, assignment()), false)
    assert.equal(canGradeAssignment(guardian, assignment()), false)
    assert.equal(canGradeAssignment(frontDesk, assignment()), false)
  })
})

describe('targetedLearners ve teacherReachesTarget', () => {
  test('öğrenci hedefi ve güncel sınıf hedefi sıralı döner', () => {
    const classOf = new Map([
      ['s-z', 'c-9a'],
      ['s-b', 'c-9b'],
      ['s-a', 'c-9c'],
    ])
    const row = assignment({
      targets: [
        { kind: 'class', id: 'c-9a' },
        { kind: 'student', id: 's-a' },
      ],
    })
    assert.deepEqual(targetedLearners(classOf, row), ['s-a', 's-z'])
  })

  test('hedeflenmeyen kursiyer boş döner', () => {
    assert.deepEqual(targetedLearners(new Map([['s-x', 'c-1']]), assignment()), [])
  })

  test('öğretmen sınıf hedefine sınıf, öğrenci hedefine öğrenci kapsamıyla erişir', () => {
    assert.equal(teacherReachesTarget(scoped, { kind: 'class', id: 'c-9a' }), true)
    assert.equal(teacherReachesTarget(scoped, { kind: 'student', id: 's-deniz' }), true)
    assert.equal(teacherReachesTarget(scoped, { kind: 'student', id: 'c-9a' }), false)
  })
})
