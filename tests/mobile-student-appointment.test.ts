import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError } from '../packages/api-client/src/errors.ts'
import type { KampusClient } from '../packages/api-client/src/client.ts'
import { runRequest } from '../packages/react-shared/src/api-result.ts'
import { createCommandSession, runCommand } from '../packages/react-shared/src/commands.ts'
import type { BookableSlot } from '../packages/react-shared/src/appointment-slots.ts'
import {
  APPOINTMENT_CHANGED_MESSAGE,
  bookAppointmentRequest,
} from '../packages/react-shared/src/use-appointment-commands.ts'
import {
  ACTION_TEXTS,
  ALL_TEACHERS,
  APPOINTMENT_GROUP_OPTIONS,
  actionFailure,
  appointmentBadgeTone,
  appointmentEmptyText,
  appointmentErrorView,
  appointmentGroup,
  appointmentGroupCounts,
  appointmentLookups,
  bookFailure,
  cancelReasonLabel,
  checkAction,
  checkBook,
  filterSlotGroups,
  groupSlots,
  isAppointmentGroup,
  serverDayStart,
  slotTeachers,
  studentActions,
  studentAppointmentRows,
  stillSelectable,
  visibleAppointmentRows,
} from '../apps/mobile/src/api/student-appointment.ts'

const apiError = (status: number, code: string, message = 'Sunucu mesajı') =>
  new ApiError({ status, code, message })
const networkError = () => apiError(0, 'network_error')

const TODAY = '2026-10-15'
const lookups = appointmentLookups([
  { id: 't1', record: { name: 'Selin Kaya' } },
  { id: 't2', record: { name: 'Ali Demir' } },
])

type Item = Parameters<typeof studentAppointmentRows>[0][number]

const item = (
  id: string,
  date: string,
  status: string,
  extra: Record<string, unknown> = {},
): Item =>
  ({
    id,
    version: 4,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    archivedAt: null,
    record: {
      id,
      studentId: 's1',
      teacherId: 't1',
      date,
      duration: 30,
      type: 'Bireysel etüt',
      note: 'Denklemleri konuşmak istiyorum.',
      status,
      requestedBy: { role: 'ogrenci', userId: 'u-s1' },
      history: [],
      ...extra,
    },
  }) as unknown as Item

const ITEMS: Item[] = [
  item('gecmis-onayli', '2026-10-10T10:00:00.000Z', 'Onaylandı'),
  item('reddedildi', '2026-10-18T10:00:00.000Z', 'Reddedildi'),
  item('yakin-onayli', '2026-10-16T10:00:00.000Z', 'Onaylandı'),
  item('bekleyen', '2026-10-20T10:00:00.000Z', 'Bekliyor'),
  item('uzak-onayli', '2026-10-25T10:00:00.000Z', 'Onaylandı'),
]

const slot = (over: Partial<BookableSlot> & Pick<BookableSlot, 'slotId'>): BookableSlot => ({
  teacherId: 't1',
  teacherName: 'Selin Kaya',
  startsAt: '2026-10-20T10:00:00.000Z',
  duration: 30,
  subjectNames: ['Matematik'],
  available: true,
  ...over,
})

const SLOTS: BookableSlot[] = [
  slot({
    slotId: 'a2',
    teacherId: 't2',
    teacherName: 'Ali Demir',
    startsAt: '2026-10-20T11:00:00.000Z',
  }),
  slot({ slotId: 'a1', startsAt: '2026-10-20T10:00:00.000Z' }),
  slot({ slotId: 'dolu', startsAt: '2026-10-20T12:00:00.000Z', available: false }),
  slot({ slotId: 'b1', startsAt: '2026-10-21T10:00:00.000Z' }),
]

