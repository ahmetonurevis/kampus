// Yönetici ve rehber öğretmen izin formu paneli (IST-067; DOM-ILT-030, -036…038). Tek sağ panelin
// içeriği adresteki parametreye göre değişir: `?izin=` form ayrıntısı ve öğrenci bazlı durum,
// `?izin-form=` aç/düzenle. Karar satırı ve veli notu yalnız yönetici ve rehber öğretmene gelir;
// derse giren öğretmen yalnız durumu görür (DOM-ILT-037). Panel kapatılınca form → ayrıntı döner.
import { useMemo, useState } from 'react'
import {
  hasDecisions,
  PERMISSION_DECISION_LABELS,
  PERMISSION_TOPIC_LABELS,
  type PermissionFormDecision,
  type PermissionFormDetail,
} from '@kampus/react-shared/permission-forms.ts'
import {
  useArchivePermissionForm,
  useClosePermissionForm,
  usePermissionForm,
} from '@kampus/react-shared/use-permission-forms.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
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
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { RECORD_UNAVAILABLE_MESSAGE, submitWithFreshRecord } from '../language/fresh-submit.ts'
import { SummaryLoading, SummaryMetrics, SummarySection } from '../management/SummaryParts.tsx'
import { Facts, SummaryTitle } from '../learning/LearningParts.tsx'
import { NEW_PERMISSION_FORM, PermissionFormContent } from './PermissionFormEditor.tsx'
import {
  permissionActions,
  permissionFormState,
  permissionFormTone,
  permissionStatusText,
  permissionStatusTone,
  type PermissionActor,
} from './permission-forms.ts'

export type PanelControl = {
  selectedId: string
  open: (id: string) => void
  close: () => void
}

type Props = {
  detail: PanelControl
  form: PanelControl
  actor: PermissionActor
}

const NONE: readonly never[] = []

