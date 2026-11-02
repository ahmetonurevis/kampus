import test, { describe } from 'node:test'
import assert from 'node:assert/strict'

import { authorize, type AuthorizationSource } from '../packages/school-core/src/lib/authorize.ts'
import { NO_COORDINATOR_SCOPE } from '../packages/school-core/src/lib/coordinator-duties.ts'
import {
  assertCourseManager,
  COURSE_PROGRAM_FIELDS,
  courseDurationWeeks,
  courseNameKey,
  courseProgramKey,
  courseView,
  courseVisibleTo,
  orderedCourses,
  planCourseActivation,
  planCourseArchive,
  planCourseCreation,
  planCourseEOzelRecord,
  planCourseUpdate,
  type Course,
  type CourseManager,
} from '../packages/school-core/src/lib/courses.ts'
import { OPERATION_COMMANDS } from '../packages/school-core/src/modules/commands.ts'
import type { Role } from '../packages/school-core/src/modules/navigation.ts'
import { createCourses, seedCourseId } from '../packages/school-core/src/platform/seed-courses.ts'
import { isDomainError } from './support/domain-error.ts'

const ZodError = { name: 'ZodError' }
const NOW = '2026-10-06T09:00:00.000Z'
const LANG = 'language_school' as const
const ADMIN: CourseManager = { role: 'yonetici', coordination: NO_COORDINATOR_SCOPE }
const B1_COORDINATOR: CourseManager = {
  role: 'ogretmen',
  coordination: { subjectIds: [], cefrLevels: ['B1'] },
}
const TEACHER: CourseManager = { role: 'ogretmen', coordination: NO_COORDINATOR_SCOPE }

const course = (overrides: Partial<Course> = {}): Course => ({
  id: 'c-b1',
  name: 'Genel İngilizce B1.1',
  language: 'en',
  level: 'B1',
  skillFocus: [],
  description: null,
  totalHours: 72,
  weeklyHours: 6,
  sessionMinutes: 45,
  minLearners: 6,
  maxLearners: 14,
  certified: false,
  nextCourseId: null,
  status: 'draft',
  activatedAt: null,
  archivedAt: null,
  eOzel: { programCode: null, approval: 'not_submitted', recordedAt: null, recordedByUserId: null },
  ...overrides,
})

const BODY = {
  name: 'Genel İngilizce B1.2',
  level: 'B1',
  totalHours: 72,
  weeklyHours: 6,
  minLearners: 6,
  maxLearners: 14,
}

const create = (input: unknown, courses: Course[] = [], manager = ADMIN) =>
  planCourseCreation({ institutionType: LANG, manager, courses, input, courseId: 'c-new' })
const update = (courses: Course[], input: unknown, courseId = 'c-b1', manager = ADMIN) =>
  planCourseUpdate({ institutionType: LANG, manager, courses, courseId, input })

/** Girdiyi dondurur: işlemler girdiyi değiştirmemeli (hata ya da başarıda). */
const frozen = (courses: Course[]) => {
  const snapshot = structuredClone(courses)
  return { courses, unchanged: () => assert.deepEqual(courses, snapshot) }
}

