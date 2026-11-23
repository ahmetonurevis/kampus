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
  previousItem,
  queuedItem,
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
import { drainQueue, enqueue, isUploading, removeItem, retryItem } from '../upload-queue.ts'

const STATE_TEXT = {
  queued: 'Sırada',
  uploading: 'Yükleniyor…',
  done: 'Yüklendi',
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
  // Kuyruğun tek doğru kaynağı: yükleme döngüsü her dosyadan önce güncel listeyi buradan okur
  // (yükleme sürerken eklenen ya da kaldırılan dosya state'in eski görüntüsüne takılmaz).
  const itemsRef = useRef(items)
  const [pickProblem, setPickProblem] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const mounted = useRef(true)

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

  const apply = (change: (list: SubmissionItem[]) => SubmissionItem[]) => {
    itemsRef.current = change(itemsRef.current)
    setItems(itemsRef.current)
  }

  // Dosyaları sırayla yükler (`upload-queue.ts`): yükleme sürerken eklenenler sıraya girer,
  // kaldırılan sıradaki dosya yüklenmez, ağ ya da 5xx hatası kuyruğu durdurur ve yeniden deneme
  // kalanları da yükler.
  const drain = () =>
    drainQueue<SubmissionItem>({
      read: () => itemsRef.current,
      write: (next) => apply(() => next),
      active: () => mounted.current,
      onDone: (_item, result) => ({ scanning: result.scanning }),
      upload: async (item) => {
        if (!item.file) return { kind: 'failed', message: 'Dosya bulunamadı.', retryable: false }
        const outcome = await uploader.upload({
          file: item.file,
          ...(abort.current ? { signal: abort.current.signal } : {}),
        })
        if (outcome.status === 'success') {
          const stored = outcome.data.data
          return { kind: 'done', fileId: stored.id, scanning: stored.status === 'processing' }
        }
        if (outcome.status === 'busy')
          return {
            kind: 'failed',
            message: 'Önceki yükleme sürüyor. Birazdan yeniden dene.',
            retryable: true,
          }
        return {
          kind: 'failed',
          message: uploadFailureText(outcome.error),
          retryable: uploadIsRetryable(outcome.error),
        }
      },
    })

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
    const { accepted, problems } = fitPicked(itemsRef.current, picked)
    setPickProblem(problems.length > 0 ? problems.join(' ') : null)
    if (accepted.length === 0) return
    apply((list) => enqueue(list, accepted.map(queuedItem)))
    void drain()
  }

  function retry(key: string) {
    setFailure(null)
    apply((list) => retryItem(list, key))
    void drain()
  }

  function remove(key: string) {
    setFailure(null)
    apply((list) => removeItem(list, key))
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
  const uploadsBusy = isUploading(items)

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
          hint="Öğretmenine iletmek istediğin açıklama. Açıklama ya da dosyadan biri yeterli."
        />
        <View style={{ gap: 8 }}>
          <T bold size={14}>
            Dosyalar
          </T>
          <T muted size={12}>
            PDF, Word ya da görsel; en çok {SUBMISSION_FILE_LIMIT} dosya, her biri en fazla 20 MB.
            Açıklama yazmadan dosya, dosya eklemeden açıklama da teslim edilebilir.
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
                    {item.state === 'failed' && (
                      <Button
                        small
                        label={`${name} dosyasını yeniden yükle`}
                        disabled={uploadsBusy}
                        onPress={() => retry(item.key)}
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
        {!check.ok && !busy && (
          <T muted size={13} accessibilityLiveRegion="polite">
            {check.message}
          </T>
        )}
      </View>
    </Section>
  )
}
