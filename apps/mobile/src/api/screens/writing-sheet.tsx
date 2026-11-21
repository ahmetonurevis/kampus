import { useEffect, useRef, useState, type RefObject } from 'react'
import { Alert, AppState, View } from 'react-native'
import { isApiError } from '@kampus/api-client/errors.ts'
import { learnerSubmissionsQuery } from '@kampus/react-shared/use-learner-task-progress.ts'
import {
  isLearnerAssignment,
  isNotFoundError,
  resubmissionPending,
  submittedTextLabel,
  writingBrief,
  writingInitialBody,
  writingProgress,
} from '@kampus/react-shared/student-task-model.ts'
import { dateTimeLabel } from '@kampus/react-shared/task-labels.ts'
import { useDraftAutosave, type DraftSaveState } from '@kampus/react-shared/use-draft-autosave.ts'
import { useTaskAssignment } from '@kampus/react-shared/use-task-assignments.ts'
import {
  useSubmitTaskDraft,
  useTaskDraft,
  useTaskSubmission,
  useTaskSubmissions,
  type TaskDraft,
  type TaskSubmissionDetail,
} from '@kampus/react-shared/use-task-submissions.ts'
import { liveWordCount } from '@kampus/react-shared/writing-model.ts'
import { Badge, Button, Field, Sheet, T } from '../../ui/components.tsx'
import { DetailPair, Notice, Section, TextAction } from '../../ui/SchoolLayout.tsx'
import { useNow } from '../../ui/use-now.ts'
import type { CommandFailure } from '../command-failure.ts'
import { submissionVersions } from '../parent-learning.ts'
import { ListLoading, QueryError } from '../QueryState.tsx'
import {
  SUBMIT_CONFIRM_TEXT,
  SUBMIT_DONE_TEXT,
  UNSAVED_CLOSE_TEXT,
  UNSAVED_CLOSE_TITLE,
  autosaveEnabled,
  checkWritingBody,
  closeNeedsConfirm,
  draftStatusText,
  initialWritingMode,
  mobileTone,
  newVersionText,
  submitWriting,
  writingFieldFor,
  writingSheetReady,
  type WritingMode,
} from '../student-writing.ts'
import { useNotify } from '../toast.tsx'

type DraftStatus = { state: DraftSaveState; savedAt: string | null; conflict: boolean }
type DraftControl = {
  flush: (text: string) => Promise<number | null>
  saveNow: () => void
  conflict: boolean
}

/**
 * Bir yazma oturumunun taslak kaydı (web `WritingEditor` içindeki `useDraftAutosave`): editör her
 * açılışta yeni anahtarla kurulur, böylece kayıt modeli o anki taslak ve açılış metniyle başlar.
 * Görünmez; durumu pencerenin sabit alt bilgisine `onStatus` ile, teslim ve arka plan kaydı için
 * denetimi `control` ile verir. Kaldırılınca bekleyen değişiklik kaydedilir (kanca kuralı).
 */
function DraftSession({
  assignmentId,
  draft,
  initialBody,
  body,
  enabled,
  onAdopt,
  onStatus,
  control,
}: {
  assignmentId: string
  draft: TaskDraft | null
  initialBody: string
  body: string
  enabled: boolean
  onAdopt: (text: string) => void
  onStatus: (status: DraftStatus) => void
  control: RefObject<DraftControl | null>
}) {
  const autosave = useDraftAutosave({ assignmentId, draft, initialBody, body, enabled, onAdopt })
  const { state, savedAt, conflict, flush, saveNow } = autosave
  useEffect(() => {
    onStatus({ state, savedAt, conflict })
  }, [state, savedAt, conflict, onStatus])
  useEffect(() => {
    control.current = { flush, saveNow, conflict }
  }, [control, flush, saveNow, conflict])
  useEffect(
    () => () => {
      control.current = null
    },
    [control],
  )
  return null
}

/**
 * Öğrencinin yazma görevi penceresi (web `StudentWritingWorkspace` + `WritingEditor`; IST-047,
 * IST-124): yönerge ve kaynak gösterimi, durum ve haklar, çok satırlı metin, canlı sözcük sayacı,
 * otomatik taslak kaydı, onaylı teslim, gönderilen sürümler ve açılmışsa öğretmen geri bildirimi.
 * Teslim edilebilirlik sunucunun `allowance`'ındandır; puan yalnız kesinleşince görünür
 * (DOM-BEC-045). Sayaç ve kayıt durumu pencerenin sabit alt bilgisindedir: klavye açıkken alan ve
 * "Teslim et" birlikte görünür. Uygulama arka plana geçerken bekleyen taslak kaydedilir. Metin
 * yalnız bellekte ve sunucudadır, cihaza yazılmaz.
 */
