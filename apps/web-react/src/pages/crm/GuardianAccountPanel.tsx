import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type Path } from 'react-hook-form'
import type { z } from 'zod'
import { isReauthenticationRequired } from '@kampus/react-shared/reauthentication.ts'
import { useInviteGuardianAccount } from '@kampus/react-shared/use-guardian-invitations.ts'
import { useReauthRetry } from '@/auth/use-reauth-retry.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useCoreAll, useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { notify } from '@/lib/notify.ts'
import { FormActions, RootError, useFocusAfterSubmit } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  focusableField,
  guardianAccountBody,
  guardianAccountDefaults,
  guardianAccountErrorMessage,
  guardianAccountFieldFor,
  guardianAccountFormSchema,
  guardianAccountStudents,
  isGuardianRecord,
  type GuardianAccountFormValues,
} from './enrollment-guardian-account.ts'

type Output = z.output<typeof guardianAccountFormSchema>
/** Panel adreste (`?veli-hesabi=ac`): geri düğmesi kapatır, bağlantı paylaşılabilir. */
const PANEL = 'veli-hesabi'
const OPEN = 'ac'

/**
 * "Veli hesabı aç" düğmesi ve sağ paneli (ON-290; DOM-YTK-071, kullanıcı kararı 2026-11-03 K-05):
 * kesin kayıtta yazılan ya da öğrencinin kayıtlı veli kaydı ve öğrenci seçili gelir; ad ve
 * e-posta veli kaydından dolar, düzenlenebilir; veli kaydına bağlı kardeşler de seçilebilir.
 * Davet taze oturum ister: 403 `reauthentication_required` parola penceresini açar, doğrulanınca
 * davet bir kez tekrarlanır (`useReauthRetry`). Yalnız yönetici ve ön büro ekranlarında kullanılır.
 */
export function GuardianAccountAction({
  studentId,
  studentName,
  parentId,
}: {
  studentId: string
  studentName: string
  parentId: string
}) {
  const panel = useDetailPanel(PANEL)
  const open = panel.selectedId === OPEN
  return (
    <>
      <Button variant="secondary" onClick={() => panel.open(OPEN)}>
        <Icon name="UserRoundPlus" size={17} aria-hidden="true" />
        Veli hesabı aç
      </Button>
      <SidePanel
        open={open}
        onOpenChange={(next) => (next ? undefined : panel.close())}
        title="Veli hesabı aç"
      >
        {open ? (
          <GuardianAccountContent
            studentId={studentId}
            studentName={studentName}
            parentId={parentId}
            onClose={panel.close}
          />
        ) : null}
      </SidePanel>
    </>
  )
}

function GuardianAccountContent({
  studentId,
  studentName,
  parentId,
  onClose,
}: {
  studentId: string
  studentName: string
  parentId: string
  onClose: () => void
}) {
  const parent = useCoreItem('parents', parentId)
  const siblings = useCoreAll('students', { filters: { parentId } })
  if (parent.error) return <QueryError error={parent.error} onRetry={() => void parent.refetch()} />
  if (!parent.data) return <SummaryLoading />
  if (!isGuardianRecord(parent.data.record))
    return (
      <p role="note" className="text-sm">
        Bu kayıtta veli yok: kursiyer kendi adına kayıtlıdır. Veli hesabı açılmaz.
      </p>
    )
  const students = guardianAccountStudents(
    { id: studentId, name: studentName },
    (siblings.data ?? [])
      .filter((row) => row.record.isActive !== false)
      .map((row) => ({ id: row.id, name: row.record.name })),
  )
  return (
    <GuardianAccountForm
      parent={parent.data.record}
      parentId={parentId}
      studentId={studentId}
      students={students}
      onClose={onClose}
    />
  )
}

function GuardianAccountForm({
  parent,
  parentId,
  studentId,
  students,
  onClose,
}: {
  parent: CoreRecord<'parents'>
  parentId: string
  studentId: string
  students: readonly { id: string; name: string }[]
  onClose: () => void
}) {
  const invite = useInviteGuardianAccount()
  const { run, reauthModal } = useReauthRetry()
  const learner = useEnrollmentLearner()
  const form = useForm<GuardianAccountFormValues, unknown, Output>({
    resolver: zodResolver(guardianAccountFormSchema),
    defaultValues: guardianAccountDefaults(parent, studentId),
  })
  const busy = invite.isPending || form.formState.isSubmitting
  const focusAfterSubmit = useFocusAfterSubmit(form, busy)
  const errors = form.formState.errors
  const studentsError = errors.studentIds?.message ?? errors.studentIds?.root?.message

  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await run(() =>
      invite.submit(guardianAccountBody(values, parentId), {
        setError: (name, error) =>
          form.setError(name as Path<GuardianAccountFormValues>, {
            type: error.type,
            message: guardianAccountErrorMessage(error.type, error.message, learner),
          }),
        fieldFor: guardianAccountFieldFor,
        silent: isReauthenticationRequired,
      }),
    )
    if (outcome.status !== 'done') return
    const result = outcome.result
    if (result.status === 'success') {
      // İleti iki durumda aynıdır (karar 73): e-postanın başka kurumda hesabı olup olmadığı
      // personele belli edilmez.
      notify.success(`${values.name} için veli hesabı daveti gönderildi.`)
      onClose()
    } else if (result.status === 'failed') {
      const field = guardianAccountFieldFor(result.error)
      if (focusableField(field)) focusAfterSubmit(field)
    }
  })

  return (
    <>
      <form
        noValidate
        aria-label="Veli hesabı aç"
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-5"
      >
        <p className="text-sm text-muted-foreground">
          Veli e-postadaki bağlantıyla parolasını belirleyip giriş yapar; seçilen {learner.plural}i
          görür ve rızalarını Rızalarım bölümünden verir. Hesap {parent.name} veli kaydına bağlanır.
        </p>
        <FormField id="veli-hesap-ad" label="Veli adı soyadı" error={errors.name}>
          {(control) => (
            <Input {...control} {...form.register('name')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField id="veli-hesap-eposta" label="Veli e-postası" error={errors.email}>
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
        <fieldset
          className="grid gap-2 text-sm"
          aria-invalid={studentsError ? true : undefined}
          aria-describedby={studentsError ? 'veli-hesap-ogrenci-hata' : undefined}
        >
          <legend className="mb-1 font-medium">Hesabın göreceği {learner.plural}</legend>
          {students.map((student) => (
            <label key={student.id} className="flex min-h-6 items-center gap-2">
              <input
                type="checkbox"
                className="size-4"
                value={student.id}
                disabled={busy}
                {...form.register('studentIds')}
              />
              {student.id === studentId ? `${student.name} (bu kayıt)` : student.name}
            </label>
          ))}
          {studentsError ? (
            <p id="veli-hesap-ogrenci-hata" role="alert" className="text-sm text-danger">
              {studentsError}
            </p>
          ) : null}
        </fieldset>
        <RootError message={errors.root?.server?.message} />
        <FormActions busy={busy} onCancel={onClose} submitLabel="Veli hesabı aç" />
      </form>
      {reauthModal}
    </>
  )
}
