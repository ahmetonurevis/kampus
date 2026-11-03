import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type {
  PermissionFormDecision,
  PermissionFormListItem,
} from '@kampus/react-shared/permission-forms.ts'

import {
  changedPermissionFormFields,
  countsSummary,
  decisionDropped,
  decisionFormSchema,
  eventFacts,
  fee,
  formsForStudent,
  myDecision,
  myDecisionText,
  permissionActions,
  permissionFormDefaults,
  permissionFormRow,
  permissionFormSchema,
  permissionFormState,
  permissionTarget,
  planPermissionFormUpdate,
  removedFromTarget,
  studentEntry,
  targetChanged,
  type PermissionFormOutput,
} from '../src/pages/communication/permission-forms.ts'

// IST-067 (DOM-ILT-030, -036…038): izin formu ekranının saf mantığı.

const opened = {
  topic: 'trip' as const,
  title: 'Müze gezisi',
  description: 'Servisle gidilir.',
  deadline: '2026-12-01',
  eventDate: null as string | null,
  eventTime: null as string | null,
  location: null as string | null,
  transport: null as string | null,
  fee: null as number | null,
  classIds: ['c1'],
  targetStudentIds: [] as string[],
}
const values = (overrides: Partial<PermissionFormOutput> = {}): PermissionFormOutput => ({
  topic: 'trip',
  title: 'Müze gezisi',
  description: 'Servisle gidilir.',
  deadline: '2026-12-01',
  classIds: ['c1'],
  studentIds: [],
  ...overrides,
})
const item = (overrides: Partial<PermissionFormListItem> = {}): PermissionFormListItem => ({
  id: 'pf1',
  version: 2,
  ...opened,
  deadlineEndsAt: '2026-12-01T21:00:00.000Z',
  detailsRevision: 0,
  studentIds: ['s1', 's2'],
  teacherId: 't1',
  status: 'open',
  closedAt: null,
  cancelledAt: null,
  acceptingDecisions: true,
  createdAt: '2026-11-01T06:00:00.000Z',
  updatedAt: '2026-11-01T06:00:00.000Z',
  counts: { pending: 1, approved: 1, rejected: 0, total: 2 },
  ...overrides,
})

describe('kim ne yapabilir (DOM-ILT-036, DOM-ILT-038)', () => {
  test('form açmayı yönetici ve öğretmen yapar, diğer roller yapmaz', () => {
    assert.equal(permissionActions({ role: 'yonetici', teacherId: null }).create, true)
    assert.equal(permissionActions({ role: 'ogretmen', teacherId: 't1' }).create, true)
    for (const role of ['onburo', 'veli', 'ogrenci'])
      assert.equal(permissionActions({ role, teacherId: null }).create, false)
  })

  test('düzenleme ve kapatma yönetici ile formu açan öğretmendedir', () => {
    const form = { teacherId: 't1' }
    assert.equal(permissionActions({ role: 'yonetici', teacherId: null }, form).manage, true)
    assert.equal(permissionActions({ role: 'ogretmen', teacherId: 't1' }, form).manage, true)
    assert.equal(permissionActions({ role: 'ogretmen', teacherId: 't2' }, form).manage, false)
    // Yöneticinin açtığı formu (`teacherId: null`) hiçbir öğretmen yönetmez.
    assert.equal(
      permissionActions({ role: 'ogretmen', teacherId: 't1' }, { teacherId: null }).manage,
      false,
    )
    assert.equal(permissionActions({ role: 'ogretmen', teacherId: 't1' }).manage, false)
  })
})

