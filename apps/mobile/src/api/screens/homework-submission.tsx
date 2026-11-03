import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import { fileLabel } from '@kampus/react-shared/files.ts'
import type { HomeworkSubmission } from '@kampus/react-shared/homework.ts'
import { useFileInfos, useFilesProcessing } from '@kampus/react-shared/use-files.ts'
import { useSubmitHomework } from '@kampus/react-shared/use-homework.ts'
import { Button, Field, IconButton, T, useColors } from '../../ui/components.tsx'
import { Notice, Section } from '../../ui/SchoolLayout.tsx'
import {
  checkSubmission,
  fitPicked,
  pickedFileKey,
  previousItem,
  SUBMISSION_FILE_LIMIT,
  SUBMISSION_NOTE_MAX_LENGTH,
  submissionFailureText,
  uploadFailureText,
  uploadIsRetryable,
  type PickedFile,
  type SubmissionAvailability,
  type SubmissionItem,
} from '../homework-submission.ts'
import { pickSubmissionFiles, useSubmissionUpload } from '../submission-files.ts'
import { useNotify } from '../toast.tsx'

const STATE_TEXT = {
  queued: 'Sırada',
  uploading: 'Yükleniyor…',
  uploaded: 'Yüklendi',
  failed: 'Yüklenemedi',
} as const

