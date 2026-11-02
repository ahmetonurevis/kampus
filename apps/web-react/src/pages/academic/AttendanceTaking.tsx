import { useId, useMemo, useState } from 'react'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import { useRecordAttendance } from '@kampus/react-shared/use-academic-commands.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { Icon } from '@/components/Icon.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { cn } from '@/lib/utils'
import { LookupError } from './AcademicParts.tsx'
import {
  ATTENDANCE_OPTIONS,
  attendanceDayFilters,
  type AcademicLookups,
  type AttendanceStatus,
} from './academic-rows.ts'
import {
  attendanceMarks,
  bulkMark,
  lateMinutesPayload,
  markCounts,
  savedLateMinutes,
} from './academic-write.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'
import { useTeacherScope } from './use-teacher-scope.ts'

/** Seçili işaretin rengi: durum yalnız renkle değil, `aria-checked` ve kalın yazıyla da bellidir. */
const SELECTED_TONE = {
  present: 'data-[state=on]:bg-success-soft data-[state=on]:text-success',
  absent: 'data-[state=on]:bg-danger-soft data-[state=on]:text-danger',
  late: 'data-[state=on]:bg-warning-soft data-[state=on]:text-warning',
  excused: 'data-[state=on]:bg-primary-soft data-[state=on]:text-primary',
} as const satisfies Record<AttendanceStatus, string>

/**
 * Yoklama alma (öğretmen, Vue `Academic.vue` `yoklama`): öğretmenin ders verdiği sınıflardan biri
 * seçilir, bugünün öğrenci listesi gelir. Varsayılan "Geldi"; gün için kayıt varsa onun durumu
 * yüklenir. Tek gönderim yapılır; aynı gün ikinci gönderim kaydı günceller. Öğretmen yalnız bugünü
 * alır (geçmiş günü yönetici düzeltir, DOM-AKD-035); sınıf listesi API kapsamından ve ders
 * atamalarından gelir, yetkiyi sunucu yine denetler.
 * Toplu işaretleme (IST-093): "Tümünü geldi işaretle" ve onay kutusuyla seçilen satırlara toplu
 * durum yalnız ekrandaki seçimi hızlandırır; gönderim yine sınıfın tek isteğidir. "Geç geldi"
 * satırında isteğe bağlı dakika alanı çıkar (DOM-AKD-036); üst sınırı (ders süresi) sunucu denetler.
 */