describe('IST-124 mobil öğrenci randevu modeli (DOM-ILT-100, DOM-ILT-102, DOM-ILT-105)', () => {
  test('DOM-ILT-102 sunucu günü İstanbul gün başlangıcına çevrilir; geçersiz değer null verir', () => {
    assert.equal(serverDayStart('2026-10-15'), '2026-10-14T21:00:00.000Z')
    assert.equal(serverDayStart(null), null)
    assert.equal(serverDayStart(''), null)
    assert.equal(serverDayStart('15.10.2026'), null)
    assert.equal(serverDayStart('2026-13-45'), null)
  })

  test('DOM-ILT-102 satırlar bekleyen, yaklaşan onaylı, sonra sonuçlananlar sırasıyla gelir', () => {
    const rows = studentAppointmentRows(ITEMS, lookups, 'u-s1', TODAY)
    assert.deepEqual(
      rows.map((row) => row.id),
      ['bekleyen', 'yakin-onayli', 'uzak-onayli', 'reddedildi', 'gecmis-onayli'],
    )
    assert.equal(rows[0]?.counterpart, 'Selin Kaya')
  })

  test('DOM-ILT-102 gün yoksa yalnız geri çekme sunulur; iptal gizlenir, sıra kayıt sırasında kalır', () => {
    const rows = studentAppointmentRows(ITEMS, lookups, 'u-s1', null)
    assert.deepEqual(
      rows.map((row) => row.id),
      ITEMS.map((entry) => entry.id),
    )
    for (const row of rows) assert.equal(row.actions.includes('cancel'), false)
    assert.deepEqual(rows.find((row) => row.id === 'bekleyen')?.actions, ['withdraw'])
  })

  test('DOM-ILT-102 talep eden bekleyeni geri çeker, onaylı başlamamışı iptal eder; geçmiş ve başkasınınki yok', () => {
    const rows = studentAppointmentRows(ITEMS, lookups, 'u-s1', TODAY)
    const actions = (id: string, today: string | null = TODAY) => {
      const row = rows.find((entry) => entry.id === id)
      assert.ok(row)
      return studentActions(row, today)
    }
    assert.deepEqual(actions('bekleyen'), ['withdraw'])
    assert.deepEqual(actions('yakin-onayli'), ['cancel'])
    // Gün geçince (randevu günü başladı) iptal kalkar; gün yoksa hiç sunulmaz.
    assert.deepEqual(actions('yakin-onayli', '2026-10-17'), [])
    assert.deepEqual(actions('yakin-onayli', null), [])
    assert.deepEqual(actions('gecmis-onayli'), [])
    assert.deepEqual(actions('reddedildi'), [])
    const others = studentAppointmentRows(ITEMS, lookups, 'u-baska', TODAY)
    assert.deepEqual(
      others.flatMap((row) => row.actions),
      [],
    )
  })

  test('DOM-ILT-102 durum sekmeleri sayımları, süzgeci ve aramayı verir', () => {
    const rows = studentAppointmentRows(ITEMS, lookups, 'u-s1', TODAY)
    assert.deepEqual(appointmentGroupCounts(rows), { pending: 1, approved: 3, closed: 1 })
    assert.deepEqual(
      APPOINTMENT_GROUP_OPTIONS.map((option) => option.value),
      ['', 'pending', 'approved', 'closed'],
    )
    assert.equal(isAppointmentGroup('closed'), true)
    assert.equal(isAppointmentGroup(''), false)
    assert.equal(appointmentGroup({ status: 'İptal' }), 'closed')
    assert.equal(appointmentGroup({ status: 'Geri çekildi' }), 'closed')
    assert.deepEqual(
      visibleAppointmentRows(rows, 'approved', '').map((row) => row.id),
      ['yakin-onayli', 'uzak-onayli', 'gecmis-onayli'],
    )
    assert.equal(visibleAppointmentRows(rows, '', 'SELİN').length, 5)
    assert.deepEqual(
      visibleAppointmentRows(rows, '', 'reddedildi').map((row) => row.id),
      ['reddedildi'],
    )
    assert.equal(visibleAppointmentRows(rows, 'pending', 'reddedildi').length, 0)
  })

  test('DOM-ILT-102 boş durum metni, rozet tonu ve hata görünümü', () => {
    assert.equal(appointmentEmptyText('').title, 'Henüz randevun yok')
    assert.equal(appointmentEmptyText('pending').title, 'Bekleyen talep yok')
    assert.equal(appointmentEmptyText('approved').title, 'Onaylı randevu yok')
    assert.equal(appointmentEmptyText('closed').title, 'Kapanan randevu yok')
    assert.equal(appointmentBadgeTone('Onaylandı'), 'green')
    assert.equal(appointmentBadgeTone('Bekliyor'), 'amber')
    assert.equal(appointmentBadgeTone('Reddedildi'), 'red')
    assert.equal(appointmentBadgeTone('İptal'), 'primary')
    assert.equal(appointmentErrorView(null, true), 'none')
    assert.equal(appointmentErrorView(networkError(), true), 'inline')
    assert.equal(appointmentErrorView(networkError(), false), 'full')
  })
})

