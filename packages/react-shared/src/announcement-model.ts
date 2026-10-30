// Duyuru ekranının saf hesapları (docs/domain/iletisim-ve-veli.md DOM-ILT-001…004). API satırı
// role göre daraltılmıştır (`narrowAnnouncement`): yayınlayan ve yönetici `readCount` ile
// `recipientCount`, alıcı `myReadAt` alır; geri çekilen duyurunun metni alıcıya gelmez. Burada
// yalnız gösterim kararı verilir; yetkiyi sunucu uygular.
import {
  ANNOUNCEMENT_CATEGORIES,
  type AnnouncementTarget,
} from '@kampus/school-core/lib/communication.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import type { InstitutionType } from '@kampus/school-core/modules/collection-modules.ts'
import type { Role } from '@kampus/school-core/modules/navigation.ts'

import type { CollectionRow } from './collections.ts'
import type { StatusBadge } from './status-badge.ts'

/** API'nin döndürdüğü duyuru kaydı; alanların bir kısmı role göre yoktur. */
export type AnnouncementRecord = {
  id: string
  title?: string
  /** Geri çekilen duyuruda alıcıya gelmez. */
  text?: string
  date?: string
  category?: string
  classId?: string | null
  target?: Partial<AnnouncementTarget>
  publishedBy?: { role?: string; userId?: string; teacherId?: string }
  revisedAt?: string
  withdrawnAt?: string
  // kvkk: K — gerekçe yalnız yayınlayan ve yöneticiye döner.
  withdrawReason?: string
  /** Düzeltme geçmişi; yalnız yayınlayan ve yöneticiye. */
  revisions?: unknown[]
  /** Yalnız yayınlayan ve yöneticiye. */
  readCount?: number
  recipientCount?: number
  /** Yalnız alıcıya: ilk açılış anı, açılmadıysa `null`. */
  myReadAt?: string | null
}

export const STATUS_PUBLISHED = 'Yayında'
export const STATUS_UNREAD = 'Okunmadı'
export const STATUS_UPDATED = 'Güncellendi'
export const STATUS_WITHDRAWN = 'Geri çekildi'
export const WITHDRAWN_NOTICE = 'Bu duyuru geri çekildi. İçeriği artık görüntülenemez.'

export type AnnouncementRow = {
  id: string
  title: string
  category: string
  /** Yayın anı (ISO); liste sıralaması ve gösterim. */
  date: string
  /** Süzgeç değeri: geri çekildi > okunmadı > güncellendi > yayında. */
  status: string
  withdrawn: boolean
  revised: boolean
  unread: boolean
  /** Yalnız yetkiliye `3 / 12`; diğerlerinde boş. */
  read: string
  /** Başlık ve metin birlikte aranır (liste araması). */
  text: string
  version: number
  record: AnnouncementRecord
}

export type Viewer = { role: Role; userId: string }

/** Satırın tek durum değeri; rozetler ayrıca `withdrawn`/`revised`/`unread`'dan çizilir. */
export function announcementStatus(record: AnnouncementRecord): string {
  if (record.withdrawnAt) return STATUS_WITHDRAWN
  if (record.myReadAt === null) return STATUS_UNREAD
  if (record.revisedAt) return STATUS_UPDATED
  return STATUS_PUBLISHED
}

/** Okundu oranı yalnız yetkiliye gelir (`readCount` yoksa gösterilmez). */
export function readSummary(record: AnnouncementRecord): string {
  if (record.readCount === undefined || record.recipientCount === undefined) return ''
  return `${record.readCount} / ${record.recipientCount}`
}

export function announcementRow(row: CollectionRow<AnnouncementRecord>): AnnouncementRow {
  const record = row.record
  return {
    id: record.id,
    title: record.title ?? 'Başlıksız duyuru',
    category: record.category ?? '—',
    date: record.date ?? '',
    status: announcementStatus(record),
    withdrawn: Boolean(record.withdrawnAt),
    revised: Boolean(record.revisedAt),
    unread: record.myReadAt === null && !record.withdrawnAt,
    read: readSummary(record),
    text: record.text ?? '',
    version: row.version,
    record,
  }
}

/**
 * Düzeltme ve geri çekme düğmeleri: yönetici her duyuruda, diğer roller yalnız kendi
 * yayınladığında (DOM-ILT-004). Okundu sayısını görmek yetki işaretidir; yayınlayan kimliği
 * yalnız yetkiliye döndüğü için karşılaştırma güvenlidir. Geri çekilen duyuru değiştirilmez.
 */
export function canManageAnnouncement(record: AnnouncementRecord, viewer: Viewer): boolean {
  if (record.withdrawnAt) return false
  if (record.readCount === undefined) return false
  if (viewer.role === 'yonetici') return true
  return record.publishedBy?.userId === viewer.userId
}

/** Metni görebilir mi: geri çekilen duyurunun metni alıcıya hiç gelmez. */
export function hasText(record: AnnouncementRecord): boolean {
  return typeof record.text === 'string' && record.text !== ''
}

