// Tek izin formu için çocuğun (ya da öğrencinin kendisinin) kararı (IST-067; DOM-ILT-030, -031,
// -037, -038). Onay ya da ret, isteğe bağlı kısa notla verilir; son güne kadar değiştirilebilir
// (her karar yeni satırdır). Karar verilebilirliğin hakemi sunucudur (`acceptingDecisions`): form
// kapatılmış ya da son günü geçmişse düğmeler gerekçesiyle kapalıdır, istemci saati karar vermez ve
// yazılan not silinmez. 18 yaş altı öğrenci için sunucu 403 `permission_guardian_required` verir;
// mesaj formun içinde gösterilir. Gönderim sürerken düğmeler kilitlidir (`useApiCommand`
// `Idempotency-Key` ile mükerrer karar yazmaz).
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  decidePermissionBody,
  decisionBlockedReason,
  PERMISSION_TOPIC_LABELS,
  type PermissionDecisionValue,
  type PermissionFormListItem,
} from '@kampus/react-shared/permission-forms.ts'
import {
  useDecidePermission,
  usePermissionForm,
} from '@kampus/react-shared/use-permission-forms.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import {
  decisionFormSchema,
  myDecision,
  myDecisionText,
  PERMISSION_NOTE_MAX_LENGTH,
  permissionErrorRoutes,
  permissionFormState,
  permissionFormTone,
  permissionStatusText,
  permissionStatusTone,
  studentEntry,
  type DecisionFormValues,
} from './permission-forms.ts'

const when = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

const SUCCESS_TEXT = {
  approved: 'Onayınız kaydedildi.',
  rejected: 'Retiniz kaydedildi.',
} as const satisfies Record<PermissionDecisionValue, string>

type Props = {
  /** Liste satırı (başlık, son gün, durum); ayrıntı kartın içinde okunur. */
  item: PermissionFormListItem
  studentId: string
  /** Kararı kimin verdiği metinlerde ve yaş uyarısında farkı belirler. */
  audience: 'guardian' | 'student'
}

export function PermissionDecisionCard({ item, studentId, audience }: Props) {
  const detail = usePermissionForm(item.id)
  const decide = useDecidePermission()
  const [editing, setEditing] = useState(false)
  const form = useForm<DecisionFormValues>({
    resolver: zodResolver(decisionFormSchema),
    defaultValues: { note: '' },
  })
  const errors = form.formState.errors
  const full = detail.data?.data
  const state = permissionFormState(item)
  const entry = full ? studentEntry(full, studentId) : undefined
  const mine = myDecision(entry)
  const blocked = full ? decisionBlockedReason(full) : null
  const busy = decide.isPending || form.formState.isSubmitting
  const decided = mine !== undefined
  const showForm = entry !== undefined && (!decided || editing)
  const reasonId = `izin-gerekce-${item.id}`
  const noteId = `izin-not-${item.id}`

  function startEditing() {
    form.reset({ note: mine?.note ?? '' })
    setEditing(true)
  }

  const submitAs = (decision: PermissionDecisionValue) =>
    form.handleSubmit(async (values) => {
      const outcome = await decide.submit(
        { formId: item.id, body: decidePermissionBody({ studentId, decision, note: values.note }) },
        { setError: form.setError, ...permissionErrorRoutes('decision') },
      )
      if (outcome.status !== 'success') return
      notify.success(SUCCESS_TEXT[decision])
      form.reset({ note: '' })
      setEditing(false)
    })

  return (
    <article
      aria-label={item.title}
      className="panel grid gap-4 rounded-card border bg-surface px-6 py-5"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold [overflow-wrap:anywhere]">{item.title}</h2>
          <p className="text-sm text-muted-foreground">
            {PERMISSION_TOPIC_LABELS[item.topic]} · Son gün{' '}
            {dateLabel(item.deadline, { year: 'numeric' })}
          </p>
        </div>
        <StatusBadge text={state} tone={permissionFormTone(state)} />
      </header>
      <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-line">{item.description}</p>
      {detail.error ? (
        <QueryError error={detail.error} onRetry={() => void detail.refetch()} />
      ) : !full ? (
        <p role="status" className="text-sm text-muted-foreground">
          Karar durumu yükleniyor…
        </p>
      ) : entry === undefined ? (
        <p className="text-sm text-muted-foreground">Bu form bu öğrenci için istenmiyor.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">İzin durumu</span>
            <StatusBadge
              text={permissionStatusText(entry.status)}
              tone={permissionStatusTone(entry.status)}
            />
          </div>
          {decided ? (
            <div className="grid gap-1 rounded-xl border bg-surface-soft px-4 py-3 text-sm">
              <p className="font-medium">
                {myDecisionText(mine)} <span className="font-normal">({when(mine.decidedAt)})</span>
              </p>
              {mine.note ? <p className="[overflow-wrap:anywhere]">Notunuz: {mine.note}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {audience === 'student'
                ? 'Henüz karar vermediniz. Karar vermezseniz katılımınız onaylanmış sayılmaz.'
                : 'Henüz karar vermediniz. Karar vermezseniz çocuğunuzun katılımı onaylanmış sayılmaz.'}
            </p>
          )}
          {blocked ? (
            <p id={reasonId} role="status" className="text-sm font-medium text-warning">
              {blocked}
            </p>
          ) : null}
          {decided && !editing ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={blocked !== null}
                aria-describedby={blocked ? reasonId : undefined}
                onClick={startEditing}
              >
                <Icon name="Pencil" size={15} aria-hidden="true" />
                Kararını değiştir
              </Button>
            </div>
          ) : null}
          {showForm ? (
            <form
              noValidate
              aria-label={`${item.title} kararı`}
              onSubmit={(event) => event.preventDefault()}
              className="grid gap-4"
            >
              <FormField
                id={noteId}
                label="Not (isteğe bağlı)"
                error={errors.note}
                description={`Okula iletmek istediğiniz kısa not. En çok ${PERMISSION_NOTE_MAX_LENGTH} karakter; sağlık bilgisi yazmayın.`}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    {...form.register('note')}
                    rows={3}
                    maxLength={PERMISSION_NOTE_MAX_LENGTH}
                    disabled={busy}
                  />
                )}
              </FormField>
              <RootError message={errors.root?.server?.message} />
              <div className="flex flex-wrap justify-end gap-2">
                {editing ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setEditing(false)}
                  >
                    Vazgeç
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || blocked !== null}
                  aria-describedby={blocked ? reasonId : undefined}
                  onClick={(event) => void submitAs('rejected')(event)}
                >
                  <Icon name="X" size={16} aria-hidden="true" />
                  Reddet
                </Button>
                <Button
                  type="button"
                  disabled={busy || blocked !== null}
                  aria-describedby={blocked ? reasonId : undefined}
                  aria-busy={decide.isPending || undefined}
                  onClick={(event) => void submitAs('approved')(event)}
                >
                  <Icon name="Check" size={16} aria-hidden="true" />
                  Onayla
                </Button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </article>
  )
}
