import test from 'node:test'
import assert from 'node:assert/strict'
import { createSeed } from '../packages/school-core/src/data/seed.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import type { Actor } from '../packages/school-core/src/lib/scope.ts'
import {
  WRITE_ACTIONS,
  WRITE_ACTION_ROLES,
  PROVIDER_CONFIRMATION_ACTIONS,
  authorize,
  requireAuthorized,
  requiresProviderConfirmation,
  sessionAuthorize,
  type WriteDecision,
} from '../packages/school-core/src/lib/authorize.ts'
import { isDomainError } from './support/domain-error.ts'

const now = '2026-10-06T10:00:00.000Z'
const seed = () => createSeed(new Date(now))
const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
const actors: Record<Role, Actor> = {
  yonetici: { role: 'yonetici', links: [] },
  onburo: { role: 'onburo', links: [] },
  // Selin Kaya: c1 dahil sınıflarda matematik.
  ogretmen: { role: 'ogretmen', links: [{ kind: 'teacher', recordId: 't1' }] },
  ogrenci: { role: 'ogrenci', links: [{ kind: 'student', recordId: 's1' }] },
  veli: {
    role: 'veli',
    links: [
      { kind: 'child', recordId: 's1' },
      { kind: 'child', recordId: 's2' },
    ],
  },
}
const code = (decision: WriteDecision) => (decision.allowed ? 'allowed' : decision.code)

test('Rol × eylem matrisi belgedeki varsayılanla aynıdır', () => {
  assert.deepEqual(WRITE_ACTION_ROLES, {
    'invoice.pay': ['yonetici', 'onburo'],
    'invoice.payOnline': ['veli'],
    'attendance.record': ['yonetici', 'ogretmen'],
    'grade.record': ['ogretmen'],
    'grade.update': ['yonetici', 'ogretmen'],
    'record.archive': ['yonetici'],
    'record.restore': ['yonetici'],
  })
  assert.deepEqual(Object.keys(WRITE_ACTION_ROLES), [...WRITE_ACTIONS])
})

test('Tahsilat kaydı yalnız yönetici ve ön büroda; veli tahsilat kaydedemez', () => {
  const state = seed()
  const pay = (role: Role, studentId: string) =>
    code(authorize(actors[role], 'invoice.pay', { studentId }, state))
  assert.equal(pay('yonetici', 's9'), 'allowed')
  assert.equal(pay('onburo', 's9'), 'allowed')
  // Ödeme sağlayıcısı yokken veliye tahsilat açmak para alınmadan taksiti kapattırırdı.
  assert.equal(pay('veli', 's1'), 'permission_denied')
  assert.equal(pay('veli', 's9'), 'permission_denied')
  assert.equal(pay('ogretmen', 's1'), 'permission_denied')
  assert.equal(pay('ogrenci', 's1'), 'permission_denied')
  assert.equal(requiresProviderConfirmation('invoice.pay'), false)
})

test('Çevrim içi ödeme yalnız velinin bağlı çocuğunda izinli ve sağlayıcı onayı bekler', () => {
  const state = seed()
  const payOnline = (role: Role, studentId: string) =>
    code(authorize(actors[role], 'invoice.payOnline', { studentId }, state))
  assert.equal(payOnline('veli', 's1'), 'allowed')
  assert.equal(payOnline('veli', 's2'), 'allowed')
  assert.equal(payOnline('veli', 's9'), 'student_scope_denied')
  for (const role of ['yonetici', 'onburo', 'ogretmen', 'ogrenci'] as const)
    assert.equal(payOnline(role, 's1'), 'permission_denied')
  assert.deepEqual(PROVIDER_CONFIRMATION_ACTIONS, ['invoice.payOnline'])
  assert.equal(requiresProviderConfirmation('invoice.payOnline'), true)
  state.modules.finance = false
  assert.equal(payOnline('veli', 's1'), 'module_disabled')
})

test('Yoklama: öğretmen ders verdiği sınıfta aynı gün; yönetici gerekçeyle düzeltir', () => {
  const state = seed()
  const own = state.assignments.find((a) => a.teacherId === 't1')!.classId
  const other = state.classes.find(
    (c) => !state.assignments.some((a) => a.classId === c.id && a.teacherId === 't1'),
  )!.id
  const take = (role: Role, classId: string, date = now, reason?: string) =>
    code(
      authorize(
        actors[role],
        'attendance.record',
        { classId, date, ...(reason ? { reason } : {}) },
        state,
        { now },
      ),
    )
  assert.equal(take('ogretmen', own), 'allowed')
  assert.equal(take('ogretmen', other), 'attendance_class_forbidden')
  assert.equal(
    take('ogretmen', own, '2026-10-05T09:00:00.000Z'),
    'attendance_correction_admin_only',
  )
  assert.equal(take('yonetici', other), 'correction_reason_required')
  assert.equal(
    take('yonetici', other, '2026-10-01T09:00:00.000Z', 'Rapor teslim edildi'),
    'allowed',
  )
  for (const role of ['onburo', 'ogrenci', 'veli'] as const)
    assert.equal(take(role, own), 'permission_denied')
  // Pasif öğretmen kaydı yetki vermez (DOM-YTK-022: atama sona erince yazma biter).
  state.teachers.find((t) => t.id === 't1')!.isActive = false
  assert.equal(take('ogretmen', own), 'attendance_class_forbidden')
})

