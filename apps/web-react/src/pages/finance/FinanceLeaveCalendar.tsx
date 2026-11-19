import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import {
  useLeaveCalendar,
  useLeaveCalendarSettings,
  useSetLeaveCalendarSettings,
  type LeaveCalendar,
  type LeaveCalendarSettings,
} from '@kampus/react-shared/use-finance-leave-calendar.ts'
import {
  LEAVE_CALENDAR_STATUS_LABELS,
  LEAVE_CALENDAR_STATUSES,
  type LeaveCalendarStatus,
} from '@kampus/school-core/lib/finance-leave-calendar.ts'
import { dayKey } from '@kampus/school-core/lib/format.ts'
import { STAFF_ROLE_LABELS, STAFF_ROLES } from '@kampus/school-core/lib/staff-accounts.ts'
import { FormField } from '@/components/FormField.tsx'
import { LineTabs } from '@/components/LineTabs.tsx'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { notify } from '@/lib/notify.ts'
import { cn } from '@/lib/utils'
import { RootError } from '../management/FormParts.tsx'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import {
  agendaDays,
  busyOn,
  CALENDAR_MODES,
  calendarRange,
  calendarWeeks,
  dayLongText,
  entriesOn,
  entryLabel,
  examWeekOn,
  isWeekend,
  periodTitle,
  settingsBody,
  settingsDefaults,
  shiftAnchor,
  WEEKDAY_LABELS,
  WEEKDAY_NAMES,
  type CalendarMode,
  type CalendarSettingsFormValues,
} from './finance-leave-calendar-view.ts'

/**
 * İzin takvimi (DOM-FIN-123; ON-183; K-420…K-422): "İzin talepleri" sekmesinde ay ya da hafta
 * görünümü. Geniş ekranda tablo ızgarası (satır hafta, sütun gün), dar ekranda yalnız dolu günlerin
 * listesi. Yönetici bekleyen ve onaylı izinleri tür adıyla, raporu yalnız "Raporlu" görür; aynı
 * branşta eşiğe ulaşan günler ve sınav haftaları işaretlidir, eşik ve sınav haftaları ayardan
 * değişir. Ön büro yalnız onaylı izinleri türsüz ("İzinli") okur.
 */