describe('IST-124 mobil alınabilir saatler (DOM-ILT-105)', () => {
  test('saatler İstanbul gününe bölünür, gün içinde saat sırasıyla dizilir', () => {
    const groups = groupSlots(SLOTS)
    assert.deepEqual(
      groups.map((group) => group.day),
      ['2026-10-20', '2026-10-21'],
    )
    assert.deepEqual(
      groups[0]?.slots.map((view) => view.id),
      ['a1', 'a2', 'dolu'],
    )
  })

  test('öğretmen listesi ad sıralı ve tekrarsızdır; süzgeç boş günleri düşürür', () => {
    const groups = groupSlots(SLOTS)
    assert.deepEqual(slotTeachers(groups), ['Ali Demir', 'Selin Kaya'])
    const ali = filterSlotGroups(groups, 'Ali Demir')
    assert.equal(ali.length, 1)
    assert.deepEqual(
      ali[0]?.slots.map((view) => view.id),
      ['a2'],
    )
    assert.equal(filterSlotGroups(groups, ALL_TEACHERS).length, 2)
    // Bilinmeyen öğretmen (liste yenilenince düşmüş) tümünü gösterir, boş ekran bırakmaz.
    assert.equal(filterSlotGroups(groups, 'Silinmiş Öğretmen').length, 2)
  })

  test('dolan ya da listeden düşen saatin seçimi kalkar', () => {
    assert.equal(stillSelectable(SLOTS, 'a1'), 'a1')
    assert.equal(stillSelectable(SLOTS, 'dolu'), '')
    assert.equal(stillSelectable(SLOTS, 'yok'), '')
    assert.equal(stillSelectable(SLOTS, ''), '')
  })
})

