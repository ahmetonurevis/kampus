import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import type { LanguageGroup } from '@kampus/react-shared/language-groups.ts'
import {
  createGroupBody,
  groupDefaults,
  groupFormErrorField,
  groupFormSchema,
  groupPatch,
  isScheduleLocked,
  mergeFormErrorField,
} from '../src/pages/language/group-forms.ts'
import {
  canCreateGroup,
  groupActions,
  groupCsvRow,
  groupRow,
  groupStatusTone,
  mergeCandidates,
  mergeNeedsConsent,
  scheduleText,
  slotLines,
  slotRange,
  teacherLabel,
} from '../src/pages/language/group-rows.ts'

const COURSE_ID = '00000000-0000-4000-8000-000000000001'

function group(overrides: Partial<LanguageGroup> = {}): LanguageGroup {
  return {
    id: '00000000-0000-4000-8000-0000000000a1',
    courseId: COURSE_ID,
    courseName: 'Genel İngilizce A1',
    level: 'A1',
    name: 'A1 Akşam',
    ageBand: 'adult',
    delivery: 'in_person',
    room: 'Derslik 3',
    schedule: [
      { weekday: 4, startTime: '18:00' },
      { weekday: 2, startTime: '18:00' },
    ],
    sessionMinutes: 90,
    startDate: '2026-11-10',
    endDate: '2027-03-30',
    status: 'planned',
    teacherMembershipId: 'm-selin',
    capacity: 12,
    activeLearners: 0,
    frozenLearners: 0,
    rowVersion: 2,
    ...overrides,
  }
}

const apiError = (status: number, code: string, path: (string | number)[] = []) =>
  new ApiError({
    status,
    code,
    message: 'Sunucu mesajı',
    issues: path.length ? [{ path: path.map(String), code, message: 'Sunucu mesajı' }] : [],
  })

const names = new Map([['m-selin', 'Selin Kaya']])

test('oturum saat aralığı süreden hesaplanır, gün ve saate göre sıralanır (IST-077)', () => {
  assert.equal(slotRange({ weekday: 2, startTime: '18:00' }, 90), '18:00–19:30')
  assert.equal(slotRange({ weekday: 2, startTime: '23:30' }, 45), '23:30–00:15')
  assert.deepEqual(
    slotLines(
      [
        { weekday: 4, startTime: '18:00' },
        { weekday: 2, startTime: '19:00' },
        { weekday: 2, startTime: '09:00' },
      ],
      45,
    ),
    ['Salı 09:00–09:45', 'Salı 19:00–19:45', 'Perşembe 18:00–18:45'],
  )
  assert.equal(scheduleText([], 45), '—')
})

test('öğretmen etiketi: atanmamış, kendisi, adı bilinen ve adı okunamayan öğretmen', () => {
  assert.equal(teacherLabel(null, names), 'Atanmamış')
  assert.equal(teacherLabel(undefined, null), 'Atanmamış')
  assert.equal(teacherLabel('m-selin', null, 'm-selin'), 'Siz')
  assert.equal(teacherLabel('m-selin', names), 'Selin Kaya')
  // Ön büro ve öğretmen kurum kullanıcı listesini okuyamaz: kimlik gösterilmez.
  assert.equal(teacherLabel('m-selin', null), 'Atanmış öğretmen')
  assert.equal(teacherLabel('m-baska', names), 'Atanmış öğretmen')
})

test('grup satırı Türkçe etiketlerle biçimlenir; CSV ekrandaki metni taşır (IST-077)', () => {
  const row = groupRow(group({ activeLearners: 5 }), names)
  assert.equal(row.course, 'Genel İngilizce A1')
  assert.equal(row.level, 'A1')
  assert.equal(row.status, 'Planlandı')
  assert.equal(row.statusKey, 'planned')
  assert.equal(row.ageBand, 'Yetişkin (18+)')
  assert.equal(row.schedule, 'Salı 18:00–19:30, Perşembe 18:00–19:30')
  assert.match(row.period, /^10 .+ 2026 – 30 .+ 2027$/)
  assert.equal(row.teacher, 'Selin Kaya')
  assert.equal(row.room, 'Derslik 3')
  assert.equal(row.occupancy, '5 / 12')
  const csv = groupCsvRow(row)
  assert.equal(Object.keys(csv).length, 10)
  assert.equal(csv.occupancy, '5 / 12')
  assert.ok(!('group' in csv))
})