function sizeText(bytes: number | null) {
  if (bytes === null) return ''
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Öğrenci teslim formu (DOM-AKD-072): açıklama ve en az bir dosya. Dosya seçilir seçilmez sırayla
 * yüklenir (`POST /files`, amaç `submission`), teslimde aynı işlemle teslime bağlanır. Yükleme
 * yarıda kalırsa ya da tarama bitmemişse teslim gönderilmez (`checkSubmission`); ekran sunucu
 * yanıtından önce değişmez, hata sayfa içinde Türkçe gösterilir. Açıklama ve dosya yalnız bellekte
 * tutulur, cihaza yazılmaz.
 */
export function SubmissionForm({
  homeworkId,
  submission,
  availability,
  onDone,
}: {
  homeworkId: string
  submission: HomeworkSubmission | undefined
  availability: SubmissionAvailability
  onDone: () => void
}) {
  const colors = useColors()
  const notify = useNotify()
  const submit = useSubmitHomework()
  const uploader = useSubmissionUpload()
  const [note, setNote] = useState(submission?.note ?? '')
  const [items, setItems] = useState<SubmissionItem[]>(() =>
    (submission?.fileIds ?? []).map(previousItem),
  )
  const [pickProblem, setPickProblem] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const uploading = useRef(false)

  useEffect(() => {
    mounted.current = true
    abort.current = new AbortController()
    return () => {
      mounted.current = false
      // Pencere kapanınca süren yükleme durur; bağlanmayan dosya sunucuda temizlenir.
      abort.current?.abort()
    }
  }, [])

  const previousIds = useMemo(
    () => items.flatMap((item) => (item.file === null && item.fileId ? [item.fileId] : [])),
    [items],
  )
  const infos = useFileInfos(previousIds)
  const scanIds = items.flatMap((item) => (item.scanning && item.fileId ? [item.fileId] : []))
  const processing = useFilesProcessing(scanIds)
  const scan = useMemo(
    () => new Map(processing.files.map((entry) => [entry.fileId, entry.state] as const)),
    [processing.files],
  )

  const nameOf = (item: SubmissionItem) => {
    if (item.name) return item.name
    const index = previousIds.indexOf(item.fileId ?? '')
    return fileLabel(infos[index]?.data, index)
  }

  const patch = (key: string, change: Partial<SubmissionItem>) =>
    setItems((list) => list.map((item) => (item.key === key ? { ...item, ...change } : item)))

  // Dosyaları sırayla yükler: komut kilidi tek istek ister ve kesin hatada sıradaki dosya sürer.
  async function upload(files: readonly PickedFile[]) {
    if (uploading.current) return
    uploading.current = true
    try {
      for (const file of files) {
        const key = pickedFileKey(file)
        if (!mounted.current) return
        patch(key, { state: 'uploading', message: null })
        const outcome = await uploader.upload({
          file,
          ...(abort.current ? { signal: abort.current.signal } : {}),
        })
        if (!mounted.current) return
        if (outcome.status === 'success') {
          const stored = outcome.data.data
          patch(key, {
            state: 'uploaded',
            fileId: stored.id,
            scanning: stored.status === 'processing',
            message: null,
          })
        } else {
          patch(key, {
            state: 'failed',
            message:
              outcome.status === 'failed'
                ? uploadFailureText(outcome.error)
                : 'Önceki yükleme sürüyor. Birazdan yeniden dene.',
          })
          // Belirsiz hatada (ağ, 5xx) sıradaki dosyalar beklemede kalır; yeniden denemede
          // aynı dosya aynı `Idempotency-Key` ile gider.
          if (outcome.status === 'failed' && uploadIsRetryable(outcome.error)) {
            const rest = files.slice(files.indexOf(file) + 1)
            for (const next of rest) patch(pickedFileKey(next), { state: 'queued' })
            return
          }
        }
      }
    } finally {
      uploading.current = false
    }
  }

  async function pick() {
    setFailure(null)
    let picked: PickedFile[]
    try {
      picked = await pickSubmissionFiles()
    } catch {
      setPickProblem('Dosya seçilemedi. Yeniden dene.')
      return
    }
    if (picked.length === 0) return
    const { accepted, problems } = fitPicked(items, picked)
    setPickProblem(problems.length > 0 ? problems.join(' ') : null)
    if (accepted.length === 0) return
    setItems((list) => [
      ...list,
      ...accepted.map((file): SubmissionItem => ({
        key: pickedFileKey(file),
        name: file.name,
        file,
        state: 'queued',
        fileId: null,
        scanning: false,
        message: null,
      })),
    ])
    void upload(accepted)
  }

  function remove(key: string) {
    setFailure(null)
    setItems((list) => list.filter((item) => item.key !== key))
  }

  const check = checkSubmission({ note, items, scan })
  const busy = sending || submit.isPending
  const resubmit = submission !== undefined

  async function send() {
    if (busy) return
    const decision = checkSubmission({ note, items, scan })
    if (!decision.ok) {
      setFailure(decision.message)
      return
    }
    setFailure(null)
    setSending(true)
    try {
      // Teslim yalnız sunucu yanıtıyla değişir; hata (409 dahil) formu ve dosyaları korur.
      const outcome = await submit.submit(
        { homeworkId, body: decision.body },
        { silent: () => true },
      )
      if (outcome.status === 'busy') return
      if (outcome.status === 'failed') {
        if (mounted.current) setFailure(submissionFailureText(outcome.error))
        return
      }
      notify(resubmit ? 'Teslimin güncellendi.' : 'Ödev teslim edildi.')
      onDone()
    } finally {
      if (mounted.current) setSending(false)
    }
  }

  const full = items.length >= SUBMISSION_FILE_LIMIT
  const uploadsBusy = items.some((item) => item.state === 'queued' || item.state === 'uploading')

  return (
    <Section title={resubmit ? 'Teslimi güncelle' : 'Ödevi teslim et'} panel>
      <View style={{ gap: 14 }}>
        {availability === 'late' && (
          <Notice
            tone="amber"
            title="Son teslim zamanı geçti"
            text="Teslimin geç teslim olarak işaretlenir."
          />
        )}
        {resubmit && (
          <T muted size={14}>
            Öğretmenin değerlendirene kadar teslimini güncelleyebilirsin; yeni teslim öncekinin
            yerine geçer.
          </T>
        )}
        <Field
          label="Açıklama"
          value={note}
          onChange={(value) => {
            setFailure(null)
            setNote(value)
          }}
          multiline
          editable={!busy}
          maxLength={SUBMISSION_NOTE_MAX_LENGTH}
          hint="Öğretmenine iletmek istediğin açıklama (isteğe bağlı)."
        />
        <View style={{ gap: 8 }}>
          <T bold size={14}>
            Dosyalar
          </T>
          <T muted size={12}>
            PDF, Word ya da görsel; en çok {SUBMISSION_FILE_LIMIT} dosya, her biri en fazla 20 MB.
            En az bir dosya gerekir.
          </T>
          {items.length > 0 && (
            <View style={{ gap: 8 }} accessibilityRole="list">
              {items.map((item) => {
                const scanState = item.fileId ? scan.get(item.fileId) : undefined
                const scanText =
                  scanState === 'processing'
                    ? 'Güvenlik taramasında…'
                    : scanState === 'timed_out'
                      ? 'Tarama uzun sürdü; birazdan yeniden dene.'
                      : scanState === 'rejected'
                        ? 'Dosya güvenlik taramasından geçmedi. Kaldırıp başka dosya seç.'
                        : scanState === 'missing'
                          ? 'Dosya artık bulunamadı. Kaldırıp yeniden yükle.'
                          : null
                const status = item.message ?? scanText ?? STATE_TEXT[item.state]
                const name = nameOf(item)
                return (
                  <View
                    key={item.key}
                    accessible
                    accessibilityLabel={`${name}. ${status}`}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48 }}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <T bold size={14}>
                        {name}
                      </T>
                      <T
                        muted={item.state !== 'failed' && scanState !== 'rejected'}
                        size={12}
                        accessibilityLiveRegion="polite"
                      >
                        {[sizeText(item.file?.size ?? null), status].filter(Boolean).join(' · ')}
                      </T>
                    </View>
                    {item.state === 'failed' && item.file && (
                      <Button
                        small
                        label={`${name} dosyasını yeniden yükle`}
                        disabled={uploadsBusy}
                        onPress={() => {
                          const file = item.file
                          if (file) void upload([file])
                        }}
                      >
                        Yeniden dene
                      </Button>
                    )}
                    {scanState === 'timed_out' && item.fileId && (
                      <Button
                        small
                        label={`${name} taramasını yeniden kontrol et`}
                        onPress={() => processing.retry(item.fileId ?? '')}
                      >
                        Kontrol et
                      </Button>
                    )}
                    <IconButton
                      name="X"
                      label={`${name} dosyasını kaldır`}
                      disabled={busy || item.state === 'uploading'}
                      onPress={() => remove(item.key)}
                    />
                  </View>
                )
              })}
            </View>
          )}
          <Button
            icon="Paperclip"
            disabled={busy || full}
            label={full ? 'Dosya sınırına ulaşıldı' : 'Dosya ekle'}
            onPress={() => void pick()}
          >
            Dosya ekle
          </Button>
          {!!pickProblem && (
            <T size={13} accessibilityLiveRegion="polite" style={{ color: colors.red }}>
              {pickProblem}
            </T>
          )}
        </View>
        {failure && <Notice tone="red" title="Teslim gönderilemedi" text={failure} />}
        <Button
          accent
          icon="Send"
          disabled={busy || !check.ok}
          label={busy ? 'Teslim gönderiliyor' : resubmit ? 'Teslimi güncelle' : 'Teslim et'}
          onPress={() => void send()}
        >
          {busy ? 'Gönderiliyor…' : resubmit ? 'Teslimi güncelle' : 'Teslim et'}
        </Button>
        {!check.ok && !busy && items.length > 0 && (
          <T muted size={13} accessibilityLiveRegion="polite">
            {check.message}
          </T>
        )}
      </View>
    </Section>
  )
}
