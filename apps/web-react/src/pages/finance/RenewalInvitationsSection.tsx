import { useMemo, useState } from 'react'
import {
  useAllRenewalInvitations,
  useOpenRenewalInvitations,
  useRenewalInvitations,
  type RenewalInvitationListQuery,
} from '@kampus/react-shared/use-finance-renewals.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  invitableStudentIds,
  RENEWAL_INVITATION_MAX_STUDENTS,
  RENEWAL_INVITATION_STATUS_LABELS,
  RENEWAL_INVITATION_STATUSES,
  type RenewalInvitationStatus,
} from '@kampus/school-core/lib/renewal-invitations.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import type { BadgeTone } from '@/lib/badge-tone.ts'
import type { FilterField } from '@/lib/list-query.ts'
import { notify } from '@/lib/notify.ts'

/**
 * Yenileme daveti, personel bölümü (K-10; DOM-KAY-027; IST-100): hedef yılın davet listesi, durum
 * süzgeci ve seçili öğrencilere davet açma. Velinin yanıtı niyet beyanıdır; plan ayrı işlemdir.
 */

type InvitationRow = {
  id: string
  studentName: string
  className: string
  status: RenewalInvitationStatus
  response: string | null
  note: string
  respondedLabel: string
}

export const INVITATION_STATUS_TONES = {
  pending: 'amber',
  will_renew: 'green',
  will_not_renew: 'red',
  planned: 'purple',
} as const satisfies Record<RenewalInvitationStatus, BadgeTone>

const NO_SORT: readonly string[] = []
const MOBILE_COLUMNS = ['status'] as const
const STATUS_FIELD: FilterField = {
  key: 'status',
  label: 'Durum',
  options: RENEWAL_INVITATION_STATUSES.map((status) => ({
    value: status,
    label: RENEWAL_INVITATION_STATUS_LABELS[status],
  })),
}
const isStatus = (value: unknown): value is RenewalInvitationStatus =>
  RENEWAL_INVITATION_STATUSES.some((status) => status === value)
const periodOf = (year: number) => `${String(year)}–${String(year + 1)}`

export function RenewalInvitationsSection({ academicYear }: { academicYear: number }) {
  const list = useListState('yenileme-davetleri', { urlPrefix: 'davet-' })
  const search = useDebouncedValue(list.state.query.trim())
  const status = list.state.filters.status
  const query: RenewalInvitationListQuery = {
    page: list.state.page,
    pageSize: list.state.pageSize,
    academicYear,
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isStatus(status) ? { status } : {}),
  }
  const invitations = useRenewalInvitations(query)
  const [opening, setOpening] = useState(false)
  const columns = useMemo<DataColumn<InvitationRow>[]>(
    () => [
      { key: 'studentName', label: 'Öğrenci' },
      { key: 'className', label: 'Sınıf' },
      {
        key: 'status',
        label: 'Durum',
        cell: (row) => (
          <StatusBadge
            text={RENEWAL_INVITATION_STATUS_LABELS[row.status]}
            tone={INVITATION_STATUS_TONES[row.status]}
          />
        ),
      },
      {
        key: 'response',
        label: 'Veli yanıtı',
        cell: (row) =>
          row.response === 'will_renew' || row.response === 'will_not_renew'
            ? RENEWAL_INVITATION_STATUS_LABELS[row.response]
            : '—',
      },
      { key: 'note', label: 'Veli notu' },
      { key: 'respondedLabel', label: 'Yanıt tarihi' },
    ],
    [],
  )
  const rows = useMemo(
    () =>
      invitations.data?.data.map((item) => ({
        id: item.id,
        studentName: item.studentName ?? '—',
        className: item.className ?? '—',
        status: item.status,
        response: item.response,
        note: item.note ?? '—',
        respondedLabel: item.respondedAt ? dateLabel(item.respondedAt, { year: 'numeric' }) : '—',
      })),
    [invitations.data],
  )
  return (
    <section
      aria-labelledby="yenileme-davetleri"
      className="panel mt-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-start justify-between gap-3 px-6 pt-6 pb-2 max-[650px]:px-4">
        <div className="min-w-0">
          <h2 id="yenileme-davetleri" className="text-lg font-semibold">
            Yenileme davetleri
          </h2>
          <p className="text-sm text-muted-foreground">
            {periodOf(academicYear)} · Velinin yanıtı niyet beyanıdır; "Yenilemeyecek" planı
            engellemez, plan formunda uyarır.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setOpening(true)}>
          <Icon name="Send" size={17} aria-hidden="true" />
          Davet aç
        </Button>
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={invitations.data?.meta.total ?? 0}
        sortable={NO_SORT}
        filters={[STATUS_FIELD]}
        columns={columns}
        mobileColumns={MOBILE_COLUMNS}
        caption="Yenileme davetleri"
        empty="Bu yıl için henüz davet açılmadı."
        loading={invitations.isPending}
        fetching={invitations.isFetching && !invitations.isPending}
        error={
          invitations.error ? (
            <QueryError error={invitations.error} onRetry={() => void invitations.refetch()} />
          ) : undefined
        }
      />
      {opening ? (
        <OpenInvitationsModal academicYear={academicYear} onClose={() => setOpening(false)} />
      ) : null}
    </section>
  )
}