const when = (value: string) =>
  dateLabel(value, { year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function PermissionFormPanel({ detail, form, actor }: Props) {
  const mode = form.selectedId ? 'form' : detail.selectedId ? 'detail' : null
  const title =
    mode === 'form'
      ? form.selectedId === NEW_PERMISSION_FORM
        ? 'İzin formu aç'
        : 'İzin formunu düzenle'
      : 'İzin formu ayrıntısı'
  return (
    <SidePanel
      open={mode !== null}
      onOpenChange={(open) => (open ? undefined : mode === 'form' ? form.close() : detail.close())}
      title={title}
    >
      {mode === 'form' ? (
        <PermissionFormContent
          key={form.selectedId}
          target={form.selectedId}
          actor={actor}
          onClose={form.close}
        />
      ) : mode === 'detail' ? (
        <PermissionFormDetailView
          formId={detail.selectedId}
          actor={actor}
          onEdit={() => form.open(detail.selectedId)}
          onGone={detail.close}
        />
      ) : null}
    </SidePanel>
  )
}

function PermissionFormDetailView({
  formId,
  actor,
  onEdit,
  onGone,
}: {
  formId: string
  actor: PermissionActor
  onEdit: () => void
  onGone: () => void
}) {
  // Tek kayıt ucu kapsamı uygular: görmediği form 404 döner ve "bulunamadı" görünür.
  const item = usePermissionForm(formId)
  const students = useCoreAll('students')
  const classes = useCoreAll('classes')
  const [closing, setClosing] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const form = item.data?.data
  const names = useMemo(
    () => new Map((students.data ?? NONE).map((row) => [row.record.id, row.record])),
    [students.data],
  )
  const classNames = useMemo(
    () => new Map((classes.data ?? NONE).map((row) => [row.record.id, row.record.name])),
    [classes.data],
  )
  const error = item.error ?? students.error ?? classes.error
  if (error)
    return (
      <QueryError
        error={error}
        onRetry={() => {
          if (item.error) void item.refetch()
          if (students.error) void students.refetch()
          if (classes.error) void classes.refetch()
        }}
      />
    )
  if (!form) return <SummaryLoading />
  const state = permissionFormState(form)
  const actions = permissionActions(actor, form)
  const expired = form.status === 'closed' && form.closedAt === null
  const closed = form.closedAt !== null
  const decided = hasDecisions(form)
  const target = (form.classIds ?? []).map((id) => classNames.get(id) ?? 'Sınıf')
  return (
    <>
      <SummaryTitle
        icon="FileCheck"
        title={form.title}
        subtitle={`${PERMISSION_TOPIC_LABELS[form.topic]} · Son gün ${dateLabel(form.deadline, { year: 'numeric' })}`}
      />
      <Facts
        items={[
          ['Konu', PERMISSION_TOPIC_LABELS[form.topic]],
          ['Son gün', dateLabel(form.deadline, { year: 'numeric' })],
          ['Durum', <StatusBadge key="durum" text={state} tone={permissionFormTone(state)} />],
          ...(form.closedAt ? ([['Kapatıldı', when(form.closedAt)]] as const) : []),
          ['Hedef sınıflar', target.length ? target.join(', ') : 'Yok'],
          ...(form.targetStudentIds?.length
            ? ([['Tek tek öğrenciler', `${form.targetStudentIds.length} öğrenci`]] as const)
            : []),
        ]}
      />
      {actions.manage ? (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" disabled={closed} onClick={onEdit}>
            <Icon name="Pencil" size={15} aria-hidden="true" />
            Düzenle
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={form.status === 'closed'}
            onClick={() => setClosing(true)}
          >
            <Icon name="Lock" size={15} aria-hidden="true" />
            Formu kapat
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={decided}
            onClick={() => setArchiving(true)}
          >
            <Icon name="Archive" size={15} aria-hidden="true" />
            Arşivle
          </Button>
          {closed || expired || decided ? (
            <p className="basis-full text-xs text-muted-foreground">
              {closed
                ? 'Kapatılmış form düzenlenemez, yeniden açılamaz.'
                : expired
                  ? 'Son günü geçmiş formda yalnız başlık, açıklama ve hedef değişir.'
                  : null}
              {decided
                ? ' Karar verilmiş form arşivlenemez; kararlar korunur, formu kapatın.'
                : null}
            </p>
          ) : null}
          <CloseDialog form={form} open={closing} onOpenChange={setClosing} />
          <ArchiveDialog
            form={form}
            open={archiving}
            onOpenChange={setArchiving}
            onArchived={onGone}
          />
        </div>
      ) : null}
      <SummaryMetrics
        items={[
          { label: 'Onay', value: form.counts.approved },
          { label: 'Ret', value: form.counts.rejected },
          { label: 'Bekleyen', value: form.counts.pending },
          { label: 'Öğrenci', value: form.counts.total },
        ]}
      />
      <SummarySection title="Açıklama">
        <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{form.description}</p>
      </SummarySection>
      <SummarySection title="Öğrenci durumu">
        {form.students.length ? (
          <ul aria-label="Öğrenci izin durumu" className="detail-list grid gap-2">
            {form.students.map((entry) => {
              const student = names.get(entry.studentId)
              return (
                <li
                  key={entry.studentId}
                  className="grid gap-2 rounded-xl border px-3.5 py-2.5 text-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <strong className="font-medium">
                      {student?.name ?? 'Öğrenci'}
                      {student ? (
                        <span className="font-normal text-muted-foreground">
                          {' '}
                          · {classNames.get(student.classId) ?? ''}
                        </span>
                      ) : null}
                    </strong>
                    <StatusBadge
                      text={permissionStatusText(entry.status)}
                      tone={permissionStatusTone(entry.status)}
                    />
                  </div>
                  {entry.decisions.length ? (
                    <DecisionHistory decisions={entry.decisions} />
                  ) : entry.status !== 'pending' ? (
                    <p className="text-xs text-muted-foreground">
                      Karar ayrıntısını yalnız yönetici ve öğrencinin rehber öğretmeni görür.
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Bu formda görebildiğiniz öğrenci yok.</p>
        )}
      </SummarySection>
    </>
  )
}

function DecisionHistory({ decisions }: { decisions: readonly PermissionFormDecision[] }) {
  return (
    <ul aria-label="Karar geçmişi" className="grid gap-1 border-t pt-2 text-xs">
      {decisions.map((decision) => (
        <li key={decision.id} className="grid gap-0.5">
          <span>
            <strong className="font-medium">
              {decision.relation === 'self' ? 'Öğrenci (kendisi)' : 'Veli'}{' '}
              {PERMISSION_DECISION_LABELS[decision.decision].toLocaleLowerCase('tr')}
            </strong>{' '}
            <span className="text-muted-foreground">· {when(decision.decidedAt)}</span>
          </span>
          {decision.note ? (
            <span className="text-muted-foreground [overflow-wrap:anywhere]">
              Not: {decision.note}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** Gönderim anında formu yeniden okur (`If-Match` sürümü buradan); okunamazsa `undefined`. */
function useFreshForm(formId: string) {
  const item = usePermissionForm(formId)
  async function fetchFresh(): Promise<PermissionFormDetail | undefined> {
    const result = await item.refetch()
    return result.error ? undefined : result.data?.data
  }
  return fetchFresh
}

function CloseDialog({
  form,
  open,
  onOpenChange,
}: {
  form: Pick<PermissionFormDetail, 'id' | 'title'>
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const close = useClosePermissionForm()
  const fetchFresh = useFreshForm(form.id)
  const busy = close.isPending
  async function confirm() {
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      close.submit({ formId: fresh.id, version: fresh.version }),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.outcome.status === 'success') {
      notify.success(`${form.title} kapatıldı.`)
      onOpenChange(false)
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Formu kapat</AlertDialogTitle>
          <AlertDialogDescription>
            {form.title} için karar alma son günden önce biter. Verilmiş kararlar korunur; kapatılan
            form yeniden açılamaz.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Vazgeç</AlertDialogCancel>
          <AlertDialogAction
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={(event) => {
              // Pencere sonuç gelene kadar açık kalır; başarıda kapanır.
              event.preventDefault()
              void confirm()
            }}
          >
            Formu kapat
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ArchiveDialog({
  form,
  open,
  onOpenChange,
  onArchived,
}: {
  form: Pick<PermissionFormDetail, 'id' | 'title'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onArchived: () => void
}) {
  const archive = useArchivePermissionForm()
  const fetchFresh = useFreshForm(form.id)
  const busy = archive.isPending
  async function confirm() {
    const result = await submitWithFreshRecord(fetchFresh, (fresh) =>
      archive.submit({ formId: fresh.id, version: fresh.version }),
    )
    if (result.status === 'missing') {
      notify.error(RECORD_UNAVAILABLE_MESSAGE)
      return
    }
    if (result.outcome.status === 'success') {
      notify.success(`${form.title} arşivlendi.`)
      onOpenChange(false)
      onArchived()
    }
  }
  return (
    <AlertDialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Formu arşivle</AlertDialogTitle>
          <AlertDialogDescription>
            {form.title} listeden kalkar. Karar verilmiş form arşivlenemez; kararlar ispat kaydıdır,
            formu kapatın.
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
            Arşivle
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