export function WritingSheet({
  assignmentId,
  onClose,
}: {
  assignmentId: string
  onClose: () => void
}) {
  const notify = useNotify()
  const assignmentQuery = useTaskAssignment(assignmentId)
  const listQuery = useTaskSubmissions(learnerSubmissionsQuery(assignmentId))
  const summary = listQuery.data?.data[0]
  const detailQuery = useTaskSubmission(summary?.id ?? '')
  const draftQuery = useTaskDraft(assignmentId)
  const submitDraft = useSubmitTaskDraft()
  const now = useNow()

  const [mode, setMode] = useState<WritingMode | null>(null)
  const [session, setSession] = useState(0)
  const [body, setBody] = useState('')
  const [initialBody, setInitialBody] = useState('')
  const [status, setStatus] = useState<DraftStatus>({
    state: 'idle',
    savedAt: null,
    conflict: false,
  })
  const [confirming, setConfirming] = useState(false)
  const [flushing, setFlushing] = useState(false)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [failure, setFailure] = useState<CommandFailure | null>(null)
  const control = useRef<DraftControl | null>(null)
  const busy = flushing || submitDraft.isPending

  // Uygulama arka plana geçerken bekleyen taslak hemen kaydedilir (zamanlayıcı beklenmez).
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') control.current?.saveNow()
    })
    return () => subscription.remove()
  }, [])

  const assignment =
    assignmentQuery.data && isLearnerAssignment(assignmentQuery.data.data)
      ? assignmentQuery.data.data
      : undefined
  const detail = detailQuery.data?.data
  const draft = draftQuery.data?.data ?? null
  const missing = isNotFoundError(assignmentQuery.error)
  // Teslim listesi `useQuery` ile okunur (hata tipi genel); istek katmanı yalnız `ApiError` fırlatır.
  const listError = isApiError(listQuery.error) ? listQuery.error : null
  // Taslak sorgusu yüklenemediyse (henüz verisi yokken) editör ve otomatik kayıt açılmaz; sonradan
  // başarısız olan arka plan tazelemesi açık editörü kapatmaz.
  const draftError = draftQuery.data ? null : draftQuery.error
  const error = missing
    ? null
    : (assignmentQuery.error ?? listError ?? detailQuery.error ?? draftError)
  const waitingDetail = summary !== undefined && !detail && !detailQuery.error
  const loaded = writingSheetReady({
    hasAssignment: !!assignment,
    hasList: !!listQuery.data,
    draftPending: draftQuery.isPending,
    draftFailed: !!draftError,
    waitingDetail,
  })
  const textKind = assignment?.submission?.submissionKind === 'text'
  const progress = assignment ? writingProgress(assignment, detail ?? summary ?? null, now) : null
  const canAct = (progress?.canAct ?? false) && textKind
  const versionCount = detail?.versionCount ?? 0

  function openEditor(target: TaskSubmissionDetail | undefined) {
    const text = writingInitialBody(draft, target, resubmissionPending(target))
    setInitialBody(text)
    setBody(text)
    setSession((value) => value + 1)
    setConfirming(false)
    setFailure(null)
    setFieldError(null)
    setMode('editor')
  }

  // Açılış kipi bir kez, veriler gelince seçilir (sonraki tazelemeler kipi değiştirmez).
  if (loaded && mode === null) {
    const initial = initialWritingMode({
      canAct,
      versionCount,
      draftSavedAt: draft?.savedAt ?? null,
      latestSubmittedAt: detail?.versions.at(-1)?.submittedAt ?? null,
    })
    if (initial === 'editor') openEditor(detail)
    else setMode('readonly')
  }

  const editing = mode === 'editor' && canAct
  const limits = {
    minWords:
      assignment?.submission?.submissionKind === 'text' ? assignment.submission.minWords : null,
    maxWords:
      assignment?.submission?.submissionKind === 'text' ? assignment.submission.maxWords : null,
  }
  const words = liveWordCount(body, limits)

  function changeBody(text: string) {
    setBody(text)
    setFieldError(null)
    if (failure) setFailure(null)
  }

  function askConfirm() {
    const problem = checkWritingBody(body)
    if (problem) {
      setFieldError(problem)
      return
    }
    setFailure(null)
    setConfirming(true)
  }

  async function submit() {
    const current = control.current
    if (busy || !current) return
    setFailure(null)
    setFlushing(true)
    let result: Awaited<ReturnType<typeof submitWriting>>
    try {
      // Kayıt başarısızsa teslim gitmez, metin ekranda kalır (karar `submitWriting`'dedir).
      result = await submitWriting({
        text: body,
        hadConflict: current.conflict,
        flush: current.flush,
        send: (revision, collector) =>
          submitDraft.submit(
            { assignmentId, revision },
            {
              setError: collector.setError,
              fieldFor: writingFieldFor,
              // Hata pencerenin içinde gösterilir; toast aynı hatayı ikinci kez söylemesin.
              silent: () => true,
            },
          ),
      })
    } finally {
      setFlushing(false)
    }
    if (result.kind === 'busy') return
    if (result.kind === 'not-saved') {
      setConfirming(false)
      setFailure(result.failure)
      return
    }
    if (result.kind === 'failed') {
      setFieldError(result.fieldError)
      setFailure(result.failure.message ? result.failure : null)
      if (!result.failure.retryable) setConfirming(false)
      return
    }
    setConfirming(false)
    setMode('readonly')
    notify(SUBMIT_DONE_TEXT)
  }

  /**
   * Kaydedilmemiş metin varken (kayıt hatası ya da çakışma) kapatmadan önce sorar: metin cihaza
   * yazılmadığı için kapatınca kaybolur (KVKK).
   */
  function confirmLoss(proceed: () => void) {
    if (!closeNeedsConfirm({ editing, state: status.state, conflict: status.conflict })) {
      proceed()
      return
    }
    Alert.alert(UNSAVED_CLOSE_TITLE, UNSAVED_CLOSE_TEXT, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Yine de kapat', style: 'destructive', onPress: proceed },
    ])
  }

  function leaveEditor() {
    // Kaldırılan oturum bekleyen değişikliği kaydeder; metin taslakta kalır.
    confirmLoss(() => {
      setConfirming(false)
      setMode('readonly')
    })
  }

  const title = assignment?.title ?? 'Yazma görevi'
  const retry = failure?.retryable === true
  // Alt bilgi kısa kalır (sayaç, durum, düğmeler): büyük yazı ve açık klavyede alan ezilmesin. Onay
  // ve hata bildirimleri kaydırılabilir gövdededir.
  const editorFooter = (
    <View style={{ gap: 8 }}>
      <T muted size={13}>
        {words.label}
      </T>
      <T muted size={13} accessibilityLiveRegion="polite">
        {draftStatusText({ ...status, canSubmit: canAct })}
      </T>
      {!!words.warning && (
        <T size={13} accessibilityLiveRegion="polite">
          {words.warning}
        </T>
      )}
      {!!failure?.message && (
        <T size={13} accessibilityLiveRegion="polite">
          Teslim edilemedi; ayrıntı metnin altında.
        </T>
      )}
      {confirming ? (
        <View style={{ gap: 8 }}>
          <Button
            primary
            icon="Send"
            disabled={busy}
            label={busy ? 'Teslim ediliyor' : retry ? 'Yeniden dene' : 'Evet, teslim et'}
            onPress={() => void submit()}
          >
            {busy ? 'Teslim ediliyor…' : retry ? 'Yeniden dene' : 'Evet, teslim et'}
          </Button>
          <Button disabled={busy} onPress={() => setConfirming(false)}>
            Vazgeç
          </Button>
        </View>
      ) : (
        <Button primary icon="Send" disabled={!canAct || busy} onPress={askConfirm}>
          Teslim et
        </Button>
      )}
    </View>
  )
  const readonlyFooter =
    mode === 'readonly' && canAct ? (
      <Button primary icon="Pencil" onPress={() => openEditor(detail)}>
        {newVersionText(versionCount)}
      </Button>
    ) : undefined

  return (
    <Sheet
      visible
      title={title}
      onClose={() => confirmLoss(onClose)}
      footer={editing ? editorFooter : readonlyFooter}
      pinFooter
    >
      {missing ? (
        <Notice title="Görev bulunamadı" text="Bu görev sana atanmamış ya da teslim beklemiyor." />
      ) : error ? (
        <QueryError
          error={error}
          onRetry={() => {
            if (assignmentQuery.error) void assignmentQuery.refetch()
            if (listQuery.error) void listQuery.refetch()
            if (detailQuery.error) void detailQuery.refetch()
            if (draftError) void draftQuery.refetch()
          }}
        />
      ) : !loaded || !assignment || !progress ? (
        <ListLoading label="Görev yükleniyor…" />
      ) : (
        <>
          <TaskBrief assignment={assignment} progress={progress} detail={detail} />
          {!textKind ? (
            <Notice title="Telefonda açılmıyor" text="Bu görev yazılı metinle teslim edilmiyor." />
          ) : editing ? (
            <View style={{ gap: 8 }}>
              <Field
                label="Metnin"
                value={body}
                onChange={changeBody}
                multiline
                tall
                editable={!busy}
                error={fieldError ?? undefined}
                placeholder="Metnini buraya yaz"
              />
              {!!failure?.message && (
                <Notice tone="red" title="Teslim edilemedi" text={failure.message}>
                  {retry && (
                    <T size={13}>Metin iletilmiş olabilir; yeniden denemek mükerrer sürüm açmaz.</T>
                  )}
                </Notice>
              )}
              {confirming && <Notice title="Teslim edilsin mi?" text={SUBMIT_CONFIRM_TEXT} />}
              {versionCount > 0 && (
                <TextAction disabled={busy} onPress={leaveEditor}>
                  Gönderdiklerime dön
                </TextAction>
              )}
              <DraftSession
                key={session}
                assignmentId={assignmentId}
                draft={draft}
                initialBody={initialBody}
                body={body}
                enabled={autosaveEnabled({ ready: loaded, canAct, busy })}
                onAdopt={setBody}
                onStatus={setStatus}
                control={control}
              />
            </View>
          ) : !progress.canAct && progress.blockedReason ? (
            <Notice title="Teslim kapalı" text={progress.blockedReason} />
          ) : null}
          {!editing && detail && detail.versions.length > 0 && (
            <SubmittedVersions versions={detail.versions} />
          )}
        </>
      )}
    </Sheet>
  )
}

