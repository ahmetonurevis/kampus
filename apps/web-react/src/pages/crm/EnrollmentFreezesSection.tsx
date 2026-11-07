import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import {
  FREEZE_PHASE_LABELS,
  FREEZE_REASON_LABELS,
  FREEZE_REASONS,
  FREEZE_REJECTION_CATEGORIES,
  FREEZE_REJECTION_CATEGORY_LABELS,
  freezeFormSchema,
  rejectFreezeSchema,
  type FreezeFormValues,
  type RejectFreezeInput,
} from '@kampus/school-core/lib/enrollment-freezes.ts'
import { ENROLLMENT_STATUS_LABELS } from '@kampus/school-core/lib/enrollment-status.ts'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  useApproveEnrollmentFreeze,
  useEnrollmentFreezes,
  useRejectEnrollmentFreeze,
  useRequestEnrollmentFreeze,
  useReturnEnrollmentFreeze,
  type EnrollmentFreeze,
} from '@kampus/react-shared/use-enrollment-freezes.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { paymentPlanHref } from './enrollment-form.ts'

type Row = EnrollmentFreeze & { name: string; reasonLabel: string; phaseLabel: string }

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['name', 'returnDate', 'phaseLabel']
const REQUEST_FORM = 'dondurma-formu'
const REJECTION_FORM = 'dondurma-ret-formu'

const shortDate = (day: string) => dateLabel(day, { year: 'numeric' })

/**
 * Kayıt dondurma (DOM-DIL-052, DOM-KAY-024, -026; IST-084): yalnız dil okulunda görünür. Ön büro ve
 * yönetici talep açar ve dönüşü işler, kararı yönetici verir. Neden yalnız kategoridir, serbest metin
 * alanı yoktur (K-20); ret nedeni kapalı listeden seçilir (K-29). Kur ortası belge alındı beyanı ister; dosya alınmaz. Taksit planı burada değişmez, MEBBİS'e bir şey işlenmez (H-24, doğrulanmalı).
 */
export function EnrollmentFreezesSection() {
  const { session } = useAuth()
  const canDecide = session?.role === 'yonetici'
  const list = useListState('dondurmalar')
  const search = useDebouncedValue(list.state.query)
  const freezes = useEnrollmentFreezes({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(search.trim().length >= 2 ? { q: search.trim() } : {}),
  })
  const [requesting, setRequesting] = useState(false)
  const [viewing, setViewing] = useState<Row | null>(null)
  const [deciding, setDeciding] = useState<{ row: Row; approve: boolean } | null>(null)
  const [returning, setReturning] = useState<Row | null>(null)

  const rows = useMemo(
    () =>
      freezes.data?.data.map((item): Row => ({
        ...item,
        name: item.studentName ?? '—',
        reasonLabel: FREEZE_REASON_LABELS[item.reason],
        phaseLabel: FREEZE_PHASE_LABELS[item.phase],
      })),
    [freezes.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Kursiyer' },
      { key: 'reasonLabel', label: 'Neden' },
      { key: 'startDate', label: 'Başlangıç', cell: (row) => shortDate(row.startDate) },
      { key: 'returnDate', label: 'Planlanan dönüş', cell: (row) => shortDate(row.returnDate) },
      {
        key: 'phaseLabel',
        label: 'Durum',
        cell: (row) => <StatusBadge text={row.phaseLabel} />,
      },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <span className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              aria-label={`${row.name} dondurma ayrıntısı`}
              onClick={() => setViewing(row)}
            >
              Ayrıntı
            </Button>
            {canDecide && row.status === 'requested' ? (
              <>
                <Button
                  size="sm"
                  aria-label={`${row.name} dondurmasını onayla`}
                  onClick={() => setDeciding({ row, approve: true })}
                >
                  Onayla
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`${row.name} dondurmasını reddet`}
                  onClick={() => setDeciding({ row, approve: false })}
                >
                  Reddet
                </Button>
              </>
            ) : null}
            {row.status === 'approved' ? (
              <Button
                size="sm"
                variant="secondary"
                aria-label={`${row.name} dönüşünü işle`}
                onClick={() => setReturning(row)}
              >
                Dönüşü işle
              </Button>
            ) : null}
          </span>
        ),
      },
    ],
    [canDecide],
  )

  const total = freezes.data?.meta.total ?? 0
  return (
    <section
      aria-labelledby="kayit-dondurma"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div>
          <h2 id="kayit-dondurma" className="text-lg font-semibold">
            Kayıt dondurma
          </h2>
          <p className="text-sm text-muted-foreground">
            {total} kayıt · Bir kayıtta toplam dondurma 6 ayı geçemez. Bu işlem MEBBİS kaydını
            değiştirmez.
          </p>
        </div>
        <Button onClick={() => setRequesting(true)}>Dondurma talebi aç</Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={total}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Kayıt dondurma talepleri"
        loading={freezes.isPending}
        fetching={freezes.isFetching && !freezes.isPending}
        error={
          freezes.error ? (
            <QueryError error={freezes.error} onRetry={() => void freezes.refetch()} />
          ) : undefined
        }
      />
      {requesting ? <RequestModal onClose={() => setRequesting(false)} /> : null}
      {viewing ? <DetailModal row={viewing} onClose={() => setViewing(null)} /> : null}
      {deciding?.approve ? (
        <ApprovalModal row={deciding.row} onClose={() => setDeciding(null)} />
      ) : null}
      {deciding && !deciding.approve ? (
        <RejectionModal row={deciding.row} onClose={() => setDeciding(null)} />
      ) : null}
      {returning ? <ReturnModal row={returning} onClose={() => setReturning(null)} /> : null}
    </section>
  )
}