/** Duyuru yayınlayabilen roller (core `WRITE_ACTION_ROLES['announcement.publish']`). */
export const PUBLISHER_ROLES: readonly Role[] = ['yonetici', 'onburo', 'ogretmen']

export function canPublish(role: Role): boolean {
  return PUBLISHER_ROLES.includes(role)
}

/** Yayın formunun rol başına seçenekleri (core `publishDecision`, DOM-ILT-002). */
export type PublishCapabilities = {
  branches: boolean
  grades: boolean
  levels: boolean
  classes: boolean
  /** Kurum geneli (konum seçicisi boş) yayın yapılabilir mi. */
  wholeInstitution: boolean
  /** Alıcı rolleri; öğretmen duyurusu öğretmenlere gitmez. */
  audienceRoles: readonly ('ogretmen' | 'ogrenci' | 'veli')[]
  /** Yalnız bu kategoride yayın; yoksa hepsi. */
  onlyCategory: string | null
}

export function publishCapabilities(
  role: Role,
  institutionType: InstitutionType,
): PublishCapabilities {
  switch (role) {
    case 'yonetici':
      return {
        branches: true,
        grades: institutionType === 'school',
        levels: institutionType === 'language_school',
        classes: true,
        wholeInstitution: true,
        audienceRoles: ['veli', 'ogrenci', 'ogretmen'],
        onlyCategory: null,
      }
    case 'onburo':
      return {
        branches: true,
        grades: false,
        levels: false,
        classes: false,
        wholeInstitution: true,
        audienceRoles: ['veli', 'ogrenci', 'ogretmen'],
        onlyCategory: 'İdari',
      }
    default:
      return {
        branches: false,
        grades: false,
        levels: false,
        classes: true,
        wholeInstitution: false,
        audienceRoles: ['veli', 'ogrenci'],
        onlyCategory: null,
      }
  }
}

export const AUDIENCE_LABELS = { veli: 'Veliler', ogrenci: 'Öğrenciler', ogretmen: 'Öğretmenler' }

/**
 * Formda seçilen hedefin kısa açıklaması ("7-A, 7-B · Veliler, Öğrenciler"); panelde gösterilir.
 * Kimlikleri adlara çevirmek için başvuru eşlemeleri verilir; bulunamayan kimlik gösterilmez.
 */
export function describeTarget(
  target: Partial<AnnouncementTarget> | undefined,
  names: { branches: ReadonlyMap<string, string>; classes: ReadonlyMap<string, string> },
): string {
  if (!target) return ''
  const places = [
    ...(target.branchIds ?? []).map((id) => names.branches.get(id)),
    ...(target.grades ?? []).map((grade) => `${grade}. sınıf düzeyi`),
    ...(target.levels ?? []),
    ...(target.classIds ?? []).map((id) => names.classes.get(id)),
  ].filter((item): item is string => Boolean(item))
  const audience = (target.roles ?? []).map((role) => AUDIENCE_LABELS[role])
  return [places.length ? places.join(', ') : 'Bütün kurum', audience.join(', ')]
    .filter(Boolean)
    .join(' · ')
}

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number]
type Content = { title: string; text: string; category: AnnouncementCategory }

/** Düzeltme formunda değişmeyen alan gönderilmez (core "değişiklik yok" 409 verir). */
export function reviseChanges(current: Content, next: Content) {
  const changes: Partial<Content> = {}
  if (next.title.trim() !== current.title) changes.title = next.title.trim()
  if (next.text.trim() !== current.text) changes.text = next.text.trim()
  if (next.category !== current.category) changes.category = next.category
  return changes
}

// --- Alıcı görünümü (mobil liste ve ayrıntı) -------------------------------------------------

export type AnnouncementView = {
  id: string
  title: string
  category: string
  /** Yayın günü, gösterim biçiminde; tarih yoksa boş. */
  date: string
  /** Geri çekilen duyurunun metni her durumda gizlenir. */
  text: string
  withdrawn: boolean
  unread: boolean
  badges: StatusBadge[]
}

/**
 * Satırın rozetleri: geri çekilen yalnız "Geri çekildi" alır; diğerlerinde okunmadı ve
 * güncellendi birlikte görünebilir (güncellenmiş duyuru yeniden okunmamış sayılabilir).
 */
export function announcementBadges(record: AnnouncementRecord): StatusBadge[] {
  if (record.withdrawnAt) return [{ text: STATUS_WITHDRAWN, tone: 'red' }]
  const badges: StatusBadge[] = []
  if (record.myReadAt === null) badges.push({ text: STATUS_UNREAD, tone: 'primary' })
  if (record.revisedAt) badges.push({ text: STATUS_UPDATED, tone: 'amber' })
  return badges
}

export function announcementView(record: AnnouncementRecord): AnnouncementView {
  const withdrawn = Boolean(record.withdrawnAt)
  return {
    id: record.id,
    title: record.title ?? 'Başlıksız duyuru',
    category: record.category ?? '',
    date: record.date ? dateLabel(record.date, { year: 'numeric' }) : '',
    text: withdrawn ? '' : (record.text ?? ''),
    withdrawn,
    unread: record.myReadAt === null && !withdrawn,
    badges: announcementBadges(record),
  }
}
