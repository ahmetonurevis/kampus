import { useMemo, useState } from 'react'
import {
  useProfessionalDevelopmentHours,
  useProfessionalDevelopmentTarget,
  useUpdateProfessionalDevelopmentTarget,
  type ProfessionalDevelopmentTarget,
} from '@kampus/react-shared/use-finance-professional-development.ts'
import { academicYearName } from '@kampus/school-core/lib/academic-years.ts'
import {
  DEFAULT_PROFESSIONAL_DEVELOPMENT_TARGET_ROLES,
  PROFESSIONAL_DEVELOPMENT_HOURS_STATUS_LABELS,
  PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES,
  type ProfessionalDevelopmentHoursStatus,
} from '@kampus/school-core/lib/finance-professional-development-hours.ts'
import { dateLabel } from '@kampus/school-core/lib/format.ts'
import {
  isStaffRole,
  STAFF_ROLE_LABELS,
  STAFF_ROLES,
  type StaffRole,
} from '@kampus/school-core/lib/staff-accounts.ts'
import { ServerDataTable, type DataColumn } from '@/components/DataTable.tsx'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { useDebouncedValue } from '@/hooks/use-debounced-value.ts'
import { useListState } from '@/hooks/use-list-state.ts'
import { notify } from '@/lib/notify.ts'
import {
  hoursRowText,
  targetBody,
  yearOptions,
} from './finance-professional-development-hours-forms.ts'

const NO_SORT: readonly string[] = []
const MOBILE = ['name', 'missing']
const FILTERS = [
  {
    key: 'status',
    label: 'Durum',
    type: 'select' as const,
    options: PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES.map((value) => ({
      value,
      label: PROFESSIONAL_DEVELOPMENT_HOURS_STATUS_LABELS[value],
    })),
  },
]
const isHoursStatus = (value: unknown): value is ProfessionalDevelopmentHoursStatus =>
  (PROFESSIONAL_DEVELOPMENT_HOURS_STATUSES as readonly unknown[]).includes(value)
const day = (value: string) => dateLabel(value, { year: 'numeric' })

type Row = {
  id: string
  name: string
  role: string
  attended: string
  completed: string
  target: string
  missing: string
  met: boolean | null
}

/**
 * Mesleki gelişim saati özeti ve öğretim yılı hedefi (DOM-FIN-144; ON-215; K-487): yalnız yönetici.
 * Yıl seçilir, hedef saat ve hedef rolleri yazılır; tablo etkin personelin tamamlanan, hedef ve eksik
 * saatini gösterir, "eksik saati olan" süzgeciyle eksik listesi alınır.
 */
