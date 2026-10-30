import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { AuditEvent, InstitutionMember } from '@kampus/react-shared/institution-lists.ts'
import { actionLabel, entityLabel, entityOptions } from '../src/pages/settings/audit-labels.ts'
import {
  auditCsvRow,
  auditRow,
  formatInstant,
  isDay,
  memberCsvRow,
  memberRow,
  memberSort,
  reversedRange,
  ROLE_OPTIONS,
} from '../src/pages/settings/settings-rows.ts'
import { settingsTab } from '../src/pages/settings/settings-tabs.ts'

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

test('sekme adresten çözülür; bilinmeyen değer ilk sekmeye düşer', () => {
  assert.equal(settingsTab(null), 'general')
  assert.equal(settingsTab('kullanicilar'), 'users')
  assert.equal(settingsTab('gecmis'), 'activity')
  assert.equal(settingsTab('x'), 'general')
})
