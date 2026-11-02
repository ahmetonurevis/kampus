import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import { createSeed } from '@kampus/school-core/data/seed.ts'
import { academicLookups, type AcademicSources } from '../src/pages/academic/academic-rows.ts'
import {
  cancelFormSchema,
  cancelledFilter,
  changedLessonFields,
  classOptions,
  isoToIstanbul,
  istanbulToIso,
  lessonActions,
  lessonErrorRoutes,
  lessonFormDefaults,
  lessonFormSchema,
  lessonUnavailableText,
  openedLesson,
  planLessonUpdate,
  reversedRange,
  scheduleByDay,
  scheduleCsvRow,
  scheduleLesson,
  scheduleRange,
  scheduleViewMode,
  substituteCandidates,
  substituteFormSchema,
  subjectOptions,
  teacherOptions,
  viewDays,
  type Lesson,
} from '../src/pages/academic/schedule-model.ts'

// IST-094 (DOM-YTK-068, DOM-YTK-069): ders programı ekranının satır, aralık, işlem, form ve hata
// eşlemesi hesapları.

const NOW = new Date('2026-10-15T09:00:00.000Z')
const wrap = <T extends { id: string }>(records: readonly T[]) =>
  records.map((record) => ({
    id: record.id,
    version: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    archivedAt: null,
    record,
  }))

function fixture() {
  const seed = createSeed(NOW)
  const data: AcademicSources = {
    subjects: wrap(seed.subjects),
    classes: wrap(seed.classes),
    students: [],
    teachers: wrap(seed.teachers),
    branches: wrap(seed.branches),
  }
  return { seed, lookups: academicLookups(data) }
}

const lesson = (overrides: Partial<Lesson> = {}): Lesson => ({
  id: 'ders-test-1',
  version: 3,
  classId: 'c1',
  subjectId: 'math',
  title: 'Matematik',
  teacherId: 't1',
  originalTeacherId: null,
  date: '2026-10-27T06:00:00.000Z',
  duration: 40,
  room: '101',
  status: 'planned',
  cancelledAt: null,
  updatedAt: NOW.toISOString(),
  ...overrides,
})

describe('ders satırı (DOM-YTK-068)', () => {
  test('İstanbul saatiyle gün ve saat; alt başlık kitleye göre', () => {
    const { seed, lookups } = fixture()
    const teacherName = seed.teachers.find((t) => t.id === 't1')!.name
    const admin = scheduleLesson(lesson(), lookups, 'admin')
    assert.equal(admin.day, '2026-10-27')
    assert.equal(admin.time, '09:00')
    assert.equal(admin.subtitle, `7-A · ${teacherName} · Derslik 101`)
    assert.equal(scheduleLesson(lesson(), lookups, 'teacher').subtitle, '7-A · Derslik 101')
    assert.equal(
      scheduleLesson(lesson(), lookups, 'student').subtitle,
      `${teacherName} · Derslik 101`,
    )
    assert.equal(admin.statusLabel, 'Planlandı')
    assert.equal(admin.substitute, '')
  })

  test('yedek atanmışsa "Yedek: …" yazar; ad görünmüyorsa genel metin; gerekçe yoktur', () => {
    const { seed, lookups } = fixture()
    const substitute = seed.teachers.find((t) => t.id !== 't1' && t.subjectId === 'math')!
    const row = scheduleLesson(
      lesson({ teacherId: substitute.id, originalTeacherId: 't1', status: 'substituted' }),
      lookups,
      'student',
    )
    assert.equal(row.substitute, `Yedek: ${substitute.name}`)
    assert.equal(row.statusLabel, 'Yedek atandı')
    // Öğrenci satırında asıl öğretmen yerine yalnız yedek satırı görünür.
    assert.equal(row.subtitle, 'Derslik 101')
    assert.equal(
      scheduleLesson(
        lesson({ teacherId: 'gorunmeyen', originalTeacherId: 't1', status: 'substituted' }),
        lookups,
        'student',
      ).substitute,
      'Yedek öğretmen atandı',
    )
    assert.equal(JSON.stringify(row).includes('reason'), false)
  })

  test('iptal edilen ders günlük programda görünmez; yalnız "İptalleri göster" ile gelir', () => {
    const { lookups } = fixture()
    const rows = [
      lesson({ id: 'gec', date: '2026-10-27T09:00:00.000Z' }),
      lesson({ id: 'iptal', date: '2026-10-27T07:00:00.000Z', status: 'cancelled' }),
      lesson({ id: 'erken', date: '2026-10-27T05:00:00.000Z' }),
      lesson({ id: 'hafta-disi', date: '2026-11-04T06:00:00.000Z' }),
    ].map((item) => scheduleLesson(item, lookups, 'admin'))
    const days = viewDays('hafta', '2026-10-28')
    assert.equal(days[0], '2026-10-26')
    const hidden = scheduleByDay(rows, days)
    assert.deepEqual(
      hidden.get('2026-10-27')!.map((row) => row.id),
      ['erken', 'gec'],
    )
    assert.equal([...hidden.values()].flat().length, 2)
    const shown = scheduleByDay(rows, days, true)
    assert.deepEqual(
      shown.get('2026-10-27')!.map((row) => row.id),
      ['erken', 'iptal', 'gec'],
    )
    assert.equal(shown.get('2026-10-27')![1]!.statusLabel, 'İptal edildi')
  })

  test('CSV satırı ekrandaki metinle aynı', () => {
    const { lookups } = fixture()
    const csv = scheduleCsvRow(scheduleLesson(lesson(), lookups, 'admin'))
    assert.equal(csv.time, '09:00')
    assert.equal(csv.className, '7-A')
    assert.equal(csv.statusLabel, 'Planlandı')
    assert.ok(csv.dayLabel.includes('2026'))
  })
})

