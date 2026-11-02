import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import type { Course } from '@kampus/react-shared/courses.ts'
import {
  activationBlocked,
  courseDefaults,
  courseFormErrorField,
  courseFormSchema,
  coursePatch,
  editableCourseFields,
  eOzelDefaults,
  eOzelErrorField,
  NEW_COURSE_VALUES,
} from '../src/pages/language/course-forms.ts'
import {
  canCreateCourse,
  canManageLevel,
  courseActions,
  courseCsvRow,
  courseRow,
  courseRows,
} from '../src/pages/language/course-rows.ts'

function course(overrides: Partial<Course> = {}): Course {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Genel İngilizce A1',
    language: 'en',
    level: 'A1',
    skillFocus: [],
    description: null,
    totalHours: 120,
    weeklyHours: 6,
    sessionMinutes: 45,
    durationWeeks: 20,
    maxLearners: 12,
    minLearners: 4,
    certified: false,
    nextCourseId: null,
    status: 'draft',
    activatedAt: null,
    archivedAt: null,
    eOzel: {
      programCode: null,
      approval: 'not_submitted',
      recordedAt: null,
      recordedByUserId: null,
    },
    rowVersion: 3,
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...overrides,
  }
}

const apiError = (status: number, code: string, path: string[] = []) =>
  new ApiError({
    status,
    code,
    message: 'Sunucu mesajı',
    issues: path.length ? [{ path, code, message: 'Sunucu mesajı' }] : [],
  })

test('kur satırı Türkçe etiketlerle biçimlenir; CSV ekrandaki metni taşır (IST-076)', () => {
  const row = courseRow(course({ certified: true, sessionMinutes: 90 }))
  assert.equal(row.language, 'İngilizce')
  assert.equal(row.level, 'A1')
  assert.equal(row.status, 'Taslak')
  assert.equal(row.hours, '120 saat · 6 saat/hafta · 20 hafta')
  assert.equal(row.session, '90 dk (2 ders saati)')
  assert.equal(row.learners, '4–12 kişi')
  assert.equal(row.certified, 'Belgeli')
  assert.equal(row.eOzel, "e-Özel'e işlenmedi")
  const csv = courseCsvRow(row)
  assert.equal(csv.name, 'Genel İngilizce A1')
  assert.equal(csv.status, 'Taslak')
  assert.equal(Object.keys(csv).length, 9)
})

test('öğrenci/veli görünümünde eksik alanlar etkin kur ve "en çok" metniyle gösterilir', () => {
  const catalog: Course = { ...course() }
  delete catalog.minLearners
  delete catalog.status
  delete catalog.eOzel
  const row = courseRow(catalog)
  assert.equal(row.status, 'Etkin')
  assert.equal(row.learners, 'En çok 12')
  assert.equal(row.eOzel, '—')
})

test('kurlar seviye sırası, sonra Türkçe ada göre dizilir', () => {
  const rows = courseRows([
    course({ id: 'b', name: 'Çocuk B1', level: 'B1' }),
    course({ id: 'c', name: 'Akşam A1', level: 'A1' }),
    course({ id: 'a', name: 'Pre', level: 'Pre-A1' }),
    course({ id: 'd', name: 'Şirket A1', level: 'A1' }),
  ])
  assert.deepEqual(
    rows.map((row) => row.id),
    ['a', 'c', 'd', 'b'],
  )
})

test('DOM-YTK-027: yönetici her seviyeyi, öğretmen yalnız koordinatörü olduğu seviyeyi yönetir', () => {
  const a1 = new Set(['A1'])
  assert.equal(canManageLevel('yonetici', new Set(), 'C2'), true)
  assert.equal(canManageLevel('ogretmen', a1, 'A1'), true)
  assert.equal(canManageLevel('ogretmen', a1, 'B1'), false)
  assert.equal(canManageLevel('onburo', a1, 'A1'), false)
  assert.equal(canCreateCourse('ogretmen', new Set()), false)
  assert.equal(canCreateCourse('ogretmen', a1), true)
  assert.equal(canCreateCourse('onburo', a1), false)
})

