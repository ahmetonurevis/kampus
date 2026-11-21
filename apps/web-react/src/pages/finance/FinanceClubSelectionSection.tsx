import { zodResolver } from '@hookform/resolvers/zod'
import { useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useSearchParams } from 'react-router'
import {
  useAddWaitlistedMember,
  useArchiveClubSelectionPeriod,
  useClubSelectionPeriod,
  useClubSelectionPeriods,
  useClubSelectionPreview,
  useConfirmClubSelection,
  useCreateClubSelectionPeriod,
  useDrawClubSelection,
  useSetClubSelectionPreference,
  useUpdateClubSelectionPeriod,
  type ClubSelectionPeriodDetail,
  type ClubSelectionPeriodRow,
} from '@kampus/react-shared/use-finance-club-selection.ts'
import { useClubs } from '@kampus/react-shared/use-finance-clubs.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { ACTIONS_KEY } from '@/lib/list-view.ts'
import { notify } from '@/lib/notify.ts'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { FinanceStudentSearch } from './FinanceStudentSearch.tsx'
import {
  choicesFromSlots,
  choicesText,
  GRADE_OPTIONS,
  gradesText,
  periodCreateBody,
  periodDefaults,
  periodFormField,
  periodFormSchema,
  periodUpdateBody,
  phaseText,
  progressText,
  slotsFor,
  termText,
  toggled,
  waitlistStatusText,
  type PeriodFormValues,
} from './finance-club-selection-forms.ts'
import { scheduleText } from './finance-club-forms.ts'
import { dayText } from './finance-visitor-forms.ts'

const NO_SORT: readonly string[] = []
const CLUB_OPTIONS_QUERY = { page: 1, pageSize: 100 } as const
const VIEW_PARAM = 'kulup_sekme'
const VIEWS = [
  { value: 'kulupler', label: 'Kulüpler' },
  { value: 'tercih', label: 'Tercih dönemi' },
] as const
export type ClubView = (typeof VIEWS)[number]['value']

/** Kulüpler sekmesindeki alt görünüm (`?kulup_sekme=tercih`); varsayılan kulüp listesi. */
export function useClubView(): [ClubView, (next: ClubView) => void] {
  const [params, setParams] = useSearchParams()
  const requested = params.get(VIEW_PARAM)
  const view: ClubView = VIEWS.find((item) => item.value === requested)?.value ?? 'kulupler'
  const setView = (next: ClubView) =>
    setParams(
      (current) => {
        const copy = new URLSearchParams(current)
        if (next === 'kulupler') copy.delete(VIEW_PARAM)
        else copy.set(VIEW_PARAM, next)
        return copy
      },
      { replace: true },
    )
  return [view, setView]
}

export function ClubViewTabs({
  value,
  onChange,
}: {
  value: ClubView
  onChange: (next: ClubView) => void
}) {
  return <LineTabs label="Kulüp görünümü" value={value} options={VIEWS} onChange={onChange} />
}

type PeriodTableRow = {
  id: string
  row: ClubSelectionPeriodRow
  name: string
  term: string
  dates: string
  phase: string
  preferences: string
}

/**
 * Kulüp tercih dönemi (DOM-FIN-150; ON-169; IST-099): Finans "Kulüpler" sekmesinin "Tercih dönemi"
 * görünümü, yönetici ve ön büro. Dönem yönetimi, tercih durumu ve adına tercih, kura ve dağıtım
 * önizlemesi, onay ve yedek listesi (K-505…K-507). Onay kulüp üyeliklerini tek işlemde yazar;
 * yedekten ekleme elle yapılır.
 */
