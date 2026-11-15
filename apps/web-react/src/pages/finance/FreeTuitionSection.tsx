import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useFieldArray, useForm, type UseFormRegisterReturn } from 'react-hook-form'
import {
  useConfirmFreeTuitionQuota,
  useCreateFreeTuitionApplication,
  useCreateFreeTuitionRound,
  useFreeTuitionApplications,
  useFreeTuitionAwards,
  useFreeTuitionMeetings,
  useFreeTuitionRounds,
  usePayFreeTuitionRefund,
  useRecordFreeTuitionBoard,
  useRecordFreeTuitionMebbis,
  useUpdateFreeTuitionDocuments,
  type FreeTuitionApplication,
  type FreeTuitionAward,
  type FreeTuitionRound,
} from '@kampus/react-shared/use-finance-free-tuition.ts'
import { useBankAccounts } from '@kampus/react-shared/use-payment-commands.ts'
import { REAUTHENTICATION_CODE } from '@kampus/react-shared/use-withdrawals.ts'
import {
  FREE_TUITION_BOARD_MIN_MEMBERS,
  FREE_TUITION_DOCUMENT_LABELS,
  FREE_TUITION_DOCUMENTS,
  FREE_TUITION_REASON_LABELS,
  FREE_TUITION_REASONS,
  FREE_TUITION_STATUS_LABELS,
  type FreeTuitionDecision,
  type FreeTuitionDocument,
  type FreeTuitionReason,
} from '@kampus/school-core/lib/finance-free-tuition.ts'
import { dateLabel, dayKey, money } from '@kampus/school-core/lib/format.ts'
import { bankAccountLabel } from '@kampus/school-core/lib/payments.ts'
import {
  payRefundSchema,
  type PayRefundInput,
  type PayRefundOutput,
} from '@kampus/school-core/lib/withdrawals.ts'
import { ReauthModal } from '@/auth/ReauthModal.tsx'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useEnrollmentLearner } from '@/hooks/use-enrollment-learner.ts'
import { useFreeTuitionMinutesPdf } from '@/hooks/use-finance-free-tuition-pdf.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { FREE_TUITION_MINUTES_TITLE } from '@/lib/pdf/templates/finance-free-tuition-minutes.ts'
import { StatGrid } from '../academic/AcademicParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { PdfDialogButton } from './CorporateParts.tsx'

/**
 * Ücretsiz okutma (DOM-FIN-026; IST-105; K-268…K-271). Yönetici eğitim yılının dönemini açar,
 * kontenjanı kesinleştirir, adayları sabit gerekçe ve belge işaretleriyle kaydeder, değerlendirme
 * kurulunun kararını yazar (kabulde açık öğrenim taksitleri kapanır, alınan ücret iade kaydı olur),
 * iadeyi öder ve MEBBİS'e işlendiği günü işaretler. Tutanak PDF'i toplantı kaydından üretilir.
 */

const NO_SORT: readonly string[] = []
const dayText = (day: string) => dateLabel(`${day}T09:00:00.000Z`, { year: 'numeric' })
const STATUS_TONE = {
  pending: 'amber',
  accepted: 'green',
  reserve: 'purple',
  rejected: 'red',
} as const
const APPLICATION_MOBILE = ['studentName', 'status']
const AWARD_MOBILE = ['studentName', 'refund', 'mebbis']

type ApplicationRow = FreeTuitionApplication & { name: string }
type AwardRow = FreeTuitionAward & { name: string }

export function FreeTuitionSection({ academicYear }: { academicYear: number }) {
  const rounds = useFreeTuitionRounds()
  const [opening, setOpening] = useState(false)
  if (rounds.isPending) return <SummaryLoading />
  if (rounds.error) return <QueryError error={rounds.error} onRetry={() => void rounds.refetch()} />
  const list = rounds.data.data
  const round = list.find((item) => item.academicYear === academicYear) ?? list[0]
  return (
    <div className="grid gap-6">
      {round ? (
        <RoundView round={round} />
      ) : (
        <section
          aria-labelledby="ucretsiz-donem"
          className="panel rounded-card border bg-surface px-6 py-6"
        >
          <h2 id="ucretsiz-donem" className="text-lg font-semibold">
            Ücretsiz okutma dönemi
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Kurum öğrenci sayısının en az %3'ü kadar öğrenciyi ücretsiz okutur. Kontenjanı
            hesaplamak ve adayları kaydetmek için eğitim yılının dönemini açın.
          </p>
          <Button className="mt-4" onClick={() => setOpening(true)}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Dönemi aç
          </Button>
        </section>
      )}
      {opening ? (
        <RoundModal academicYear={academicYear} onClose={() => setOpening(false)} />
      ) : null}
    </div>
  )
}