test('DOM-DIL-005/006: işlemler duruma göre; e-Özel yalnız yönetici, arşivde işlem yok', () => {
  const none = new Set<string>()
  assert.deepEqual(courseActions(course(), 'yonetici', none), {
    edit: true,
    activate: true,
    archive: true,
    eOzel: true,
  })
  assert.deepEqual(courseActions(course({ status: 'active' }), 'ogretmen', new Set(['A1'])), {
    edit: true,
    activate: false,
    archive: true,
    eOzel: false,
  })
  assert.deepEqual(courseActions(course({ status: 'archived' }), 'yonetici', none), {
    edit: false,
    activate: false,
    archive: false,
    eOzel: false,
  })
  assert.deepEqual(courseActions(course(), 'onburo', none), {
    edit: false,
    activate: false,
    archive: false,
    eOzel: false,
  })
})

test('kur formu şeması core kurallarını uygular ve Türkçe mesaj verir', () => {
  assert.equal(courseFormSchema.safeParse(NEW_COURSE_VALUES).success, false, 'ad boş')
  const valid = courseFormSchema.safeParse({ ...NEW_COURSE_VALUES, name: '  Genel A1  ' })
  assert.ok(valid.success)
  assert.equal(valid.data.name, 'Genel A1')
  const nan = courseFormSchema.safeParse({ ...NEW_COURSE_VALUES, name: 'A', totalHours: NaN })
  assert.ok(!nan.success)
  assert.match(nan.error.issues[0]?.message ?? '', /Toplam ders saati/)
  const big = courseFormSchema.safeParse({ ...NEW_COURSE_VALUES, name: 'A', maxLearners: 19 })
  assert.ok(!big.success)
  assert.match(big.error.issues[0]?.message ?? '', /en çok 18/)
})

test('DOM-DIL-005: PATCH yalnız değişen alanları taşır; etkin kurda program alanları gönderilmez', () => {
  const draft = course()
  assert.deepEqual(coursePatch(draft, courseDefaults(draft)), {})
  assert.deepEqual(
    coursePatch(draft, { ...courseDefaults(draft), name: 'Yeni ad', totalHours: 140 }),
    { name: 'Yeni ad', totalHours: 140 },
  )
  const active = course({ status: 'active' })
  assert.deepEqual(editableCourseFields(active), ['name', 'minLearners', 'maxLearners'])
  assert.deepEqual(
    coursePatch(active, {
      ...courseDefaults(active),
      level: 'B1',
      certified: true,
      maxLearners: 10,
    }),
    { maxLearners: 10 },
  )
})

test('sunucu hatası yalnız formdaki alana bağlanır; diğerleri toast olur', () => {
  assert.equal(courseFormErrorField(apiError(409, 'course_name_exists')), 'name')
  assert.equal(courseFormErrorField(apiError(422, 'course_session_mismatch')), 'weeklyHours')
  assert.equal(courseFormErrorField(apiError(422, 'course_learners_invalid')), 'minLearners')
  assert.equal(
    courseFormErrorField(apiError(400, 'validation_failed', ['totalHours'])),
    'totalHours',
  )
  // Sonraki kur ve program kodu bu formda yok: toast.
  assert.equal(courseFormErrorField(apiError(422, 'course_next_level')), undefined)
  assert.equal(courseFormErrorField(apiError(422, 'course_program_code_exists')), undefined)
  assert.equal(courseFormErrorField(apiError(403, 'course_coordinator_required')), undefined)
  assert.equal(courseFormErrorField(apiError(409, 'version_conflict')), undefined)
  assert.equal(eOzelErrorField(apiError(409, 'course_program_code_exists')), 'programCode')
  assert.equal(eOzelErrorField(apiError(409, 'course_name_exists')), undefined)
})

test('DOM-DIL-006: e-Özel formu ve belgeli kurun etkinleşme engeli', () => {
  assert.deepEqual(eOzelDefaults(course()), { programCode: '', approval: 'pending' })
  const recorded = course({
    certified: true,
    eOzel: {
      programCode: 'ING-01',
      approval: 'rejected',
      recordedAt: '2026-11-01T09:00:00.000Z',
      recordedByUserId: 'u1',
    },
  })
  assert.deepEqual(eOzelDefaults(recorded), { programCode: 'ING-01', approval: 'rejected' })
  assert.match(activationBlocked(recorded) ?? '', /e-Özel/)
  assert.equal(
    activationBlocked({ ...recorded, eOzel: { ...recorded.eOzel!, approval: 'approved' } }),
    null,
  )
  assert.equal(activationBlocked(course()), null)
})