export function FinanceLeaveCalendar({ canManage }: { canManage: boolean }) {
  const today = dayKey()
  const [mode, setMode] = useState<CalendarMode>('month')
  const [anchor, setAnchor] = useState(today)
  const [subjectId, setSubjectId] = useState('')
  const [role, setRole] = useState('')
  const [status, setStatus] = useState('')
  const [editing, setEditing] = useState(false)
  const range = calendarRange(mode, anchor)
  const calendar = useLeaveCalendar({
    ...range,
    ...(subjectId === '' ? {} : { subjectId }),
    ...(role === '' ? {} : { role: role as (typeof STAFF_ROLES)[number] }),
    ...(status === '' || !canManage ? {} : { status: status as LeaveCalendarStatus }),
  })
  const data = calendar.data?.data
  const title = periodTitle(mode, anchor)
  return (
    <section aria-labelledby="izin-takvimi" className="grid gap-3 px-6 pb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h3 id="izin-takvimi" className="text-base font-semibold">
            İzin takvimi: {title}
          </h3>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? 'Onaylı ve onay bekleyen izinler. Rapor yalnız "Raporlu" görünür; tür ve tanı gösterilmez. Uyarılar izni engellemez.'
              : 'Onaylı izinler. Tür gösterilmez.'}
          </p>
        </div>
        {canManage ? (
          <Button variant="secondary" onClick={() => setEditing(true)}>
            Takvim ayarı
          </Button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <LineTabs
          label="Takvim görünümü"
          value={mode}
          options={CALENDAR_MODES}
          onChange={(next) => setMode(next)}
        />
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAnchor(shiftAnchor(mode, anchor, -1))}
          >
            {mode === 'month' ? 'Önceki ay' : 'Önceki hafta'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAnchor(today)}>
            Bugün
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setAnchor(shiftAnchor(mode, anchor, 1))}
          >
            {mode === 'month' ? 'Sonraki ay' : 'Sonraki hafta'}
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="takvim-brans" label="Branş">
          {(control) => (
            <NativeSelect
              {...control}
              className="w-full"
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
            >
              <NativeSelectOption value="">Tüm branşlar</NativeSelectOption>
              {(data?.subjects ?? []).map((subject) => (
                <NativeSelectOption key={subject.id} value={subject.id}>
                  {subject.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        <FormField id="takvim-rol" label="Rol">
          {(control) => (
            <NativeSelect
              {...control}
              className="w-full"
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              <NativeSelectOption value="">Tüm roller</NativeSelectOption>
              {STAFF_ROLES.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {STAFF_ROLE_LABELS[item]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
        {canManage ? (
          <FormField id="takvim-durum" label="Durum">
            {(control) => (
              <NativeSelect
                {...control}
                className="w-full"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <NativeSelectOption value="">Onaylı ve bekleyen</NativeSelectOption>
                {LEAVE_CALENDAR_STATUSES.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {LEAVE_CALENDAR_STATUS_LABELS[item]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
        ) : null}
      </div>
      {calendar.error ? (
        <QueryError error={calendar.error} onRetry={() => void calendar.refetch()} />
      ) : data === undefined ? (
        <SummaryLoading />
      ) : (
        <CalendarBody data={data} title={title} today={today} month={anchor.slice(0, 7)} />
      )}
      {editing ? <SettingsDialog onClose={() => setEditing(false)} /> : null}
    </section>
  )
}

function DayDetails({ data, day }: { data: LeaveCalendar; day: string }) {
  const exam = examWeekOn(data.examWeeks, day)
  const busy = busyOn(data.busyDays, data.subjects, day)
  return (
    <>
      {exam === null ? null : (
        <StatusBadge text={`Sınav haftası: ${exam}`} tone="purple" className="whitespace-normal" />
      )}
      {busy.map((text) => (
        <StatusBadge
          key={text}
          text={`Eşzamanlı izin: ${text}`}
          tone="amber"
          className="whitespace-normal"
        />
      ))}
      <ul className="grid gap-1">
        {entriesOn(data.entries, day).map((entry) => (
          <li
            key={entry.id}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-xs leading-snug',
              entry.status === 'pending' && 'border-dashed',
            )}
          >
            <span className="font-medium">{entry.name}</span>
            <span className="block text-muted-foreground">
              {entryLabel(entry)}
              {entry.status === 'pending' ? ` · ${LEAVE_CALENDAR_STATUS_LABELS.pending}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Izgara (geniş ekran) ve gün listesi (dar ekran) aynı veriden. */
function CalendarBody({
  data,
  title,
  today,
  month,
}: {
  data: LeaveCalendar
  title: string
  today: string
  month: string
}) {
  const weeks = calendarWeeks(data)
  const days = agendaDays(weeks.flat(), data)
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-collapse text-sm">
          <caption className="sr-only">İzin takvimi: {title}</caption>
          <thead>
            <tr>
              {WEEKDAY_LABELS.map((label, index) => (
                <th
                  key={label}
                  scope="col"
                  abbr={WEEKDAY_NAMES[index]}
                  className="border-b px-2 py-1 text-left text-xs font-medium text-muted-foreground"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0]}>
                {week.map((day) => (
                  <td
                    key={day}
                    aria-current={day === today ? 'date' : undefined}
                    className={cn(
                      'h-24 border p-1 align-top',
                      (isWeekend(day) || day.slice(0, 7) !== month) && 'bg-muted/40',
                    )}
                  >
                    <div className="grid gap-1">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'text-xs text-muted-foreground',
                          day === today && 'font-semibold text-foreground',
                        )}
                      >
                        {Number(day.slice(8))}
                      </span>
                      <span className="sr-only">{dayLongText(day)}</span>
                      <DayDetails data={data} day={day} />
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        {days.length === 0 ? (
          <p className="text-sm text-muted-foreground">Bu dönemde izin yok.</p>
        ) : (
          <ol aria-label={`İzin listesi: ${title}`} className="grid gap-2">
            {days.map((day) => (
              <li key={day} className="grid gap-1 rounded-sm border px-3 py-2">
                <span className="text-sm font-medium">{dayLongText(day)}</span>
                <DayDetails data={data} day={day} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {data.entries.length === 0 ? (
        <p className="hidden text-sm text-muted-foreground md:block">Bu dönemde izin yok.</p>
      ) : null}
    </>
  )
}

/** Eşik ve sınav haftaları (yalnız yönetici; K-421, K-422). */
function SettingsDialog({ onClose }: { onClose: () => void }) {
  const settings = useLeaveCalendarSettings()
  return (
    <Modal
      open
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="İzin takvimi ayarı"
      description="Aynı branşta aynı gün izinli personel sayısı eşiğe ulaşınca ve izin sınav haftasına denk gelince talepte uyarı gösterilir; uyarı izni engellemez."
    >
      {settings.error ? (
        <QueryError error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data === undefined ? (
        <SummaryLoading />
      ) : (
        <SettingsForm settings={settings.data.data} onDone={onClose} />
      )}
    </Modal>
  )
}

function SettingsForm({
  settings,
  onDone,
}: {
  settings: LeaveCalendarSettings
  onDone: () => void
}) {
  const save = useSetLeaveCalendarSettings()
  const form = useForm<CalendarSettingsFormValues>({ defaultValues: settingsDefaults(settings) })
  const weeks = useFieldArray({ control: form.control, name: 'examWeeks' })
  const errors = form.formState.errors
  const busy = save.isPending || form.formState.isSubmitting
  const onSubmit = form.handleSubmit(async (values) => {
    const result = settingsBody(values)
    if ('issues' in result) {
      for (const issue of result.issues)
        form.setError(issue.field as never, { message: issue.message }, { shouldFocus: true })
      return
    }
    const outcome = await save.submit(
      { version: settings.version, body: result.body },
      {
        setError: (name, error) => {
          if (name === 'concurrentThreshold') form.setError('concurrentThreshold', error)
          else form.setError('root.server', error)
        },
      },
    )
    if (outcome.status === 'success') {
      notify.success('İzin takvimi ayarı kaydedildi.')
      onDone()
    } else if (outcome.status === 'failed' && outcome.error.code === 'version_conflict') onDone()
  })
  return (
    <form
      noValidate
      aria-label="İzin takvimi ayarı"
      className="grid gap-3"
      onSubmit={(event) => void onSubmit(event)}
    >
      <FormField
        id="takvim-esik"
        label="Eşzamanlı izin eşiği (aynı branş, aynı gün)"
        error={errors.concurrentThreshold}
        description="2 ile 20 arası; varsayılan 2."
      >
        {(control) => (
          <Input
            {...control}
            inputMode="numeric"
            autoComplete="off"
            {...form.register('concurrentThreshold')}
            disabled={busy}
          />
        )}
      </FormField>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-semibold">Sınav haftaları</legend>
        {weeks.fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sınav haftası tanımlı değil.</p>
        ) : null}
        {weeks.fields.map((field, index) => (
          <div key={field.id} className="grid gap-2 rounded-sm border p-3 sm:grid-cols-3">
            <FormField
              id={`sinav-ad-${String(index)}`}
              label={`${String(index + 1)}. sınav haftası adı`}
              error={errors.examWeeks?.[index]?.label}
            >
              {(control) => (
                <Input
                  {...control}
                  {...form.register(`examWeeks.${index}.label`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`sinav-baslangic-${String(index)}`}
              label="İlk gün"
              error={errors.examWeeks?.[index]?.startDate}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  {...form.register(`examWeeks.${index}.startDate`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <FormField
              id={`sinav-bitis-${String(index)}`}
              label="Son gün"
              error={errors.examWeeks?.[index]?.endDate}
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  {...form.register(`examWeeks.${index}.endDate`)}
                  disabled={busy}
                />
              )}
            </FormField>
            <div className="sm:col-span-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                aria-label={`${String(index + 1)}. sınav haftasını kaldır`}
                onClick={() => weeks.remove(index)}
              >
                Kaldır
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => weeks.append({ label: '', startDate: '', endDate: '' })}
          >
            Sınav haftası ekle
          </Button>
        </div>
      </fieldset>
      <RootError message={errors.root?.server?.message} />
      <div>
        <Button type="submit" disabled={busy} aria-busy={busy || undefined}>
          Ayarı kaydet
        </Button>
      </div>
    </form>
  )
}