describe('kur tanımı (DOM-DIL-005, IST-076)', () => {
  test('DOM-DIL-005 yeni kur taslak açılır; varsayılanlar ve hesaplanan süre', () => {
    const created = create(BODY)
    assert.equal(created.status, 'draft')
    assert.equal(created.language, 'en')
    assert.equal(created.sessionMinutes, 45)
    assert.equal(created.certified, false)
    assert.deepEqual(created.skillFocus, [])
    assert.equal(created.description, null)
    assert.equal(created.eOzel.approval, 'not_submitted')
    assert.equal(courseDurationWeeks(created), 12)
    assert.equal(courseDurationWeeks({ totalHours: 100, weeklyHours: 6 }), 17)
  })

  test('DOM-DIL-005 doğrulama: şema hatası 400, alanlar arası kural 422; girdi değişmez', () => {
    const state = frozen([course()])
    for (const bad of [
      { ...BODY, level: 'C1+' },
      { ...BODY, maxLearners: 19 },
      { ...BODY, totalHours: 0 },
      { ...BODY, sessionMinutes: 60 },
      { ...BODY, skillFocus: ['reading', 'reading'] },
      { ...BODY, skillFocus: ['grammar'] },
      { ...BODY, language: 'xx' },
      { ...BODY, price: 1000 },
      { ...BODY, name: '  ' },
    ])
      assert.throws(() => create(bad, state.courses), ZodError, JSON.stringify(bad))
    assert.throws(
      () => create({ ...BODY, totalHours: 4 }, state.courses),
      isDomainError('course_hours_invalid'),
    )
    assert.throws(
      () => create({ ...BODY, sessionMinutes: 90, weeklyHours: 3 }, state.courses),
      isDomainError('course_session_mismatch'),
    )
    assert.throws(
      () => create({ ...BODY, sessionMinutes: 90, weeklyHours: 4, totalHours: 41 }, state.courses),
      isDomainError('course_session_mismatch'),
    )
    assert.throws(
      () => create({ ...BODY, minLearners: 10, maxLearners: 8 }, state.courses),
      isDomainError('course_learners_invalid'),
    )
    state.unchanged()
  })

  test('DOM-DIL-005 ad arşivlenmemiş kurlarda tekildir (Türkçe küçük harf); arşivli ad yeniden kullanılır', () => {
    const existing = course({ name: 'İLERİ İngilizce' })
    assert.equal(courseNameKey('İLERİ İngilizce'), courseNameKey(' ileri ingilizce '))
    assert.throws(
      () => create({ ...BODY, name: 'ileri ingilizce' }, [existing]),
      isDomainError('course_name_exists', 'conflict'),
    )
    assert.doesNotThrow(() =>
      create({ ...BODY, name: 'ileri ingilizce' }, [{ ...existing, status: 'archived' }]),
    )
  })

  test('DOM-DIL-005 yalnız dil okulunda; okulda 404 module_unavailable_for_type', () => {
    assert.throws(
      () =>
        planCourseCreation({
          institutionType: 'school',
          manager: ADMIN,
          courses: [],
          input: BODY,
          courseId: 'x',
        }),
      isDomainError('module_unavailable_for_type', 'not_found'),
    )
    for (const run of [
      () =>
        planCourseUpdate({
          institutionType: 'school',
          manager: ADMIN,
          courses: [course()],
          courseId: 'c-b1',
          input: { name: 'x' },
        }),
      () =>
        planCourseActivation({
          institutionType: 'school',
          manager: ADMIN,
          courses: [course()],
          courseId: 'c-b1',
          now: NOW,
        }),
      () =>
        planCourseArchive({
          institutionType: 'school',
          manager: ADMIN,
          courses: [course()],
          courseId: 'c-b1',
          now: NOW,
        }),
      () =>
        planCourseEOzelRecord({
          institutionType: 'school',
          courses: [course()],
          courseId: 'c-b1',
          input: { programCode: 'X', approval: 'pending' },
          actorUserId: 'u',
          now: NOW,
        }),
    ])
      assert.throws(run, isDomainError('module_unavailable_for_type', 'not_found'))
  })

  test('DOM-DIL-005 yönetici her kuru, akademik koordinatör yalnız kendi seviyesini yönetir', () => {
    assert.doesNotThrow(() => create(BODY, [], B1_COORDINATOR))
    assert.throws(
      () => create({ ...BODY, level: 'B2' }, [], B1_COORDINATOR),
      isDomainError('course_coordinator_required', 'forbidden'),
    )
    assert.throws(
      () => create(BODY, [], TEACHER),
      isDomainError('course_coordinator_required', 'forbidden'),
    )
    for (const role of ['onburo', 'ogrenci', 'veli'] as const)
      assert.throws(
        () => assertCourseManager({ role, coordination: B1_COORDINATOR.coordination }, ['B1']),
        isDomainError('course_coordinator_required', 'forbidden'),
        role,
      )
    // Seviye değişiminde eski ve yeni seviye birlikte aranır.
    assert.throws(
      () => update([course()], { level: 'B2' }, 'c-b1', B1_COORDINATOR),
      isDomainError('course_coordinator_required', 'forbidden'),
    )
    assert.doesNotThrow(() => update([course()], { name: 'B1 yeni' }, 'c-b1', B1_COORDINATOR))
  })
})

