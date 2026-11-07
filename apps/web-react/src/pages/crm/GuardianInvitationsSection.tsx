import { useState } from 'react'
import { GUARDIAN_INVITATIONS_PAGE_SIZE } from '@kampus/react-shared/guardian-invitations.ts'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useCancelGuardianInvitation,
  useGuardianInvitations,
} from '@kampus/react-shared/use-guardian-invitations.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import {
  canManageGuardianAccounts,
  guardianInvitationRow,
  type GuardianInvitationRow,
} from './enrollment-guardian-account.ts'

const QUIET = { silent: isReauthenticationRequired }

/**
 * Bekleyen veli davetleri (ON-290, DOM-YTK-071): kişi ilk girişini yapınca listeden düşer. Yalnız
 * yönetici ve ön büro görür; öteki rollerde bölüm çizilmez ve istek atılmaz. Liste boşsa bölüm
 * görünmez. İptal taze oturum ister; açılmış hesap ve öğrenci bağları korunur, yalnız davet kapanır.
 */
export function GuardianInvitationsSection() {
  const { session } = useAuth()
  const allowed = canManageGuardianAccounts(session?.role)
  const [page, setPage] = useState(1)
  const invitations = useGuardianInvitations(page, { enabled: allowed })
  const [target, setTarget] = useState<GuardianInvitationRow | null>(null)
  if (!allowed) return null
  if (invitations.error)
    return <QueryError error={invitations.error} onRetry={() => void invitations.refetch()} />
  const rows = (invitations.data?.data ?? []).map((invitation) => guardianInvitationRow(invitation))
  const total = invitations.data?.meta.total ?? 0
  const pages = Math.max(1, Math.ceil(total / GUARDIAN_INVITATIONS_PAGE_SIZE))
  // Son sayfadaki davet iptal edilince boş sayfada kalınmaz.
  if (invitations.data && rows.length === 0 && page > 1) {
    setPage(Math.min(page - 1, pages))
    return null
  }
  if (rows.length === 0) return null
  return (
    <section
      aria-labelledby="bekleyen-veli-davetleri"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="px-6 pt-6 pb-2">
        <h2 id="bekleyen-veli-davetleri" className="text-lg font-semibold">
          Bekleyen veli davetleri
        </h2>
        <p className="text-sm text-muted-foreground">
          {total} davet · Veli ilk girişini yapınca listeden düşer
        </p>
      </header>
      <ul className="divide-y px-6 pb-4">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="grid min-w-0">
              <strong className="font-medium">{row.name}</strong>
              <small className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {row.email} · <StudentNames ids={row.studentIds} /> · {row.createdLabel}
                {row.expired ? ' · Süresi doldu' : ''}
              </small>
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${row.name} veli davetini iptal et`}
              onClick={() => setTarget(row)}
            >
              <Icon name="X" size={15} aria-hidden="true" />
              Daveti iptal et
            </Button>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <nav
          aria-label="Veli davetleri sayfaları"
          className="flex items-center justify-between gap-3 border-t px-6 py-3 text-sm"
        >
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            Önceki sayfa
          </Button>
          <span role="status" aria-live="polite">
            {page} / {pages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
          >
            Sonraki sayfa
          </Button>
        </nav>
      ) : null}
      {target ? <CancelDialog row={target} onClose={() => setTarget(null)} /> : null}
    </section>
  )
}

/** Davetteki öğrencilerin adları; kayıt okunamazsa kimlik yerine "öğrenci" yazılır. */
function StudentNames({ ids }: { ids: readonly string[] }) {
  return (
    <>
      {ids.map((id, index) => (
        <span key={id}>
          {index > 0 ? ', ' : ''}
          <StudentName id={id} />
        </span>
      ))}
    </>
  )
}

function StudentName({ id }: { id: string }) {
  const student = useCoreItem('students', id)
  return <>{student.data?.record.name ?? 'öğrenci'}</>
}

function CancelDialog({ row, onClose }: { row: GuardianInvitationRow; onClose: () => void }) {
  const cancel = useCancelGuardianInvitation()
  const { run, reauthModal } = useReauthRetry()
  const busy = cancel.isPending

  async function confirm() {
    const outcome = await run(() => cancel.submit({ invitationId: row.id }, QUIET))
    if (outcome.status === 'done' && outcome.result.status === 'success') {
      notify.success(`${row.name} veli daveti iptal edildi.`)
      onClose()
    } else if (outcome.status === 'done') onClose()
  }

  return (
    <>
      <AlertDialog open onOpenChange={(next) => (busy || next ? undefined : onClose())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Veli davetini iptal et</AlertDialogTitle>
            <AlertDialogDescription>
              {row.name} ({row.email}) daveti kapanır ve listeden düşer. Davetle açılan veli hesabı
              ve öğrenci bağları silinmez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={(event) => {
                event.preventDefault()
                void confirm()
              }}
            >
              Daveti iptal et
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reauthModal}
    </>
  )
}