function RoundView({ round }: { round: FreeTuitionRound }) {
  const [dialog, setDialog] = useState<
    | { kind: 'quota' }
    | { kind: 'application' }
    | { kind: 'board' }
    | { kind: 'documents'; row: ApplicationRow }
    | { kind: 'refund'; row: AwardRow }
    | { kind: 'mebbis'; row: AwardRow }
    | null
  >(null)
  const year = `${String(round.academicYear)}–${String(round.academicYear + 1)}`
  const close = () => setDialog(null)
  return (
    <>
      <section
        aria-labelledby="ucretsiz-kontenjan"
        className="panel rounded-card border bg-surface px-6 pt-6"
      >
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="ucretsiz-kontenjan" className="text-lg font-semibold">
              Ücretsiz okutma kontenjanı · {year}
            </h2>
            <p className="text-sm text-muted-foreground">
              Öğretim başlangıcı {dayText(round.teachingStartDate)}. Alınan ücret öğretim
              başladıktan sonra iki ay içinde iade edilir.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setDialog({ kind: 'quota' })}>
            Kontenjanı kesinleştir
          </Button>
        </header>
        <StatGrid
          label="Kontenjan"
          items={[
            { label: 'Öğrenci sayısı', value: String(round.currentStudentCount) },
            {
              label: 'En az kontenjan (%3)',
              value: String(round.currentMinimumQuota),
              note: 'Öğrenci sayısından hesaplanır, 0,5 yukarı yuvarlanır.',
            },
            {
              label: 'Kesin kontenjan',
              value: round.confirmedQuota === null ? 'Kesinleşmedi' : String(round.confirmedQuota),
            },
            { label: 'Kabul edilen', value: String(round.acceptedCount) },
          ]}
        />
      </section>
      <ApplicationsPanel
        round={round}
        onAdd={() => setDialog({ kind: 'application' })}
        onBoard={() => setDialog({ kind: 'board' })}
        onDocuments={(row) => setDialog({ kind: 'documents', row })}
      />
      <MeetingsPanel roundId={round.id} />
      <AwardsPanel
        roundId={round.id}
        onRefund={(row) => setDialog({ kind: 'refund', row })}
        onMebbis={(row) => setDialog({ kind: 'mebbis', row })}
      />
      {dialog?.kind === 'quota' ? <QuotaModal round={round} onClose={close} /> : null}
      {dialog?.kind === 'application' ? (
        <ApplicationModal roundId={round.id} onClose={close} />
      ) : null}
      {dialog?.kind === 'documents' ? <DocumentsModal row={dialog.row} onClose={close} /> : null}
      {dialog?.kind === 'board' ? <BoardModal round={round} onClose={close} /> : null}
      {dialog?.kind === 'refund' ? <RefundModal row={dialog.row} onClose={close} /> : null}
      {dialog?.kind === 'mebbis' ? <MebbisModal row={dialog.row} onClose={close} /> : null}
    </>
  )
}