describe('kur güncelleme, etkinleştirme ve arşiv (DOM-DIL-005)', () => {
  test('DOM-DIL-005 güncelleme yalnız değişen alanları denetime verir; girdi değişmez', () => {
    const state = frozen([course()])
    const { course: next, fields } = update(state.courses, {
      name: 'Genel İngilizce B1.1',
      maxLearners: 12,
      description: '  ',
    })
    assert.deepEqual(fields, ['maxLearners'])
    assert.equal(next.maxLearners, 12)
    assert.equal(next.description, null)
    state.unchanged()
    assert.throws(() => update(state.courses, {}), ZodError)
    assert.throws(() => update(state.courses, { status: 'active' }), ZodError)
    assert.throws(
      () => update(state.courses, { name: 'x' }, 'missing'),
      isDomainError('course_not_found', 'not_found'),
    )
    assert.throws(
      () => update(state.courses, { totalHours: 3 }),
      isDomainError('course_hours_invalid'),
    )
    state.unchanged()
  })

  test('DOM-DIL-005 etkin kurun program alanları değişmez; katalog alanları değişir', () => {
    const active = course({ status: 'active', activatedAt: NOW })
    for (const field of COURSE_PROGRAM_FIELDS) {
      const change = {
        language: { language: 'de' },
        level: { level: 'B2' },
        totalHours: { totalHours: 80 },
        weeklyHours: { weeklyHours: 4 },
        sessionMinutes: { sessionMinutes: 90 },
        certified: { certified: true },
      }[field]
      assert.throws(() => update([active], change), isDomainError('course_active_locked'), field)
    }
    const { fields } = update([active], { name: 'Yeni ad', skillFocus: ['speaking'] })
    assert.deepEqual(fields, ['name', 'skillFocus'])
    // Aynı değer gönderilmesi değişiklik sayılmaz.
    assert.doesNotThrow(() => update([active], { level: 'B1', totalHours: 72 }))
  })

  test('DOM-DIL-005 etkinleştirme yalnız taslakta; arşiv son durumdur', () => {
    const activated = planCourseActivation({
      institutionType: LANG,
      manager: ADMIN,
      courses: [course()],
      courseId: 'c-b1',
      now: NOW,
    })
    assert.equal(activated.status, 'active')
    assert.equal(activated.activatedAt, NOW)
    assert.throws(
      () =>
        planCourseActivation({
          institutionType: LANG,
          manager: ADMIN,
          courses: [activated],
          courseId: 'c-b1',
          now: NOW,
        }),
      isDomainError('course_not_draft', 'conflict'),
    )
    const archived = planCourseArchive({
      institutionType: LANG,
      manager: ADMIN,
      courses: [activated],
      courseId: 'c-b1',
      now: NOW,
    })
    assert.equal(archived.status, 'archived')
    assert.equal(archived.archivedAt, NOW)
    assert.throws(
      () =>
        planCourseArchive({
          institutionType: LANG,
          manager: ADMIN,
          courses: [archived],
          courseId: 'c-b1',
          now: NOW,
        }),
      isDomainError('course_archived', 'conflict'),
    )
    assert.throws(
      () => update([archived], { name: 'x' }),
      isDomainError('course_archived', 'conflict'),
    )
  })
})

