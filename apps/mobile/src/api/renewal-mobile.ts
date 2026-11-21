// Yönetici ve ön büro Kayıt Yenileme ekranının saf görünüm mantığı (ON-122; IST-100, DOM-KAY-020,
// DOM-FIN-005). Satır ve ayrıntı bölümleri web ile ortaktır (`@kampus/react-shared/renewal-model.ts`);
// burada yalnız telefona çevrilir. Telefon salt okurdur: plan, toplu yenileme, dönem geçişi, ÜFE/TÜFE
// ve sözleşme PDF'i web'dedir.
import { RENEWAL_STATUSES, type RenewalRow } from '@kampus/react-shared/renewal-model.ts'
import type { RenewalListQuery } from '@kampus/react-shared/use-finance-renewals.ts'
import { API_PAGE_SIZE, type ListState } from './list-state.ts'
import { isModuleOpen, type MobileSession } from './session-state.ts'
import { staffPageOpen, type SelectChoice } from './prospect-mobile.ts'

type Session = Pick<MobileSession, 'role' | 'modules'>

/**
 * Ekran açık mı: yönetici ve ön büro, `renewal` modülü (menü) ve `finance` modülü (uçlar ikisine
 * bağlı, DOM-YTK-040) açıkken. `renewal` yalnız okulda vardır; dil okulunda `/me` kapalı verir
 * (DOM-YTK-012). Veli yenilemesi web'dedir.
 */
export function canOpenRenewals(session: Session): boolean {
  return (
    staffPageOpen(session, { yonetici: 'kayit-yenileme', onburo: 'kayit-yenileme' }) &&
    isModuleOpen(session.modules, 'finance')
  )
}

export const RENEWAL_STATUS_OPTIONS: readonly SelectChoice[] = [
  { value: '', label: 'Tüm durumlar' },
  ...RENEWAL_STATUSES.map((status) => ({ value: status, label: status })),
]

const isStatus = (value: string) => (RENEWAL_STATUSES as readonly string[]).includes(value)
const MIN_SEARCH = 2

/** Liste sorgusu: öğrenci adı araması ve durum sunucuda; sıra sunucunun varsayılanıdır (web gibi). */
export function renewalListQuery(state: ListState, search: string): RenewalListQuery {
  const q = search.trim()
  return {
    page: state.index + 1,
    pageSize: API_PAGE_SIZE,
    ...(q.length >= MIN_SEARCH ? { q } : {}),
    ...(isStatus(state.filter) ? { status: state.filter } : {}),
  }
}

export type RenewalListEntry = {
  title: string
  subtitle: string
  eyebrow: string
  status: string
  label: string
}

export function renewalListItem(row: RenewalRow): RenewalListEntry {
  return {
    title: row.studentName,
    subtitle: `${row.period} · ${row.transition}`,
    eyebrow: row.netLabel,
    status: row.status,
    label: `${row.studentName}, ${row.period}, ${row.transition}, ${row.status}, ayrıntıyı aç`,
  }
}
