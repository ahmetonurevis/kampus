import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { AuditEvent, InstitutionMember } from '@kampus/react-shared/institution-lists.ts'
import { actionLabel, entityLabel, entityOptions } from '../src/pages/settings/audit-labels.ts'
import {
  auditCsvRow,
  auditRow,
  formatInstant,
  INVITE_DEFAULTS,
  invitationRow,
  inviteBody,
  inviteFormSchema,
  isDay,
  memberCsvRow,
  memberRow,
  memberSort,
  reversedRange,
  ROLE_OPTIONS,
  STAFF_ROLE_OPTIONS,
  staffActions,
} from '../src/pages/settings/settings-rows.ts'

const member = (patch: Partial<InstitutionMember> = {}): InstitutionMember => ({
  id: 'm1',
  userId: 'u1',
  name: 'Ayşe Yılmaz',
  email: 'ayse@example.test',
  role: 'veli',
  status: 'active',
  links: [
    { kind: 'child', name: 'Deniz Yılmaz' },
    { kind: 'child', name: null },
  ],
  deactivatedAt: null,
  createdAt: '2026-10-30T21:30:00.000Z',
  ...patch,
})

const event = (patch: Partial<AuditEvent> = {}): AuditEvent => ({
  id: 'a1',
  createdAt: '2026-10-30T09:05:00.000Z',
  action: 'module.set',
  entityType: 'module',
  entityId: 'meals',
  actor: { userId: 'u1', name: 'Murat Yılmaz', role: 'yonetici' },
  fields: ['enabledModules'],
  reason: null,
  ...patch,
})

describe('tarih', () => {
  test('UTC anı Europe/Istanbul günü ve saatiyle gösterilir', () => {
    // 21:30 UTC, İstanbul'da (UTC+3) ertesi gün 00:30.
    assert.match(formatInstant('2026-10-30T21:30:00.000Z'), /31 Eki 2026/)
    assert.match(formatInstant('2026-10-30T21:30:00.000Z'), /00:30/)
    assert.equal(formatInstant('bozuk'), '—')
  })

  test('gün değeri ve ters aralık', () => {
    assert.equal(isDay('2026-10-30'), true)
    assert.equal(isDay('30.10.2026'), false)
    assert.equal(reversedRange('2026-10-31', '2026-10-30'), true)
    assert.equal(reversedRange('2026-10-30', '2026-10-30'), false)
    assert.equal(reversedRange('', '2026-10-30'), false)
  })
})

describe('kullanıcı satırı', () => {
  test('rol etiketi, durum ve bağlı kişi adları', () => {
    const row = memberRow(member())
    assert.equal(row.roleLabel, 'Veli')
    assert.equal(row.status, 'Etkin')
    // Adı olmayan bağlantı tür etiketiyle gösterilir.
    assert.equal(row.links, 'Deniz Yılmaz, Çocuk')
    assert.equal(memberRow(member({ status: 'passive', links: [] })).links, '—')
    assert.equal(memberRow(member({ status: 'passive' })).status, 'Pasif')
  })

  test('CSV satırı yalnız görünen sütunları taşır', () => {
    assert.deepEqual(Object.keys(memberCsvRow(memberRow(member()))), [
      'name',
      'email',
      'roleLabel',
      'links',
      'status',
      'createdLabel',
    ])
  })

  test('sıralama yönü API alanına çevrilir', () => {
    assert.equal(memberSort('name', 1), 'name')
    assert.equal(memberSort('createdAt', -1), '-createdAt')
    assert.equal(memberSort('email', 1), undefined)
    assert.equal(memberSort('', 1), undefined)
  })

  test('rol seçenekleri beş rolü Türkçe adıyla verir', () => {
    assert.deepEqual(
      ROLE_OPTIONS.map((option) => option.label),
      ['Yönetici', 'Ön Büro & Satış', 'Öğretmen', 'Öğrenci', 'Veli'],
    )
  })
})

