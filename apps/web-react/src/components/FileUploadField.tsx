// Yeniden kullanılabilir dosya yükleme alanı (OG-224; ADR 0003, DOM-KYN-004). Amaç (`purpose`)
// parametredir: `accept` çekirdek tür tablosundan türer, seçilen dosya yüklemeden önce aynı tabloyla
// denetlenir (Türkçe alan hatası, istek atılmaz). Dosyalar seçilir seçilmez sırayla yüklenir;
// belirsiz hatada (ağ, 5xx) kuyruk durur ve "Yeniden dene" aynı dosyayı aynı `Idempotency-Key` ile
// gönderir. Yükleme "İptal" ile ya da bileşen kalkınca (panel kapandı) durur. Liste çağıranındır
// (kontrollü): `onUploaded` ekler, `onRemoved` çıkarır; örn. react-hook-form alanı. Sürükle-bırak yok.
// Tarayıcı açıkken (ADR 0003 karar 8; OG-092) yanıtı `processing` gelen dosya güvenlik taramasındadır:
// satırda "Taranıyor…" görünür, `useFilesProcessing` dosya hazır olana kadar yoklar ve alan o
// sürede meşguldür (çağıranın gönderimi kilitli; OG-987). Bekleme dolarsa satırda "Yeniden dene",
// taramada reddedilen dosyada Türkçe ileti çıkar; dosya kaldırılınca kilit açılır. Tarayıcısız
// ortamda (`pending`) dosya izlenmez, bağlama bugünkü gibi denenir.
import { useEffect, useRef, useState } from 'react'
import { useFilesProcessing } from '@kampus/react-shared/use-files.ts'
import {
  fileIdentity,
  useFileUpload,
  type UploadedFile,
} from '@kampus/react-shared/use-file-upload.ts'
import type { FilePurpose } from '@kampus/school-core/content/taxonomy.ts'
import { FormField } from '@/components/FormField.tsx'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import {
  acceptFor,
  attemptFrom,
  defaultMaxFiles,
  fieldError,
  fitFiles,
  isUploadBusy,
  pickProblems,
  runUploadQueue,
  scanAnnouncement,
  scanRowView,
  scanWatchIds,
  type FileUploadItem,
} from './file-upload-model.ts'

export type { FileUploadItem }

type Props = {
  id: string
  label: string
  /** Dosyanın amacı: izinli türleri, boyut sınırını ve rıza gereksinimini belirler. */
  purpose: FilePurpose
  description?: string
  /** Alanda görünen dosyalar (adı çağıran çözer). */
  items: readonly FileUploadItem[]
  /** Yükleme başarıyla bitti; çağıran dosyayı listesine ekler. */
  onUploaded: (item: FileUploadItem, file: UploadedFile) => void
  /** Kullanıcı dosyayı listeden kaldırdı (sunucudaki kayıt bir kayda bağlanmadıkça kendiliğinden temizlenir). */
  onRemoved: (fileId: string) => void
  /** Birden çok dosya seçilebilir; varsayılan tek dosya. */
  multiple?: boolean
  /** En çok dosya; verilmezse amacın sınırı (çoklu) ya da 1 (tekil). */
  maxFiles?: number
  /** Dışarıdan gelen alan hatası (ör. form doğrulaması); varsa alanın kendi uyarısından önce gösterilir. */
  error?: { message?: string } | undefined
  disabled?: boolean
  /**
   * Yükleme ya da yüklenen dosyanın güvenlik taraması başlayınca `true`, bitince `false`; çağıran
   * gönderim düğmesini kilitler.
   */
  onBusyChange?: (busy: boolean) => void
  listLabel?: string
}

