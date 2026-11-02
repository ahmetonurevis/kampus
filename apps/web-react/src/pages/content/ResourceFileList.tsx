// Kaynak sürümünün dosyaları (DOM-KYN-006, 051; ADR 0003 karar 6): ad ve boyut sürüm yanıtının
// meta verisinden okunur, dosya kullanıcı "Aç" dediğinde kısa ömürlü imzalı bağlantıyla
// (`GET /files/:id/url`) yeni sekmede açılır. Bağlantı önceden istenmez. Kişiye artık açılmayan
// dosya (404: kaldırılan kaynak ya da kopyası, lisansı dolmuş sürüm) satırda sakin bir notla
// kapanır; nedeni ve teknik ayrıntı gösterilmez.
import { useState } from 'react'
import {
  resourceFileName,
  resourceFileOpenFailure,
  resourceFileSize,
  RESOURCE_FILE_GONE_MESSAGE,
  type ResourceFile,
} from '@kampus/react-shared/resource-model.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'
import { useOpenFile } from '../learning/SubmissionFiles.tsx'

type Props = {
  files: readonly ResourceFile[]
  label?: string
}

/** Sürüm dosyalarının listesi (salt okur); dosya yoksa hiçbir şey çizilmez. */
export function ResourceFileList({ files, label = 'Dosyalar' }: Props) {
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set())
  const opener = useOpenFile((error, fileId) => {
    const failure = resourceFileOpenFailure(error)
    if (failure.kind === 'gone') {
      setGone((current) => new Set(current).add(fileId))
      notify.info(failure.message)
      return
    }
    notify.error(failure.message, failure.kind === 'failed' ? error : undefined)
  })
  if (files.length === 0) return null
  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-semibold">{label}</h3>
      <ul aria-label={label} className="grid gap-2">
        {files.map((file, index) => {
          const name = resourceFileName(file, index)
          const unavailable = file.status === 'deleted' || gone.has(file.id)
          const opening = opener.opening === file.id
          return (
            <li
              key={file.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Icon name="FileText" size={16} aria-hidden="true" />
                <span className="min-w-0 [overflow-wrap:anywhere]">{name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {resourceFileSize(file.byteSize)}
                </span>
              </span>
              {unavailable ? (
                <span className="text-xs text-muted-foreground">{RESOURCE_FILE_GONE_MESSAGE}</span>
              ) : file.status === 'processing' ? (
                <span className="text-xs text-muted-foreground">Hazırlanıyor</span>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  aria-label={`${name} dosyasını aç`}
                  disabled={opening}
                  aria-busy={opening || undefined}
                  onClick={() => void opener.open(file.id)}
                >
                  <Icon name="ExternalLink" size={15} aria-hidden="true" />
                  Aç
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
