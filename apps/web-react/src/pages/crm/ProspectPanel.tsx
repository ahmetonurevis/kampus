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
import {
  meetingInstant,
  trialLessonOptions,
  trialLessonUsed,
} from '@kampus/school-core/lib/prospect-form.ts'
import {
  useAddProspectNote,
  useChangeProspectStage,
  useScheduleProspectMeeting,
  useScheduleTrialLesson,
} from '@kampus/react-shared/use-prospect-commands.ts'
import { useAuth } from '@/auth/use-auth.ts'
import { FormField } from '@/components/FormField.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { SidePanel } from '@/components/SidePanel.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { useCoreAll, useCoreItem } from '@/hooks/use-core-collection.ts'
import { notify } from '@/lib/notify.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'

const LOST: ProspectStage = 'Vazgeçti'
const DETAIL_TIME = { year: 'numeric', hour: '2-digit', minute: '2-digit' } as const

/**
 * Aday kartı (DOM-KAY-005, -030…-033): aşama yalnız ileri gider, vazgeçme nedenle girilir, not
 * eklenir ve değişmez, görüşme planlanır. Komutlar okunan sürümü `If-Match` taşır; kart bayatsa
 * sunucu 409 verir, mesaj gösterilir ve kart tazelenir. Kesin kayıt ayrı sayfadadır. Dil okulunda
 * deneme dersi de buradan planlanır (DOM-DIL-030).
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
          phone={prospect.phone ?? ''}
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

      {institutionType === 'language_school' ? (
        <TrialLessonSection
          prospectId={prospectId}
          version={version}
          branchId={prospect.branchId ?? ''}
          minor={prospect.minor !== false}
          trial={prospect.trialLesson}
          closed={closed}
        />
      ) : null}

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

/** Sunucu kuralları (kapasite, kampüs, çakışma) `scheduleTrialLesson`'dadır; liste yalnız ön süzgeç. */
function TrialLessonSection({
  prospectId,
  version,
  branchId,
  minor,
  trial,
  closed,
}: {
  prospectId: string
  version: number
  branchId: string
  minor: boolean
  trial: { lessonId: string; date: string; duration: number } | undefined
  closed: boolean
}) {
  const schedule = useCoreAll('schedule')
  const classes = useCoreAll('classes')
  const submit = useScheduleTrialLesson()
  const [lessonId, setLessonId] = useState('')
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  // Kart açıkken sabit: seçenek listesi her çizimde değişmesin; son kararı sunucu verir.
  const [now] = useState(() => new Date().toISOString())
  const lessons = (schedule.data ?? []).map((row) => ({ ...row.record, id: row.id }))
  const groups = (classes.data ?? []).map((row) => ({ ...row.record, id: row.id }))
  const options = trialLessonOptions(lessons, groups, branchId, now)
  const used = trialLessonUsed(trial, lessons, now)
  const busy = submit.isPending
  const loadError = schedule.error ?? classes.error

  async function send() {
    if (lessonId === '') {
      setError('Deneme dersini seçin.')
      return
    }
    setError('')
    const outcome = await submit.submit(
      {
        prospectId,
        version,
        body: { lessonId, ...(minor ? { guardianConsent: consent } : {}) },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') {
      notify.success('Deneme dersi planlandı.')
      setLessonId('')
      setConsent(false)
    }
  }

  return (
    <section className="grid gap-3" aria-labelledby="aday-deneme">
      <h3 id="aday-deneme" className="font-semibold">
        Deneme dersi
      </h3>
      {trial ? (
        <p className="text-sm">
          {dateLabel(trial.date, DETAIL_TIME)} · {String(trial.duration)} dk
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Planlanmış deneme dersi yok.</p>
      )}
      {loadError ? (
        <QueryError
          error={loadError}
          onRetry={() => {
            void schedule.refetch()
            void classes.refetch()
          }}
        />
      ) : closed || used ? null : (
        <form
          noValidate
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <FormField
            id="deneme-ders"
            label="Ders"
            error={error ? { message: error } : undefined}
            description="Adayın kampüsündeki açık grupların yaklaşan dersleri."
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={lessonId}
                disabled={busy}
                onChange={(event) => setLessonId(event.target.value)}
              >
                <NativeSelectOption value="">Ders seçin</NativeSelectOption>
                {options.map((option) => (
                  <NativeSelectOption key={option.id} value={option.id}>
                    {dateLabel(option.date, DETAIL_TIME)} · {option.className}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </FormField>
          {minor ? (
            <label className="flex min-h-6 items-center gap-2 text-sm">
              <Checkbox
                checked={consent}
                disabled={busy}
                onCheckedChange={(checked) => setConsent(checked === true)}
              />
              Veli, deneme dersine katılım için onay verdi
            </label>
          ) : null}
          <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy || undefined}>
            Deneme dersini planla
          </Button>
        </form>
      )}
    </section>
  )
}

function StageForm({
  prospectId,
  version,
  stage,
  phone,
}: {
  prospectId: string
  version: number
  stage: string
  phone: string
}) {
  const { session } = useAuth()
  const change = useChangeProspectStage()
  const options = nextProspectStages(stage)
  const [next, setNext] = useState<ProspectStage | ''>(options[0] ?? '')
  const [reason, setReason] = useState<ProspectLostReason | ''>('')
  const [error, setError] = useState('')
  // Telefonu paylaşan adayı yeniden açmak kardeş seçimi ister (DOM-KAY-031).
  const [sharedContact, setSharedContact] = useState(false)
  const [siblingOfId, setSiblingOfId] = useState('')
  const prospects = useCoreAll('prospects', {}, { enabled: sharedContact })
  if (options.length === 0) return null
  const siblings = (prospects.data ?? []).filter(
    (row) => row.id !== prospectId && row.record.phone === phone,
  )

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
        body: {
          stage: next,
          ...(next === LOST && reason !== '' ? { lostReason: reason } : {}),
          ...(siblingOfId === '' ? {} : { siblingOfId }),
        },
      },
      { setError: (_name, issue) => setError(issue.message) },
    )
    if (outcome.status === 'success') notify.success('Aday aşaması güncellendi.')
    else if (outcome.status === 'failed' && outcome.error.code === 'prospect_contact_shared')
      setSharedContact(true)
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
      {sharedContact ? (
        <FormField
          id="aday-asama-kardes"
          label="Kardeş aday"
          description="Bu telefon başka bir adayda kayıtlı. Kardeşse seçin."
        >
          {(control) => (
            <NativeSelect
              {...control}
              value={siblingOfId}
              disabled={busy}
              onChange={(event) => setSiblingOfId(event.target.value)}
            >
              <NativeSelectOption value="">Aday seçin</NativeSelectOption>
              {siblings.map((row) => (
                <NativeSelectOption key={row.id} value={row.id}>
                  {row.record.name}
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