/** Yönerge, kaynak gösterimi ve durum bilgileri (web "Görev bilgileri"). */
function TaskBrief({
  assignment,
  progress,
  detail,
}: {
  assignment: Parameters<typeof writingBrief>[0]
  progress: NonNullable<ReturnType<typeof writingProgress>>
  detail: TaskSubmissionDetail | undefined
}) {
  const brief = writingBrief(assignment)
  const request = resubmissionPending(detail) ? (detail?.resubmission ?? null) : null
  return (
    <Section title="Görev bilgileri" panel>
      {!!brief.instructions && (
        <View style={{ gap: 4 }}>
          <T bold size={14}>
            Yönerge
          </T>
          <T size={15}>{brief.instructions}</T>
        </View>
      )}
      {!!brief.notice && (
        <T muted size={14}>
          {brief.notice}
        </T>
      )}
      {brief.attributions.length > 0 && (
        <View style={{ gap: 4 }}>
          <T bold size={14}>
            Kaynak gösterimi
          </T>
          {brief.attributions.map((item) => (
            <T key={`${item.work}:${item.author}:${item.source}`} muted size={13}>
              {item.work} — {item.author}, {item.source}
              {item.year ? ` (${item.year})` : ''}
            </T>
          ))}
        </View>
      )}
      <View style={{ gap: 12 }}>
        <DetailPair
          label="Durum"
          value={<Badge text={progress.status} tone={mobileTone(progress.tone)} />}
        />
        <DetailPair label="Sürüm hakkı" value={progress.rights} />
        <DetailPair
          label="Son teslim"
          value={
            assignment.deadline.dueAt ? dateTimeLabel(assignment.deadline.dueAt) : 'Belirtilmemiş'
          }
        />
        {request && (
          <DetailPair label="Yeniden teslim son tarihi" value={dateTimeLabel(request.dueAt)} />
        )}
        <DetailPair label="Puan" value={progress.score} />
      </View>
      {request && (
        <T size={14} accessibilityLiveRegion="polite">
          Öğretmenin yeniden teslim istedi; yeni bir sürüm gönderebilirsin.
        </T>
      )}
    </Section>
  )
}