export function FinanceProfessionalDevelopmentHours() {
  const [chosenYear, setChosenYear] = useState<number | null>(null)
  const list = useListState('mesleki-gelisim-saat', {
    urlPrefix: 'mgs_',
    resetKey: String(chosenYear),
  })
  const search = useDebouncedValue(list.state.query).trim()
  const status = list.state.filters.status
  const hours = useProfessionalDevelopmentHours({
    page: list.state.page,
    pageSize: list.state.pageSize,
    ...(chosenYear === null ? {} : { academicYear: chosenYear }),
    ...(search.length >= 2 ? { q: search } : {}),
    ...(isHoursStatus(status) ? { status } : {}),
  })
  // İçinde bulunulan yıl ilk yanıttan öğrenilir (kurumun kayıtlı öğretim yılına göre sunucuda).
  const [currentYear, setCurrentYear] = useState<number | null>(null)
  const metaYear = hours.data?.meta.academicYear
  if (currentYear === null && metaYear !== undefined) setCurrentYear(metaYear)
  const year = chosenYear ?? currentYear
  const target = useProfessionalDevelopmentTarget(year)
  const options = currentYear === null ? [] : yearOptions(currentYear)

  const rows = useMemo(
    () =>
      hours.data?.data.map((item): Row => {
        const text = hoursRowText(item)
        return {
          id: item.membershipId,
          name: item.name,
          role: isStaffRole(item.role) ? STAFF_ROLE_LABELS[item.role] : item.role,
          attended: String(item.attendedCount),
          completed: text.completed,
          target: text.target,
          missing: text.missing,
          met: item.met,
        }
      }) ?? [],
    [hours.data],
  )
  const columns = useMemo<DataColumn<Row>[]>(
    () => [
      { key: 'name', label: 'Personel' },
      { key: 'role', label: 'Rol' },
      { key: 'attended', label: 'Eğitim' },
      { key: 'completed', label: 'Tamamlanan' },
      { key: 'target', label: 'Hedef' },
      {
        key: 'missing',
        label: 'Eksik',
        cell: (row) =>
          row.met === null ? (
            row.missing
          ) : (
            <StatusBadge text={row.missing} tone={row.met ? 'green' : 'amber'} />
          ),
      },
    ],
    [],
  )
  const targetData = target.data?.data

  return (
    <section
      aria-labelledby="mesleki-gelisim-saati"
      className="panel overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading grid gap-3 px-6 pt-6 pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 id="mesleki-gelisim-saati" className="text-lg font-semibold">
              Gelişim saati
            </h2>
            <p className="text-sm text-muted-foreground">
              Katıldı işaretli eğitimlerin saati öğretim yılına göre toplanır. Hedef girildiğinde
              eksik saati olan personel ayrıca listelenir.
            </p>
          </div>
          <FormField id="mgs-yil" label="Öğretim yılı">
            {(control) => (
              <NativeSelect
                {...control}
                value={year === null ? '' : String(year)}
                onChange={(event) => setChosenYear(Number(event.target.value))}
                disabled={options.length === 0}
              >
                {options.map((option) => (
                  <NativeSelectOption key={option.value} value={String(option.value)}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        </div>
        {target.error ? (
          <QueryError error={target.error} onRetry={() => void target.refetch()} />
        ) : targetData !== undefined && year !== null ? (
          <TargetForm key={`${String(year)}-${String(targetData.version)}`} target={targetData} />
        ) : null}
      </header>
      <ServerDataTable
        list={list}
        rows={rows}
        total={hours.data?.meta.total ?? 0}
        sortable={NO_SORT}
        columns={columns}
        filters={FILTERS}
        mobileColumns={MOBILE}
        caption={
          year === null
            ? 'Mesleki gelişim saati'
            : `${academicYearName(year)} mesleki gelişim saati`
        }
        empty="Etkin personel yok."
        emptyFiltered={
          targetData?.targetHours === null
            ? 'Bu yıl için hedef saat girilmemiş.'
            : 'Bu seçimle eşleşen personel yok.'
        }
        loading={hours.isPending}
        fetching={hours.isFetching && !hours.isPending}
        error={
          hours.error ? (
            <QueryError error={hours.error} onRetry={() => void hours.refetch()} />
          ) : undefined
        }
      />
    </section>
  )
}

function TargetForm({ target }: { target: ProfessionalDevelopmentTarget }) {
  const update = useUpdateProfessionalDevelopmentTarget()
  const [hoursText, setHoursText] = useState(
    target.targetHours === null ? '' : String(target.targetHours),
  )
  const [roles, setRoles] = useState<StaffRole[]>(
    target.appliesToRoles.length === 0
      ? [...DEFAULT_PROFESSIONAL_DEVELOPMENT_TARGET_ROLES]
      : target.appliesToRoles,
  )
  const [error, setError] = useState<string | undefined>(undefined)
  const busy = update.isPending
  const submit = async () => {
    setError(undefined)
    const parsed = targetBody(hoursText, roles)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }
    const outcome = await update.submit(
      { academicYear: target.academicYear, body: parsed.body },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success')
      notify.success(
        parsed.body.targetHours === null ? 'Hedef saat kaldırıldı.' : 'Hedef saat kaydedildi.',
      )
  }
  return (
    <form
      noValidate
      aria-label="Hedef saat"
      className="grid gap-3 sm:grid-cols-[minmax(0,10rem)_1fr_auto] sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField
        id="mgs-hedef"
        label="Yıllık hedef (saat)"
        error={error ? { message: error } : undefined}
        description={`${day(target.startDate)} – ${day(target.endDate)}; boş bırakılırsa hedef kalkar.`}
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            value={hoursText}
            onChange={(event) => setHoursText(event.target.value)}
            disabled={busy}
          />
        )}
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Hedefin uygulandığı roller</legend>
        <div className="flex flex-wrap gap-4">
          {STAFF_ROLES.map((role) => (
            <span key={role} className="flex min-h-11 items-center gap-2">
              <Checkbox
                id={`mgs-rol-${role}`}
                checked={roles.includes(role)}
                disabled={busy}
                onCheckedChange={(checked) =>
                  setRoles((current) =>
                    checked === true
                      ? [...new Set([...current, role])]
                      : current.filter((value) => value !== role),
                  )
                }
              />
              <Label htmlFor={`mgs-rol-${role}`}>{STAFF_ROLE_LABELS[role]}</Label>
            </span>
          ))}
        </div>
      </fieldset>
      <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
        Hedefi kaydet
      </Button>
    </form>
  )
}
