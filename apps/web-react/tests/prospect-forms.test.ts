import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createBody,
  createDefaults,
  createFormSchema,
  fieldErrors,
  isDuplicateCode,
  isMinor,
  meetingBody,
  meetingFormSchema,
  meetingInstant,
  noteFormSchema,
  PRIVACY_NOTICE_VERSION,
  stageBody,
  trialBody,
  trialLessonOptions,
} from '../src/pages/crm/prospect-forms.ts'

const NOW = Date.parse('2026-10-15T09:00:00.000Z')
const valid = {
  ...createDefaults('br-1'),
  name: 'Alara Güven',
  phone: '0532 111 22 33',
  interest: 'B1 genel İngilizce',
  noticeShown: true,
}

test('DOM-KAY-009: okul adayı 18 yaş altı sayılır, dil okulunda seçim zorunludur', () => {
  assert.equal(isMinor('', 'school'), true)
  assert.equal(isMinor('no', 'language_school'), false)
  assert.equal(isMinor('yes', 'language_school'), true)
  const school = createFormSchema('school').safeParse(valid)
  assert.equal(school.success, false)
  assert.ok(school.error?.issues.some((issue) => issue.path[0] === 'guardianName'))
  const language = createFormSchema('language_school').safeParse(valid)
  assert.ok(language.error?.issues.some((issue) => issue.path[0] === 'minor'))
})

test('DOM-KAY-009: yetişkin dil okulu adayı veli adı olmadan geçer, gövdeye minor=false girer', () => {
  const parsed = createFormSchema('language_school').safeParse({ ...valid, minor: 'no' })
  assert.equal(parsed.success, true)
  if (!parsed.success) return
  const body = createBody(parsed.data, 'language_school')
  assert.equal(body.phone, '05321112233')
  assert.equal(body.minor, false)
  assert.equal('guardianName' in body, false)
  assert.equal(body.privacyNoticeVersion, PRIVACY_NOTICE_VERSION)
})

test('DOM-KAY-003: aydınlatma onayı, e-posta onayı ve referans öğrencisi sorulur', () => {
  const schema = createFormSchema('school')
  const base = { ...valid, guardianName: 'Ayşe Güven' }
  assert.equal(schema.safeParse({ ...base, noticeShown: false }).success, false)
  assert.equal(schema.safeParse({ ...base, emailConsent: true }).success, false)
  assert.equal(schema.safeParse({ ...base, source: 'Veli referansı' }).success, false)
  const ok = schema.safeParse({ ...base, source: 'Veli referansı', referrerStudentId: 's1' })
  assert.equal(ok.success, true)
  if (ok.success) assert.equal(createBody(ok.data, 'school').referrerStudentId, 's1')
})

test('mükerrer ret kodları tanınır', () => {
  assert.equal(isDuplicateCode('prospect_duplicate'), true)
  assert.equal(isDuplicateCode('prospect_contact_shared'), true)
  assert.equal(isDuplicateCode('validation_error'), false)
})

test('DOM-KAY-005: vazgeçmede neden zorunlu, yeniden açmada kardeş yalnız seçilmişse gider', () => {
  const noReason = stageBody({ stage: 'Vazgeçti', lostReason: '' }, { reopening: false })
  assert.deepEqual(noReason, {
    ok: false,
    field: 'lostReason',
    message: 'Vazgeçme nedenini seçin.',
  })
  assert.deepEqual(stageBody({ stage: 'Vazgeçti', lostReason: 'price' }, { reopening: false }), {
    ok: true,
    body: { stage: 'Vazgeçti', lostReason: 'price' },
  })
  assert.equal(stageBody({ stage: '' }, { reopening: false }).ok, false)
  assert.deepEqual(
    stageBody({ stage: 'İletişime geçildi', siblingOfId: 'p2' }, { reopening: true }),
    { ok: true, body: { stage: 'İletişime geçildi', siblingOfId: 'p2' } },
  )
  assert.deepEqual(
    stageBody({ stage: 'İletişime geçildi', siblingOfId: 'p2' }, { reopening: false }),
    { ok: true, body: { stage: 'İletişime geçildi' } },
  )
})

