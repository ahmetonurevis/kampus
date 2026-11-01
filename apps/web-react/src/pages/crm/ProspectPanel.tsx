import { useState } from 'react'
import { Link } from 'react-router'
import { dateLabel, dayKey } from '@kampus/school-core/lib/format.ts'
import {
  MEETING_DURATION,
  nextProspectStages,
  PROSPECT_LOST_REASON_LABELS,
  PROSPECT_LOST_REASONS,
  prospectStageLabel,
  type ProspectLostReason,
  type ProspectStage,
} from '@kampus/school-core/lib/prospects.ts'
import { meetingInstant } from '@kampus/school-core/lib/prospect-form.ts'
import {
  useAddProspectNote,
  useChangeProspectStage,
  useScheduleProspectMeeting,
} from '@kampus/react-shared/use-prospect-commands.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

const LOST: ProspectStage = 'Vazgeçti'
const DETAIL_TIME = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const

/**
 * Aday kartı (DOM-KAY-005, -030…-033): aşama yalnız ileri gider, vazgeçme nedenle girilir, not
 * eklenir ve değişmez, görüşme planlanır. Komutlar okunan sürümü `If-Match` taşır; kart bayatsa
 * sunucu 409 verir, mesaj gösterilir ve kart tazelenir. Kesin kayıt ayrı sayfadadır.
 */