describe('görünüm ve aralık', () => {
  test('haftalık pazartesi–pazar, günlük tek gün, liste süzgeç günleri', () => {
    assert.deepEqual(scheduleRange('hafta', '2026-10-29', '', ''), {
      dateFrom: '2026-10-26',
      dateTo: '2026-11-01',
    })
    assert.deepEqual(scheduleRange('gun', '2026-10-29', '', ''), {
      dateFrom: '2026-10-29',
      dateTo: '2026-10-29',
    })
    assert.deepEqual(scheduleRange('liste', '2026-10-29', '2026-10-01', 'x'), {
      dateFrom: '2026-10-01',
    })
    assert.equal(reversedRange('2026-10-05', '2026-10-01'), true)
    assert.equal(reversedRange('2026-10-01', ''), false)
    assert.equal(scheduleViewMode('liste'), 'liste')
    assert.equal(scheduleViewMode('bilinmeyen'), 'hafta')
    assert.equal(cancelledFilter(false), 'false')
    assert.equal(cancelledFilter(true), 'all')
  })
})

describe('işlem görünürlüğü (DOM-YTK-069)', () => {
  const now = '2026-10-26T12:00:00.000Z'
  test('yönetici gelecek ve iptal edilmemiş derste düzenler, yedek atar, iptal eder', () => {
    assert.deepEqual(lessonActions(lesson(), true, now), {
      edit: true,
      substitute: true,
      cancel: true,
    })
  })
  test('geçmiş, başlamış ya da iptal edilmiş derste ve yönetici dışında işlem yok', () => {
    const none = { edit: false, substitute: false, cancel: false }
    assert.deepEqual(lessonActions(lesson({ date: now }), true, now), none)
    assert.deepEqual(lessonActions(lesson({ date: '2026-10-20T06:00:00.000Z' }), true, now), none)
    assert.deepEqual(lessonActions(lesson({ status: 'cancelled' }), true, now), none)
    assert.deepEqual(lessonActions(lesson(), false, now), none)
  })
})