describe('form şeması core kuralıdır', () => {
  const valid = {
    topic: 'trip',
    title: 'Müze gezisi',
    description: 'Servisle gidilir.',
    deadline: '2026-12-01',
    eventDate: '',
    eventTime: '',
    location: '',
    transport: '',
    fee: '',
    classIds: ['c1'],
    studentIds: [],
  }

  test('geçerli girdi geçer', () => {
    assert.equal(permissionFormSchema.safeParse(valid).success, true)
  })

  test('boş konu, başlık ve son gün Türkçe mesaj verir; geçmiş gün istemcide reddedilmez', () => {
    const result = permissionFormSchema.safeParse({
      ...valid,
      topic: '',
      title: '',
      deadline: '',
    })
    assert.equal(result.success, false)
    const messages = new Map(
      result.error?.issues.map((issue) => [String(issue.path[0]), issue.message]),
    )
    assert.equal(messages.get('topic'), 'Konu türünü seçin.')
    assert.equal(messages.get('title'), 'Form başlığını yazın.')
    assert.equal(messages.get('deadline'), 'Son günü seçin.')
    // Son günün hakemi sunucudur: geçmiş tarih biçimce geçerliyse istemci reddetmez.
    assert.equal(permissionFormSchema.safeParse({ ...valid, deadline: '2020-01-01' }).success, true)
  })

  test('sınıf ve öğrenci seçilmezse hedef hatası classIds alanındadır', () => {
    const result = permissionFormSchema.safeParse({ ...valid, classIds: [], studentIds: [] })
    assert.equal(result.success, false)
    assert.equal(result.error?.issues[0]?.path[0], 'classIds')
    assert.equal(result.error?.issues[0]?.message, 'En az bir sınıf ya da öğrenci seçin.')
  })

  test('boş gönderimde hedef hatası diğer alan hatalarıyla birlikte gelir (DOM-ILT-036)', () => {
    const result = permissionFormSchema.safeParse({
      ...valid,
      topic: '',
      title: '',
      deadline: '',
      classIds: [],
    })
    const paths = new Set(result.error?.issues.map((issue) => String(issue.path[0])))
    assert.deepEqual([...paths].sort(), ['classIds', 'deadline', 'title', 'topic'])
  })

  test('yalnız tek tek öğrenci seçmek yeter', () => {
    assert.equal(
      permissionFormSchema.safeParse({ ...valid, classIds: [], studentIds: ['s5'] }).success,
      true,
    )
  })
})

describe('düzenleme: yalnız değişen alanlar gider', () => {
  test('DOM-ILT-036: varsayılan hedef sunucunun kayıtlı hedefidir; yeni formda boştur', () => {
    assert.deepEqual(permissionFormDefaults({ ...opened, targetStudentIds: ['s7'] }), {
      topic: opened.topic,
      title: opened.title,
      description: opened.description,
      deadline: opened.deadline,
      eventDate: '',
      eventTime: '',
      location: '',
      transport: '',
      fee: '',
      classIds: ['c1'],
      studentIds: ['s7'],
    })
    // Alanı olmayan eski kayıt ve formu yönetmeyen okuyucu: yalnız sınıf hedefi.
    assert.deepEqual(permissionTarget({ ...opened, targetStudentIds: undefined }), {
      classIds: ['c1'],
      studentIds: [],
    })
    assert.equal(permissionFormDefaults().topic, '')
    assert.deepEqual(permissionFormDefaults().classIds, [])
  })

  test('hiç değişiklik yoksa gövde boştur', () => {
    assert.deepEqual(changedPermissionFormFields(opened, values()), {})
  })

  test('hedef değişirse iki liste birlikte gider', () => {
    assert.deepEqual(changedPermissionFormFields(opened, values({ classIds: ['c1', 'c2'] })), {
      classIds: ['c1', 'c2'],
      studentIds: [],
    })
    assert.deepEqual(changedPermissionFormFields(opened, values({ studentIds: ['s9'] })), {
      classIds: ['c1'],
      studentIds: ['s9'],
    })
  })

  test('hedef karşılaştırması sıradan bağımsızdır', () => {
    assert.equal(
      targetChanged(
        { classIds: ['c1', 'c2'], studentIds: [] },
        { classIds: ['c2', 'c1'], studentIds: [] },
      ),
      false,
    )
  })

  test('başkasının değiştirdiği alan geri yazılmaz; çakışan alan uyarı olur', () => {
    const fresh = { ...opened, title: 'Başkasının başlığı', deadline: '2026-12-05' }
    const plan = planPermissionFormUpdate(
      opened,
      fresh,
      values({ title: 'Benim başlığım', description: 'Yeni açıklama' }),
    )
    // Son gün kullanıcı tarafından değiştirilmedi: taze değer korunur, gövdede yok.
    assert.deepEqual(plan.body, { title: 'Benim başlığım', description: 'Yeni açıklama' })
    assert.deepEqual(
      plan.overlaps.map((entry) => [entry.field, entry.theirs, entry.mine]),
      [['title', 'Başkasının başlığı', 'Benim başlığım']],
    )
  })

  test('taze kayıt zaten kullanıcının değerindeyse gönderilecek bir şey kalmaz', () => {
    const fresh = { ...opened, title: 'Yeni' }
    const plan = planPermissionFormUpdate(opened, fresh, values({ title: 'Yeni' }))
    assert.deepEqual(plan.body, {})
    assert.deepEqual(plan.overlaps, [])
  })

  test('hedefi başkası da değiştirdiyse hedef uyarısı çıkar', () => {
    const fresh = { ...opened, classIds: ['c1', 'c3'] }
    const plan = planPermissionFormUpdate(opened, fresh, values({ classIds: ['c1', 'c2'] }))
    assert.deepEqual(plan.body, { classIds: ['c1', 'c2'], studentIds: [] })
    assert.equal(plan.overlaps[0]?.field, 'target')
  })

  test('DOM-ILT-036: başkasının tek tek eklediği öğrenci uyarısız düşmez', () => {
    // B, Ece'yi (s9) ekledi; A sınıf eklerse hedef çakışması gösterilir.
    const fresh = { ...opened, targetStudentIds: ['s9'] }
    const plan = planPermissionFormUpdate(opened, fresh, values({ classIds: ['c1', 'c2'] }))
    assert.deepEqual(
      plan.overlaps.map((entry) => [entry.field, entry.theirs, entry.mine]),
      [['target', '1 sınıf, 1 tek öğrenci', '2 sınıf, 0 tek öğrenci']],
    )
    // A hedefe dokunmadıysa hedef gönderilmez: B'nin eklediği kalır.
    const titleOnly = planPermissionFormUpdate(opened, fresh, values({ title: 'Yeni başlık' }))
    assert.deepEqual(titleOnly.body, { title: 'Yeni başlık' })
    assert.deepEqual(titleOnly.overlaps, [])
  })

  test('DOM-ILT-036: hem sınıfta hem tek seçili öğrenci sınıf çıkarılınca hedefte kalır', () => {
    const both = { ...opened, classIds: ['c1', 'c2'], targetStudentIds: ['s2'] }
    const plan = planPermissionFormUpdate(
      both,
      both,
      values({ classIds: ['c1'], studentIds: ['s2'] }),
    )
    assert.deepEqual(plan.body, { classIds: ['c1'], studentIds: ['s2'] })
  })

  test('kararlı formda hedeften çıkarılanlar bulunur', () => {
    assert.deepEqual(
      removedFromTarget(
        { classIds: ['c1', 'c2'], studentIds: ['s1'] },
        { classIds: ['c1'], studentIds: ['s1', 's2'] },
      ),
      { classIds: ['c2'], studentIds: [] },
    )
  })
})

