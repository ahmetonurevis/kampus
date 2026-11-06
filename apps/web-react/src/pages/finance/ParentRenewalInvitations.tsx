import { useId, useState } from 'react'
import { Link } from 'react-router'
import {
  useRenewalInvitations,
  useRespondRenewalInvitation,
} from '@kampus/react-shared/use-finance-renewals.ts'
import {
  RENEWAL_INVITATION_NOTE_MAX,
  RENEWAL_INVITATION_STATUS_LABELS,
  type RenewalInvitationResponse,
  type RenewalInvitationStatus,
} from '@kampus/school-core/lib/renewal-invitations.ts'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { INVITATION_STATUS_TONES } from './RenewalInvitationsSection.tsx'

/**
 * Yenileme daveti, veli kartı (K-10; DOM-KAY-027; IST-100): seçili çocuğun davetleri. Ödeyici veli
 * niyetini bildirir ve plan yapılana kadar değiştirir; ödeyici olmayan veli yalnız durumu görür.
 * Yanıt niyet beyanıdır: sözleşme, taksit ve sınıf yazmaz; sözleşme onayı Sözleşmeler sayfasında
 * ayrı kalır. Seçili çocuk yoksa (velayeti olmayan ödeyici veli) kapsamındaki bütün davetler gelir.
 */

const CONTRACTS_PATH = '/veli/sozlesmeler'
const INVITATION_PAGE_SIZE = 20

type Invitation = {
  id: string
  version: number
  studentName: string | null
  academicYear: number
  status: RenewalInvitationStatus
  response: RenewalInvitationResponse | null
  note: string | null
  canRespond: boolean
}

const periodOf = (year: number) => `${String(year)}–${String(year + 1)}`

export function ParentRenewalInvitations({ childId }: { childId: string | null }) {
  const invitations = useRenewalInvitations({
    page: 1,
    pageSize: INVITATION_PAGE_SIZE,
    ...(childId ? { studentId: childId } : {}),
  })
  if (invitations.error)
    return (
      <div className="mb-6">
        <QueryError error={invitations.error} onRetry={() => void invitations.refetch()} />
      </div>
    )
  if (!invitations.data || invitations.data.data.length === 0) return null
  return (
    <div className="mb-6 grid gap-4">
      {invitations.data.data.map((item) => (
        <InvitationCard key={item.id} invitation={item} />
      ))}
    </div>
  )
}

function InvitationCard({ invitation }: { invitation: Invitation }) {
  const headingId = useId()
  const noteId = useId()
  const respond = useRespondRenewalInvitation()
  const [note, setNote] = useState(invitation.note ?? '')

  async function answer(response: RenewalInvitationResponse) {
    const trimmed = note.trim()
    const outcome = await respond.submit({
      invitationId: invitation.id,
      version: invitation.version,
      body: { response, ...(trimmed === '' ? {} : { note: trimmed }) },
    })
    if (outcome.status === 'success') notify.success('Yanıtınız kaydedildi.')
  }

  const period = periodOf(invitation.academicYear)
  return (
    <section
      aria-labelledby={headingId}
      className="panel grid gap-3 rounded-card border bg-surface px-6 py-5 max-[650px]:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold [overflow-wrap:anywhere]">
          {invitation.studentName ?? 'Öğrenci'} için {period} kayıt yenileme daveti
        </h2>
        <StatusBadge
          text={RENEWAL_INVITATION_STATUS_LABELS[invitation.status]}
          tone={INVITATION_STATUS_TONES[invitation.status]}
        />
      </div>
      <p className="max-w-[62ch] text-sm text-muted-foreground">
        Yanıtınız niyet beyanıdır; sözleşme ya da taksit oluşturmaz. Plan yapılınca sözleşme onayı
        ayrıca istenir.
      </p>
      {invitation.canRespond ? (
        <>
          <div className="grid gap-1.5">
            <Label htmlFor={noteId}>Not (isteğe bağlı)</Label>
            <Textarea
              id={noteId}
              value={note}
              maxLength={RENEWAL_INVITATION_NOTE_MAX}
              disabled={respond.isPending}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant={invitation.response === 'will_renew' ? 'default' : 'secondary'}
              aria-pressed={invitation.response === 'will_renew'}
              disabled={respond.isPending}
              aria-busy={respond.isPending || undefined}
              onClick={() => void answer('will_renew')}
            >
              Yenilemek istiyorum
            </Button>
            <Button
              variant={invitation.response === 'will_not_renew' ? 'default' : 'secondary'}
              aria-pressed={invitation.response === 'will_not_renew'}
              disabled={respond.isPending}
              aria-busy={respond.isPending || undefined}
              onClick={() => void answer('will_not_renew')}
            >
              Yenilemeyeceğim
            </Button>
          </div>
        </>
      ) : invitation.status === 'planned' ? (
        <p className="text-sm">
          Yenileme planlandı. Onay bekleyen sözleşme varsa{' '}
          <Link
            to={CONTRACTS_PATH}
            className="inline-flex min-h-(--target-min) items-center font-medium text-primary hover:underline"
          >
            Sözleşmeler
          </Link>{' '}
          sayfasındadır.
        </p>
      ) : (
        <p className="text-sm">Bu daveti öğrencinin ödeyici velisi yanıtlar.</p>
      )}
    </section>
  )
}
