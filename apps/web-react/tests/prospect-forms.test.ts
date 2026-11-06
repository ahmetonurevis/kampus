import assert from 'node:assert/strict'
import { test } from 'node:test'
import { INSTITUTION_TYPES } from '@kampus/school-core/modules/collection-modules.ts'
import {
  createBody,
  createDefaults,
  createFormSchema,
  editBody,
  editDefaults,
  editFormSchema,
  fieldErrors,
  isDuplicateCode,
  isMinor,
  meetingBody,
  meetingFormSchema,
  meetingInstant,
  noteFormSchema,
  PRIVACY_NOTICE_VERSION,
  revertBody,
  revertDefaults,
  revertFormSchema,
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

test('DOM-KAY-009, ADR 0008: okul dışındaki her türde yaş grubu zorunlu; yetişkinin gövdesinde veli adı yok', () => {
  const courseTypes = INSTITUTION_TYPES.filter((type) => type !== 'school')
  assert.ok(courseTypes.length > 0)
  for (const type of courseTypes) {
    const missing = createFormSchema(type).safeParse(valid)
    assert.ok(
      missing.error?.issues.some((issue) => issue.path[0] === 'minor'),
      type,
    )
    const parsed = createFormSchema(type).safeParse({
      ...valid,
      minor: 'no',
      guardianName: 'Ayşe Güven',
    })
    assert.equal(parsed.success, true, type)
    if (!parsed.success) continue
    const body = createBody(parsed.data, type)
    assert.equal(body.minor, false, type)
    assert.equal('guardianName' in body, false, type)
    const child = createFormSchema(type).safeParse({ ...valid, minor: 'yes' })
    assert.ok(
      child.error?.issues.some((issue) => issue.path[0] === 'guardianName'),
      type,
    )
  }
  const school = createFormSchema('school').safeParse({ ...valid, guardianName: 'Ayşe Güven' })
  assert.equal(school.success, true)
  if (school.success) assert.equal('minor' in createBody(school.data, 'school'), false)
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

test("DOM-KAY-034: 25 grup ve 100'den fazla ders sessizce düşmeden seçeneğe girer", () => {
  const classes = new Map(Array.from({ length: 25 }, (_, i) => [`c${i}`, `Grup ${i}`] as const))
  const lessons = Array.from({ length: 150 }, (_, i) => ({
    id: `l${i}`,
    classId: `c${i % 25}`,
    date: new Date(NOW + (i + 1) * 3_600_000).toISOString(),
    duration: 40,
  }))
  lessons.push({
    id: 'l-yabanci',
    classId: 'baska-kampus',
    date: new Date(NOW + 3_600_000).toISOString(),
    duration: 40,
  })
  const options = trialLessonOptions(lessons, classes, NOW)
  assert.equal(options.length, 150)
  assert.equal(options[0]?.id, 'l0')
  assert.equal(options[149]?.id, 'l149')
  assert.equal(
    options.some((item) => item.id === 'l-yabanci'),
    false,
  )
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
  const calls: string[] = []
  const focused: string[] = []
  const apply = fieldErrors(
    ['phone', 'siblingOfId'] as const,
    (name) => calls.push(name),
    (name) => focused.push(name),
  )
  const error = { type: 'server', message: 'Bu telefon kullanılıyor.' }
  apply('phone', error)
  apply('siblingOfId', error)
  apply('guardianName', error)
  assert.deepEqual(calls, ['phone', 'siblingOfId', 'root.server'])
  assert.deepEqual(focused, ['phone'])
})

test('DOM-KAY-030: aşama geri alma formu hedef aşama ve gerekçe ister; gövde yalnız açık aşamayı taşır', () => {
  const empty = revertFormSchema.safeParse(revertDefaults())
  assert.equal(empty.success, false)
  const paths = empty.success ? [] : empty.error.issues.map((issue) => issue.path[0])
  assert.deepEqual(paths.sort(), ['reason', 'stage'])
  assert.equal(revertFormSchema.safeParse({ stage: 'Yeni aday', reason: 'x' }).success, false)
  const ok = revertFormSchema.parse({ stage: 'İletişime geçildi', reason: '  Yanlış aşama.  ' })
  assert.deepEqual(revertBody(ok), {
    ok: true,
    body: { stage: 'İletişime geçildi', reason: 'Yanlış aşama.' },
  })
  // Kapalı ya da bilinmeyen aşama gövdeye girmez.
  for (const stage of ['Vazgeçti', 'Kayıt oldu', 'Bilinmeyen'])
    assert.deepEqual(revertBody({ stage, reason: 'Gerekçe.' }), {
      ok: false,
      message: 'Geri alınacak aşamayı seçin.',
    })
})

test('DOM-KAY-003: düzeltme formu mevcut değerle dolar, yalnız farklı alanları gönderir', () => {
  const prospect = {
    name: 'Alara Güven',
    phone: '05321112233',
    email: 'alara@kampus.example',
    interest: 'B1 genel İngilizce',
    guardianName: 'Ayşe Güven',
    minor: true,
  }
  const defaults = editDefaults(prospect)
  assert.deepEqual(defaults, {
    name: 'Alara Güven',
    phone: '05321112233',
    email: 'alara@kampus.example',
    interest: 'B1 genel İngilizce',
    guardianName: 'Ayşe Güven',
  })
  // Değişiklik yoksa istek atılmaz.
  assert.deepEqual(editBody(editFormSchema.parse(defaults), prospect), {
    ok: false,
    field: 'root',
    message: 'Değişiklik yapılmadı.',
  })
  // Telefon boşluklarla yazılsa da temizlenir; yalnız telefon ve e-posta farkı gider (e-posta silinir).
  const changed = editFormSchema.parse({ ...defaults, phone: '0532 222 33 44', email: '' })
  assert.deepEqual(editBody(changed, prospect), {
    ok: true,
    body: { phone: '05322223344', email: '' },
  })
})

test('DOM-KAY-003: dolu veli adı silinemez; adı hiç yazılmamış eski kayıtta boş veli diğer düzeltmeyi engellemez', () => {
  const legacy = { name: 'Eski Aday', phone: '05321112266', interest: 'A1', minor: undefined }
  const values = editFormSchema.parse({ ...editDefaults(legacy), interest: 'A2' })
  assert.deepEqual(editBody(values, legacy), { ok: true, body: { interest: 'A2' } })
  const short = editFormSchema.parse({ ...editDefaults(legacy), guardianName: 'V' })
  assert.deepEqual(editBody(short, legacy), {
    ok: false,
    field: 'guardianName',
    message: 'Velinin adını yazın.',
  })
  const added = editFormSchema.parse({ ...editDefaults(legacy), guardianName: 'Veli Kişi' })
  assert.deepEqual(editBody(added, legacy), { ok: true, body: { guardianName: 'Veli Kişi' } })
})

test('DOM-KAY-003: 18 yaş altında dolu veli adı boş bırakılamaz, yetişkin adayda sorulmaz', () => {
  const minor = {
    name: 'Ece Kaya',
    phone: '05321112244',
    interest: 'A2',
    guardianName: 'Veli',
    minor: true,
  }
  const emptied = editFormSchema.parse({ ...editDefaults(minor), guardianName: ' ' })
  assert.deepEqual(editBody(emptied, minor), {
    ok: false,
    field: 'guardianName',
    message: 'Velinin adını yazın.',
  })
  const adult = { name: 'Can Demir', phone: '05321112255', interest: 'C1', minor: false }
  const renamed = editFormSchema.parse({ ...editDefaults(adult), name: 'Can D. Demir' })
  assert.deepEqual(editBody(renamed, adult), { ok: true, body: { name: 'Can D. Demir' } })
})

test('DOM-KAY-005: tercih edilen kurum yazılırsa gövdeye girer, boşsa gitmez; aşama değişince gitmez', () => {
  const lost = { stage: 'Vazgeçti', lostReason: 'other_school' as const }
  assert.deepEqual(
    stageBody({ ...lost, lostToInstitution: ' Rakip Koleji ' }, { reopening: false }),
    { ok: true, body: { ...lost, lostToInstitution: 'Rakip Koleji' } },
  )
  assert.deepEqual(stageBody({ ...lost, lostToInstitution: '  ' }, { reopening: false }), {
    ok: true,
    body: lost,
  })
  assert.deepEqual(
    stageBody({ stage: 'Teklif verildi', lostToInstitution: 'Rakip' }, { reopening: false }),
    { ok: true, body: { stage: 'Teklif verildi' } },
  )
})