describe('liste satırı (DOM-ILT-038)', () => {
  test('durum: açık, elle kapatılmış ve süresi dolmuş ayrı söylenir', () => {
    assert.equal(permissionFormState(item()), 'Açık')
    assert.equal(
      permissionFormState(item({ status: 'closed', closedAt: '2026-11-02T06:00:00.000Z' })),
      'Kapalı',
    )
    assert.equal(permissionFormState(item({ status: 'closed', closedAt: null })), 'Süresi doldu')
  })

  test('DOM-ILT-032: iptal edilmiş form kapanıştan önce "İptal edildi" söyler', () => {
    const at = '2026-11-02T06:00:00.000Z'
    assert.equal(
      permissionFormState(item({ status: 'closed', closedAt: at, cancelledAt: at })),
      'İptal edildi',
    )
  })

  test('karar özeti sayıları söyler; öğrencisiz özet tire olur', () => {
    assert.equal(
      countsSummary({ pending: 3, approved: 2, rejected: 1, total: 6 }),
      '2 onay · 1 ret · 3 bekliyor',
    )
    assert.equal(countsSummary({ pending: 0, approved: 0, rejected: 0, total: 0 }), '—')
  })

  test('satır konu etiketini ve son günü Türkçe gösterir', () => {
    const row = permissionFormRow(item())
    assert.equal(row.topic, 'Gezi')
    assert.equal(row.status, 'Açık')
    assert.ok(row.deadlineLabel.includes('2026'))
  })
})