describe('personel hesabı (DOM-YTK-070)', () => {
  test('DOM-YTK-070: satır pasifleştirilmiş ve personel bilgisini taşır', () => {
    const teacher = memberRow(
      member({ role: 'ogretmen', status: 'passive', deactivatedAt: '2026-11-02T08:00:00.000Z' }),
    )
    assert.equal(teacher.deactivated, true)
    assert.equal(teacher.staff, true)
    assert.equal(teacher.status, 'Pasif')
    const parent = memberRow(member())
    assert.equal(parent.deactivated, false)
    assert.equal(parent.staff, false)
  })

  test('DOM-YTK-070: işlemler yalnız başkasının personel hesabında; pasif hesapta yalnız geri alma', () => {
    const active = memberRow(member({ role: 'onburo', userId: 'u2' }))
    assert.deepEqual(staffActions(active, 'u1'), {
      changeRole: true,
      deactivate: true,
      reactivate: false,
    })
    assert.deepEqual(staffActions({ ...active, deactivated: true }, 'u1'), {
      changeRole: false,
      deactivate: false,
      reactivate: true,
    })
    const none = { changeRole: false, deactivate: false, reactivate: false }
    assert.deepEqual(staffActions(active, 'u2'), none, 'kendi hesabı')
    assert.deepEqual(staffActions(memberRow(member()), 'u9'), none, 'veli hesabı')
  })

  test('DOM-YTK-070: davet satırı adı yoksa e-postayı gösterir, rol Türkçe', () => {
    const row = invitationRow({
      id: 'inv-1',
      membershipId: 'm-1',
      name: null,
      email: 'selin@kampus.example',
      role: 'ogretmen',
      status: 'pending',
      createdAt: '2026-10-30T21:30:00.000Z',
      expiresAt: '2026-11-06T21:30:00.000Z',
    })
    assert.equal(row.name, 'selin@kampus.example')
    assert.equal(row.roleLabel, 'Öğretmen')
    assert.equal(row.createdLabel, formatInstant('2026-10-30T21:30:00.000Z'))
  })

  test('DOM-YTK-070: davet gövdesi öğretmen kaydını yalnız öğretmen rolünde taşır', () => {
    assert.deepEqual(
      inviteBody({ email: 'a@b.test', name: 'Ali', role: 'ogretmen', teacherId: 't1' }),
      { email: 'a@b.test', name: 'Ali', role: 'ogretmen', teacherId: 't1' },
    )
    assert.deepEqual(
      inviteBody({ email: 'a@b.test', name: 'Ali', role: 'onburo', teacherId: 't1' }),
      {
        email: 'a@b.test',
        name: 'Ali',
        role: 'onburo',
      },
    )
    assert.equal('teacherId' in inviteBody({ ...INVITE_DEFAULTS, teacherId: '  ' }), false)
  })

  test('DOM-YTK-070: form e-postayı küçültür, geçersiz e-posta ve kısa adı Türkçe reddeder', () => {
    const ok = inviteFormSchema.safeParse({
      email: ' Selin@Kampus.Example ',
      name: 'Selin Kaya',
      role: 'ogretmen',
      teacherId: '',
    })
    assert.equal(ok.success && ok.data.email, 'selin@kampus.example')
    const bad = inviteFormSchema.safeParse({ ...INVITE_DEFAULTS, email: 'yok', name: 'A' })
    assert.equal(bad.success, false)
    const messages = bad.error?.issues.map((issue) => issue.message) ?? []
    assert.ok(messages.includes('Geçerli bir e-posta adresi girin.'))
    assert.ok(messages.includes('Ad en az 2 karakter olmalı.'))
    assert.deepEqual(
      STAFF_ROLE_OPTIONS.map((option) => option.value),
      ['yonetici', 'ogretmen', 'onburo'],
    )
  })

  test('DOM-YTK-070: işlem geçmişinde personel işlemleri Türkçe', () => {
    assert.equal(actionLabel('staff.deactivate'), 'Personel hesabı pasifleştirildi')
    assert.equal(entityLabel('staff_invitation'), 'Personel daveti')
  })
})

describe('işlem geçmişi satırı', () => {
  test('etiketler Türkçe, yapan kişi rolüyle', () => {
    const row = auditRow(event())
    assert.equal(row.actionLabel, 'Modül açıldı veya kapatıldı')
    assert.equal(row.entityLabel, 'Modül ayarı')
    assert.equal(row.actorName, 'Murat Yılmaz')
    assert.equal(row.actorRoleLabel, 'Yönetici')
    assert.equal(row.fields, 'enabledModules')
  })

  test('sistem olayı ve alansız kayıt', () => {
    const row = auditRow(event({ actor: null, fields: [], entityType: null, entityId: null }))
    assert.equal(row.actorName, 'Sistem')
    assert.equal(row.fields, '—')
    assert.equal(row.entityLabel, '—')
    assert.equal(
      auditRow(event({ actor: { userId: 'u', name: null, role: null } })).actorName,
      'Bilinmeyen kullanıcı',
    )
  })

  test('CSV satırında ham kimlik yoktur', () => {
    const csv = auditCsvRow(auditRow(event({ entityId: 'gizli-kimlik' })))
    assert.ok(!JSON.stringify(csv).includes('gizli-kimlik'))
  })
})

describe('eylem etiketleri', () => {
  test('bilinen eylemler', () => {
    assert.equal(actionLabel('invoice.pay'), 'Taksit ödemesi alındı')
    assert.equal(actionLabel('workflow.guidance'), 'Rehberlik kaydı değişti')
    assert.equal(actionLabel('workflow.goal-review'), 'Hedef incelendi')
    assert.equal(actionLabel('request.open'), 'Talep açıldı')
    assert.equal(actionLabel('request.update'), 'Talep güncellendi')
    assert.equal(actionLabel('absence.notify'), 'İzin/mazeret bildirildi')
    assert.equal(actionLabel('question.ask'), 'Soru gönderildi')
    assert.equal(actionLabel('question.answer'), 'Soru yanıtlandı')
    assert.equal(actionLabel('question.withdraw'), 'Soru geri çekildi')
    assert.equal(entityLabel('requests'), 'Talep')
    assert.equal(entityLabel('questions'), 'Soru')
    assert.equal(actionLabel('classes.archive'), 'Sınıf arşivlendi')
    assert.equal(actionLabel('branches.restore'), 'Kampüs arşivden geri alındı')
  })

  test('bilinmeyen eylem ham adıyla gösterilir', () => {
    assert.equal(actionLabel('yeni.islem'), 'yeni.islem')
    assert.equal(actionLabel('tek'), 'tek')
    assert.equal(actionLabel('workflow.yeni-komut'), 'Okul işlemi: yeni-komut')
    assert.equal(entityLabel('yeniTur'), 'yeniTur')
  })

  test('varlık seçenekleri Türkçe sıralıdır', () => {
    const labels = entityOptions().map((option) => option.label)
    assert.deepEqual(
      labels,
      [...labels].sort((a, b) => a.localeCompare(b, 'tr')),
    )
  })
})