/**
 * Gönderilen değişmez sürümler, yeniden eskiye (DOM-BEC-040). Puan ve geri bildirim yalnız sunucu
 * kesinleştirdiyse görünür (DOM-BEC-045); metin dokununca açılır.
 */
function SubmittedVersions({ versions }: { versions: TaskSubmissionDetail['versions'] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const counts = new Map(versions.map((version) => [version.id, version.wordCount]))
  return (
    <Section title="Gönderdiklerin" panel>
      <View style={{ gap: 16 }} accessibilityRole="list">
        {submissionVersions(versions).map((version) => {
          const wordCount = counts.get(version.id)
          const shown = openId === version.id
          return (
            <View key={version.id} style={{ gap: 6 }}>
              <T bold size={15}>
                {version.title}
                {version.late ? ' · Geç teslim' : ''}
              </T>
              <T muted size={13}>
                {version.stamp}
                {wordCount ? ` · ${wordCount.count} sözcük` : ''}
              </T>
              {!!wordCount?.warning && <T size={13}>{wordCount.warning}</T>}
              {!!version.score && <Badge text={version.score} tone="green" />}
              {!!version.comment && <T size={14}>Öğretmen geri bildirimi: {version.comment}</T>}
              {version.criteria.map((criterion) => (
                <T key={criterion} muted size={14}>
                  {criterion}
                </T>
              ))}
              {!!version.body && (
                <>
                  <TextAction onPress={() => setOpenId(shown ? null : version.id)}>
                    {shown ? 'Metni gizle' : submittedTextLabel('learner')}
                  </TextAction>
                  {shown && <T size={15}>{version.body}</T>}
                </>
              )}
            </View>
          )
        })}
      </View>
    </Section>
  )
}