test('çevrim içi grupta derslik yerine teslim biçimi, personel dışında doluluk yok', () => {
  const row = groupRow(group({ delivery: 'online', room: null, capacity: undefined }), null)
  assert.equal(row.room, 'Çevrim içi')
  assert.equal(row.occupancy, '—')
  assert.equal(groupRow(group({ room: null }), null).room, '—')
})

test('durum etiketi tonları her durum için tanımlıdır', () => {
  assert.equal(groupStatusTone('planned'), 'amber')
  assert.equal(groupStatusTone('open'), 'green')
  assert.equal(groupStatusTone('running'), 'purple')
  assert.equal(groupStatusTone('completed'), 'gray')
  assert.equal(groupStatusTone('cancelled'), 'red')
})

test('grup işlemleri yönetici ve seviye koordinatöründedir; kapanmış grupta işlem yok (DOM-DIL-008)', () => {
  const none = new Set<string>()
  const a1 = new Set(['A1'])
  assert.deepEqual(groupActions(group(), 'yonetici', none), {
    edit: true,
    open: true,
    cancel: true,
    merge: true,
  })
  assert.equal(groupActions(group({ status: 'open' }), 'yonetici', none).open, false)
  assert.equal(groupActions(group(), 'ogretmen', a1).edit, true)
  assert.equal(groupActions(group({ level: 'B1' }), 'ogretmen', a1).edit, false)
  assert.equal(groupActions(group(), 'ogretmen', none).cancel, false)
  assert.equal(groupActions(group(), 'onburo', a1).edit, false)
  for (const status of ['completed', 'cancelled'] as const)
    assert.deepEqual(groupActions(group({ status }), 'yonetici', none), {
      edit: false,
      open: false,
      cancel: false,
      merge: false,
    })
  assert.equal(canCreateGroup('yonetici', none), true)
  assert.equal(canCreateGroup('ogretmen', a1), true)
  assert.equal(canCreateGroup('ogretmen', none), false)
  assert.equal(canCreateGroup('onburo', a1), false)
})

test('birleştirme adayları aynı kur ve yaş bandındaki açık gruplardır (DOM-DIL-042)', () => {
  const target = group()
  const same = group({ id: 'g-2', name: 'A1 Hafta sonu' })
  const otherCourse = group({ id: 'g-3', courseId: '00000000-0000-4000-8000-000000000002' })
  const teen = group({ id: 'g-4', ageBand: 'teen' })
  const cancelled = group({ id: 'g-5', status: 'cancelled' })
  const completed = group({ id: 'g-6', status: 'completed' })
  const running = group({ id: 'g-7', status: 'running' })
  assert.deepEqual(
    mergeCandidates(target, [target, same, otherCourse, teen, cancelled, completed, running]).map(
      (item) => item.id,
    ),
    ['g-2', 'g-7'],
  )
})

test('gün ya da saat farklıysa birleştirmede kursiyer onayı gerekir (DOM-DIL-042)', () => {
  const target = group()
  // Sıra farkı onay gerektirmez.
  const reordered = group({ schedule: [...target.schedule].reverse() })
  assert.equal(mergeNeedsConsent(target, reordered), false)
  const otherTime = group({
    schedule: [
      { weekday: 2, startTime: '19:00' },
      { weekday: 4, startTime: '18:00' },
    ],
  })
  assert.equal(mergeNeedsConsent(target, otherTime), true)
  const otherDay = group({
    schedule: [
      { weekday: 1, startTime: '18:00' },
      { weekday: 4, startTime: '18:00' },
    ],
  })
  assert.equal(mergeNeedsConsent(target, otherDay), true)
})

test('form şeması core kurallarını uygular; boş öğretmen ve derslik gövdede null olur (IST-077)', () => {
  const values = groupDefaults(undefined, { courseId: COURSE_ID, startDate: '2026-11-10' })
  assert.equal(values.teacherMembershipId, '')
  assert.deepEqual(values.schedule, [{ weekday: 1, startTime: '18:00' }])
  const missingName = groupFormSchema.safeParse(values)
  assert.equal(missingName.success, false)
  const parsed = groupFormSchema.parse({ ...values, name: '  A1 Akşam  ' })
  const body = createGroupBody(parsed)
  assert.equal(body.name, 'A1 Akşam')
  assert.equal(body.teacherMembershipId, null)
  assert.equal(body.room, null)
  // Çevrim içi grupta yazılan derslik gönderilmez.
  const online = createGroupBody(
    groupFormSchema.parse({ ...values, name: 'Çevrim içi', delivery: 'online', room: 'D1' }),
  )
  assert.equal(online.room, null)
  assert.equal(
    groupFormSchema.safeParse({ ...values, name: 'X', schedule: [] }).success,
    false,
    'boş haftalık program',
  )
  assert.equal(groupFormSchema.safeParse({ ...values, name: 'X', capacity: 0 }).success, false)
})

