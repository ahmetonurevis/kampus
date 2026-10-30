import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { BookableSlot } from '@kampus/react-shared/appointment-slots.ts'
import {
  APPOINTMENT_TYPES_BY_ROLE,
  bookAppointmentSchema,
} from '@kampus/school-core/lib/appointments.ts'
import {
  appointmentTypes,
  bookBody,
  bookDefaults,
  bookFormSchema,
  groupSlots,
  reasonLabel,
  selectableSlot,
  slotTime,
  transitionBody,
} from '../src/pages/communication/appointment-forms.ts'

const slot = (over: Partial<BookableSlot> & Pick<BookableSlot, 'slotId'>): BookableSlot => ({
  teacherId: 't1',
  teacherName: 'Selin Kaya',
  startsAt: '2026-10-20T10:00:00.000Z',
  duration: 30,
  subjectNames: ['Matematik'],
  available: true,
  ...over,
})

test('DOM-ILT-100: tür seçenekleri rolün sınırıdır ve ilk seçenek varsayılandır', () => {
  assert.deepEqual(appointmentTypes('parent'), APPOINTMENT_TYPES_BY_ROLE.veli)
  assert.deepEqual(appointmentTypes('student'), APPOINTMENT_TYPES_BY_ROLE.ogrenci)
  assert.equal(bookDefaults('parent').type, 'Veli görüşmesi')
  assert.equal(bookDefaults('student').type, 'Bireysel etüt')
  assert.equal(bookDefaults('student').slotId, '')
})

test('DOM-ILT-100: talep formu saat, tür ve konu ister; mesajlar core ile aynıdır', () => {
  const empty = bookFormSchema.safeParse({ slotId: '', type: 'Bireysel etüt', note: '' })
  assert.equal(empty.success, false)
  const messages = empty.error?.issues.map((issue) => issue.message)
  assert.deepEqual(messages, ['Müsait bir görüşme saati seçin.', 'Görüşme konusunu yazın.'])
  const core = bookAppointmentSchema.safeParse({ studentId: 's1', slotId: '', note: '' })
  assert.deepEqual(
    core.error?.issues.map((issue) => issue.message),
    messages,
  )
  assert.equal(
    bookFormSchema.safeParse({ slotId: 'x', type: 'Veli görüşmesi', note: 'ok' }).success,
    true,
  )
})

test('DOM-ILT-105: dolu saat seçilemez ve istek atılmaz; nedeni söylenmez', () => {
  const slots = [slot({ slotId: 'free' }), slot({ slotId: 'busy', available: false })]
  assert.equal(selectableSlot(slots, 'free')?.slotId, 'free')
  assert.equal(selectableSlot(slots, 'busy'), undefined)
  assert.equal(selectableSlot(slots, 'gone'), undefined)
  const values = { slotId: 'busy', type: 'Bireysel etüt', note: 'Konu' } as const
  const outcome = bookBody(values, 's1', slots, 'student')
  assert.deepEqual(outcome, {
    ok: false,
    field: 'slotId',
    message: 'Müsait bir görüşme saati seçin.',
  })
})

test('DOM-ILT-100: talep gövdesi konuyu kırpar; rolün seçemediği tür istek atmadan reddedilir', () => {
  const slots = [slot({ slotId: 'free' })]
  const ok = bookBody(
    { slotId: 'free', type: 'Bireysel etüt', note: '  Denklemler  ' },
    's1',
    slots,
    'student',
  )
  assert.deepEqual(ok, {
    ok: true,
    body: { studentId: 's1', slotId: 'free', type: 'Bireysel etüt', note: 'Denklemler' },
  })
  const wrong = bookBody(
    { slotId: 'free', type: 'Bireysel etüt', note: 'Konu' },
    's1',
    slots,
    'parent',
  )
  assert.deepEqual(wrong, {
    ok: false,
    field: 'type',
    message: 'Bu görüşme türünü seçemezsiniz.',
  })
})

test('DOM-ILT-105: saatler İstanbul gününe bölünür, gün içinde saat sırasıyla dizilir', () => {
  const groups = groupSlots([
    slot({ slotId: 'b', startsAt: '2026-10-20T11:00:00.000Z', campusName: 'Kadıköy Kampüsü' }),
    slot({ slotId: 'c', startsAt: '2026-10-21T10:00:00.000Z', available: false }),
    slot({ slotId: 'a', startsAt: '2026-10-20T10:00:00.000Z', subjectNames: [] }),
    // 21:30Z İstanbul'da ertesi gün 00:30'dur.
    slot({ slotId: 'late', startsAt: '2026-10-20T21:30:00.000Z' }),
  ])
  assert.deepEqual(
    groups.map((group) => [group.day, group.slots.map((item) => item.id)]),
    [
      ['2026-10-20', ['a', 'b']],
      ['2026-10-21', ['late', 'c']],
    ],
  )
  const first = groups[0]?.slots[0]
  assert.equal(first?.time, '13:00 – 13:30')
  assert.equal(first?.subjects, '')
  assert.equal(groups[0]?.slots[1]?.campus, 'Kadıköy Kampüsü')
  assert.equal(groups[1]?.slots[1]?.available, false)
  assert.equal(slotTime('2026-10-20T10:45:00.000Z', 30), '13:45 – 14:15')
})

test('DOM-ILT-102: red ve iptal gerekçe ister, onay ve geri çekme istemez', () => {
  assert.deepEqual(transitionBody('Reddedildi', '  '), {
    ok: false,
    message: 'Red gerekçesini yazın.',
  })
  assert.deepEqual(transitionBody('İptal', ''), {
    ok: false,
    message: 'İptal gerekçesini yazın.',
  })
  assert.deepEqual(transitionBody('Reddedildi', ' O gün müsait değilim. '), {
    ok: true,
    body: { status: 'Reddedildi', reason: 'O gün müsait değilim.' },
  })
  assert.deepEqual(transitionBody('Onaylandı', ''), { ok: true, body: { status: 'Onaylandı' } })
  assert.deepEqual(transitionBody('Geri çekildi', ''), {
    ok: true,
    body: { status: 'Geri çekildi' },
  })
  assert.equal(transitionBody('İptal', 'x').ok, false)
  assert.equal(transitionBody('İptal', 'x'.repeat(501)).ok, false)
})

test('DOM-ILT-102: gerekçe alanının etiketi işleme göre değişir', () => {
  assert.equal(reasonLabel(['approve', 'reject']), 'Red gerekçesi')
  assert.equal(reasonLabel(['cancel']), 'İptal gerekçesi')
})