function ApplicationsPanel({
  round,
  onAdd,
  onBoard,
  onDocuments,
}: {
  round: FreeTuitionRound
  onAdd: () => void
  onBoard: () => void
  onDocuments: (row: ApplicationRow) => void
}) {
  const learner = useEnrollmentLearner()
  const list = useListState('ucretsiz-adaylar')
  const applications = useFreeTuitionApplications(round.id, {
    page: list.state.page,
    pageSize: list.state.pageSize,
  })
  const rows = useMemo(
    () =>
      applications.data?.data.map((item): ApplicationRow => ({
        ...item,
        name: item.studentName ?? '—',
      })),
    [applications.data],
  )
  const columns = useMemo<DataColumn<ApplicationRow>[]>(
    () => [
      { key: 'studentName', label: learner.title, cell: (row) => row.name },
      { key: 'reason', label: 'Gerekçe', cell: (row) => FREE_TUITION_REASON_LABELS[row.reason] },
      {
        key: 'documents',
        label: 'Belgeler',
        cell: (row) =>
          `${String(row.documents.length)} / ${String(FREE_TUITION_DOCUMENTS.length)} teslim`,
      },
      {
        key: 'status',
        label: 'Karar',
        cell: (row) => (
          <StatusBadge
            text={FREE_TUITION_STATUS_LABELS[row.status]}
            tone={STATUS_TONE[row.status]}
          />
        ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) =>
          row.status === 'pending' || row.status === 'reserve' ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} belgelerini işaretle`}
              onClick={() => onDocuments(row)}
            >
              Belgeler
            </Button>
          ) : null,
      },
    ],
    [learner, onDocuments],
  )
  return (
    <section
      aria-labelledby="ucretsiz-adaylar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="ucretsiz-adaylar" className="text-lg font-semibold">
            Adaylar
          </h2>
          <p className="text-sm text-muted-foreground">
            Gerekçe sabit listeden seçilir; belgelerin yalnız teslim edildiği işaretlenir, belge
            yüklenmez.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onAdd}>
            <Icon name="Plus" size={17} aria-hidden="true" />
            Aday ekle
          </Button>
          <Button onClick={onBoard} disabled={round.confirmedQuota === null}>
            Kurul kararını kaydet
          </Button>
        </div>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={applications.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={APPLICATION_MOBILE}
        caption="Ücretsiz okutma adayları"
        search={false}
        loading={applications.isPending}
        fetching={applications.isFetching && !applications.isPending}
        error={
          applications.error ? (
            <QueryError error={applications.error} onRetry={() => void applications.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}

function MeetingsPanel({ roundId }: { roundId: string }) {
  const meetings = useFreeTuitionMeetings(roundId)
  const items = meetings.data?.data ?? []
  if (items.length === 0 && !meetings.error) return null
  return (
    <section
      aria-labelledby="ucretsiz-kurul"
      className="panel rounded-card border bg-surface px-6 py-6"
    >
      <h2 id="ucretsiz-kurul" className="text-lg font-semibold">
        Değerlendirme kurulu toplantıları
      </h2>
      {meetings.error ? (
        <QueryError error={meetings.error} onRetry={() => void meetings.refetch()} />
      ) : (
        <ul className="mt-3 grid gap-3">
          {items.map((meeting) => (
            <li
              key={meeting.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
            >
              <span>
                {dayText(meeting.meetingDate)} · {meeting.memberCount} üye · kabul{' '}
                {meeting.acceptedCount}, yedek {meeting.reserveCount}, ret {meeting.rejectedCount}
              </span>
              <PdfDialogButton
                label="Tutanak PDF"
                title={FREE_TUITION_MINUTES_TITLE}
                id={meeting.id}
                usePdf={useFreeTuitionMinutesPdf}
                accessibleName={`${dayText(meeting.meetingDate)} tutanak PDF`}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function AwardsPanel({
  roundId,
  onRefund,
  onMebbis,
}: {
  roundId: string
  onRefund: (row: AwardRow) => void
  onMebbis: (row: AwardRow) => void
}) {
  const learner = useEnrollmentLearner()
  const list = useListState('ucretsiz-haklar')
  const mebbis = list.state.filters.mebbis === 'unrecorded' ? 'unrecorded' : ''
  const awards = useFreeTuitionAwards({
    roundId,
    ...(mebbis === '' ? {} : { mebbis }),
    page: list.state.page,
    pageSize: list.state.pageSize,
  })
  const rows = useMemo(
    () => awards.data?.data.map((item): AwardRow => ({ ...item, name: item.studentName ?? '—' })),
    [awards.data],
  )
  const columns = useMemo<DataColumn<AwardRow>[]>(
    () => [
      { key: 'studentName', label: learner.title, cell: (row) => row.name },
      { key: 'accepted', label: 'Kabul', cell: (row) => dayText(row.acceptedDate) },
      { key: 'waived', label: 'Kapanan alacak', cell: (row) => money(row.waivedCents) },
      {
        key: 'refund',
        label: 'İade',
        cell: (row) =>
          row.refundStatus === 'none' ? (
            'İade yok'
          ) : row.refundStatus === 'paid' ? (
            `${money(row.refundCents)} · ödendi ${dayText(row.refundPaidDate ?? row.refundDueDate)}`
          ) : (
            <span>
              {money(row.refundCents)} ·{' '}
              <StatusBadge text={`Son gün ${dayText(row.refundDueDate)}`} tone="amber" />
            </span>
          ),
      },
      {
        key: 'mebbis',
        label: 'MEBBİS',
        cell: (row) =>
          row.mebbisRecordedDate ? (
            dayText(row.mebbisRecordedDate)
          ) : (
            <StatusBadge text="İşlenmedi" tone="amber" />
          ),
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <div className="flex flex-wrap gap-2">
            {row.refundStatus === 'pending' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} iadesini öde`}
                onClick={() => onRefund(row)}
              >
                İadeyi öde
              </Button>
            ) : null}
            {row.mebbisRecordedDate === null ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} hakkının MEBBİS gününü işle`}
                onClick={() => onMebbis(row)}
              >
                MEBBİS'e işlendi
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [learner, onMebbis, onRefund],
  )
  return (
    <section
      aria-labelledby="ucretsiz-haklar"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="ucretsiz-haklar" className="text-lg font-semibold">
            Hak kazananlar
          </h2>
          <p className="text-sm text-muted-foreground">
            Kabulde o yılın ödenmemiş öğrenim taksitleri kapanır; alınan öğrenim ücreti iade edilir.
            MEBBİS'e gönderim elle yapılır, işlendiği gün buraya kaydedilir.
          </p>
        </div>
        <FormField id="ucretsiz-mebbis-suzgec" label="MEBBİS durumu">
          {(control) => (
            <NativeSelect
              {...control}
              value={mebbis}
              onChange={(event) =>
                list.dispatch({ type: 'filter', key: 'mebbis', value: event.target.value })
              }
            >
              <NativeSelectOption value="">Tümü</NativeSelectOption>
              <NativeSelectOption value="unrecorded">İşlenmemişler</NativeSelectOption>
            </NativeSelect>
          )}
        </FormField>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={awards.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={AWARD_MOBILE}
        caption="Ücretsiz okutma hakları"
        search={false}
        loading={awards.isPending}
        fetching={awards.isFetching && !awards.isPending}
        error={
          awards.error ? (
            <QueryError error={awards.error} onRetry={() => void awards.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}

function ModalFooter({
  busy,
  form,
  submit,
  onClose,
}: {
  busy: boolean
  form: string
  submit: string
  onClose: () => void
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose} disabled={busy}>
        Vazgeç
      </Button>
      <Button type="submit" form={form} disabled={busy} aria-busy={busy || undefined}>
        {submit}
      </Button>
    </>
  )
}

function RootError({ message }: { message: string | undefined }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null
}

function RoundModal({ academicYear, onClose }: { academicYear: number; onClose: () => void }) {
  const create = useCreateFreeTuitionRound()
  const form = useForm<{ teachingStartDate: string }>({
    defaultValues: { teachingStartDate: `${String(academicYear)}-09-08` },
  })
  const busy = create.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ teachingStartDate }) => {
    const outcome = await create.submit(
      { academicYear, teachingStartDate },
      {
        setError: (name, error) =>
          name === 'teachingStartDate'
            ? form.setError('teachingStartDate', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Ücretsiz okutma dönemi açıldı.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ücretsiz okutma dönemi"
      description={`${String(academicYear)}–${String(academicYear + 1)} eğitim yılı`}
      footer={
        <ModalFooter busy={busy} form="ucretsiz-donem-formu" submit="Dönemi aç" onClose={onClose} />
      }
    >
      <form
        id="ucretsiz-donem-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="ucretsiz-ogretim-baslangici"
          label="Öğretimin başladığı gün"
          error={form.formState.errors.teachingStartDate}
          description="İadenin son günü bu günden iki ay sonradır."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('teachingStartDate', { required: 'Günü seçin.' })}
              type="date"
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function QuotaModal({ round, onClose }: { round: FreeTuitionRound; onClose: () => void }) {
  const confirm = useConfirmFreeTuitionQuota()
  const form = useForm<{ confirmedQuota: string }>({
    defaultValues: {
      confirmedQuota: String(Math.max(round.confirmedQuota ?? 0, round.currentMinimumQuota)),
    },
  })
  const busy = confirm.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ confirmedQuota }) => {
    const outcome = await confirm.submit(
      {
        roundId: round.id,
        version: round.version,
        body: { confirmedQuota: Number(confirmedQuota) },
      },
      {
        setError: (name, error) =>
          name === 'confirmedQuota'
            ? form.setError('confirmedQuota', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Kontenjan kesinleşti.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Kontenjanı kesinleştir"
      description={`Bugün ${String(round.currentStudentCount)} öğrenci; en az ${String(round.currentMinimumQuota)} öğrenci ücretsiz okutulur.`}
      footer={
        <ModalFooter
          busy={busy}
          form="ucretsiz-kontenjan-formu"
          submit="Kesinleştir"
          onClose={onClose}
        />
      }
    >
      <form
        id="ucretsiz-kontenjan-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="ucretsiz-kesin-kontenjan"
          label="Kesin kontenjan"
          error={form.formState.errors.confirmedQuota}
          description="Hesaplanan sayının ve kabul edilmiş aday sayısının altına inemez."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('confirmedQuota', { required: 'Kontenjanı girin.' })}
              inputMode="numeric"
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

function DocumentChecks({
  registration,
  busy,
}: {
  registration: UseFormRegisterReturn<'documents'>
  busy: boolean
}) {
  return (
    <fieldset className="grid gap-2 text-sm">
      <legend className="mb-1 font-medium">Teslim edilen belgeler</legend>
      {FREE_TUITION_DOCUMENTS.map((code) => (
        <label key={code} className="flex min-h-6 items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            value={code}
            {...registration}
            disabled={busy}
          />
          {FREE_TUITION_DOCUMENT_LABELS[code]}
        </label>
      ))}
    </fieldset>
  )
}

type ApplicationForm = {
  studentId: string
  reason: FreeTuitionReason
  documents: FreeTuitionDocument[]
}

function ApplicationModal({ roundId, onClose }: { roundId: string; onClose: () => void }) {
  const learner = useEnrollmentLearner()
  const students = useCoreAll('students')
  const create = useCreateFreeTuitionApplication()
  const form = useForm<ApplicationForm>({
    defaultValues: { studentId: '', reason: 'financial_need', documents: [] },
  })
  const busy = create.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const options = (students.data ?? [])
    .filter((item) => item.record.isActive)
    .sort((a, b) => a.record.name.localeCompare(b.record.name, 'tr'))
  const onSubmit = form.handleSubmit(async (values) => {
    const outcome = await create.submit(
      { roundId, body: values },
      {
        setError: (name, error) =>
          name === 'studentId' || name === 'reason'
            ? form.setError(name, error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Aday kaydedildi.')
      onClose()
    }
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Ücretsiz okutma adayı"
      description="Gerekçe ve belgeler hassas veridir; serbest metin alınmaz."
      footer={
        <ModalFooter
          busy={busy}
          form="ucretsiz-aday-formu"
          submit="Adayı kaydet"
          onClose={onClose}
        />
      }
    >
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : (
        <form
          id="ucretsiz-aday-formu"
          noValidate
          onSubmit={(event) => void onSubmit(event)}
          className="grid gap-4"
        >
          <FormField id="ucretsiz-aday-ogrenci" label={learner.title} error={errors.studentId}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('studentId', { required: `${learner.title} seçin.` })}
                className="w-full"
                disabled={busy || !students.data}
              >
                <NativeSelectOption value="">{learner.title} seçin</NativeSelectOption>
                {options.map((item) => (
                  <NativeSelectOption key={item.id} value={item.id}>
                    {item.record.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="ucretsiz-aday-gerekce" label="Gerekçe" error={errors.reason}>
            {(control) => (
              <NativeSelect
                {...control}
                {...form.register('reason')}
                className="w-full"
                disabled={busy}
              >
                {FREE_TUITION_REASONS.map((code) => (
                  <NativeSelectOption key={code} value={code}>
                    {FREE_TUITION_REASON_LABELS[code]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <DocumentChecks registration={form.register('documents')} busy={busy} />
          <RootError message={errors.root?.server?.message} />
        </form>
      )}
    </Modal>
  )
}

function DocumentsModal({ row, onClose }: { row: ApplicationRow; onClose: () => void }) {
  const update = useUpdateFreeTuitionDocuments()
  const form = useForm<{ documents: FreeTuitionDocument[] }>({
    defaultValues: { documents: row.documents },
  })
  const busy = update.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ documents }) => {
    const outcome = await update.submit(
      { applicationId: row.id, version: row.version, body: { documents } },
      { setError: (_name, error) => form.setError('root.server', error) },
    )
    if (outcome.status === 'success') {
      notify.success('Belgeler güncellendi.')
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Teslim edilen belgeler"
      description={row.name}
      footer={
        <ModalFooter busy={busy} form="ucretsiz-belge-formu" submit="Kaydet" onClose={onClose} />
      }
    >
      <form
        id="ucretsiz-belge-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <DocumentChecks registration={form.register('documents')} busy={busy} />
        <RootError message={form.formState.errors.root?.server?.message} />
      </form>
    </Modal>
  )
}

type BoardForm = {
  meetingDate: string
  members: { name: string; title: string }[]
  decisions: Record<string, '' | FreeTuitionDecision>
}

function BoardModal({ round, onClose }: { round: FreeTuitionRound; onClose: () => void }) {
  const learner = useEnrollmentLearner()
  const applications = useFreeTuitionApplications(round.id, { pageSize: 100 })
  const record = useRecordFreeTuitionBoard()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<BoardForm>({
    defaultValues: {
      meetingDate: today,
      members: Array.from({ length: FREE_TUITION_BOARD_MIN_MEMBERS }, () => ({
        name: '',
        title: '',
      })),
      decisions: {},
    },
  })
  const members = useFieldArray({ control: form.control, name: 'members' })
  const busy = record.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  const open = (applications.data?.data ?? []).filter(
    (item) => item.status === 'pending' || item.status === 'reserve',
  )
  const onSubmit = form.handleSubmit(async (values) => {
    const decisions = Object.entries(values.decisions).flatMap(([applicationId, decision]) =>
      decision === '' ? [] : [{ applicationId, decision }],
    )
    const outcome = await record.submit(
      {
        roundId: round.id,
        body: { meetingDate: values.meetingDate, members: values.members, decisions },
      },
      {
        setError: (name, error) =>
          name === 'meetingDate'
            ? form.setError('meetingDate', error, { shouldFocus: true })
            : form.setError('root.server', error),
      },
    )
    if (outcome.status === 'success') {
      notify.success('Kurul kararı kaydedildi.')
      onClose()
    }
  })
  return (
    <Modal
      open
      size="wide"
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Değerlendirme kurulu kararı"
      description={`Kesin kontenjan ${String(round.confirmedQuota ?? 0)}, kabul edilen ${String(round.acceptedCount)}. Kabul edilenin ödenmemiş öğrenim taksitleri kapanır, alınan öğrenim ücreti iade kaydı olur.`}
      footer={
        <ModalFooter
          busy={busy}
          form="ucretsiz-kurul-formu"
          submit="Kararı kaydet"
          onClose={onClose}
        />
      }
    >
      {applications.isPending ? (
        <SummaryLoading />
      ) : applications.error ? (
        <QueryError error={applications.error} onRetry={() => void applications.refetch()} />
      ) : (
        <form
          id="ucretsiz-kurul-formu"
          noValidate
          onSubmit={(event) => void onSubmit(event)}
          className="grid gap-5"
        >
          <FormField id="ucretsiz-kurul-gun" label="Toplantı günü" error={errors.meetingDate}>
            {(control) => (
              <Input
                {...control}
                {...form.register('meetingDate', { required: 'Günü seçin.' })}
                type="date"
                max={today}
                disabled={busy}
              />
            )}
          </FormField>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Kurul üyeleri</legend>
            {members.fields.map((field, index) => (
              <div key={field.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <FormField
                  id={`ucretsiz-uye-ad-${String(index)}`}
                  label={`${String(index + 1)}. üye adı`}
                  error={errors.members?.[index]?.name}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`members.${index}.name`, {
                        required: 'Üyenin adını yazın.',
                      })}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <FormField
                  id={`ucretsiz-uye-gorev-${String(index)}`}
                  label={`${String(index + 1)}. üye görevi`}
                  error={errors.members?.[index]?.title}
                >
                  {(control) => (
                    <Input
                      {...control}
                      {...form.register(`members.${index}.title`, {
                        required: 'Üyenin görevini yazın.',
                      })}
                      disabled={busy}
                    />
                  )}
                </FormField>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`${String(index + 1)}. üyeyi çıkar`}
                  disabled={busy || members.fields.length <= FREE_TUITION_BOARD_MIN_MEMBERS}
                  onClick={() => members.remove(index)}
                >
                  <Icon name="Trash2" size={16} aria-hidden="true" />
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                disabled={busy || members.fields.length >= 9}
                onClick={() => members.append({ name: '', title: '' })}
              >
                <Icon name="Plus" size={16} aria-hidden="true" />
                Üye ekle
              </Button>
            </div>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium">Kararlar</legend>
            {open.length === 0 ? (
              <p className="text-sm text-muted-foreground">Karar bekleyen aday yok.</p>
            ) : (
              open.map((item) => (
                <FormField
                  key={item.id}
                  id={`ucretsiz-karar-${item.id}`}
                  label={`${item.studentName ?? learner.title} · ${FREE_TUITION_REASON_LABELS[item.reason]}`}
                >
                  {(control) => (
                    <NativeSelect
                      {...control}
                      {...form.register(`decisions.${item.id}`)}
                      className="w-full"
                      disabled={busy}
                    >
                      <NativeSelectOption value="">
                        Bu toplantıda karar verilmedi
                      </NativeSelectOption>
                      <NativeSelectOption value="accepted">Kabul</NativeSelectOption>
                      <NativeSelectOption value="reserve">Yedek</NativeSelectOption>
                      <NativeSelectOption value="rejected">Ret</NativeSelectOption>
                    </NativeSelect>
                  )}
                </FormField>
              ))
            )}
          </fieldset>
          <RootError message={errors.root?.server?.message} />
        </form>
      )}
    </Modal>
  )
}

function MebbisModal({ row, onClose }: { row: AwardRow; onClose: () => void }) {
  const recordMebbis = useRecordFreeTuitionMebbis()
  const [today] = useState(() => dayKey(Date.now()))
  const form = useForm<{ day: string }>({ defaultValues: { day: today } })
  const busy = recordMebbis.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async ({ day }) => {
    const outcome = await recordMebbis.submit(
      { awardId: row.id, version: row.version, body: { recordedDate: day } },
      { setError: (_name, error) => form.setError('day', error, { shouldFocus: true }) },
    )
    if (outcome.status === 'success') {
      notify.success("MEBBİS'e işlendiği kaydedildi.")
      onClose()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onClose()
  })
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="MEBBİS'e işlendi"
      description={`${row.name}. Bu gün bir kez işlenir; MEBBİS'e gönderim elle yapılır.`}
      footer={
        <ModalFooter busy={busy} form="ucretsiz-mebbis-formu" submit="Kaydet" onClose={onClose} />
      }
    >
      <form
        id="ucretsiz-mebbis-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField
          id="ucretsiz-mebbis-gun"
          label="MEBBİS'e işlendiği gün"
          error={form.formState.errors.day}
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('day', { required: 'Günü seçin.' })}
              type="date"
              min={row.acceptedDate}
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
      </form>
    </Modal>
  )
}

