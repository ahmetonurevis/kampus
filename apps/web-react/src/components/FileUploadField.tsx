// Yeniden kullanılabilir dosya yükleme alanı (OG-224; ADR 0003, DOM-KYN-004). Amaç (`purpose`)
// parametredir: `accept` çekirdek tür tablosundan türer, seçilen dosya yüklemeden önce aynı tabloyla
// denetlenir (Türkçe alan hatası, istek atılmaz). Dosyalar seçilir seçilmez sırayla yüklenir;
// belirsiz hatada (ağ, 5xx) kuyruk durur ve "Yeniden dene" aynı dosyayı aynı `Idempotency-Key` ile
// gönderir. Yükleme "İptal" ile ya da bileşen kalkınca (panel kapandı) durur. Liste çağıranındır
// (kontrollü): `onUploaded` ekler, `onRemoved` çıkarır; örn. react-hook-form alanı. Sürükle-bırak yok.
import { useEffect, useRef, useState } from 'react'
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
  pickProblems,
  runUploadQueue,
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
  /** Yükleme başlayınca `true`, bitince `false`; çağıran gönderim düğmesini kilitler. */
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
  const input = useRef<HTMLInputElement>(null)
  const aborter = useRef<AbortController | null>(null)
  const unmounted = useRef(false)
  // Yükleme sürerken liste çağıranda güncellenir; döngü her turda en güncel hâli okur.
  const itemsRef = useRef(items)
  const busyChange = useRef(onBusyChange)
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
    }
  }, [])

  useEffect(() => {
    busyChange.current?.(uploading)
  }, [uploading])

  async function runQueue(queue: readonly File[], fit: { dropped: number; duplicates: number }) {
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
      onUploaded,
    })
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
      {uploading ? (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => aborter.current?.abort()}
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
            onClick={() => void runQueue(retry, { dropped: 0, duplicates: 0 })}
          >
            <Icon name="RotateCcw" size={15} aria-hidden="true" />
            Yeniden dene
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
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
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="FileText" size={16} aria-hidden="true" />
                <span className="truncate">{item.name}</span>
              </span>
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
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