describe('form şemaları ve seçenekler', () => {
  test('ders formu core şemasıyla doğrulanır; yerel saat ISO UTC olur', () => {
    const parsed = lessonFormSchema.parse({
      classId: 'c1',
      subjectId: 'math',
      teacherId: 't1',
      date: '2026-10-27T09:00',
      duration: '40',
      room: '101',
    })
    assert.equal(parsed.date, '2026-10-27T06:00:00.000Z')
    assert.equal(parsed.duration, 40)
    const failed = lessonFormSchema.safeParse({
      classId: '',
      subjectId: 'math',
      teacherId: 't1',
      date: '',
      duration: 5,
      room: '1',
    })
    assert.equal(failed.success, false)
    const paths = failed.error!.issues.map((issue) => issue.path.join('.'))
    for (const path of ['classId', 'date', 'duration', 'room'])
      assert.ok(paths.includes(path), path)
  })

  test('yedek ve iptal gerekçesi zorunlu ve en çok 500 karakter (DOM-YTK-069)', () => {
    assert.equal(substituteFormSchema.safeParse({ teacherId: 't2', reason: '' }).success, false)
    assert.equal(substituteFormSchema.safeParse({ teacherId: '', reason: 'Rapor' }).success, false)
    assert.equal(cancelFormSchema.safeParse({ reason: 'x'.repeat(501) }).success, false)
    assert.equal(cancelFormSchema.safeParse({ reason: 'Okul gezisi' }).success, true)
  })

  test('düzenleme varsayılanı yerel saattir; yalnız değişen alanlar gider', () => {
    const current = lesson()
    const defaults = lessonFormDefaults(current)
    assert.equal(defaults.date, '2026-10-27T09:00')
    assert.equal(isoToIstanbul(current.date), '2026-10-27T09:00')
    assert.equal(istanbulToIso('2026-10-27T09:00'), current.date)
    const values = lessonFormSchema.parse({ ...defaults, room: '102' })
    assert.deepEqual(changedLessonFields(current, values), { room: '102' })
  })

  test('öğretmen seçeneği sınıfın kampüsü ve dersin branşıdır; yedek adayı dersi veren hariç', () => {
    const { seed, lookups } = fixture()
    const classroom = seed.classes.find((c) => c.id === 'c1')!
    assert.ok(classOptions(lookups).some((option) => option.value === 'c1'))
    assert.ok(subjectOptions('c1', lookups).some((option) => option.value === 'math'))
    assert.deepEqual(subjectOptions('', lookups), [])
    const teachers = teacherOptions('c1', 'math', lookups)
    assert.ok(teachers.length > 0)
    for (const option of teachers) {
      const teacher = seed.teachers.find((t) => t.id === option.value)!
      assert.equal(teacher.branchId, classroom.branchId)
      assert.equal(teacher.subjectId, 'math')
      assert.equal(teacher.isActive, true)
    }
    const candidates = substituteCandidates(lesson({ teacherId: teachers[0]!.value }), lookups)
    assert.equal(
      candidates.some((option) => option.value === teachers[0]!.value),
      false,
    )
    assert.equal(candidates.length, teachers.length - 1)
  })
})

describe('hata eşleme', () => {
  const error = (status: number, code: string, message = 'Sunucu mesajı.') =>
    new ApiError({ status, code, message })

  test('çakışma alanda, sürüm çakışması form uyarısında (toast yok), gerisi toast', () => {
    const lessonRoutes = lessonErrorRoutes('lesson')
    assert.equal(lessonRoutes.fieldFor(error(409, 'room_conflict')), 'room')
    assert.equal(lessonRoutes.fieldFor(error(409, 'teacher_lesson_conflict')), 'teacherId')
    assert.equal(lessonRoutes.fieldFor(error(409, 'class_lesson_conflict')), 'date')
    assert.equal(lessonRoutes.fieldFor(error(422, 'lesson_in_past')), 'date')
    assert.equal(lessonRoutes.silent(error(409, 'version_conflict')), true)
    assert.equal(lessonRoutes.silent(error(409, 'room_conflict')), false)
    const cancelRoutes = lessonErrorRoutes('cancel')
    assert.equal(cancelRoutes.fieldFor(error(422, 'lesson_attendance_taken')), undefined)
    assert.equal(
      lessonErrorRoutes('substitute').fieldFor(error(422, 'teacher_unchanged')),
      'teacherId',
    )
  })
})