export function AttendanceTaking() {
  const headingId = useId()
  const data = useAcademicLookups()
  const scope = useTeacherScope(data.lookups)
  const [classId, setClassId] = useState('')

  const classes = useMemo(
    () =>
      data.sources.classes
        .filter((row) => scope.classIds.has(row.id))
        .sort((left, right) =>
          left.record.name.localeCompare(right.record.name, 'tr', { numeric: true }),
        ),
    [scope.classIds, data.sources.classes],
  )

  const selected = classes.find((row) => row.id === classId)
  const error = data.error ?? scope.error
  return (
    <section
      aria-labelledby={headingId}
      className="panel mb-6 overflow-hidden rounded-card border bg-surface"
    >
      <header className="panel-heading flex flex-wrap items-end justify-between gap-3 px-6 pt-6 pb-4 max-[650px]:px-4">
        <div className="min-w-0">
          <h2 id={headingId} className="text-lg font-semibold">
            Yoklama al
          </h2>
          <p className="text-sm text-muted-foreground">
            Ders verdiğiniz sınıfın bugünkü devam durumunu kaydedin.
          </p>
        </div>
        <label className="grid gap-1 text-sm font-medium">
          Yoklama alınacak sınıf
          <NativeSelect
            value={classId}
            onChange={(event) => setClassId(event.target.value)}
            disabled={data.pending || scope.pending}
            className="min-h-9 text-sm"
          >
            <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
            {classes.map((row) => (
              <NativeSelectOption key={row.id} value={row.id}>
                {row.record.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
      </header>
      {error ? (
        <LookupError
          error={error}
          onRetry={() => {
            data.retry()
            scope.retry()
          }}
        />
      ) : null}
      {selected ? (
        <AttendanceSheet
          key={selected.id}
          classId={selected.id}
          className={selected.record.name}
          classVersion={selected.version}
          lookups={data.lookups}
        />
      ) : (
        <p className="border-t px-6 py-5 text-sm text-muted-foreground max-[650px]:px-4">
          {classes.length === 0 && !data.pending && !scope.pending
            ? 'Ders verdiğiniz sınıf bulunmuyor.'
            : 'Öğrenci listesi için bir sınıf seçin.'}
        </p>
      )}
    </section>
  )
}

type SheetProps = {
  classId: string
  className: string
  classVersion: number
  lookups: AcademicLookups
}

function AttendanceSheet({ classId, className, classVersion, lookups }: SheetProps) {
  const today = dayKey()
  const students = useMemo(
    () => lookups.studentsByClass.get(classId) ?? [],
    [lookups.studentsByClass, classId],
  )
  const saved = useCoreAll('attendance', {
    filters: { classId, ...attendanceDayFilters(today) },
  })
  const record = useRecordAttendance()
  // Kullanıcının dokunduğu işaretler; kayıtlı veya varsayılan durum bunun altında türetilir.
  const [edits, setEdits] = useState<Record<string, AttendanceStatus>>({})
  const [result, setResult] = useState('')
  // Toplu işaretleme için seçili satırlar ve geç kalma dakikası alanları (ham metin).
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [minuteEdits, setMinuteEdits] = useState<Record<string, string>>({})
  const [minuteErrors, setMinuteErrors] = useState<Record<string, string>>({})

  const savedRecords = useMemo(() => saved.data?.map((row) => row.record) ?? [], [saved.data])
  const marks = useMemo(
    () =>
      attendanceMarks(
        students.map((student) => student.id),
        savedRecords,
        edits,
      ),
    [students, savedRecords, edits],
  )
  const minuteText = useMemo(
    () => ({ ...savedLateMinutes(savedRecords), ...minuteEdits }),
    [savedRecords, minuteEdits],
  )
  const counts = markCounts(marks)
  const alreadyTaken = savedRecords.length > 0
  const busy = record.isPending
  const mark = (studentId: string, status: AttendanceStatus) => {
    setResult('')
    setEdits((current) => ({ ...current, [studentId]: status }))
  }
  const markMany = (ids: Iterable<string>, status: AttendanceStatus) => {
    setResult('')
    setEdits((current) => bulkMark(current, ids, status))
  }
  const allSelected = students.length > 0 && students.every((student) => selected.has(student.id))
  const toggleSelected = (studentId: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current)
      if (on) next.add(studentId)
      else next.delete(studentId)
      return next
    })

  async function save() {
    const updating = alreadyTaken
    // Dakika alanı: geçersiz değer istek atılmadan satırda gösterilir.
    const late = lateMinutesPayload(marks, minuteText)
    setMinuteErrors(late.errors)
    if (Object.keys(late.errors).length > 0) return
    const outcome = await record.submit({
      classId,
      date: today,
      marks,
      lateMinutes: late.minutes,
      classVersion,
    })
    if (outcome.status !== 'success') return
    const message = updating ? 'Yoklama güncellendi.' : 'Yoklama kaydedildi.'
    setEdits({})
    setMinuteEdits({})
    setSelected(new Set())
    setResult(message)
    notify.success(message)
  }

  if (saved.error)
    return (
      <div className="border-t p-6">
        <QueryError error={saved.error} onRetry={() => void saved.refetch()} />
      </div>
    )
  return (
    <form
      noValidate
      aria-label={`${className} yoklaması`}
      onSubmit={(event) => {
        event.preventDefault()
        void save()
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 max-[650px]:px-4">
        <p className="text-sm">
          <strong className="font-semibold">{className}</strong> · {students.length} öğrenci ·{' '}
          {dateLabel(`${today}T09:00:00.000Z`, { year: 'numeric', weekday: 'long' })}
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => {
            markMany(
              students.map((student) => student.id),
              'present',
            )
            setSelected(new Set())
          }}
        >
          <Icon name="CheckCheck" size={16} aria-hidden="true" />
          Tümünü geldi işaretle
        </Button>
      </div>
      {students.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-t bg-surface-soft px-6 py-2 text-sm max-[650px]:px-4">
          <label className="flex items-center gap-2 font-medium">
            <Checkbox
              checked={allSelected}
              disabled={busy}
              onCheckedChange={(on) =>
                setSelected(
                  on === true ? new Set(students.map((student) => student.id)) : new Set(),
                )
              }
            />
            Tümünü seç
          </label>
          <span aria-live="polite" className="text-muted-foreground">
            {selected.size} öğrenci seçili
          </span>
          <span role="group" aria-label="Seçilenlere toplu durum" className="flex flex-wrap gap-2">
            {ATTENDANCE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || selected.size === 0}
                onClick={() => markMany(selected, option.value)}
              >
                Seçilenleri {option.label.toLocaleLowerCase('tr')} işaretle
              </Button>
            ))}
          </span>
        </div>
      ) : null}
      {alreadyTaken ? (
        <p className="border-t bg-surface-soft px-6 py-2 text-sm max-[650px]:px-4">
          Bu sınıfın bugünkü yoklaması kayıtlı; gönderim kaydı günceller.
        </p>
      ) : null}
      {saved.isPending ? (
        <p className="border-t px-6 py-5 text-sm text-muted-foreground max-[650px]:px-4">
          Yoklama yükleniyor…
        </p>
      ) : students.length === 0 ? (
        <p className="border-t px-6 py-5 text-sm text-muted-foreground max-[650px]:px-4">
          Bu sınıfta aktif öğrenci bulunmuyor.
        </p>
      ) : (
        <ul className="m-0 list-none p-0" aria-label={`${className} öğrencileri`}>
          {students.map((student) => (
            <li
              key={student.id}
              className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 max-[650px]:px-4"
            >
              <span className="person-cell flex min-w-0 items-center gap-2.5">
                <Checkbox
                  checked={selected.has(student.id)}
                  disabled={busy}
                  onCheckedChange={(on) => toggleSelected(student.id, on === true)}
                  aria-label={`${student.name} seç`}
                />
                <Avatar name={student.name} size="small" />
                <span className="font-medium">{student.name}</span>
              </span>
              <ToggleGroup
                type="single"
                variant="outline"
                spacing={2}
                value={marks[student.id] ?? 'present'}
                // Seçili düğmeye yeniden basmak seçimi kaldırmaz; her öğrencinin bir durumu vardır.
                onValueChange={(value) => {
                  if (value) mark(student.id, value as AttendanceStatus)
                }}
                disabled={busy}
                aria-label={`${student.name} yoklama durumu`}
                className="grid w-full grid-cols-2 sm:flex sm:w-auto"
              >
                {ATTENDANCE_OPTIONS.map((option) => (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    aria-label={`${student.name}: ${option.label}`}
                    className={cn(
                      'min-h-9 data-[state=on]:font-semibold data-[state=on]:border-current',
                      SELECTED_TONE[option.value],
                    )}
                  >
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {marks[student.id] === 'late' ? (
                <div className="grid w-full gap-1 sm:ml-12">
                  <label className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-muted-foreground">
                      Geç kalma süresi (dk, isteğe bağlı)
                    </span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={minuteText[student.id] ?? ''}
                      disabled={busy}
                      aria-label={`${student.name} geç kalma süresi (dakika)`}
                      aria-invalid={minuteErrors[student.id] ? true : undefined}
                      aria-describedby={
                        minuteErrors[student.id] ? `dakika-${student.id}` : undefined
                      }
                      onChange={(event) => {
                        setResult('')
                        setMinuteEdits((current) => ({
                          ...current,
                          [student.id]: event.target.value,
                        }))
                      }}
                      className="min-h-9 w-24 text-sm"
                    />
                  </label>
                  {minuteErrors[student.id] ? (
                    <p id={`dakika-${student.id}`} role="alert" className="text-sm text-danger">
                      {minuteErrors[student.id]}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4 max-[650px]:px-4">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {counts.present} geldi · {counts.absent} gelmedi · {counts.late} geç geldi ·{' '}
          {counts.excused} mazeretli
        </p>
        <div className="flex items-center gap-3">
          <p role="status" className="text-sm font-medium text-success">
            {result}
          </p>
          <Button
            type="submit"
            disabled={busy || saved.isPending || students.length === 0}
            aria-busy={busy || undefined}
          >
            <Icon name="ClipboardCheck" size={17} aria-hidden="true" />
            Yoklamayı kaydet
          </Button>
        </div>
      </div>
    </form>
  )
}