/** İade ödemesi (K-270): ayrılış iadesiyle aynı form; hesaplar yüklenince açılır. */
function RefundModal({ row, onClose }: { row: AwardRow; onClose: () => void }) {
  const accounts = useBankAccounts()
  if (accounts.isPending)
    return (
      <Modal open onOpenChange={(open) => (open ? undefined : onClose())} title="İadeyi öde">
        <SummaryLoading />
      </Modal>
    )
  return <RefundFormModal row={row} onClose={onClose} accounts={accounts.data?.data ?? []} />
}

function RefundFormModal({
  row,
  onClose,
  accounts,
}: {
  row: AwardRow
  onClose: () => void
  accounts: readonly { id: string; bankName: string; iban: string }[]
}) {
  const pay = usePayFreeTuitionRefund()
  const [today] = useState(() => dayKey(Date.now()))
  const [reauth, setReauth] = useState(false)
  const form = useForm<PayRefundInput, unknown, PayRefundOutput>({
    resolver: zodResolver(payRefundSchema),
    defaultValues: {
      paidDate: today,
      iban: '',
      accountHolder: '',
      bankAccountId: accounts[0]?.id ?? '',
    },
  })
  const busy = pay.isPending || form.formState.isSubmitting
  const errors = form.formState.errors
  async function send(values: PayRefundOutput) {
    const outcome = await pay.submit(
      { awardId: row.id, version: row.version, body: values },
      {
        setError: (name, error) => {
          if (
            name === 'iban' ||
            name === 'accountHolder' ||
            name === 'paidDate' ||
            name === 'bankAccountId'
          )
            form.setError(name, error)
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('İade ödendi olarak kaydedildi.')
      onClose()
    } else if (outcome.status === 'failed') {
      if (outcome.error.code === REAUTHENTICATION_CODE) setReauth(true)
      else if (outcome.error.code === 'version_conflict') onClose()
    }
  }
  const onSubmit = form.handleSubmit((values) => send(values))
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="İadeyi öde"
      description={`${row.name} · ${money(row.refundCents)}. Ödenen iade değiştirilemez; ödeme gününün gün sonuna iade ödemesi olarak girer.`}
      footer={
        <ModalFooter
          busy={busy}
          form="ucretsiz-iade-formu"
          submit="Ödendi olarak kaydet"
          onClose={onClose}
        />
      }
    >
      <form
        id="ucretsiz-iade-formu"
        noValidate
        onSubmit={(event) => void onSubmit(event)}
        className="grid gap-4"
      >
        <FormField id="ucretsiz-iade-tarih" label="Ödeme tarihi" error={errors.paidDate}>
          {(control) => (
            <Input
              {...control}
              {...form.register('paidDate')}
              type="date"
              min={row.acceptedDate}
              max={today}
              disabled={busy}
            />
          )}
        </FormField>
        <FormField
          id="ucretsiz-iade-hesap"
          label="Kurum banka hesabı"
          error={errors.bankAccountId}
          description={
            accounts.length === 0
              ? 'Tanımlı banka hesabı yok; Ayarlar’dan hesap ekleyin.'
              : 'İadenin çıktığı bildirilmiş hesap.'
          }
        >
          {(control) => (
            <NativeSelect
              {...control}
              {...form.register('bankAccountId')}
              className="w-full"
              disabled={busy}
            >
              <NativeSelectOption value="">Hesap seçin</NativeSelectOption>
              {accounts.map((account) => (
                <NativeSelectOption key={account.id} value={account.id}>
                  {bankAccountLabel(account)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="ucretsiz-iade-iban" label="IBAN" error={errors.iban}>
          {(control) => (
            <Input {...control} {...form.register('iban')} autoComplete="off" disabled={busy} />
          )}
        </FormField>
        <FormField
          id="ucretsiz-iade-sahip"
          label="Hesap sahibi"
          error={errors.accountHolder}
          description="Sözleşmedeki ödeyici olmalıdır."
        >
          {(control) => (
            <Input
              {...control}
              {...form.register('accountHolder')}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </FormField>
        <RootError message={errors.root?.server?.message} />
      </form>
      {reauth ? (
        <ReauthModal
          onCancel={() => setReauth(false)}
          onDone={() => {
            setReauth(false)
            void onSubmit()
          }}
        />
      ) : null}
    </Modal>
  )
}
