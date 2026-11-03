import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import {
  useCancelStaffInvitation,
  useChangeStaffRole,
  useInviteStaff,
  useSetStaffActive,
  useStaffInvitations,
} from '@kampus/react-shared/use-staff-accounts.ts'
import type { StaffRole } from '@kampus/school-core/lib/staff-accounts.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { FormField } from '@/components/FormField.tsx'
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
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { errorRoutes, FormActions, useFocusAfterSubmit } from '../management/FormParts.tsx'
import { SummarySection } from '../management/SummaryParts.tsx'
import {
  INVITE_DEFAULTS,
  inviteBody,
  inviteFormSchema,
  invitationRow,
  STAFF_ROLE_OPTIONS,
  staffActions,
  type InvitationRow,
  type InviteFormValues,
  type MemberRow,
} from './settings-rows.ts'

// Personel hesabı işlemleri (IST-007, DOM-YTK-070): davet formu, bekleyen davetler ve satırın
// rol/pasifleştirme işlemleri. Hepsi taze oturum ister; 403 `reauthentication_required` parola
// penceresini açar, doğrulanınca işlem bir kez tekrarlanır (`useReauthRetry`).

const INVITE_ROUTES = {
  ...errorRoutes({
    member_exists: 'email',
    invitation_exists: 'email',
    teacher_already_linked: 'teacherId',
    not_found: 'teacherId',
  }),
  silent: isReauthenticationRequired,
}
const QUIET = { silent: isReauthenticationRequired }