describe('veli ve öğrenci kararı (DOM-ILT-030, DOM-ILT-037, DOM-ILT-038)', () => {
  const decision = (overrides: Partial<PermissionFormDecision> = {}): PermissionFormDecision => ({
    id: 'd1',
    decision: 'approved',
    note: '',
    relation: 'guardian',
    decidedAt: '2026-11-02T08:00:00.000Z',
    current: true,
    mine: true,
    decidedByUserId: null,
    ...overrides,
  })

  test('not isteğe bağlıdır, kırpılır ve 500 karakteri aşamaz', () => {
    assert.equal(decisionFormSchema.safeParse({ note: '' }).success, true)
    assert.equal(decisionFormSchema.safeParse({ note: '  servisle  ' }).data?.note, 'servisle')
    const long = decisionFormSchema.safeParse({ note: 'a'.repeat(501) })
    assert.equal(long.success, false)
    assert.equal(long.error?.issues[0]?.message, 'Not en fazla 500 karakter olabilir.')
  })

  test('geçerli karar okuyanın en son kararıdır; başkasının satırı sayılmaz', () => {
    const entry = {
      decisions: [
        decision({ id: 'd1', decision: 'approved' }),
        decision({ id: 'd0', decision: 'approved', mine: false }),
        decision({ id: 'd2', decision: 'rejected', note: 'Vazgeçtim' }),
      ],
    }
    assert.equal(myDecision(entry)?.id, 'd2')
    assert.equal(myDecisionText(myDecision(entry)), 'Reddettiniz.')
    assert.equal(myDecision({ decisions: [decision({ mine: false })] }), undefined)
    assert.equal(myDecisionText(undefined), 'Henüz karar vermediniz.')
    assert.equal(myDecisionText(decision()), 'Onayladınız.')
  })

  test('DOM-ILT-032: düşmüş karar geçerli karar sayılmaz; yeniden izin istenir', () => {
    const dropped = {
      status: 'pending' as const,
      decisions: [decision({ id: 'd1', current: false })],
    }
    assert.equal(myDecision(dropped), undefined)
    assert.equal(decisionDropped(dropped), true)
    // Yeniden karar verilince düşmüş satır kalır ama geçerli karar yenisidir.
    const again = {
      status: 'pending' as const,
      decisions: [...dropped.decisions, decision({ id: 'd2', decision: 'rejected' })],
    }
    assert.equal(myDecision(again)?.id, 'd2')
    assert.equal(decisionDropped(again), false)
    // Başkasının düşmüş kararı okuyanın kararı değildir; hiç kararı olmayan "düştü" sayılmaz.
    assert.equal(
      decisionDropped({
        status: 'pending',
        decisions: [decision({ mine: false, current: false })],
      }),
      false,
    )
    assert.equal(decisionDropped({ status: 'pending', decisions: [] }), false)
    assert.equal(decisionDropped(undefined), false)
  })

  test('DOM-ILT-032: öbür veli yeni sürümde karar verdiyse durum bekliyor değildir, "yeniden izin" denmez', () => {
    const decisions = [decision({ id: 'd1', current: false })]
    for (const status of ['approved', 'rejected'] as const)
      assert.equal(decisionDropped({ status, decisions }), false)
  })

  test('çocuğun satırı yalnız hedef olduğu formda bulunur', () => {
    const students = [
      { studentId: 's1', status: 'pending' as const, canDecide: true, decisions: [] },
      { studentId: 's2', status: 'approved' as const, canDecide: true, decisions: [] },
    ]
    assert.equal(studentEntry({ students }, 's2')?.status, 'approved')
    assert.equal(studentEntry({ students }, 's9'), undefined)
    // Personel liste satırı öğrenci satırı taşımaz.
    assert.equal(studentEntry({}, 's1'), undefined)
  })

  test('çocuk bazlı liste: karar alanlar önce, sonra yakın son gün; başka çocuğun formu yok', () => {
    const items = [
      item({ id: 'a', deadline: '2026-12-05', studentIds: ['s1'] }),
      item({ id: 'b', deadline: '2026-11-20', studentIds: ['s1', 's2'] }),
      item({ id: 'c', deadline: '2026-11-01', studentIds: ['s1'], acceptingDecisions: false }),
      item({ id: 'd', deadline: '2026-11-10', studentIds: ['s2'] }),
    ]
    assert.deepEqual(
      formsForStudent(items, 's1').map((form) => form.id),
      ['b', 'a', 'c'],
    )
    assert.deepEqual(
      formsForStudent(items, 's2').map((form) => form.id),
      ['d', 'b'],
    )
    assert.deepEqual(formsForStudent(items, 's3'), [])
  })
})