describe('taze kayıtla düzenleme planı (IST-077, OG-040)', () => {
  const values = (overrides: Partial<ReturnType<typeof lessonFormDefaults>> = {}) =>
    lessonFormSchema.parse({ ...lessonFormDefaults(lesson()), ...overrides })

  test('yalnız kullanıcının değiştirdiği alan gider; başkasının değişikliği geri yazılmaz', () => {
    const { lookups } = fixture()
    const opened = lesson()
    // Başkası dersi 40 -> 50 dk yaptı; kullanıcı derslik girdi.
    const fresh = lesson({ version: 4, duration: 50 })
    const plan = planLessonUpdate(opened, fresh, values({ room: '102' }), lookups)
    assert.deepEqual(plan.body, { room: '102' })
    assert.deepEqual(plan.overlaps, [])
  })

  test('aynı alanı başkası da değiştirdiyse çakışma değerleriyle listelenir', () => {
    const { lookups } = fixture()
    const opened = lesson()
    const fresh = lesson({ version: 4, room: '205' })
    const plan = planLessonUpdate(opened, fresh, values({ room: '102', duration: 45 }), lookups)
    assert.deepEqual(plan.body, { duration: 45, room: '102' })
    assert.deepEqual(plan.overlaps, [
      { field: 'room', label: 'Derslik', theirs: '205', mine: '102' },
    ])
  })

  test('başkası aynı değeri girdiyse çakışma yoktur ve alan gönderilmez', () => {
    const { lookups } = fixture()
    const fresh = lesson({ version: 4, room: '102' })
    const plan = planLessonUpdate(lesson(), fresh, values({ room: '102' }), lookups)
    assert.deepEqual(plan.body, {})
    assert.deepEqual(plan.overlaps, [])
  })

  test('çakışan sınıf ve öğretmen kimlik yerine adla gösterilir', () => {
    const { seed, lookups } = fixture()
    const other = seed.teachers.find((t) => t.id !== 't1' && t.subjectId === 'math')!
    const fresh = lesson({ version: 4, teacherId: other.id })
    const plan = planLessonUpdate(lesson(), fresh, values({ teacherId: 't2' }), lookups)
    assert.equal(plan.overlaps[0]?.field, 'teacherId')
    assert.equal(plan.overlaps[0]?.theirs, other.name)
  })
})

describe('açık formun uygunluğu açıldığı anda sabitlenir (OG-040)', () => {
  const before = '2026-10-27T05:00:00.000Z'
  const after = '2026-10-27T06:30:00.000Z'

  test('uygun ders açılışta alınır, sonradan başlasa ya da iptal edilse de korunur', () => {
    const opened = openedLesson(null, lesson(), before)
    assert.equal(opened?.id, 'ders-test-1')
    // Ders başladı: açık form aynı dersle kalır (girdi kaybolmaz).
    assert.equal(openedLesson(opened, lesson(), after), opened)
    // Ders iptal edildi: yine aynı kayıt.
    const cancelled = lesson({ status: 'cancelled', version: 4 })
    assert.equal(openedLesson(opened, cancelled, before), opened)
    assert.equal(lessonUnavailableText(cancelled), 'Bu ders iptal edildi; değiştirilemez.')
    assert.equal(lessonUnavailableText(lesson()), 'Başlamış ya da geçmiş ders değiştirilemez.')
  })

  test('açılışta uygun değilse (başlamış ya da iptal) form açılmaz', () => {
    assert.equal(openedLesson(null, lesson(), after), null)
    assert.equal(openedLesson(null, lesson({ status: 'cancelled' }), before), null)
    assert.equal(openedLesson(null, undefined, before), null)
  })
})
