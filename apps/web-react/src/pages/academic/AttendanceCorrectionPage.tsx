import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useId, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useBlocker, useSearchParams } from 'react-router'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  ATTENDANCE_CORRECTION_CHANGED_MESSAGE,
  useCorrectAttendance,
} from '@kampus/react-shared/use-academic-commands.ts'
import { useInstitutionMembersAll } from '@kampus/react-shared/use-institution-lists.ts'
import { Avatar } from '@/components/Avatar.tsx'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
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
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCoreAll, useCoreItem, type CoreRecord } from '@/hooks/use-core-collection.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { NavPage } from '@/lib/navigation.ts'
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
  canSubmitCorrection,
  correctionCounts,
  correctionDay,
  correctionDirty,
  correctionFormSchema,
  correctionHistory,
  correctionMarks,
  correctionRows,
  correctorIds,
  FIRST_ENTRY_NOTE,
  formAfterSubmit,
  markUnselectedPresent,
  savedMessage,
  submitWithFreshState,
  type CorrectionFormInput,
  type CorrectionFormOutput,
} from './attendance-correction.ts'
import { classOptions } from './class-analysis-model.ts'
import { useAcademicLookups } from './use-academic-lookups.ts'

const DAY_LABEL = { year: 'numeric', weekday: 'long' } as const
const dayLabel = (day: string) => dateLabel(`${day}T09:00:00.000Z`, DAY_LABEL)

/**
 * Yoklama Düzeltme (yönetici, IST-093, DOM-AKD-035): sınıf ve geçmiş gün seçilir (adreste
 * `?sinif=`, `?tarih=`; ileri tarih seçilemez), o günün öğrencileri mevcut ve yeni durumla gelir.
 * Değişen satırlar vurgulanır; gerekçe zorunludur ve "Düzeltmeyi kaydet" tek istek atar (`If-Match`
 * sınıf sürümü; gönderimden hemen önce sürüm ve yoklama yeniden okunur). Başkası araya girdiyse
 * (409) veri tazelenir, seçimler ve gerekçe formda kalır. Kaydı olmayan öğrencinin varsayılan
 * durumu yoktur: hepsi seçilmeden (ya da toplu "Geldi" denmeden) kayıt kapalıdır; ilk yoklamada
 * gerekçe saklanmaz ve bu açıkça yazılır. Kirli formdan gezinmek onay ister.
 */