describe('etkinlik ayrıntısı (DOM-ILT-032)', () => {
  const valid = {
    topic: 'trip',
    title: 'Müze gezisi',
    description: 'Servisle gidilir.',
    deadline: '2026-12-01',
    eventDate: '2026-12-10',
    eventTime: '09:30',
    location: ' Arkeoloji Müzesi ',
    transport: 'Servis',
    fee: '250,50',
    classIds: ['c1'],
    studentIds: [],
  }

  test('DOM-ILT-032: ücret metni kuruşa çevrilir; boş belirtilmemiş, geçersiz metin reddedilir', () => {
    assert.equal(fee(''), null)
    assert.equal(fee('  '), null)
    assert.equal(fee('0'), 0)
    assert.equal(fee('0,00'), 0)
    assert.equal(fee('250'), 25000)
    assert.equal(fee('250,50'), 25050)
    assert.equal(fee('abc'), undefined)
    assert.equal(fee('-5'), undefined)
  })

  test('DOM-ILT-032: ayrıntı core girdisine çevrilir; boş alan gönderilmez', () => {
    const parsed = permissionFormSchema.safeParse(valid)
    assert.equal(parsed.success, true)
    assert.equal(parsed.data?.eventDate, '2026-12-10')
    assert.equal(parsed.data?.eventTime, '09:30')
    assert.equal(parsed.data?.location, 'Arkeoloji Müzesi')
    assert.equal(parsed.data?.fee, 25050)
    const empty = permissionFormSchema.safeParse({
      ...valid,
      eventDate: '',
      eventTime: '',
      location: '',
      transport: '',
      fee: '',
    })
    assert.equal(empty.success, true)
    for (const field of ['eventDate', 'eventTime', 'location', 'transport', 'fee'] as const)
      assert.equal(empty.data?.[field], undefined, field)
  })

  test('DOM-ILT-032: geçersiz ücret ve saat kendi alanında Türkçe mesaj verir', () => {
    const result = permissionFormSchema.safeParse({ ...valid, fee: 'on lira', eventTime: '25:00' })
    assert.equal(result.success, false)
    const messages = new Map(
      result.error?.issues.map((issue) => [String(issue.path[0]), issue.message]),
    )
    assert.ok(messages.get('fee')?.includes('250,50'))
    assert.equal(messages.get('eventTime'), 'Saati SS:DD biçiminde girin.')
  })

  test('DOM-ILT-032: kayıtlı ücret formda ₺ metni olur, ayrıntısız formda alanlar boştur', () => {
    const defaults = permissionFormDefaults({ ...opened, fee: 25050, location: 'Müze' })
    assert.equal(defaults.fee, '250,50')
    assert.equal(defaults.location, 'Müze')
    assert.equal(permissionFormDefaults(opened).fee, '')
  })

  test('DOM-ILT-032: değişen ayrıntı gider, kaldırılan ayrıntı null gider', () => {
    const withDetails = { ...opened, eventDate: '2026-12-10', fee: 0 }
    assert.deepEqual(
      changedPermissionFormFields(
        withDetails,
        values({ eventDate: '2026-12-11', fee: 0, location: 'Müze' }),
      ),
      { eventDate: '2026-12-11', location: 'Müze' },
    )
    assert.deepEqual(changedPermissionFormFields(withDetails, values()), {
      eventDate: null,
      fee: null,
    })
    assert.deepEqual(
      changedPermissionFormFields(withDetails, values({ eventDate: '2026-12-10', fee: 0 })),
      {},
    )
  })

  test('DOM-ILT-032: başkasının değiştirdiği ayrıntı geri yazılmaz', () => {
    const fresh = { ...opened, location: 'Başkasının yeri' }
    const plan = planPermissionFormUpdate(opened, fresh, values({ eventTime: '10:00' }))
    assert.deepEqual(plan.body, { eventTime: '10:00' })
  })

  test('DOM-ILT-032: yalnız belirtilen ayrıntı satır olur; sıfır ücret "Ücretsiz" yazılır', () => {
    assert.deepEqual(eventFacts(item()), [])
    const facts = new Map(
      eventFacts(item({ eventDate: '2026-12-10', eventTime: '09:30', location: 'Müze', fee: 0 })),
    )
    assert.deepEqual([...facts.keys()], ['Etkinlik günü', 'Saat', 'Yer', 'Ücret'])
    assert.ok(facts.get('Etkinlik günü')?.includes('2026'))
    assert.equal(facts.get('Ücret'), 'Ücretsiz')
    assert.equal(new Map(eventFacts(item({ fee: 25050 }))).get('Ücret'), '250,50 ₺')
  })
})