test('takvim kursiyerli ya da başlamış grupta kilitlidir (DOM-DIL-008)', () => {
  assert.equal(isScheduleLocked(undefined), false)
  assert.equal(isScheduleLocked(group()), false)
  assert.equal(isScheduleLocked(group({ activeLearners: 1 })), true)
  assert.equal(isScheduleLocked(group({ frozenLearners: 1 })), true)
  assert.equal(isScheduleLocked(group({ status: 'running' })), true)
  assert.equal(isScheduleLocked(group({ status: 'completed' })), true)
  assert.equal(isScheduleLocked(group({ status: 'open' })), false)
})

test('PATCH gövdesi yalnız değişen alanları taşır; kilitli grupta takvim alanları düşer (DOM-DIL-008)', () => {
  const current = group()
  const values = groupDefaults(current, { startDate: current.startDate })
  assert.deepEqual(groupPatch(current, groupFormSchema.parse(values)), {})
  const changed = groupFormSchema.parse({
    ...values,
    name: 'A1 Akşam (yeni)',
    teacherMembershipId: '',
    schedule: [
      { weekday: 1, startTime: '18:00' },
      { weekday: 3, startTime: '18:00' },
    ],
    startDate: '2026-11-17',
    ageBand: 'teen',
    capacity: 10,
  })
  const open = groupPatch(current, changed)
  assert.equal(open.name, 'A1 Akşam (yeni)')
  assert.equal(open.teacherMembershipId, null)
  assert.equal(open.capacity, 10)
  assert.equal(open.ageBand, 'teen')
  assert.equal(open.startDate, '2026-11-17')
  assert.equal(open.schedule?.length, 2)
  assert.ok(!('courseId' in open), 'kur hiç gönderilmez')

  const locked = groupPatch(group({ activeLearners: 3 }), changed)
  assert.ok(!('schedule' in locked))
  assert.ok(!('startDate' in locked))
  assert.ok(!('ageBand' in locked))
  assert.equal(locked.name, 'A1 Akşam (yeni)')
  assert.equal(locked.capacity, 10)
  // Kur değiştirilse bile gövdeye girmez.
  const courseOnly = groupFormSchema.parse({
    ...values,
    courseId: '00000000-0000-4000-8000-000000000009',
  })
  assert.deepEqual(groupPatch(current, courseOnly), {})
})

test('grup formu hata eşlemesi: takvim satırı, öğretmen çakışması, yetki hataları toast', () => {
  assert.equal(
    groupFormErrorField(apiError(422, 'group_schedule_overlap', ['schedule', 1])),
    'schedule.1',
  )
  assert.equal(groupFormErrorField(apiError(422, 'group_outside_legal_hours')), 'schedule')
  assert.equal(groupFormErrorField(apiError(409, 'group_teacher_conflict')), 'teacherMembershipId')
  assert.equal(groupFormErrorField(apiError(409, 'group_room_conflict')), 'room')
  assert.equal(groupFormErrorField(apiError(422, 'group_start_passed')), 'startDate')
  assert.equal(groupFormErrorField(apiError(422, 'group_schedule_locked')), 'schedule')
  // Birleştirme alanları grup formunda yoktur.
  assert.equal(groupFormErrorField(apiError(422, 'group_merge_same')), undefined)
  assert.equal(groupFormErrorField(apiError(403, 'group_teacher_conflict')), undefined)
  assert.equal(groupFormErrorField(apiError(404, 'not_found')), undefined)
  assert.equal(groupFormErrorField(apiError(500, 'internal')), undefined)
})

test('birleştirme formu hata eşlemesi: kaynak seçimi ve onay kutusu (DOM-DIL-042)', () => {
  assert.equal(
    mergeFormErrorField(apiError(422, 'group_merge_consent_required')),
    'learnersConsented',
  )
  assert.equal(mergeFormErrorField(apiError(422, 'group_merge_capacity')), 'sourceGroupId')
  assert.equal(mergeFormErrorField(apiError(409, 'learner_schedule_conflict')), 'sourceGroupId')
  assert.equal(
    mergeFormErrorField(apiError(422, 'group_schedule_overlap', ['schedule', 0])),
    'sourceGroupId',
  )
  assert.equal(mergeFormErrorField(apiError(422, 'group_teacher_conflict')), undefined)
  assert.equal(mergeFormErrorField(apiError(404, 'not_found')), undefined)
})