export function ProspectPanel({
  prospectId,
  onClose,
}: {
  prospectId: string
  onClose: () => void
}) {
  return (
    <SidePanel
      open={prospectId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title="Aday kartı"
    >
      {prospectId ? <ProspectCard prospectId={prospectId} /> : null}
    </SidePanel>
  )
}

function ProspectCard({ prospectId }: { prospectId: string }) {
  const { session } = useAuth()
  const institutionType = session?.institution.type ?? 'school'
  const item = useCoreItem('prospects', prospectId)
  if (item.error) return <QueryError error={item.error} onRetry={() => void item.refetch()} />
  if (!item.data) return <SummaryLoading />
  const prospect = item.data.record
  const version = item.data.version
  const enrolled = prospect.stage === 'Kayıt oldu'
  const closed = enrolled || prospect.stage === LOST
  const meeting = prospect.meeting
  // Eski kayıtta görüşme anı `trialAt`'tedir; süre ve oda yoktur.
  const meetingDate = meeting?.date ?? prospect.trialAt

  return (
    <div className="grid gap-6">
      <section className="grid gap-1 text-sm">
        <h3 className="text-lg font-semibold">{prospect.name}</h3>
        <div>
          <StatusBadge text={prospectStageLabel(prospect.stage, institutionType)} />
        </div>
        <p>{prospect.phone}</p>
        {prospect.email ? <p>{prospect.email}</p> : null}
        <p>{prospect.interest}</p>
        <p className="text-muted-foreground">Kaynak: {prospect.source}</p>
        {prospect.guardianName ? (
          <p className="text-muted-foreground">Veli: {prospect.guardianName}</p>
        ) : null}
        {prospect.lostReason ? (
          <p className="text-muted-foreground">
            Vazgeçme nedeni: {PROSPECT_LOST_REASON_LABELS[prospect.lostReason]}
          </p>
        ) : null}
      </section>

      {!enrolled ? (
        <StageForm
          prospectId={prospectId}
          version={version}
          stage={prospect.stage ?? ''}
          key={prospect.stage}
        />
      ) : null}

      {!closed ? (
        <Button asChild>
          <Link to={`../kayit-islemleri?aday=${encodeURIComponent(prospectId)}`} relative="path">
            Kesin kayda dönüştür
          </Link>
        </Button>
      ) : null}

      <section className="grid gap-3" aria-labelledby="aday-gorusme">
        <h3 id="aday-gorusme" className="font-semibold">
          Tanışma görüşmesi
        </h3>
        {meetingDate ? (
          <p className="text-sm">
            {dateLabel(meetingDate, DETAIL_TIME)}
            {meeting ? ` · ${String(meeting.duration)} dk · ${meeting.room}` : ''}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Planlanmış görüşme yok.</p>
        )}
        {!closed ? <MeetingForm prospectId={prospectId} version={version} /> : null}
      </section>

      <section className="grid gap-3" aria-labelledby="aday-notlari">
        <h3 id="aday-notlari" className="font-semibold">
          İletişim geçmişi
        </h3>
        {!closed ? <NoteForm prospectId={prospectId} version={version} /> : null}
        {prospect.notes?.length ? (
          <ul className="grid gap-3 text-sm">
            {prospect.notes.map((note) => (
              <li key={note.id} className="border-l-2 pl-3">
                <small className="text-muted-foreground">
                  {dateLabel(note.date, DETAIL_TIME)} · {note.author}
                </small>
                <p className="whitespace-pre-wrap">{note.text}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Henüz not yok.</p>
        )}
      </section>
    </div>
  )
}

function StageForm({
  prospectId,
  version,
  stage,
}: {
  prospectId: string
  version: number
  stage: string
}) {
  const { session } = useAuth()
  const change = useChangeProspectStage()
  const options = nextProspectStages(stage)
  const [next, setNext] = useState<ProspectStage | ''>(options[0] ?? '')
  const [reason, setReason] = useState<ProspectLostReason | ''>('')
  const [error, setError] = useState('')
  if (options.length === 0) return null

  async function submit() {
    if (next === '') return
    if (next === LOST && reason === '') {
      setError('Vazgeçme nedenini seçin.')
      return
    }
    setError('')
    const outcome = await change.submit(
      {
        prospectId,
        version,
        body: { stage: next, ...(next === LOST && reason !== '' ? { lostReason: reason } : {}) },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') notify.success('Aday aşaması güncellendi.')
  }

  const busy = change.isPending
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id="aday-asama" label="Yeni aşama" error={error ? { message: error } : undefined}>
        {(control) => (
          <NativeSelect
            {...control}
            value={next}
            disabled={busy}
            onChange={(event) => setNext(event.target.value as ProspectStage)}
          >
            {options.map((option) => (
              <NativeSelectOption key={option} value={option}>
                {prospectStageLabel(option, session?.institution.type ?? 'school')}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </FormField>
      {next === LOST ? (
        <FormField id="aday-neden" label="Vazgeçme nedeni">
          {(control) => (
            <NativeSelect
              {...control}
              value={reason}
              disabled={busy}
              onChange={(event) => setReason(event.target.value as ProspectLostReason)}
            >
              <NativeSelectOption value="">Neden seçin</NativeSelectOption>
              {PROSPECT_LOST_REASONS.map((item) => (
                <NativeSelectOption key={item} value={item}>
                  {PROSPECT_LOST_REASON_LABELS[item]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </FormField>
      ) : null}
      <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
        Aşamayı güncelle
      </Button>
    </form>
  )
}

function NoteForm({ prospectId, version }: { prospectId: string; version: number }) {
  const addNote = useAddProspectNote()
  const [text, setText] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    if (text.trim().length < 2) {
      setError('Görüşme notunu yazın.')
      return
    }
    setError('')
    const outcome = await addNote.submit(
      { prospectId, version, body: { text } },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Görüşme notu eklendi.')
      setText('')
    }
  }

  const busy = addNote.isPending
  return (
    <form
      noValidate
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id="aday-not" label="Görüşme notu" error={error ? { message: error } : undefined}>
        {(control) => (
          <Textarea
            {...control}
            value={text}
            maxLength={2000}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
        )}
      </FormField>
      <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
        Notu kaydet
      </Button>
    </form>
  )
}

function MeetingForm({ prospectId, version }: { prospectId: string; version: number }) {
  const schedule = useScheduleProspectMeeting()
  const today = dayKey()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('14:00')
  const [duration, setDuration] = useState(String(MEETING_DURATION.default))
  const [room, setRoom] = useState('')
  const [error, setError] = useState('')

  async function submit() {
    const instant = meetingInstant(date, time)
    if (instant === null) {
      setError('Geçerli bir tarih ve saat seçin.')
      return
    }
    if (room.trim() === '') {
      setError('Görüşme odasını yazın.')
      return
    }
    setError('')
    const outcome = await schedule.submit(
      {
        prospectId,
        version,
        body: { date: instant, duration: Number(duration), room: room.trim() },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') notify.success('Tanışma görüşmesi planlandı.')
  }

  const busy = schedule.isPending
  return (
    <form
      noValidate
      className="grid grid-cols-2 gap-3 max-[420px]:grid-cols-1"
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <FormField id="gorusme-tarih" label="Tarih">
        {(control) => (
          <Input
            {...control}
            type="date"
            min={today}
            value={date}
            disabled={busy}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </FormField>
      <FormField id="gorusme-saat" label="Saat">
        {(control) => (
          <Input
            {...control}
            type="time"
            value={time}
            disabled={busy}
            onChange={(event) => setTime(event.target.value)}
          />
        )}
      </FormField>
      <FormField id="gorusme-sure" label="Süre (dakika)">
        {(control) => (
          <Input
            {...control}
            type="number"
            min={MEETING_DURATION.min}
            max={MEETING_DURATION.max}
            value={duration}
            disabled={busy}
            onChange={(event) => setDuration(event.target.value)}
          />
        )}
      </FormField>
      <FormField id="gorusme-oda" label="Görüşme odası">
        {(control) => (
          <Input
            {...control}
            value={room}
            disabled={busy}
            onChange={(event) => setRoom(event.target.value)}
          />
        )}
      </FormField>
      {error ? (
        <p role="alert" className="col-span-full text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        className="col-span-full"
        disabled={busy}
        aria-busy={busy || undefined}
      >
        Görüşmeyi planla
      </Button>
    </form>
  )
}