test('Not: öğretmen atandığı sınıf + derste girer; yönetici yalnız gerekçeli düzeltir', () => {
  const state = seed()
  const ownClass = state.assignments.find((a) => a.teacherId === 't1' && a.subjectId === 'math')!
  const student = state.students.find((s) => s.classId === ownClass.classId)!.id
  const outsider = state.students.find(
    (s) => !state.assignments.some((a) => a.classId === s.classId && a.teacherId === 't1'),
  )!.id
  const grade = (role: Role, studentId: string, subjectId = 'math') =>
    code(authorize(actors[role], 'grade.record', { studentId, subjectId }, state))
  const update = (role: Role, studentId: string, reason?: string) =>
    code(
      authorize(
        actors[role],
        'grade.update',
        { studentId, subjectId: 'math', ...(reason ? { reason } : {}) },
        state,
      ),
    )
  assert.equal(grade('ogretmen', student), 'allowed')
  assert.equal(grade('ogretmen', student, 'science'), 'grade_assignment_forbidden')
  assert.equal(grade('ogretmen', outsider), 'grade_assignment_forbidden')
  for (const role of ['yonetici', 'onburo', 'ogrenci', 'veli'] as const)
    assert.equal(grade(role, student), 'permission_denied')
  assert.equal(update('ogretmen', student), 'allowed')
  assert.equal(update('ogretmen', outsider), 'grade_assignment_forbidden')
  assert.equal(update('yonetici', outsider), 'correction_reason_required')
  assert.equal(update('yonetici', outsider, 'Okuma hatası düzeltildi'), 'allowed')
  for (const role of ['onburo', 'ogrenci', 'veli'] as const)
    assert.equal(update(role, student, 'Gerekçe'), 'permission_denied')
})

test('Kampüs, sınıf ve kadro arşivi ile geri alma yalnız yöneticidedir', () => {
  const state = seed()
  for (const action of ['record.archive', 'record.restore'] as const)
    for (const kind of ['branch', 'class', 'teacher'] as const)
      for (const role of roles)
        assert.equal(
          code(authorize(actors[role], action, { kind }, state)),
          role === 'yonetici' ? 'allowed' : 'permission_denied',
        )
})

test('Modül kapalıyken eylem rol denetiminden önce reddedilir', () => {
  const state = seed()
  state.modules.finance = false
  state.modules.academic = false
  assert.equal(
    code(authorize(actors.yonetici, 'invoice.pay', { studentId: 's1' }, state)),
    'module_disabled',
  )
  assert.equal(
    code(authorize(actors.ogrenci, 'grade.record', { studentId: 's1', subjectId: 'math' }, state)),
    'module_disabled',
  )
  assert.equal(
    code(authorize(actors.ogretmen, 'attendance.record', { classId: 'c1', date: now }, state)),
    'module_disabled',
  )
  // Çekirdek kayıtlar modüle bağlı değildir.
  assert.equal(
    code(authorize(actors.yonetici, 'record.archive', { kind: 'class' }, state)),
    'allowed',
  )
  // Haritada olmayan modül kapalı sayılır.
  delete state.modules.finance
  assert.equal(
    code(authorize(actors.onburo, 'invoice.pay', { studentId: 's1' }, state)),
    'module_disabled',
  )
})

test('Bilinmeyen rol ve bağlantısız öğretmen hiçbir yazma yetkisi almaz', () => {
  const state = seed()
  const stranger: Actor = { role: 'misafir' as Role, links: [] }
  const teacher: Actor = { role: 'ogretmen', links: [] }
  assert.equal(
    code(authorize(stranger, 'invoice.pay', { studentId: 's1' }, state)),
    'permission_denied',
  )
  assert.equal(
    code(authorize(teacher, 'grade.record', { studentId: 's1', subjectId: 'math' }, state)),
    'grade_assignment_forbidden',
  )
})

test('requireAuthorized reddi DomainError olarak fırlatır; izinli istek sessiz geçer', () => {
  const state = seed()
  assert.throws(
    () => requireAuthorized(actors.ogrenci, 'invoice.pay', { studentId: 's1' }, state),
    isDomainError('permission_denied', 'forbidden'),
  )
  assert.throws(
    () =>
      requireAuthorized(actors.yonetici, 'attendance.record', { classId: 'c1', date: now }, state, {
        now,
      }),
    isDomainError('correction_reason_required', 'rule'),
  )
  state.modules.finance = false
  assert.throws(
    () => requireAuthorized(actors.yonetici, 'invoice.pay', { studentId: 's1' }, state),
    isDomainError('module_disabled', 'forbidden'),
  )
  requireAuthorized(actors.yonetici, 'record.restore', { kind: 'branch' }, state)
})

test('Dil okulunda tahsilat yetkisi okuldakiyle aynıdır', () => {
  const state = seed()
  assert.equal(
    code(
      authorize(actors.onburo, 'invoice.pay', { studentId: 's1' }, state, {
        institutionType: 'language_school',
      }),
    ),
    'allowed',
  )
})

test('Çevrimdışı demo oturumu sessionActor ile aynı kararı alır', () => {
  const state = seed()
  assert.equal(
    code(
      sessionAuthorize(state, { role: 'veli', childId: 's1' }, 'invoice.payOnline', {
        studentId: 's2',
      }),
    ),
    'allowed',
  )
  assert.equal(
    code(sessionAuthorize(state, { role: 'veli' }, 'invoice.payOnline', { studentId: 's9' })),
    'student_scope_denied',
  )
  assert.equal(
    code(sessionAuthorize(state, { role: 'veli' }, 'invoice.pay', { studentId: 's1' })),
    'permission_denied',
  )
  assert.equal(
    code(
      sessionAuthorize(
        state,
        { role: 'ogretmen' },
        'attendance.record',
        { classId: 'c1', date: now },
        { now },
      ),
    ),
    'allowed',
  )
})