function OpenInvitationsModal({
  academicYear,
  onClose,
}: {
  academicYear: number
  onClose: () => void
}) {
  const students = useCoreAll('students')
  const classes = useCoreAll('classes')
  const renewals = useCoreAll('renewals')
  const invited = useAllRenewalInvitations(academicYear)
  const open = useOpenRenewalInvitations()
  const [classId, setClassId] = useState('')
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())

  const classRows = (classes.data ?? []).map((row) => ({ ...row.record, id: row.id }))
  const classNames = new Map(classRows.map((row) => [row.id, row.name]))
  const studentRows = (students.data ?? []).map((row) => ({ ...row.record, id: row.id }))
  const invitable = new Set(
    invitableStudentIds(
      {
        students: studentRows,
        classes: classRows,
        renewals: (renewals.data ?? []).map((row) => row.record),
      },
      academicYear,
      new Set(invited.data?.map((row) => row.studentId)),
    ),
  )
  const candidates = studentRows
    .filter((row) => invitable.has(row.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
  const visible = classId === '' ? candidates : candidates.filter((row) => row.classId === classId)
  const allVisible = visible.length > 0 && visible.every((row) => selected.has(row.id))
  const tooMany = selected.size > RENEWAL_INVITATION_MAX_STUDENTS

  const loadError = students.error ?? classes.error ?? renewals.error ?? invited.error
  const loading = !students.data || !classes.data || !renewals.data || !invited.data

  function toggle(studentId: string, checked: boolean) {
    const next = new Set(selected)
    if (checked) next.add(studentId)
    else next.delete(studentId)
    setSelected(next)
  }
  function toggleVisible(checked: boolean) {
    const next = new Set(selected)
    for (const row of visible) {
      if (checked) next.add(row.id)
      else next.delete(row.id)
    }
    setSelected(next)
  }
  async function submit() {
    const outcome = await open.submit({ academicYear, studentIds: [...selected] })
    if (outcome.status !== 'success') return
    const { invitations, withoutPayerCount } = outcome.data.data
    notify.success(`${String(invitations.length)} öğrenciye davet açıldı.`)
    if (withoutPayerCount > 0)
      notify.warning(
        `${String(withoutPayerCount)} öğrencinin ödeyicisi kayıtlı değil; bildirim gitmedi, ödeyici işlenince veli yanıt verebilir.`,
      )
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      title="Yenileme daveti aç"
      description={`${periodOf(academicYear)} eğitim yılı için seçili öğrencilerin ödeyici velisine bildirim gider. Tutar yazılmaz; sözleşme ve taksit açılmaz.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={open.isPending}>
            Vazgeç
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={open.isPending || selected.size === 0 || tooMany}
            aria-busy={open.isPending || undefined}
          >
            {selected.size > 0 ? `Davet aç (${String(selected.size)})` : 'Davet aç'}
          </Button>
        </>
      }
    >
      {loadError ? (
        <QueryError
          error={loadError}
          onRetry={() => {
            void students.refetch()
            void classes.refetch()
            void renewals.refetch()
            void invited.refetch()
          }}
        />
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Öğrenciler yükleniyor…
        </p>
      ) : (
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="davet-sinif">Sınıf</Label>
            <NativeSelect
              id="davet-sinif"
              className="w-full"
              value={classId}
              onChange={(event) => setClassId(event.target.value)}
            >
              <NativeSelectOption value="">Tüm sınıflar</NativeSelectOption>
              {classRows.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {row.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          {visible.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Davet açılabilecek öğrenci yok. Daveti ya da planı olan öğrenci ve son sınıflar
              listelenmez.
            </p>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Öğrenciler</legend>
              <label className="flex min-h-11 items-center gap-2 border-b pb-2 text-sm font-medium">
                <Checkbox
                  checked={allVisible}
                  onCheckedChange={(checked) => toggleVisible(checked === true)}
                />
                Listelenenlerin tümünü seç ({visible.length})
              </label>
              <div className="grid max-h-72 gap-1 overflow-y-auto pr-1">
                {visible.map((row) => (
                  <label key={row.id} className="flex min-h-11 items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={(checked) => toggle(row.id, checked === true)}
                    />
                    <span className="[overflow-wrap:anywhere]">
                      {row.name} · {classNames.get(row.classId) ?? '—'}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {tooMany ? (
            <p role="alert" className="text-sm text-danger">
              Tek seferde en çok {RENEWAL_INVITATION_MAX_STUDENTS} öğrenciye davet açılır; seçimi
              sınıfa göre bölün.
            </p>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
