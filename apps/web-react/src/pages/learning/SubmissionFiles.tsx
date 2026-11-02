// Teslim dosyaları (DOM-AKD-072, DOM-AKD-074; ADR 0003): dosya adları meta veriden okunur, dosya
// kullanıcı "Aç" dediğinde kısa ömürlü imzalı bağlantıyla açılır. Teslim dosyasında her bağlantı
// üretimi denetim kaydıdır; bağlantı bu yüzden önceden istenmez.
import { useState } from 'react'
import { fileLabel } from '@kampus/react-shared/files.ts'
import { useFileInfos, useFileUrlFetcher } from '@kampus/react-shared/use-files.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { notify } from '@/lib/notify.ts'

export const FILE_OPEN_FAILED = 'Dosya açılamadı. Biraz sonra yeniden deneyin.'
export const FILE_POPUP_BLOCKED =
  'Açılır pencere engellendi. Tarayıcıda bu site için açılır pencerelere izin verip yeniden deneyin.'

/**
 * İmzalı bağlantıyı yeni sekmede açar. Sekme tıklamayla eşzamanlı açılır (açılır pencere
 * engelleyicisi beklemeden sonraki `window.open`'ı engeller), bağlantı gelince adrese gider.
 */
export function useOpenFile() {
  const fetchUrl = useFileUrlFetcher()
  const [opening, setOpening] = useState('')
  async function open(fileId: string) {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      // Bağlantı üretmek denetim kaydıdır; pencere açılamıyorsa üretilmez. Uygulamanın kendi
      // sayfası dosya adresine götürülmez (form girdisi ve panel kaybolurdu).
      notify.error(FILE_POPUP_BLOCKED)
      return
    }
    setOpening(fileId)
    try {
      const { url } = await fetchUrl(fileId)
      tab.opener = null
      tab.location.href = url
    } catch (error) {
      tab.close()
      notify.error(FILE_OPEN_FAILED, error)
    } finally {
      setOpening('')
    }
  }
  return { open, opening }
}

/** Teslime bağlı dosyaların listesi (salt okur); dosya yoksa hiçbir şey çizilmez. */
export function SubmissionFileList({
  fileIds,
  label = 'Teslim dosyaları',
}: {
  fileIds: readonly string[]
  label?: string
}) {
  const infos = useFileInfos(fileIds)
  const files = useOpenFile()
  if (!fileIds.length) return null
  return (
    <ul aria-label={label} className="grid gap-2">
      {fileIds.map((fileId, index) => {
        const name = fileLabel(infos[index]?.data, index)
        return (
          <li
            key={fileId}
            className="flex items-center justify-between gap-3 rounded-xl border px-3.5 py-2 text-sm"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="FileText" size={16} aria-hidden="true" />
              <span className="truncate">{name}</span>
            </span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              aria-label={`${name} dosyasını aç`}
              disabled={files.opening === fileId}
              aria-busy={files.opening === fileId || undefined}
              onClick={() => void files.open(fileId)}
            >
              <Icon name="ExternalLink" size={15} aria-hidden="true" />
              Aç
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