describe('IST-124 randevu talebi ve eylemleri (DOM-ILT-100, DOM-ILT-102, DOM-ILT-105)', () => {
  const form = { slotId: 'a1', type: 'Bireysel etüt', note: '  Denklemler  ' } as const

  test('DOM-ILT-100 geçerli talep gövdeye dönüşür, konu kırpılır', () => {
    const check = checkBook(form, 's1', SLOTS)
    assert.equal(check.ok, true)
    assert.deepEqual(check.ok && check.body, {
      studentId: 's1',
      slotId: 'a1',
      type: 'Bireysel etüt',
      note: 'Denklemler',
    })
  })

  test('DOM-ILT-105 dolu ya da listede olmayan saat ve boş konu istek atmadan reddedilir', () => {
    const busy = checkBook({ ...form, slotId: 'dolu' }, 's1', SLOTS)
    assert.equal(busy.ok === false && busy.errors.slotId, 'Müsait bir görüşme saati seçin.')
    const gone = checkBook({ ...form, slotId: 'yok' }, 's1', SLOTS)
    assert.equal(gone.ok === false && gone.errors.slotId, 'Müsait bir görüşme saati seçin.')
    const empty = checkBook({ ...form, note: '   ' }, 's1', SLOTS)
    assert.equal(empty.ok === false && empty.errors.note, 'Görüşme konusunu yazın.')
  })

  test('DOM-ILT-100 öğrencinin seçemediği tür reddedilir', () => {
    const type = checkBook({ ...form, type: 'Veli görüşmesi' }, 's1', SLOTS)
    assert.equal(type.ok === false && type.errors.type, 'Bu görüşme türünü seçemezsiniz.')
    const academic = checkBook({ ...form, type: 'Akademik danışmanlık' }, 's1', SLOTS)
    assert.equal(academic.ok, true)
  })

  test('DOM-ILT-105 dolu saat çakışması saat alanında, geri kalanı genel mesajdır', () => {
    const conflict = bookFailure(apiError(409, 'slot_taken', 'Bu saat doldu.'), {})
    assert.equal(conflict.message, 'Bu saat doldu.')
    assert.equal(conflict.retryable, false)
    const fields = bookFailure(apiError(400, 'validation_error', 'Geçersiz'), {
      note: 'Konu çok uzun.',
      baska: 'Başka sorun.',
    })
    assert.deepEqual(fields.errors, { note: 'Konu çok uzun.' })
    assert.equal(fields.message, 'Başka sorun.')
    assert.equal(bookFailure(networkError(), {}).retryable, true)
    assert.equal(
      bookFailure(apiError(409, 'version_conflict', 'x'), {}).message,
      APPOINTMENT_CHANGED_MESSAGE,
    )
  })

  test('DOM-ILT-102 geri çekme gerekçe istemez, iptal gerekçesiz reddedilir', () => {
    const withdraw = checkAction('withdraw', '')
    assert.equal(withdraw.ok, true)
    assert.equal(withdraw.ok && withdraw.status, 'Geri çekildi')
    assert.equal(withdraw.ok && 'reason' in withdraw.body, false)
    const noReason = checkAction('cancel', '   ')
    assert.equal(noReason.ok, false)
    assert.ok(!noReason.ok && noReason.message !== '')
    const cancel = checkAction('cancel', '  Sınav çıktı  ')
    assert.equal(cancel.ok && cancel.status, 'İptal')
    assert.equal(cancel.ok && cancel.body.reason, 'Sınav çıktı')
    assert.equal(cancelReasonLabel(), 'İptal gerekçesi')
    assert.equal(ACTION_TEXTS.withdraw.done, 'Randevu talebiniz geri çekildi.')
  })

  test('DOM-ILT-102 başlamış randevunun iptali sunucunun mesajıyla görünür; ağ hatası yeniden denenir', () => {
    const late = actionFailure(apiError(409, 'appointment_started', 'Randevu başladı.'), {})
    assert.equal(late.message, 'Randevu başladı.')
    assert.equal(late.retryable, false)
    const reason = actionFailure(apiError(400, 'validation_error', 'Geçersiz'), {
      reason: 'Gerekçe çok uzun.',
    })
    assert.deepEqual(reason.errors, { reason: 'Gerekçe çok uzun.' })
    assert.equal(actionFailure(apiError(502, 'x'), {}).retryable, true)
  })
})

describe('IST-124 randevu talep komutu (çift gönderim ve Idempotency-Key)', () => {
  function fakeBookServer(script: Array<'ok' | ApiError>) {
    const keys: string[] = []
    const client = {
      POST: async (
        _path: string,
        options: { params: { header: { 'idempotency-key': string } } },
      ) => {
        keys.push(options.params.header['idempotency-key'])
        const step = script.shift() ?? 'ok'
        if (step instanceof ApiError) throw step
        return { data: { data: {} }, response: new Response(null, { status: 201 }) }
      },
    } as unknown as KampusClient
    const send = (session: ReturnType<typeof createCommandSession>) => {
      const check = checkBook({ slotId: 'a1', type: 'Bireysel etüt', note: 'Konu' }, 's1', SLOTS)
      assert.ok(check.ok)
      return runCommand(
        session,
        {
          execute: (input, headers) =>
            runRequest(() => bookAppointmentRequest(client, input, headers)),
          refresh: async () => {},
        },
        check.body,
      )
    }
    return { keys, send }
  }

  test('çift dokunma tek istek atar', async () => {
    const server = fakeBookServer(['ok'])
    const session = createCommandSession()
    const [a, b] = await Promise.all([server.send(session), server.send(session)])
    assert.deepEqual([a.status, b.status].sort(), ['busy', 'success'])
    assert.equal(server.keys.length, 1)
  })

  test('ağ hatasından sonra "Yeniden dene" aynı anahtarla gider; mükerrer randevu oluşmaz', async () => {
    const server = fakeBookServer([networkError(), 'ok'])
    const session = createCommandSession()
    assert.equal((await server.send(session)).status, 'failed')
    assert.equal((await server.send(session)).status, 'success')
    assert.equal(new Set(server.keys).size, 1)
  })
})