export function AttendanceCorrectionPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const [params, setParams] = useSearchParams()
  const today = dayKey()
  const data = useAcademicLookups()
  const options = useMemo(
    () => classOptions(data.sources.classes, data.lookups.branches),
    [data.sources.classes, data.lookups.branches],
  )
  const requestedClass = params.get('sinif') ?? ''
  const selected = options.some((item) => item.id === requestedClass)
    ? data.sources.classes.find((row) => row.id === requestedClass)
    : undefined
  const day = correctionDay(params.get('tarih'), today)

  const setParam = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { preventScrollReset: true },
    )

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {data.error ? <LookupError error={data.error} onRetry={data.retry} /> : null}
      <section
        aria-label="Düzeltilecek yoklama"
        className="panel mb-6 overflow-hidden rounded-card border bg-surface"
      >
        <div className="flex flex-wrap items-end gap-4 px-6 pt-6 pb-4 max-[650px]:px-4">
          <label className="grid gap-1 text-sm font-medium">
            Sınıf
            <NativeSelect
              value={selected?.id ?? ''}
              onChange={(event) => setParam('sinif', event.target.value)}
              disabled={data.pending}
              className="min-h-9 text-sm"
            >
              <NativeSelectOption value="">Sınıf seçin</NativeSelectOption>
              {options.map((item) => (
                <NativeSelectOption key={item.id} value={item.id}>
                  {item.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-sm font-medium">
            Yoklama günü
            <Input
              type="date"
              value={day}
              max={today}
              required
              onChange={(event) => setParam('tarih', event.target.value)}
              className="min-h-9 w-auto text-sm"
              aria-describedby="yoklama-gunu-aciklama"
            />
          </label>
          <p id="yoklama-gunu-aciklama" className="pb-2 text-sm text-muted-foreground">
            Bugün ve geçmiş günler seçilebilir.
          </p>
        </div>
        {selected ? (
          <CorrectionSheet
            // Sınıf ya da gün değişince form yeniden kurulur (kirliyse önce onay istenir).
            key={`${selected.id}-${day}`}
            classId={selected.id}
            className={selected.record.name}
            day={day}
            lookups={data.lookups}
          />
        ) : (
          <p className="border-t px-6 py-5 text-sm text-muted-foreground max-[650px]:px-4">
            {options.length === 0 && !data.pending
              ? 'Kurumda aktif sınıf bulunmuyor.'
              : 'Öğrenci listesi için bir sınıf seçin.'}
          </p>
        )}
      </section>
    </>
  )
}

type SheetProps = {
  classId: string
  className: string
  day: string
  lookups: AcademicLookups
}

function CorrectionSheet({ classId, className, day, lookups }: SheetProps) {
  const students = useMemo(
    () => lookups.studentsByClass.get(classId) ?? [],
    [lookups.studentsByClass, classId],
  )
  const saved = useCoreAll('attendance', { filters: { classId, ...attendanceDayFilters(day) } })
  // Gönderimden hemen önce güncel sürüm bu sorgudan okunur (liste sürümü eskimiş olabilir).
  const classItem = useCoreItem('classes', classId)
  const correct = useCorrectAttendance()
  const [edits, setEdits] = useState<Record<string, AttendanceStatus>>({})
  const form = useForm<CorrectionFormInput, unknown, CorrectionFormOutput>({
    resolver: zodResolver(correctionFormSchema),
    defaultValues: { reason: '' },
  })

  const reasonValue = useWatch({ control: form.control, name: 'reason' })
  const records = useMemo(() => saved.data?.map((row) => row.record) ?? [], [saved.data])
  const rows = useMemo(() => correctionRows(students, records, edits), [students, records, edits])
  const counts = correctionCounts(rows)
  const notTaken = !saved.isPending && records.length === 0
  const firstEntries = counts.added + counts.unselected > 0
  const busy = correct.isPending || form.formState.isSubmitting
  const canSave = canSubmitCorrection(rows) && !saved.isPending && students.length > 0
  const dirty = correctionDirty(rows, reasonValue ?? '')

  // Kirli formdan sınıf/gün değiştirmek, geri/ileri ve başka sayfaya geçmek onay ister.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  )
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const onSubmit = form.handleSubmit(async ({ reason }) => {
    if (!canSave) return
    const sent = counts
    const marks = correctionMarks(rows)
    const result = await submitWithFreshState(records, {
      refreshClassVersion: async () => {
        const fresh = await classItem.refetch({ throwOnError: true })
        if (!fresh.data) throw new Error('Sınıf kaydı okunamadı.')
        return fresh.data.version
      },
      refreshSaved: async () => {
        const fresh = await saved.refetch({ throwOnError: true })
        return (fresh.data ?? []).map((row) => row.record)
      },
      send: (classVersion) =>
        correct.submit(
          { classId, date: day, marks, reason, classVersion },
          {
            setError: form.setError,
            // Gerekçe kuralı sunucudan da gelirse mesaj alanın altında görünür (toast değil).
            fieldFor: (error) =>
              error.code === 'correction_reason_required' ? 'reason' : undefined,
          },
        ),
    })
    if (result.kind === 'stale') {
      // Güncel yoklama yüklendi; seçimler ve gerekçe formda kalır, kullanıcı kontrol eder.
      notify.error(ATTENDANCE_CORRECTION_CHANGED_MESSAGE)
      return
    }
    if (result.kind === 'unavailable') {
      notify.error(
        'Güncel yoklama okunamadı. Bağlantıyı kontrol edip yeniden deneyin.',
        result.cause,
      )
      return
    }
    const next = formAfterSubmit({ edits, reason }, result.outcome)
    if (result.outcome.status === 'success') {
      setEdits({ ...next.edits })
      form.reset({ reason: next.reason })
      notify.success(savedMessage(sent))
    }
  })

  if (saved.error)
    return (
      <div className="border-t p-6">
        <QueryError error={saved.error} onRetry={() => void saved.refetch()} />
      </div>
    )
  return (
    <>
      <form
        noValidate
        aria-label={`${className} yoklama düzeltmesi`}
        onSubmit={(event) => void onSubmit(event)}
      >
        <p className="border-t px-6 py-3 text-sm max-[650px]:px-4">
          <strong className="font-semibold">{className}</strong> · {students.length} öğrenci ·{' '}
          {dayLabel(day)}
        </p>
        {firstEntries && students.length > 0 ? (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-3 border-t bg-surface-soft px-6 py-2 text-sm max-[650px]:px-4"
          >
            <p className="m-0">
              {notTaken
                ? 'Bu gün için yoklama alınmamış.'
                : 'Bu günde kaydı olmayan öğrenciler var.'}{' '}
              Her öğrencinin durumunu seçin ya da toplu işaretleyin; hepsi seçilmeden kaydedilemez.{' '}
              {FIRST_ENTRY_NOTE} Gerekçe yine zorunludur.
            </p>
            {counts.unselected > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setEdits(markUnselectedPresent(rows, edits))}
              >
                Seçilmeyenleri Geldi işaretle
              </Button>
            ) : null}
          </div>
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
            {rows.map((row) => (
              <li
                key={row.studentId}
                data-change={row.change}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 border-t px-6 py-3 max-[650px]:px-4',
                  row.change === 'changed' && 'bg-warning-soft',
                )}
              >
                <span className="person-cell flex min-w-0 items-center gap-2.5">
                  <Avatar name={row.name} size="small" />
                  <span className="grid min-w-0">
                    <span className="font-medium">{row.name}</span>
                    <span className="text-xs text-muted-foreground">
                      Mevcut: {row.currentLabel}
                    </span>
                  </span>
                  {row.change === 'changed' ? (
                    <StatusBadge text="Değişecek" tone="amber" />
                  ) : row.change === 'unselected' ? (
                    <StatusBadge text="Seçim bekliyor" tone="amber" />
                  ) : row.change === 'new' && !notTaken ? (
                    <StatusBadge text="Yeni kayıt" tone="gray" />
                  ) : null}
                </span>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={2}
                  value={row.next ?? ''}
                  onValueChange={(value) => {
                    if (value)
                      setEdits((current) => ({
                        ...current,
                        [row.studentId]: value as AttendanceStatus,
                      }))
                  }}
                  disabled={busy}
                  aria-label={`${row.name} yeni durum`}
                  className="grid w-full grid-cols-2 sm:flex sm:w-auto"
                >
                  {ATTENDANCE_OPTIONS.map((option) => (
                    <ToggleGroupItem
                      key={option.value}
                      value={option.value}
                      aria-label={`${row.name}: ${option.label}`}
                      className="min-h-9 data-[state=on]:border-current data-[state=on]:bg-primary-soft data-[state=on]:font-semibold data-[state=on]:text-primary"
                    >
                      {option.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-4 border-t px-6 py-4 max-[650px]:px-4">
          <FormField
            id="yoklama-duzeltme-gerekce"
            label="Düzeltme gerekçesi"
            description={
              firstEntries
                ? `Durumu değişen öğrencinin düzeltme geçmişine eski durumla birlikte yazılır. ${FIRST_ENTRY_NOTE}`
                : 'Değişen her öğrencinin düzeltme geçmişine eski durumla birlikte yazılır.'
            }
            error={form.formState.errors.reason}
          >
            {(control) => (
              <Textarea
                {...control}
                {...form.register('reason')}
                maxLength={500}
                rows={2}
                disabled={busy}
              />
            )}
          </FormField>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {counts.changed} öğrencinin durumu değişecek
              {counts.added > 0 ? ` · ${counts.added} öğrenci ilk kez kaydedilecek` : ''}
              {counts.unselected > 0 ? ` · ${counts.unselected} öğrencinin durumu seçilmedi` : ''}
            </p>
            <Button
              type="submit"
              disabled={busy || !canSave}
              aria-busy={busy || undefined}
              className="max-[650px]:w-full"
            >
              <Icon name="ClipboardCheck" size={17} aria-hidden="true" />
              Düzeltmeyi kaydet
            </Button>
          </div>
        </div>
      </form>
      <CorrectionHistory records={records} lookups={lookups} />
      <AlertDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Kaydedilmemiş değişiklikler var</AlertDialogTitle>
            <AlertDialogDescription>
              Yoklama seçimleriniz ve gerekçeniz kaydedilmedi. Sayfadan ayrılırsanız silinir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Düzenlemeye devam et</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                // Radix kendi kapanışını yapmasın; gezinme sürer ve sayfa yeniden kurulur.
                event.preventDefault()
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              Değişiklikleri at
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

type AttendanceRecord = CoreRecord<'attendance'>

/**
 * Günün düzeltme geçmişi: kayıtların `corrections` alanı (kim, ne zaman, gerekçe, eski → yeni).
 * Düzelten kişinin adı kurum kullanıcılarından çözülür (yalnız yönetici ve öğretmen düzeltir).
 */
function CorrectionHistory({
  records,
  lookups,
}: {
  records: readonly AttendanceRecord[]
  lookups: AcademicLookups
}) {
  const headingId = useId()
  const hasHistory = correctorIds(records).length > 0
  // Rol başına bütün kullanıcılar çekilir; sayfa sınırı kalabalık kurumda adı düşürürdü.
  const admins = useInstitutionMembersAll({ role: 'yonetici' }, { enabled: hasHistory })
  const teachers = useInstitutionMembersAll({ role: 'ogretmen' }, { enabled: hasHistory })
  const entries = useMemo(() => {
    const studentNames = new Map(
      [...lookups.students.values()].map((student) => [student.id, student.name]),
    )
    const userNames = new Map(
      [...(admins.data ?? []), ...(teachers.data ?? [])].map((member) => [
        member.userId,
        member.name,
      ]),
    )
    return correctionHistory(records, studentNames, userNames)
  }, [records, lookups.students, admins.data, teachers.data])

  return (
    <section aria-labelledby={headingId} className="border-t px-6 py-5 max-[650px]:px-4">
      <h2 id={headingId} className="text-base font-semibold">
        Düzeltme geçmişi
      </h2>
      {entries.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">Bu günün yoklaması düzeltilmemiş.</p>
      ) : (
        <ol className="m-0 mt-3 grid list-none gap-3 p-0" aria-label="Bu günün düzeltmeleri">
          {entries.map((entry) => (
            <li key={entry.key} className="grid gap-0.5 rounded-control border px-4 py-3 text-sm">
              <span className="font-medium">
                {entry.student}: {entry.previous} → {entry.next}
              </span>
              <span className="text-muted-foreground">
                {entry.by} ·{' '}
                {dateLabel(entry.at, { year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
              {entry.reason ? <span>Gerekçe: {entry.reason}</span> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