function RequestModal({ onClose }: { onClose: () => void }) {
  const students = useCoreAll('students')
  const request = useRequestEnrollmentFreeze()
  const today = dayKey()
  const form = useForm<FreezeFormValues>({
    resolver: zodResolver(freezeFormSchema),
    defaultValues: {
      studentId: '',
      reason: 'documented',
      startDate: today,
      returnDate: '',
      documentReceived: false,
    },
  })
  const errors = form.formState.errors
  const busy = request.isPending || form.formState.isSubmitting
  const fields = {
    setError: (name: string, error: { type: string; message: string }) => {
      if (
        name === 'studentId' ||
        name === 'startDate' ||
        name === 'returnDate' ||
        name === 'documentReceived'
      )
        form.setError(name, error)
      else form.setError('root.server', error)
    },
  }
  const submit = form.handleSubmit(async (values) => {
    const outcome = await request.submit(values, fields)
    if (outcome.status === 'success') {
      notify.success('Dondurma talebi açıldı.')
      onClose()
    }
  })
  const options = (students.data ?? [])
    .filter((row) => row.record.isActive !== false)
    .map((row) => ({ id: row.id, name: row.record.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))

  return (
    <Modal
      open
      size="wide"
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Dondurma talebi aç"
      description="Dondurma kur sınırında başlar. Kur ortasında yalnız belgeli nedenle olur."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button type="submit" form={REQUEST_FORM} disabled={busy} aria-busy={busy || undefined}>
            Talebi aç
          </Button>
        </>
      }
    >
      {students.error ? (
        <QueryError error={students.error} onRetry={() => void students.refetch()} />
      ) : !students.data ? (
        <SummaryLoading />
      ) : (
        <form
          id={REQUEST_FORM}
          noValidate
          onSubmit={(event) => void submit(event)}
          className="grid grid-cols-2 gap-4 max-[650px]:grid-cols-1"
        >
          <FormField id="dondurma-kursiyer" label="Kursiyer" error={errors.studentId}>
            {(control) => (
              <NativeSelect {...control} {...form.register('studentId')}>
                <NativeSelectOption value="">Kursiyer seçin</NativeSelectOption>
                {options.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {option.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField
            id="dondurma-neden"
            label="Dondurma nedeni"
            description="Sağlık nedeninde Belgeli neden seçilir; tanı ya da sağlık ayrıntısı istenmez."
            error={errors.reason}
          >
            {(control) => (
              <NativeSelect {...control} {...form.register('reason')}>
                {FREEZE_REASONS.map((reason) => (
                  <NativeSelectOption key={reason} value={reason}>
                    {FREEZE_REASON_LABELS[reason]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField id="dondurma-baslangic" label="Başlangıç" error={errors.startDate}>
            {(control) => (
              <Input {...control} {...form.register('startDate')} type="date" min={today} />
            )}
          </FormField>
          <FormField id="dondurma-donus" label="Planlanan dönüş" error={errors.returnDate}>
            {(control) => (
              <Input {...control} {...form.register('returnDate')} type="date" min={today} />
            )}
          </FormField>
          <div className="col-span-full grid gap-1 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                {...form.register('documentReceived')}
                aria-invalid={Boolean(errors.documentReceived)}
                className="size-4"
              />
              Belge alındı (kur ortası dondurmada zorunlu; dosya yüklenmez)
            </label>
            {errors.documentReceived?.message ? (
              <p role="alert" className="text-danger">
                {errors.documentReceived.message}
              </p>
            ) : null}
          </div>
          {errors.root?.server?.message ? (
            <p role="alert" className="col-span-full text-sm text-danger">
              {errors.root.server.message}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  )
}

function InstallmentNotice({ row }: { row: Row }) {
  const { session } = useAuth()
  const href = paymentPlanHref(session?.role)
  if (row.openInstallmentsDuring === 0) return null
  return (
    <p role="note" className="rounded-md border bg-warning-soft p-3 text-sm">
      Bu aralıkta vadesi gelen {row.openInstallmentsDuring} açık taksit var. Taksit planı
      kendiliğinden değişmez; erteleme ek protokolle yapılır ve kursiyere ya da veliye onaylatılır.
      {href ? (
        <>
          {' '}
          <Link className="underline" to={href}>
            Ödeme planına git
          </Link>
        </>
      ) : null}
    </p>
  )
}

function DetailModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const lines: readonly (readonly [string, string])[] = [
    [
      'Kayıt durumu',
      row.phase === 'frozen' || row.phase === 'overdue'
        ? ENROLLMENT_STATUS_LABELS.frozen
        : ENROLLMENT_STATUS_LABELS.active,
    ],
    ['Neden', row.reasonLabel],
    ['Başlangıç', shortDate(row.startDate)],
    ['Planlanan dönüş', shortDate(row.returnDate)],
    ...(row.endedDate ? ([['Bitiş', shortDate(row.endedDate)]] as const) : []),
    ['Kur ortası', row.midCourse ? 'Evet' : 'Hayır'],
    ['Belge', row.documentReceived ? 'Alındı' : 'Yok'],
    ...(row.rejectionCategory
      ? ([['Ret nedeni', FREEZE_REJECTION_CATEGORY_LABELS[row.rejectionCategory]]] as const)
      : []),
    ['Gruplar', row.groups.map((group) => group.name).join(', ') || 'Grup yok'],
  ]
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Dondurma ayrıntısı"
      description={`${row.name} · ${row.phaseLabel}`}
    >
      <dl className="grid gap-1 text-sm">
        {lines.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b py-1.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-3">
        <InstallmentNotice row={row} />
        {row.needsPlacement ? (
          <p role="note" className="rounded-md border bg-warning-soft p-3 text-sm">
            Eski grup uygun olmadığı için kursiyerin yeni gruba yerleştirilmesi gerekir.
          </p>
        ) : null}
        {row.placementRenewalRequired ? (
          <p role="note" className="rounded-md border bg-warning-soft p-3 text-sm">
            Dondurma 90 günü aştı; dönüşte seviye tespiti yenilenir.
          </p>
        ) : null}
      </div>
    </Modal>
  )
}

function ApprovalModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const command = useApproveEnrollmentFreeze()
  const busy = command.isPending
  async function confirm() {
    const outcome = await command.submit({ freezeId: row.id, version: row.version })
    if (outcome.status === 'success') notify.success('Dondurma onaylandı.')
    if (outcome.status !== 'busy') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Dondurmayı onayla"
      description={`${row.name} · ${shortDate(row.startDate)} – ${shortDate(row.returnDate)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
            Onayla
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-sm">
          Kur ortası ve süre koşulları onay anındaki bilgiyle yeniden denetlenir. Karar için gerekçe
          yazılmaz; sağlık ayrıntısı kaydedilmez.
        </p>
        {row.groups.length > 1 ? (
          <p role="note" className="rounded-md border bg-warning-soft p-3 text-sm">
            Kursiyerin birden çok programda kaydı var. Onay bütün gruplarını dondurur:{' '}
            {row.groups.map((group) => group.name).join(', ')}.
          </p>
        ) : null}
        <InstallmentNotice row={row} />
      </div>
    </Modal>
  )
}

function RejectionModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const command = useRejectEnrollmentFreeze()
  // Varsayılan seçenek yok: ret nedeni yöneticinin bilinçli seçimidir (K-29).
  const form = useForm<RejectFreezeInput>({ resolver: zodResolver(rejectFreezeSchema) })
  const busy = command.isPending || form.formState.isSubmitting
  const submit = form.handleSubmit(async ({ rejectionCategory }) => {
    const outcome = await command.submit(
      { freezeId: row.id, version: row.version, rejectionCategory },
      {
        setError: (name: string, error: { type: string; message: string }) => {
          form.setError(name === 'rejectionCategory' ? name : 'root.server', error)
        },
      },
    )
    if (outcome.status === 'success') notify.success('Dondurma reddedildi.')
    // 409: talep karara bağlanmış ya da değişmiş, liste tazelendi; eski sürümle kalınmaz.
    if (
      outcome.status === 'success' ||
      (outcome.status === 'failed' && outcome.error.status === 409)
    )
      onClose()
  })
  const errors = form.formState.errors
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Dondurmayı reddet"
      description={`${row.name} · ${shortDate(row.startDate)} – ${shortDate(row.returnDate)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button
            type="submit"
            form={REJECTION_FORM}
            variant="destructive"
            disabled={busy}
            aria-busy={busy || undefined}
          >
            Reddet
          </Button>
        </>
      }
    >
      <form
        id={REJECTION_FORM}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="grid gap-3"
      >
        <p className="text-sm">
          Talep kapanır, kursiyerin kaydı değişmez. Seçilen neden talep edene görünür; gerekçe
          yazılmaz, sağlık ayrıntısı kaydedilmez.
        </p>
        <FormField id="dondurma-ret-nedeni" label="Ret nedeni" error={errors.rejectionCategory}>
          {(control) => (
            <NativeSelect {...control} {...form.register('rejectionCategory')}>
              <NativeSelectOption value="">Ret nedeni seçin</NativeSelectOption>
              {FREEZE_REJECTION_CATEGORIES.map((category) => (
                <NativeSelectOption key={category} value={category}>
                  {FREEZE_REJECTION_CATEGORY_LABELS[category]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {errors.root?.server?.message ? (
          <p role="alert" className="text-sm text-danger">
            {errors.root.server.message}
          </p>
        ) : null}
      </form>
    </Modal>
  )
}

function ReturnModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const command = useReturnEnrollmentFreeze()
  const busy = command.isPending
  async function confirm() {
    const outcome = await command.submit({ freezeId: row.id, version: row.version })
    if (outcome.status === 'success') {
      const { needsPlacement } = outcome.data.data
      notify.success(
        needsPlacement
          ? 'Dönüş işlendi. Kursiyeri yeni gruba yerleştirin.'
          : 'Dönüş işlendi. Kursiyer yeniden aktif.',
      )
    }
    if (outcome.status !== 'busy') onClose()
  }
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Dönüşü işle"
      description={`${row.name} · Planlanan dönüş ${shortDate(row.returnDate)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button disabled={busy} aria-busy={busy || undefined} onClick={() => void confirm()}>
            Dönüşü işle
          </Button>
        </>
      }
    >
      <p className="text-sm">
        {row.startedAt === null
          ? 'Dondurma henüz başlamadı. Kayıt kapanır, kursiyerin grubu değişmez.'
          : 'Kayıt yeniden aktif olur. Aynı grup garanti edilmez: yalnız henüz başlamamış ve boş yeri olan gruba geri döner, öteki durumda yeni gruba yerleştirilir.'}
      </p>
    </Modal>
  )
}
