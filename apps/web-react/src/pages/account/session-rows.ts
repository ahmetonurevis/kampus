// Güvenlik sayfasındaki "Oturumlarım" satırları (IST-003, IST-025). Saf model: ekran ve birim
// testi aynı metni kullanır. API satırı IP, ham kullanıcı ajanı ve oturum belirteci taşımaz;
// burada yalnız kaba cihaz özeti, tarih ve "bu oturum" işareti gösterime çevrilir.
import { sessionDeviceLabel, type SessionListItem } from '@kampus/react-shared/account-security.ts'

const DATE_TIME = new Intl.DateTimeFormat('tr-TR', {
  timeZone: 'Europe/Istanbul',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** ISO tarih Europe/Istanbul gösterimi; geçersizse boş. */
export function formatSessionTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : DATE_TIME.format(date)
}

export interface SessionRow {
  id: string
  device: string
  current: boolean
  /** "Son etkinlik … · Açılış …" satırı. */
  detail: string
  /** Kapatma düğmesinin erişilebilir adı (satırlar aynı cihazdan olabilir, tarih ayırt eder). */
  revokeLabel: string
}

export function sessionRow(item: SessionListItem): SessionRow {
  const device = sessionDeviceLabel(item)
  const lastActive = formatSessionTime(item.updatedAt)
  return {
    id: item.id,
    device,
    current: item.current,
    detail: `Son etkinlik ${lastActive} · Açılış ${formatSessionTime(item.createdAt)}`,
    revokeLabel: `Bu oturumu kapat: ${device}, son etkinlik ${lastActive}`,
  }
}

/** Bu cihaz başta, ardından son etkinliğe göre yeniden eskiye (API sırası da budur). */
export function sessionRows(list: readonly SessionListItem[]): SessionRow[] {
  return [...list]
    .sort((a, b) => Number(b.current) - Number(a.current) || b.updatedAt.localeCompare(a.updatedAt))
    .map(sessionRow)
}

export interface ConfirmCopy {
  title: string
  description: string
  action: string
}

export function revokeSessionConfirm(row: Pick<SessionRow, 'device' | 'detail'>): ConfirmCopy {
  return {
    title: 'Bu oturum kapatılsın mı?',
    description: `${row.device} (${row.detail.toLocaleLowerCase('tr-TR')}) cihazındaki oturum kapanır; o cihazda yeniden giriş gerekir.`,
    action: 'Bu oturumu kapat',
  }
}

export function revokeOthersConfirm(count: number): ConfirmCopy {
  return {
    title: 'Diğer tüm oturumlar kapatılsın mı?',
    description: `Bu cihaz dışındaki ${count} oturum kapanır; o cihazlarda yeniden giriş gerekir.`,
    action: 'Diğer tüm oturumları kapat',
  }
}