/** Davet formu (sağ panel): e-posta, ad, rol ve öğretmen rolünde isteğe bağlı öğretmen kaydı. */
export function StaffInviteForm({ onClose }: { onClose: () => void }) {
  const invite = useInviteStaff()
  const { run, reauthModal } = useReauthRetry()
  const form = useForm<InviteFormValues, unknown, InviteFormValues>({
    resolver: zodResolver(inviteFormSchema),
    defaultValues: INVITE_DEFAULTS,
  })
  const role = useWatch({ control: form.control, name: 'role' })
  const teachers = useCoreAll('teachers', {}, { enabled: role === 'ogretmen' })
  const busy = invite.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await run(() =>
      invite.submit(inviteBody(values), { setError: form.setError, ...INVITE_ROUTES }),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      notify.success(
        `${result.data.data.name ?? values.name} davet edildi. Parola belirleme bağlantısı e-postayla gönderildi.`,
      )
      onClose()
    } else if (result.status === 'failed') {
      focusAfterSubmit(INVITE_ROUTES.fieldFor(result.error))
    }
  })

  return (
    <>
      <form
        noValidate
        aria-label="Personel davet et"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <p className="text-sm text-muted-foreground">
          Hesap hemen açılır; kişi e-postadaki bağlantıyla parolasını belirleyip giriş yapar.
          Öğrenci ve veli hesapları kayıt üzerinden açılır.
        </p>
        <FormField id="davet-ad" label="Ad soyad" error={errors.name}>
          {(control) => (
            <Input {...control} {...form.register('name')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField id="davet-eposta" label="E-posta" error={errors.email}>
          {(control) => (
            <Input
              {...control}
              {...form.register('email')}
              type="email"
              inputMode="email"
              autoComplete="off"
              disabled={busy}
            />
          )}
        </FormField>
        <FormField id="davet-rol" label="Rol" error={errors.role}>
          {(control) => (
            <NativeSelect {...control} {...form.register('role')} disabled={busy}>
              {STAFF_ROLE_OPTIONS.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {role === 'ogretmen' ? (
          <FormField
            id="davet-ogretmen"
            label="Öğretmen kaydı"
            error={errors.teacherId}
            description="İsteğe bağlı: hesap kadrodaki öğretmen kaydına bağlanır; dersleri ve sınıfları buradan gelir."
          >
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('teacherId')}
                disabled={busy || teachers.isPending}
              >
                <NativeSelectOption value="">Bağlama</NativeSelectOption>
                {(teachers.data ?? []).map(({ record }) => (
                  <NativeSelectOption key={record.id} value={record.id}>
                    {record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
        <FormActions busy={busy} onCancel={onClose} submitLabel="Davet et" />
      </form>
      {reauthModal}
    </>
  )
}

/** Bekleyen davetler: kişi henüz ilk girişini yapmadı. Liste boşsa bölüm görünmez. */
export function PendingInvitations() {
  const invitations = useStaffInvitations()
  const [target, setTarget] = useState<InvitationRow | null>(null)
  if (invitations.error)
    return <QueryError error={invitations.error} onRetry={() => void invitations.refetch()} />
  const rows = (invitations.data?.data ?? []).map(invitationRow)
  if (rows.length === 0) return null
  return (
    <section
      aria-labelledby="bekleyen-davetler"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="px-6 pt-6 pb-2">
        <h2 id="bekleyen-davetler" className="text-lg font-semibold">
          Bekleyen davetler
        </h2>
        <p className="text-sm text-muted-foreground">
          {rows.length} davet · Kişi ilk girişini yapınca listeden düşer
        </p>
      </header>
      <ul className="divide-y px-6 pb-4">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <span className="grid min-w-0">
              <strong className="font-medium">{row.name}</strong>
              <small className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {row.email} · {row.roleLabel} · {row.createdLabel}
              </small>
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${row.name} davetini iptal et`}
              onClick={() => setTarget(row)}
            >
              <Icon name="X" size={15} aria-hidden="true" />
              Daveti iptal et
            </Button>
          </li>
        ))}
      </ul>
      {target ? <CancelInvitationDialog row={target} onClose={() => setTarget(null)} /> : null}
    </section>
  )
}

function CancelInvitationDialog({ row, onClose }: { row: InvitationRow; onClose: () => void }) {
  const cancel = useCancelStaffInvitation()
  const { run, reauthModal } = useReauthRetry()
  const busy = cancel.isPending

  async function confirm() {
    const outcome = await run(() => cancel.submit({ invitationId: row.id }, QUIET))
    if (outcome.status === 'done' && outcome.result.status === 'success') {
      notify.success(`${row.name} daveti iptal edildi.`)
      onClose()
    } else if (outcome.status === 'done') onClose()
  }

  return (
    <>
      <AlertDialog open onOpenChange={(next) => (busy || next ? undefined : onClose())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Daveti iptal et</AlertDialogTitle>
            <AlertDialogDescription>
              {row.name} ({row.email}) için açılan hesap kapanır ve parola bağlantısı geçersiz olur.
              Kişiyi daha sonra yeniden davet edebilirsiniz.
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

/**
 * Üye ayrıntısındaki hesap işlemleri: rol değiştirme ve pasifleştirme/etkinleştirme. Öğrenci ve
 * veli hesaplarında ve kişinin kendi hesabında görünmez (`staffActions`).
 */
export function StaffMemberActions({
  row,
  selfUserId,
}: {
  row: MemberRow
  selfUserId: string | null
}) {
  const actions = staffActions(row, selfUserId)
  const changeRole = useChangeStaffRole()
  const setActive = useSetStaffActive()
  const { run, reauthModal } = useReauthRetry()
  const [role, setRole] = useState<StaffRole | ''>('')
  const [confirmDeactivate, setConfirmDeactivate] = useState(false)
  if (!actions.changeRole && !actions.deactivate && !actions.reactivate) return null
  const selectedRole = role || (row.role as StaffRole)
  const busy = changeRole.isPending || setActive.isPending

  async function saveRole() {
    const outcome = await run(() =>
      changeRole.submit({ membershipId: row.id, role: selectedRole }, QUIET),
    )
    if (outcome.status === 'done' && outcome.result.status === 'success') {
      notify.success(`${row.name} rolü değiştirildi.`)
      setRole('')
    }
  }

  async function toggle(active: boolean) {
    const outcome = await run(() => setActive.submit({ membershipId: row.id, active }, QUIET))
    setConfirmDeactivate(false)
    if (outcome.status === 'done' && outcome.result.status === 'success')
      notify.success(
        active ? `${row.name} hesabı etkinleştirildi.` : `${row.name} hesabı pasifleştirildi.`,
      )
  }

  return (
    <SummarySection title="Hesap işlemleri">
      <div className="grid gap-4">
        {actions.changeRole ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1.5 text-sm font-medium" htmlFor="uye-rol">
              Rol
              <NativeSelect
                id="uye-rol"
                value={selectedRole}
                onChange={(event) => setRole(event.target.value as StaffRole)}
                disabled={busy}
              >
                {STAFF_ROLE_OPTIONS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <Button
              variant="secondary"
              disabled={busy || selectedRole === row.role}
              aria-busy={changeRole.isPending || undefined}
              onClick={() => void saveRole()}
            >
              Rolü değiştir
            </Button>
          </div>
        ) : null}
        {actions.deactivate ? (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              Pasif hesap bu kurumda giriş yapamaz; kayıtları ve geçmişi korunur.
            </p>
            <Button
              variant="outline"
              className="justify-self-start"
              disabled={busy}
              onClick={() => setConfirmDeactivate(true)}
            >
              <Icon name="X" size={15} aria-hidden="true" />
              Hesabı pasifleştir
            </Button>
          </div>
        ) : null}
        {actions.reactivate ? (
          <Button
            variant="secondary"
            className="justify-self-start"
            disabled={busy}
            aria-busy={setActive.isPending || undefined}
            onClick={() => void toggle(true)}
          >
            <Icon name="RotateCcw" size={15} aria-hidden="true" />
            Hesabı etkinleştir
          </Button>
        ) : null}
      </div>
      <AlertDialog
        open={confirmDeactivate}
        onOpenChange={(next) => (busy ? undefined : setConfirmDeactivate(next))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hesabı pasifleştir</AlertDialogTitle>
            <AlertDialogDescription>
              {row.name} bu kurumda giriş yapamaz ve açık oturumları kapanır. Kayıtları ve işlem
              geçmişi korunur; hesabı daha sonra yeniden etkinleştirebilirsiniz.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={(event) => {
                event.preventDefault()
                void toggle(false)
              }}
            >
              Pasifleştir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reauthModal}
    </SummarySection>
  )
}