export function FinanceClubSelectionSection() {
  const list = useListState('kulup-tercih', { urlPrefix: 'tercih_' })
  const periods = useClubSelectionPeriods({ page: list.state.page, pageSize: list.state.pageSize })
  const panel = useDetailPanel('tercih_donemi')
  const [creating, setCreating] = useState(false)
  const rows = useMemo(
    () =>
      periods.data?.data.map((row): PeriodTableRow => ({
        id: row.id,
        row,
        name: row.name,
        term: termText(row),
        dates: `${dayText(row.openDate)} – ${dayText(row.closeDate)}`,
        phase: phaseText(row.phase),
        preferences: String(row.preferenceCount),
      })),
    [periods.data],
  )
  const columns = useMemo<DataColumn<PeriodTableRow>[]>(
    () => [
      { key: 'name', label: 'Dönem' },
      { key: 'term', label: 'Eğitim yılı' },
      { key: 'dates', label: 'Tercih tarihleri' },
      { key: 'phase', label: 'Durum' },
      { key: 'preferences', label: 'Tercih' },
      {
        key: ACTIONS_KEY,
        label: 'İşlemler',
        cell: (row) => (
          <Button
            className="min-h-11"
            variant="ghost"
            aria-label={`${row.name} dönemini aç`}
            onClick={() => panel.open(row.id)}
          >
            Aç
          </Button>
        ),
      },
    ],
    [panel],
  )
  return (
    <section
      aria-labelledby="kulup-tercih"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2">
        <div className="grid gap-1">
          <h2 id="kulup-tercih" className="text-lg font-semibold">
            Tercih dönemi
          </h2>
          <p className="text-sm text-muted-foreground">
            Öğrenciler sıralı tercih girer; dönem kapanınca kura bir kez çekilir, önizleme
            onaylanınca üyelikler yazılır. Yerleşemeyenler yedek listesinde bekler.
          </p>
        </div>
        <Button className="min-h-11" onClick={() => setCreating(true)}>
          Tercih dönemi ekle
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={periods.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        mobileColumns={['name', ACTIONS_KEY]}
        caption="Tercih dönemleri"
        empty="Henüz tercih dönemi yok."
        emptyFiltered="Bu aramayla eşleşen dönem yok."
        loading={periods.isPending}
        fetching={periods.isFetching && !periods.isPending}
        error={
          periods.error ? (
            <QueryError error={periods.error} onRetry={() => void periods.refetch()} />
          ) : undefined
        }
      />
      <SidePanel
        open={panel.selectedId !== ''}
        onOpenChange={(open) => (open ? undefined : panel.close())}
        title="Tercih dönemi"
      >
        {panel.selectedId ? (
          <PeriodPanel periodId={panel.selectedId} onClose={panel.close} />
        ) : null}
      </SidePanel>
      <Modal open={creating} onOpenChange={setCreating} title="Tercih dönemi ekle">
        {creating ? <PeriodForm onDone={() => setCreating(false)} /> : null}
      </Modal>
    </section>
  )
}

function PeriodPanel({ periodId, onClose }: { periodId: string; onClose: () => void }) {
  const period = useClubSelectionPeriod(periodId)
  if (period.error) return <QueryError error={period.error} onRetry={() => void period.refetch()} />
  const detail = period.data?.data
  if (!detail) return <SummaryLoading />
  return <PeriodDetails key={detail.version} detail={detail} onClose={onClose} />
}

function PeriodDetails({
  detail,
  onClose,
}: {
  detail: ClubSelectionPeriodDetail
  onClose: () => void
}) {
  const archive = useArchiveClubSelectionPeriod()
  const draw = useDrawClubSelection()
  const [editing, setEditing] = useState(false)
  const names = useMemo(() => new Map(detail.clubs.map((club) => [club.id, club.name])), [detail])
  const archivePeriod = async () => {
    const outcome = await archive.submit({ periodId: detail.id, version: detail.version })
    if (outcome.status !== 'success') return
    notify.success(`${detail.name} arşivlendi.`)
    onClose()
  }
  const drawLottery = async () => {
    const outcome = await draw.submit({ periodId: detail.id })
    if (outcome.status !== 'success') return
    notify.success('Kura çekildi; önizlemeyi inceleyip onaylayın.')
  }
  const editable =
    detail.phase === 'upcoming' || detail.phase === 'open' || detail.phase === 'closed'
  return (
    <div className="grid gap-5">
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-muted-foreground">Dönem</dt>
        <dd>{detail.name}</dd>
        <dt className="text-muted-foreground">Eğitim yılı</dt>
        <dd>{termText(detail)}</dd>
        <dt className="text-muted-foreground">Tercih tarihleri</dt>
        <dd>{`${dayText(detail.openDate)} – ${dayText(detail.closeDate)}`}</dd>
        <dt className="text-muted-foreground">Durum</dt>
        <dd>{phaseText(detail.phase)}</dd>
        <dt className="text-muted-foreground">Tercih ve atama</dt>
        <dd>{`En çok ${String(detail.maxChoices)} tercih · ${String(detail.seatsPerStudent)} kulüp atanır`}</dd>
        <dt className="text-muted-foreground">Sınıflar</dt>
        <dd>{gradesText(detail.gradeLevels)}</dd>
        <dt className="text-muted-foreground">Tercih durumu</dt>
        <dd>{progressText(detail.preferenceCount, detail.eligibleStudentCount)}</dd>
        {detail.seed === null ? null : (
          <>
            <dt className="text-muted-foreground">Kura tohumu</dt>
            <dd className="font-mono text-xs break-all">{detail.seed}</dd>
          </>
        )}
      </dl>
      <section aria-labelledby="tercih-kulupler" className="grid gap-2">
        <h3 id="tercih-kulupler" className="font-semibold">
          Kulüpler
        </h3>
        <ul aria-label="Dönemin kulüpleri" className="grid gap-1 text-sm">
          {detail.clubs.map((club) => (
            <li key={club.id} className="flex flex-wrap justify-between gap-2">
              <span>{`${club.name} · ${scheduleText(club)}`}</span>
              <span>{`${String(club.freeSeats)} boş yer (${String(club.memberCount)}/${String(club.capacity)})`}</span>
            </li>
          ))}
        </ul>
      </section>
      {detail.phase === 'open' ? <PreferenceForm detail={detail} /> : null}
      <section aria-labelledby="tercih-liste" className="grid gap-2">
        <h3 id="tercih-liste" className="font-semibold">
          Tercihler
        </h3>
        {detail.preferences.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz tercih yok.</p>
        ) : (
          <ul aria-label="Öğrenci tercihleri" className="grid gap-1 text-sm">
            {detail.preferences.map((preference) => (
              <li key={preference.studentId} className="grid gap-0.5 border-b py-1">
                <span className="font-medium">
                  {preference.studentName}
                  {preference.eligible ? '' : ' · dağıtıma girmez'}
                </span>
                <span>{choicesText(preference.choices, names)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {detail.phase === 'closed' ? (
        <div>
          <Button
            className="min-h-11"
            disabled={draw.isPending}
            aria-busy={draw.isPending || undefined}
            onClick={() => void drawLottery()}
          >
            Kurayı çek
          </Button>
        </div>
      ) : null}
      {detail.phase === 'drawn' ? <AllocationPreview periodId={detail.id} /> : null}
      {detail.result === null ? null : <ResultView result={detail.result} />}
      <div className="flex flex-wrap gap-2">
        {editable ? (
          <Button variant="secondary" className="min-h-11" onClick={() => setEditing(true)}>
            Dönemi düzenle
          </Button>
        ) : null}
        <Button
          variant="ghost"
          className="min-h-11"
          disabled={archive.isPending}
          onClick={() => void archivePeriod()}
        >
          Dönemi arşivle
        </Button>
      </div>
      <Modal open={editing} onOpenChange={setEditing} title="Tercih dönemini düzenle">
        {editing ? <PeriodForm period={detail} onDone={() => setEditing(false)} /> : null}
      </Modal>
    </div>
  )
}

function PreferenceForm({ detail }: { detail: ClubSelectionPeriodDetail }) {
  const save = useSetClubSelectionPreference()
  const [studentId, setStudentId] = useState('')
  const [slots, setSlots] = useState(() => slotsFor(detail.maxChoices))
  const [error, setError] = useState<string | undefined>()
  const busy = save.isPending
  const pick = (next: string) => {
    setStudentId(next)
    setError(undefined)
    const existing = detail.preferences.find((row) => row.studentId === next)
    setSlots(slotsFor(detail.maxChoices, existing?.choices))
  }
  const submit = async () => {
    if (studentId === '') {
      setError('Öğrenciyi seçin.')
      return
    }
    const choices = choicesFromSlots(slots)
    const outcome = await save.submit(
      { periodId: detail.id, body: { studentId, choices } },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') return
    notify.success(choices.length === 0 ? 'Tercih geri çekildi.' : 'Tercih kaydedildi.')
    setError(undefined)
  }
  return (
    <form
      noValidate
      aria-label="Adına tercih gir"
      className="grid gap-3 rounded-card border p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <h3 className="font-semibold">Adına tercih gir</h3>
      <FinanceStudentSearch
        label="Tercih edecek öğrenci"
        value={studentId}
        onChange={pick}
        error={undefined}
        disabled={busy}
      />
      {slots
        .map((value, index) => ({ value, index, rank: String(index + 1) }))
        .map(({ value, index, rank }) => (
          <FormField key={rank} id={`tercih-${rank}`} label={`${rank}. tercih`}>
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={value}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value
                  setSlots((current) => current.map((slot, at) => (at === index ? next : slot)))
                }}
              >
                <NativeSelectOption value="">Seçilmedi</NativeSelectOption>
                {detail.clubs.map((club) => (
                  <NativeSelectOption key={club.id} value={club.id}>
                    {club.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ))}
      <p className="text-sm text-muted-foreground">
        Bütün tercihler boş bırakılırsa öğrencinin tercihi geri çekilir.
      </p>
      <RootError message={error} />
      <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
        Tercihi kaydet
      </Button>
    </form>
  )
}

function AllocationPreview({ periodId }: { periodId: string }) {
  const preview = useClubSelectionPreview(periodId)
  const confirm = useConfirmClubSelection()
  const [error, setError] = useState<string | undefined>()
  if (preview.error)
    return <QueryError error={preview.error} onRetry={() => void preview.refetch()} />
  const data = preview.data?.data
  if (!data) return <SummaryLoading />
  const unplaced = data.students.filter((row) => row.assigned < row.wanted)
  const submit = async () => {
    const outcome = await confirm.submit(
      { periodId, digest: data.digest },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status !== 'success') {
      void preview.refetch()
      return
    }
    notify.success('Dağıtım onaylandı; üyelikler yazıldı.')
  }
  return (
    <section aria-labelledby="tercih-onizleme" className="grid gap-3 rounded-card border p-3">
      <h3 id="tercih-onizleme" className="font-semibold">
        Dağıtım önizlemesi
      </h3>
      <ul aria-label="Kulüp doluluğu" className="grid gap-1 text-sm">
        {data.clubs.map((club) => (
          <li key={club.clubId} className="flex flex-wrap justify-between gap-2">
            <span>{club.clubName}</span>
            <span>{`${String(club.assigned)} atama · ${String(club.seatsAfter)} boş · ${String(club.waitlisted)} yedek`}</span>
          </li>
        ))}
      </ul>
      <h4 className="text-sm font-semibold">Atamalar</h4>
      {data.assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Atanacak öğrenci yok.</p>
      ) : (
        <ul aria-label="Önerilen atamalar" className="grid gap-1 text-sm">
          {data.assignments.map((row) => (
            <li key={`${row.studentId}-${row.clubId}`}>
              {`${row.studentName} → ${row.clubName} (${String(row.rank)}. tercih)`}
            </li>
          ))}
        </ul>
      )}
      <h4 className="text-sm font-semibold">Yedek listesi</h4>
      {data.waitlist.length === 0 ? (
        <p className="text-sm text-muted-foreground">Herkes yerleşti.</p>
      ) : (
        <ul aria-label="Önizleme yedek listesi" className="grid gap-1 text-sm">
          {data.waitlist.map((row) => (
            <li key={`${row.clubId}-${row.studentId}`}>
              {`${row.clubName} · ${String(row.position)}. yedek: ${row.studentName}`}
            </li>
          ))}
        </ul>
      )}
      {unplaced.length > 0 ? (
        <p className="text-sm">{`${String(unplaced.length)} öğrenci istediği sayıda kulübe yerleşemedi.`}</p>
      ) : null}
      <RootError message={error} />
      <div>
        <Button
          className="min-h-11"
          disabled={confirm.isPending}
          aria-busy={confirm.isPending || undefined}
          onClick={() => void submit()}
        >
          Dağıtımı onayla
        </Button>
      </div>
    </section>
  )
}

function ResultView({ result }: { result: NonNullable<ClubSelectionPeriodDetail['result']> }) {
  const add = useAddWaitlistedMember()
  const addSuggested = async (clubId: string, studentId: string, studentName: string) => {
    const outcome = await add.submit({ clubId, studentId })
    if (outcome.status !== 'success') return
    notify.success(`${studentName} kulübe eklendi.`)
  }
  return (
    <section aria-labelledby="tercih-sonuc" className="grid gap-3">
      <h3 id="tercih-sonuc" className="font-semibold">
        Dağıtım sonucu
      </h3>
      <p className="text-sm">{`${String(result.assignedCount)} atama · ${String(result.waitlistedStudentCount)} öğrenci yedekte`}</p>
      {result.clubs.map((club) => (
        <div key={club.clubId} className="grid gap-1 border-b pb-2 text-sm">
          <h4 className="font-medium">{club.clubName}</h4>
          <p>
            {club.assigned.length === 0
              ? 'Atanan yok.'
              : `Atananlar: ${club.assigned.map((row) => row.studentName).join(', ')}`}
          </p>
          {club.waitlist.length === 0 ? null : (
            <ol aria-label={`${club.clubName} yedek listesi`} className="grid gap-0.5">
              {club.waitlist.map((row) => (
                <li key={row.studentId}>
                  {`${String(row.position)}. ${row.studentName} · ${waitlistStatusText(row.status)}`}
                </li>
              ))}
            </ol>
          )}
          {club.suggestedStudentId === null ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <span>{`Boş yer var; önerilen yedek: ${club.suggestedStudentName ?? '—'}`}</span>
              <Button
                variant="secondary"
                className="min-h-11"
                disabled={add.isPending}
                aria-label={`${club.suggestedStudentName ?? 'Yedek öğrenciyi'} ${club.clubName} kulübüne ekle`}
                onClick={() =>
                  void addSuggested(
                    club.clubId,
                    club.suggestedStudentId ?? '',
                    club.suggestedStudentName ?? '',
                  )
                }
              >
                Kulübe ekle
              </Button>
            </div>
          )}
        </div>
      ))}
    </section>
  )
}

function PeriodForm({
  period,
  onDone,
}: {
  period?: ClubSelectionPeriodDetail
  onDone: () => void
}) {
  const clubs = useClubs(CLUB_OPTIONS_QUERY)
  const create = useCreateClubSelectionPeriod()
  const update = useUpdateClubSelectionPeriod()
  const today = dayKey()
  const form = useForm<PeriodFormValues>({
    resolver: zodResolver(periodFormSchema),
    defaultValues: periodDefaults(today, period),
  })
  const errors = form.formState.errors
  const busy = create.isPending || update.isPending || form.formState.isSubmitting
  const clubIds = useWatch({ control: form.control, name: 'clubIds' })
  const gradeLevels = useWatch({ control: form.control, name: 'gradeLevels' })
  const years = useMemo(() => {
    const base = Number(periodDefaults(today).academicYear)
    const own = period?.academicYear
    return [...new Set([base - 1, base, base + 1, ...(own === undefined ? [] : [own])])].sort()
  }, [today, period])
  const setServerError = (name: string, error: { type: string; message: string }) => {
    const field = periodFormField(name)
    if (field) form.setError(field, error, { shouldFocus: true })
    else form.setError('root.server', error)
  }
  const onSubmit = form.handleSubmit(async (values) => {
    if (period === undefined) {
      const outcome = await create.submit(periodCreateBody(values), { setError: setServerError })
      if (outcome.status !== 'success') return
      notify.success(`${outcome.data.data.name} açıldı.`)
      onDone()
      return
    }
    const body = periodUpdateBody(values, period)
    if (body === null) {
      onDone()
      return
    }
    const outcome = await update.submit(
      { periodId: period.id, version: period.version, body },
      { setError: setServerError },
    )
    if (outcome.status !== 'success') return
    notify.success(`${outcome.data.data.name} güncellendi.`)
    onDone()
  })
  const label = period === undefined ? 'Tercih dönemi ekle' : 'Tercih dönemini düzenle'
  return (
    <form
      noValidate
      aria-label={label}
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(event) => void onSubmit(event)}
    >
      <div className="sm:col-span-2">
        <FormField id="tercih-ad" label="Dönem adı" error={errors.name}>
          {(control) => <Input {...control} {...form.register('name')} disabled={busy} />}
        </FormField>
      </div>
      <FormField id="tercih-yil" label="Eğitim yılı" error={errors.academicYear}>
        {(control) => (
          <NativeSelect
            {...control}
            {...form.register('academicYear')}
            className="w-full"
            disabled={busy}
          >
            {years.map((year) => (
              <NativeSelectOption key={year} value={String(year)}>
                {`${String(year)}–${String(year + 1)}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      <FormField id="tercih-donem" label="Eğitim dönemi" error={errors.term}>
        {(control) => (
          <NativeSelect {...control} {...form.register('term')} className="w-full" disabled={busy}>
            <NativeSelectOption value="">Bütün yıl</NativeSelectOption>
            <NativeSelectOption value="1">1. dönem</NativeSelectOption>
            <NativeSelectOption value="2">2. dönem</NativeSelectOption>
          </NativeSelect>
        )}
      </FormField>
      <FormField id="tercih-acilis" label="Açılış günü" error={errors.openDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('openDate')} disabled={busy} />
        )}
      </FormField>
      <FormField id="tercih-kapanis" label="Kapanış günü" error={errors.closeDate}>
        {(control) => (
          <Input {...control} type="date" {...form.register('closeDate')} disabled={busy} />
        )}
      </FormField>
      <fieldset
        className="grid gap-2 sm:col-span-2"
        aria-describedby={errors.clubIds ? 'tercih-kulupler-hata' : undefined}
      >
        <legend className="text-sm font-medium">Katılan kulüpler</legend>
        {clubs.isPending ? <p className="text-sm">Kulüpler yükleniyor…</p> : null}
        {clubs.data?.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Önce kulüp ekleyin.</p>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {(clubs.data?.data ?? []).map((club) => (
            <label key={club.id} className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={clubIds.includes(club.id)}
                disabled={busy}
                onCheckedChange={(checked) =>
                  form.setValue('clubIds', toggled(clubIds, club.id, checked === true), {
                    shouldDirty: true,
                    shouldValidate: form.formState.isSubmitted,
                  })
                }
              />
              {`${club.name} · ${String(club.capacity)} kişi`}
            </label>
          ))}
        </div>
        {errors.clubIds ? (
          <p id="tercih-kulupler-hata" role="alert" className="text-sm text-destructive">
            {errors.clubIds.message}
          </p>
        ) : null}
      </fieldset>
      <FormField id="tercih-sayisi" label="En çok tercih" error={errors.maxChoices}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('maxChoices')}
            disabled={busy}
          />
        )}
      </FormField>
      <FormField id="tercih-atama" label="Atanacak kulüp sayısı" error={errors.seatsPerStudent}>
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            {...form.register('seatsPerStudent')}
            disabled={busy}
          />
        )}
      </FormField>
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Sınıf düzeyi (boşsa bütün öğrenciler)</legend>
        <div className="flex flex-wrap gap-3">
          {GRADE_OPTIONS.map((grade) => (
            <label key={grade} className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={gradeLevels.includes(String(grade))}
                disabled={busy}
                onCheckedChange={(checked) =>
                  form.setValue(
                    'gradeLevels',
                    toggled(gradeLevels, String(grade), checked === true),
                    {
                      shouldDirty: true,
                    },
                  )
                }
              />
              {`${String(grade)}. sınıf`}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <RootError message={errors.root?.server?.message} />
        <Button type="submit" className="min-h-11" disabled={busy} aria-busy={busy || undefined}>
          {period === undefined ? 'Dönemi kaydet' : 'Değişiklikleri kaydet'}
        </Button>
      </div>
    </form>
  )
}
