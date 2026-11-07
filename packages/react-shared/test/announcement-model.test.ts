import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  announcementRow,
  announcementStatus,
  canManageAnnouncement,
  canPublish,
  describeTarget,
  hasText,
  publishCapabilities,
  readSummary,
  reviseChanges,
  STATUS_PUBLISHED,
  STATUS_UNREAD,
  STATUS_UPDATED,
  STATUS_WITHDRAWN,
  type AnnouncementRecord,
} from '../src/announcement-model.ts'

const base: AnnouncementRecord = { id: 'ann-1', title: 'Gezi', text: 'Metin', category: 'Etkinlik' }

test('durum önceliği: geri çekildi, okunmadı, güncellendi, yayında', () => {
  const withdrawn = { ...base, withdrawnAt: '2026-10-01T08:00:00Z', myReadAt: null, revisedAt: 'x' }
  assert.equal(announcementStatus(withdrawn), STATUS_WITHDRAWN)
  assert.equal(announcementStatus({ ...base, myReadAt: null, revisedAt: 'x' }), STATUS_UNREAD)
  assert.equal(
    announcementStatus({ ...base, myReadAt: '2026-10-01T08:00:00Z', revisedAt: 'x' }),
    STATUS_UPDATED,
  )
  assert.equal(announcementStatus(base), STATUS_PUBLISHED)
})

test('okundu özeti yalnız yetkiliye gelen sayılarla kurulur', () => {
  assert.equal(readSummary(base), '')
  assert.equal(readSummary({ ...base, readCount: 1 }), '')
  assert.equal(readSummary({ ...base, readCount: 1, recipientCount: 5 }), '1 / 5')
})

test('satır geri çekilen duyuruyu okunmamış saymaz ve eksik alanı doldurur', () => {
  const row = announcementRow({
    record: { id: 'a', myReadAt: null, withdrawnAt: '2026-10-01T08:00:00Z' },
    version: 3,
  } as never)
  assert.equal(row.unread, false)
  assert.equal(row.withdrawn, true)
  assert.equal(row.title, 'Başlıksız duyuru')
  assert.equal(row.version, 3)
  assert.equal(row.text, '')
  assert.equal(hasText({ id: 'a' }), false)
  assert.equal(hasText(base), true)
})

test('düzeltme ve geri çekme yetkisi: yönetici her zaman, diğerleri kendi duyurusunda', () => {
  const owned: AnnouncementRecord = {
    ...base,
    readCount: 0,
    recipientCount: 4,
    publishedBy: { userId: 'u-teacher' },
  }
  assert.equal(canManageAnnouncement(owned, { role: 'yonetici', userId: 'u-admin' }), true)
  assert.equal(canManageAnnouncement(owned, { role: 'ogretmen', userId: 'u-teacher' }), true)
  assert.equal(canManageAnnouncement(owned, { role: 'ogretmen', userId: 'u-other' }), false)
  // Okundu sayısı gelmeyen kayıt yetkisiz görünümdür.
  const asRecipient: AnnouncementRecord = { ...owned }
  delete asRecipient.readCount
  assert.equal(canManageAnnouncement(asRecipient, { role: 'veli', userId: 'u-teacher' }), false)
})

test('yayın yetkisi yönetici, ön büro ve öğretmendedir', () => {
  assert.deepEqual(
    (['yonetici', 'onburo', 'ogretmen', 'ogrenci', 'veli'] as const).map(canPublish),
    [true, true, true, false, false],
  )
})

test('yayın seçenekleri role ve kurum türüne göre daralır', () => {
  const admin = publishCapabilities('yonetici', 'school')
  assert.equal(admin.grades, true)
  assert.equal(admin.levels, false)
  assert.equal(admin.wholeInstitution, true)
  assert.equal(publishCapabilities('yonetici', 'language_school').levels, true)
  const front = publishCapabilities('onburo', 'school')
  assert.equal(front.onlyCategory, 'İdari')
  assert.equal(front.classes, false)
  const teacher = publishCapabilities('ogretmen', 'school')
  assert.equal(teacher.wholeInstitution, false)
  assert.deepEqual(teacher.audienceRoles, ['veli', 'ogrenci'])
})

test('hedef kitle açıklaması konumları ve alıcı rollerini adlandırır', () => {
  const names = {
    branches: new Map([['b1', 'Kadıköy Kampüsü']]),
    classes: new Map([['c1', '7-A']]),
  }
  assert.equal(
    describeTarget({ classIds: ['c1'], roles: ['veli', 'ogrenci'] }, names),
    '7-A · Veliler, Öğrenciler',
  )
  assert.equal(describeTarget({ roles: ['veli'] }, names), 'Bütün kurum · Veliler')
  assert.equal(
    describeTarget({ branchIds: ['b1', 'silinmis'], grades: [7], roles: [] }, names),
    'Kadıköy Kampüsü, 7. sınıf düzeyi',
  )
  assert.equal(describeTarget(undefined, names), '')
})

test('düzeltmede yalnız değişen alan gönderilir', () => {
  const current = { title: 'Gezi', text: 'Metin', category: 'Etkinlik' as const }
  assert.deepEqual(reviseChanges(current, current), {})
  assert.deepEqual(reviseChanges(current, { ...current, text: '  Yeni metin ' }), {
    text: 'Yeni metin',
  })
  assert.deepEqual(reviseChanges(current, { ...current, category: 'İdari' }), {
    category: 'İdari',
  })
})