test('DOM-KAY-032: boş not reddedilir', () => {
  assert.equal(noteFormSchema.safeParse({ text: '  ' }).success, false)
  assert.equal(noteFormSchema.safeParse({ text: 'Veli ile görüşüldü.' }).success, true)
})

test('DOM-KAY-033: görüşme anı İstanbul saatinden UTC değerine çevrilir', () => {
  assert.equal(meetingInstant('2026-10-20', '13:00'), '2026-10-20T10:00:00.000Z')
  assert.equal(meetingInstant('', '13:00'), null)
  assert.equal(meetingInstant('2026-13-40', '13:00'), null)
})

test('DOM-KAY-033: geçmiş an alan hatası verir, gelecek an gövdeye öğretmensiz ya da öğretmenli girer', () => {
  const parse = (values: object) =>
    meetingFormSchema.parse({
      date: '2026-10-20',
      time: '13:00',
      duration: '30',
      room: 'Oda 1',
      ...values,
    })
  const past = meetingBody(parse({ date: '2026-10-10' }), NOW)
  assert.deepEqual(past, { ok: false, field: 'date', message: 'Gelecek bir tarih ve saat seçin.' })
  const open = meetingBody(parse({}), NOW)
  assert.deepEqual(open, {
    ok: true,
    body: { date: '2026-10-20T10:00:00.000Z', duration: 30, room: 'Oda 1' },
  })
  const withTeacher = meetingBody(parse({ teacherId: 't1' }), NOW)
  assert.equal(withTeacher.ok && withTeacher.body.teacherId, 't1')
  assert.equal(meetingFormSchema.safeParse({ ...parse({}), duration: '1' }).success, false)
})

test('DOM-KAY-034: deneme dersi seçenekleri gelecek, iptal edilmemiş ve kampüs grubundaki dersleri sıralı verir', () => {
  const lessons = [
    { id: 'l-late', classId: 'c1', date: '2026-10-22T10:00:00.000Z', duration: 40 },
    {
      id: 'l-soon',
      classId: 'c1',
      date: '2026-10-20T10:00:00.000Z',
      duration: 40,
      title: 'Speaking',
    },
    { id: 'l-past', classId: 'c1', date: '2026-10-10T10:00:00.000Z', duration: 40 },
    {
      id: 'l-cancelled',
      classId: 'c1',
      date: '2026-10-21T10:00:00.000Z',
      duration: 40,
      cancelledAt: 'x',
    },
    { id: 'l-other', classId: 'c9', date: '2026-10-21T10:00:00.000Z', duration: 40 },
  ]
  const options = trialLessonOptions(lessons, new Map([['c1', 'A2 Akşam']]), NOW)
  assert.deepEqual(
    options.map((item) => item.id),
    ['l-soon', 'l-late'],
  )
  assert.match(options[0]?.label ?? '', /13:00 – 13:40 · A2 Akşam · Speaking$/)
})

test('DOM-DIL-030: veli onayı yalnız 18 yaş altında gövdeye girer', () => {
  assert.deepEqual(trialBody({ lessonId: 'l1', guardianConsent: true }, true), {
    lessonId: 'l1',
    guardianConsent: true,
  })
  assert.deepEqual(trialBody({ lessonId: 'l1' }, true), { lessonId: 'l1', guardianConsent: false })
  assert.deepEqual(trialBody({ lessonId: 'l1', guardianConsent: true }, false), { lessonId: 'l1' })
})

test('sunucu hata yolu bilinen alana yazılır, bilinmeyen yol form düzeyi hata olur; yalnız ilk alan odak alır', () => {
  const calls: Array<{ name: string; focus: boolean | undefined }> = []
  const apply = fieldErrors(['phone', 'siblingOfId'] as const, (name, _error, options) => {
    calls.push({ name, focus: options?.shouldFocus })
  })
  const error = { type: 'server', message: 'Bu telefon kullanılıyor.' }
  apply('phone', error)
  apply('siblingOfId', error)
  apply('guardianName', error)
  assert.deepEqual(calls, [
    { name: 'phone', focus: true },
    { name: 'siblingOfId', focus: false },
    { name: 'root.server', focus: undefined },
  ])
})