describe('sonraki kur bağı (DOM-DIL-007)', () => {
  const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`
  const A2 = id(1)
  const B11 = id(2)
  const B12 = id(3)
  const a2 = course({ id: A2, name: 'A2', level: 'A2', status: 'active' })
  const b11 = course({ id: B11, name: 'B1.1', level: 'B1' })
  const b12 = course({ id: B12, name: 'B1.2', level: 'B1' })

  test('DOM-DIL-007 aynı ya da üst seviyeye bağlanır; düşük seviye, başka dil, arşivli, kendisi ve döngü reddedilir', () => {
    assert.equal(update([a2, b11], { nextCourseId: B11 }, A2).course.nextCourseId, B11)
    assert.doesNotThrow(() => update([b11, b12], { nextCourseId: B12 }, B11))
    assert.throws(
      () => update([a2, b11], { nextCourseId: A2 }, B11),
      isDomainError('course_next_level'),
    )
    assert.throws(
      () => update([a2, { ...b11, language: 'de' }], { nextCourseId: B11 }, A2),
      isDomainError('course_next_language'),
    )
    assert.throws(
      () => update([a2, { ...b11, status: 'archived' }], { nextCourseId: B11 }, A2),
      isDomainError('course_next_not_found'),
    )
    assert.throws(
      () => update([a2], { nextCourseId: id(99) }, A2),
      isDomainError('course_next_not_found'),
    )
    assert.throws(() => update([a2], { nextCourseId: 'c-a2' }, A2), ZodError)
    const self = course({ id: '00000000-0000-4000-8000-000000000009', name: 'Self' })
    assert.throws(
      () => update([self], { nextCourseId: self.id }, self.id),
      isDomainError('course_next_invalid'),
    )
    const x = course({ id: '00000000-0000-4000-8000-00000000000a', name: 'X' })
    const y = course({ id: '00000000-0000-4000-8000-00000000000b', name: 'Y', nextCourseId: x.id })
    assert.throws(
      () => update([x, y], { nextCourseId: y.id }, x.id),
      isDomainError('course_next_cycle'),
    )
  })

  test('DOM-DIL-007 başka kurun sonraki kuru arşivlenmez', () => {
    const linked = { ...a2, nextCourseId: B11 }
    assert.throws(
      () =>
        planCourseArchive({
          institutionType: LANG,
          manager: ADMIN,
          courses: [linked, b11],
          courseId: B11,
          now: NOW,
        }),
      isDomainError('course_has_dependents'),
    )
  })
})

describe('e-Özel eşlemesi (DOM-DIL-006)', () => {
  const record = (courses: Course[], input: unknown, courseId = 'c-b1') =>
    planCourseEOzelRecord({
      institutionType: LANG,
      courses,
      courseId,
      input,
      actorUserId: 'user-admin',
      now: NOW,
    })

  test('DOM-DIL-006 işaret program kodu, onay ve kim/ne zaman izini yazar; kod tekildir', () => {
    const marked = record([course()], { programCode: 'KDA-EN-B1', approval: 'pending' })
    assert.deepEqual(marked.eOzel, {
      programCode: 'KDA-EN-B1',
      approval: 'pending',
      recordedAt: NOW,
      recordedByUserId: 'user-admin',
    })
    const other = course({
      id: 'c-other',
      name: 'Diğer',
      eOzel: { ...marked.eOzel, programCode: 'kda-en-b1' },
    })
    assert.equal(courseProgramKey('kda-en-b1'), courseProgramKey('KDA-EN-B1 '))
    assert.throws(
      () => record([course(), other], { programCode: 'KDA-EN-B1', approval: 'pending' }),
      isDomainError('course_program_code_exists', 'conflict'),
    )
    assert.doesNotThrow(() =>
      record([course(), { ...other, status: 'archived' }], {
        programCode: 'KDA-EN-B1',
        approval: 'pending',
      }),
    )
    for (const bad of [
      { programCode: '', approval: 'pending' },
      { programCode: 'KDA EN', approval: 'pending' },
      { programCode: 'KDA', approval: 'not_submitted' },
    ])
      assert.throws(() => record([course()], bad), ZodError)
  })

  test('DOM-DIL-006 belgeli kur onaysız etkinleşmez; etkin belgeli kurun kaydı değişmez', () => {
    const certified = course({ certified: true })
    const activate = (item: Course) =>
      planCourseActivation({
        institutionType: LANG,
        manager: ADMIN,
        courses: [item],
        courseId: item.id,
        now: NOW,
      })
    assert.throws(() => activate(certified), isDomainError('course_program_not_approved'))
    const pending = record([certified], { programCode: 'P1', approval: 'pending' })
    assert.throws(() => activate(pending), isDomainError('course_program_not_approved'))
    const approved = record([certified], { programCode: 'P1', approval: 'approved' })
    const active = activate(approved)
    assert.equal(active.status, 'active')
    assert.throws(
      () => record([active], { programCode: 'P1', approval: 'rejected' }),
      isDomainError('course_active_locked'),
    )
    // Belgesiz etkin kurun kaydı işaretlenebilir; belgesiz kur onaysız etkinleşir.
    const plain = activate(course())
    assert.equal(
      record([plain], { programCode: 'P2', approval: 'approved' }).eOzel.approval,
      'approved',
    )
    assert.throws(
      () => record([{ ...plain, status: 'archived' }], { programCode: 'P2', approval: 'pending' }),
      isDomainError('course_archived', 'conflict'),
    )
  })

  test('DOM-DIL-006 taslakta program alanı değişirse e-Özel izi sıfırlanır, kod kalır', () => {
    const marked = record([course()], { programCode: 'P1', approval: 'approved' })
    const { course: changed, fields } = update([marked], { totalHours: 80 })
    assert.deepEqual(fields, ['totalHours', 'eOzel'])
    assert.deepEqual(changed.eOzel, {
      programCode: 'P1',
      approval: 'not_submitted',
      recordedAt: null,
      recordedByUserId: null,
    })
    // Katalog alanı izi bozmaz.
    const { course: renamed } = update([marked], { description: 'Yeni açıklama' })
    assert.equal(renamed.eOzel.approval, 'approved')
  })
})

describe('okuma görünümü ve yetki (DOM-DIL-005)', () => {
  test('DOM-DIL-005 öğrenci ve veli yalnız etkin kurları daraltılmış görür; personel tümünü', () => {
    const next = course({ id: 'c-next', name: 'B2', level: 'B2', status: 'draft' })
    const active = course({
      status: 'active',
      activatedAt: NOW,
      nextCourseId: 'c-next',
      eOzel: { programCode: 'P', approval: 'approved', recordedAt: NOW, recordedByUserId: 'u' },
    })
    for (const role of ['ogrenci', 'veli'] as const) {
      assert.equal(courseVisibleTo(active, role), true)
      assert.equal(courseVisibleTo(next, role), false)
      const view = courseView(active, role, [active, next])
      assert.deepEqual(Object.keys(view).sort(), [
        'certified',
        'description',
        'durationWeeks',
        'id',
        'language',
        'level',
        'maxLearners',
        'name',
        'nextCourseId',
        'sessionMinutes',
        'skillFocus',
        'totalHours',
        'weeklyHours',
      ])
      // Sonraki kur taslaksa gizlenir.
      assert.equal(view.nextCourseId, null)
      assert.equal(
        courseView(active, role, [active, { ...next, status: 'active' }]).nextCourseId,
        'c-next',
      )
    }
    for (const role of ['yonetici', 'onburo', 'ogretmen'] as const) {
      assert.equal(courseVisibleTo(next, role), true)
      const view = courseView(active, role)
      assert.ok('eOzel' in view && view.eOzel.recordedByUserId === 'u', role)
      assert.equal(view.nextCourseId, 'c-next')
    }
  })

  test('DOM-DIL-005 yetki tablosu: beş rol okur, yönetici ve öğretmen yönetir, e-Özel yönetici; okulda 404', () => {
    const source: AuthorizationSource = {
      modules: {},
      students: [],
      classes: [],
      teachers: [],
      assignments: [],
      clubs: [],
      mockExams: [],
    }
    for (const action of ['course.read', 'course.manage', 'course.eozel'] as const)
      assert.equal(OPERATION_COMMANDS[action].module, null)
    const roles: Role[] = ['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli']
    for (const role of roles) {
      const actor = { role, links: [] }
      const options = { institutionType: LANG }
      assert.equal(authorize(actor, 'course.read', {}, source, options).allowed, true, role)
      assert.equal(
        authorize(actor, 'course.manage', {}, source, options).allowed,
        role === 'yonetici' || role === 'ogretmen',
        role,
      )
      assert.equal(
        authorize(actor, 'course.eozel', {}, source, options).allowed,
        role === 'yonetici',
        role,
      )
      const school = authorize(actor, 'course.read', {}, source, { institutionType: 'school' })
      assert.equal(school.allowed, false)
      assert.equal(!school.allowed && school.kind, 'not_found')
    }
  })

  test('IST-076 örnek kur programı deterministik ve kendi kurallarından geçer', () => {
    const courses = createCourses(2026, 'user-founder')
    assert.deepEqual(courses, createCourses(2026, 'user-founder'))
    assert.equal(seedCourseId(1), '00000000-0000-4000-8000-0000c0000001')
    assert.deepEqual(
      orderedCourses(courses).map((item) => item.name),
      [
        'Genel İngilizce A1',
        'Genel İngilizce A2',
        'Genel İngilizce B1.1',
        'Genel İngilizce B1.2',
        'Konuşma Kulübü B1',
        'IELTS Yazma Hazırlık',
      ],
    )
    for (const item of courses) {
      // Her örnek kur güncelleme kurallarından (tutarlılık, ad, sonraki kur) geçer.
      assert.doesNotThrow(() => update(courses, { description: 'denetim' }, item.id), item.name)
      if (item.certified && item.status === 'active') assert.equal(item.eOzel.approval, 'approved')
    }
  })
})
