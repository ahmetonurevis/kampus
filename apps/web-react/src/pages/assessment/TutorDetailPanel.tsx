import { useId, useState } from 'react'
import {
  useCancelTutorSession,
  useRecordTutorAttendance,
  type TutorAttendanceMark,
} from '@kampus/react-shared/use-tutoring-commands.ts'
import { FormField } from '@/components/FormField.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { notify } from '@/lib/notify.ts'
import { ATTENDANCE_MARKS, attendanceDefaults, type TutorRow } from './tutoring-model.ts'

type Props = {
  /** URL'deki etüt kimliği (`?etut=`); boşsa panel kapalı. */
  selectedId: string
  row: TutorRow | undefined
  pending: boolean
  /** Etüt kaydının okunan sürümü (`If-Match`). */
  version: number | undefined
  onClose: () => void
}

type Mode = 'view' | 'cancel' | 'attendance'

/**
 * Etüt ayrıntısı (sağ panel): salt okunur bilgi; yazma yetkisi olan rolde iptal ve yoklama. Öğrenci
 * ve veli yalnız kendi kapsamındaki öğrencileri görür (core `tutoringSessions` daraltır), işlem
 * düğmesi görmez.
 */
export function TutorDetailPanel({ selectedId, row, pending, version, onClose }: Props) {
  const title = row ? row.title : pending ? 'Etüt yükleniyor' : 'Etüt bulunamadı'
  return (
    <SidePanel
      open={Boolean(selectedId)}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
    >
      {row ? (
        // Etüt değişince form durumu sıfırlanır (başka etütten kalan gerekçe/işaret taşınmaz).
        <DetailBody key={row.id} row={row} version={version} />
      ) : pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Etüt yükleniyor…
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Etüt mevcut rol veya çocuk kapsamında bulunamadı. Listeye dönüp yeniden seçin.
        </p>
      )}
    </SidePanel>
  )
}

type BodyProps = { row: TutorRow; version: number | undefined }

function DetailBody({ row, version }: BodyProps) {
  const [mode, setMode] = useState<Mode>('view')
  return (
    <div className="grid gap-5">
      <div>
        <StatusBadge text={row.status} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Tarih</dt>
        <dd>{row.when}</dd>
        <dt className="text-muted-foreground">Öğretmen</dt>
        <dd>{row.teacher}</dd>
        <dt className="text-muted-foreground">Derslik</dt>
        <dd>{row.room}</dd>
        <dt className="text-muted-foreground">Başarı eşiği</dt>
        <dd>%{row.threshold}</dd>
      </dl>
      {row.cancelReason ? (
        <section className="grid gap-1 border-t pt-4">
          <h3 className="text-sm font-semibold">İptal nedeni</h3>
          <p className="text-sm text-muted-foreground">{row.cancelReason}</p>
        </section>
      ) : null}
      <section className="grid gap-2 border-t pt-4">
        <h3 className="text-sm font-semibold">Öğrenciler ({row.studentCount})</h3>
        <ul className="grid gap-1 text-sm">
          {row.students.map((student) => (
            <li key={student.id} className="flex items-center justify-between gap-3">
              <span>{student.name}</span>
              <span className="text-muted-foreground">{student.mark || 'Yoklama yok'}</span>
            </li>
          ))}
        </ul>
      </section>
      {mode === 'view' && (row.attendanceOpen || row.cancellable) ? (
        <div className="flex flex-wrap gap-2 border-t pt-4">
          {row.attendanceOpen ? (
            <Button onClick={() => setMode('attendance')}>Yoklama al / güncelle</Button>
          ) : null}
          {row.cancellable ? (
            <Button variant="secondary" onClick={() => setMode('cancel')}>
              Etüdü iptal et
            </Button>
          ) : null}
        </div>
      ) : null}
      {mode === 'cancel' ? (
        <CancelForm row={row} version={version} onDone={() => setMode('view')} />
      ) : null}
      {mode === 'attendance' ? (
        <AttendanceForm row={row} version={version} onDone={() => setMode('view')} />
      ) : null}
    </div>
  )
}

type FormProps = { row: TutorRow; version: number | undefined; onDone: () => void }

function CancelForm({ row, version, onDone }: FormProps) {
  const id = useId()
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const cancel = useCancelTutorSession()

  async function submit() {
    const trimmed = reason.trim()
    if (trimmed.length < 2) {
      setError('İptal nedenini girin.')
      return
    }
    setError('')
    const outcome = await cancel.submit(
      { sessionId: row.id, reason: trimmed, version },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Etüt iptal edildi.')
      onDone()
    }
  }

  return (
    <form
      className="grid gap-3 border-t pt-4"
      aria-label="Etüdü iptal et"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id={id} label="İptal nedeni" error={error ? { message: error } : undefined}>
        {(control) => (
          <Textarea
            {...control}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </FormField>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={cancel.isPending} aria-busy={cancel.isPending}>
          İptali onayla
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}

function AttendanceForm({ row, version, onDone }: FormProps) {
  const prefix = useId()
  const [marks, setMarks] = useState<Record<string, TutorAttendanceMark>>(() =>
    attendanceDefaults(row),
  )
  const record = useRecordTutorAttendance()

  async function submit() {
    const outcome = await record.submit({ sessionId: row.id, marks, version })
    if (outcome.status === 'success') {
      notify.success('Yoklama kaydedildi.')
      onDone()
    }
  }

  return (
    <form
      className="grid gap-3 border-t pt-4"
      aria-label="Etüt yoklaması"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      {row.students.map((student) => (
        <FormField key={student.id} id={`${prefix}-${student.id}`} label={student.name}>
          {(control) => (
            <NativeSelect
              {...control}
              className="w-full"
              value={marks[student.id] ?? 'Geldi'}
              onChange={(event) =>
                setMarks((current) => ({
                  ...current,
                  [student.id]: event.target.value as TutorAttendanceMark,
                }))
              }
            >
              {ATTENDANCE_MARKS.map((mark) => (
                <NativeSelectOption key={mark} value={mark}>
                  {mark}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={record.isPending} aria-busy={record.isPending}>
          Yoklamayı kaydet
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Vazgeç
        </Button>
      </div>
    </form>
  )
}
