import { useEffect } from 'react'
import { Navigate } from 'react-router'
import { notify } from '@/lib/notify.ts'

export const MODULE_CLOSED = 'Bu modül kurum ayarlarından kapatılmış.'

/** Kapalı modül: kullanıcı uyarılır ve rolün ana sayfasına gönderilir (tek toast). */
export function ModuleClosedRedirect({ to }: { to: string }) {
  useEffect(() => {
    notify.warning(MODULE_CLOSED, 'module-closed')
  }, [])
  return <Navigate to={to} replace />
}