export function FileUploadField({
  id,
  label,
  purpose,
  description,
  items,
  onUploaded,
  onRemoved,
  multiple = false,
  maxFiles,
  error,
  disabled = false,
  onBusyChange,
  listLabel = 'Eklenen dosyalar',
}: Props) {
  const uploader = useFileUpload()
  const limit = maxFiles ?? defaultMaxFiles(purpose, multiple)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [retry, setRetry] = useState<readonly File[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  // Yanıtı `processing` gelen (taranan) dosyalar; listeden çıkan kimlik izlenmez.
  const [scanning, setScanning] = useState<ReadonlySet<string>>(() => new Set())
  const scan = useFilesProcessing(scanWatchIds(items, scanning))
  const scanStates = new Map(scan.files.map((file) => [file.fileId, file.state]))
  const input = useRef<HTMLInputElement>(null)
  const aborter = useRef<AbortController | null>(null)
  const unmounted = useRef(false)
  // Kalkan düğmeden (iptal, yeniden dene, vazgeç) sonra odak dosya seçme denetimine döner.
  const restoreFocus = useRef(false)
  // Yükleme sürerken liste çağıranda güncellenir; döngü her turda en güncel hâli okur.
  const itemsRef = useRef(items)
  const busyChange = useRef(onBusyChange)
  const busyNow = useRef(false)
  // Ref'ler çizimden sonra güncellenir; yükleme döngüsü ve bildirim en güncel değeri okur.
  useEffect(() => {
    itemsRef.current = items
    busyChange.current = onBusyChange
  })

  useEffect(() => {
    unmounted.current = false
    return () => {
      unmounted.current = true
      aborter.current?.abort()
      // Yükleme sürerken ya da yeniden deneme beklerken kalkarsa çağıranın gönderim kilidi açık kalmamalı.
      if (busyNow.current) busyChange.current?.(false)
    }
  }, [])

  // Yeniden denenecek dosya varken de meşgul sayılır; yoksa ağ hatasında kaydet açılır.
  const busy = isUploadBusy(uploading, retry.length, [...scanStates.values()])
  useEffect(() => {
    busyNow.current = busy
    busyChange.current?.(busy)
  }, [busy])

  // Odak düğmeyle birlikte DOM'dan kalkınca `body`'ye düşer; yükleme bitip denetim açılınca geri alınır.
  // Kullanıcı bu arada odağı başka yere taşıdıysa ona dokunulmaz.
  useEffect(() => {
    if (!restoreFocus.current || uploading) return
    restoreFocus.current = false
    const active = document.activeElement
    if (active && active !== document.body && active !== input.current) return
    input.current?.focus()
  })

  async function runQueue(queue: readonly File[], fit: { dropped: number; duplicates: number }) {
    // Süren kuyruk varken ikincisi başlamaz (çift çağrıda ilk denetleyici sahipsiz kalırdı).
    if (aborter.current) return
    const controller = new AbortController()
    aborter.current = controller
    setUploading(true)
    setRetry([])
    setNotice('Dosya yükleniyor…')
    const result = await runUploadQueue({
      queue,
      current: () => itemsRef.current,
      signal: controller.signal,
      upload: async (file) =>
        attemptFrom(
          await uploader.upload(
            purpose,
            file,
            { silent: () => controller.signal.aborted },
            controller.signal,
          ),
        ),
      onUploaded: (item, file) => {
        if (file.status === 'processing') setScanning((current) => new Set(current).add(item.id))
        onUploaded(item, file)
      },
    })
    if (aborter.current === controller) aborter.current = null
    if (unmounted.current) return
    setUploading(false)
    if (input.current) input.current.value = ''
    setProblem(pickProblems(result.problems, fit, limit))
    setRetry(result.retry)
    setNotice(
      result.aborted
        ? 'Yükleme iptal edildi.'
        : result.retry.length > 0
          ? 'Yükleme tamamlanamadı. Yeniden deneyebilirsiniz.'
          : null,
    )
  }

  async function pick(picked: readonly File[]) {
    setProblem(null)
    const fit = fitFiles(itemsRef.current, picked, limit, fileIdentity)
    await runQueue(fit.accepted, fit)
  }

  function removeItem(fileId: string) {
    setProblem(null)
    setScanning((current) => {
      const next = new Set(current)
      next.delete(fileId)
      return next
    })
    onRemoved(fileId)
  }

  const locked = disabled || uploading || retry.length > 0 || items.length >= limit
  return (
    <div className="grid min-w-0 gap-3">
      <FormField
        id={id}
        label={label}
        error={fieldError(problem, error)}
        {...(description ? { description } : {})}
      >
        {(control) => (
          <input
            {...control}
            ref={input}
            type="file"
            multiple={multiple}
            accept={acceptFor(purpose)}
            disabled={locked}
            aria-busy={uploading || undefined}
            onChange={(event) => void pick([...(event.target.files ?? [])])}
            className="w-full min-w-0 max-w-full text-sm file:mr-3 file:rounded-md file:border file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium disabled:opacity-50"
          />
        )}
      </FormField>
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground empty:hidden">
        {notice}
      </p>
      {/* Tarama durumu satırda görünür; değişimi ekran okuyucuya ayrıca duyurulur. */}
      <p role="status" aria-live="polite" className="sr-only">
        {scanAnnouncement([...scanStates.values()])}
      </p>
      {uploading ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              restoreFocus.current = true
              aborter.current?.abort()
            }}
          >
            <Icon name="X" size={15} aria-hidden="true" />
            Yüklemeyi iptal et
          </Button>
        </div>
      ) : null}
      {retry.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              restoreFocus.current = true
              void runQueue(retry, { dropped: 0, duplicates: 0 })
            }}
          >
            <Icon name="RotateCcw" size={15} aria-hidden="true" />
            Yeniden dene
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              restoreFocus.current = true
              setRetry([])
              setNotice(null)
              if (input.current) input.current.value = ''
            }}
          >
            Vazgeç
          </Button>
        </div>
      ) : null}
      {items.length > 0 ? (
        <ul aria-label={listLabel} className="grid gap-2">
          {items.map((item) => {
            const view = scanRowView(scanStates.get(item.id))
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border px-3.5 py-2 text-sm"
              >
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name="FileText" size={16} aria-hidden="true" />
                    <span className="truncate">{item.name}</span>
                  </span>
                  {view ? (
                    <span
                      className={
                        view.tone === 'danger'
                          ? 'flex items-start gap-1.5 text-destructive'
                          : 'flex items-start gap-1.5 text-muted-foreground'
                      }
                    >
                      <Icon
                        name={view.tone === 'danger' ? 'ShieldAlert' : 'Timer'}
                        size={14}
                        className="mt-0.5 shrink-0"
                        aria-hidden="true"
                      />
                      {view.text}
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center gap-1">
                  {view?.retry ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`${item.name} dosyası için yeniden dene`}
                      disabled={disabled}
                      onClick={() => scan.retry(item.id)}
                    >
                      <Icon name="RotateCcw" size={15} aria-hidden="true" />
                      Yeniden dene
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`${item.name} dosyasını kaldır`}
                    disabled={disabled || uploading}
                    onClick={() => removeItem(item.id)}
                  >
                    <Icon name="X" size={15} aria-hidden="true" />
                    Kaldır
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
