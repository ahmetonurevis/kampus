import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { PermissionFormListItem } from '@kampus/react-shared/permission-forms.ts'

import {
  changedPermissionFormFields,
  countsSummary,
  extraTargetStudentIds,
  permissionActions,
  permissionFormDefaults,
  permissionFormRow,
  permissionFormSchema,
  permissionFormState,
  planPermissionFormUpdate,
  removedFromTarget,
  targetChanged,
  type PermissionFormOutput,
} from '../src/pages/communication/permission-forms.ts'

// IST-067 (DOM-ILT-030, -036…038): izin formu ekranının saf mantığı.

const opened = {
  topic: 'trip' as const,
  title: 'Müze gezisi',
  description: 'Servisle gidilir.',
  deadline: '2026-12-01',
  classIds: ['c1'],
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
  studentIds: ['s1', 's2'],
  teacherId: 't1',
  status: 'open',
  closedAt: null,
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
  test('varsayılanlar kaydı ve tek tek öğrencileri taşır; yeni formda boştur', () => {
    assert.deepEqual(permissionFormDefaults(opened, ['s7']), {
      ...opened,
      studentIds: ['s7'],
    })
    assert.equal(permissionFormDefaults().topic, '')
    assert.deepEqual(permissionFormDefaults().classIds, [])
  })

  test('hiç değişiklik yoksa gövde boştur', () => {
    assert.deepEqual(changedPermissionFormFields(opened, values(), []), {})
  })

  test('hedef değişirse iki liste birlikte gider', () => {
    assert.deepEqual(changedPermissionFormFields(opened, values({ classIds: ['c1', 'c2'] }), []), {
      classIds: ['c1', 'c2'],
      studentIds: [],
    })
    assert.deepEqual(changedPermissionFormFields(opened, values({ studentIds: ['s9'] }), []), {
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
      [],
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
    const plan = planPermissionFormUpdate(opened, fresh, values({ title: 'Yeni' }), [])
    assert.deepEqual(plan.body, {})
    assert.deepEqual(plan.overlaps, [])
  })

  test('hedefi başkası da değiştirdiyse hedef uyarısı çıkar', () => {
    const fresh = { ...opened, classIds: ['c1', 'c3'] }
    const plan = planPermissionFormUpdate(opened, fresh, values({ classIds: ['c1', 'c2'] }), [])
    assert.deepEqual(plan.body, { classIds: ['c1', 'c2'], studentIds: [] })
    assert.equal(plan.overlaps[0]?.field, 'target')
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

  test('tek tek seçilmiş öğrenciler hedef sınıfların dışındaki etkin öğrencilerdir', () => {
    const students = [
      { id: 's1', classId: 'c1', isActive: true },
      { id: 's2', classId: 'c9', isActive: true },
      { id: 's3', classId: 'c9', isActive: false },
    ]
    assert.deepEqual(extraTargetStudentIds(['s1', 's2', 's3', 's4'], ['c1'], students), ['s2'])
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
