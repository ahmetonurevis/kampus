import { useId, useState } from 'react'
import { useFileUrlFetcher } from '@kampus/react-shared/use-files.ts'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  DEFAULT_PLAYBACK_RATE,
  PLAYBACK_RATES,
  RECORDING_EXPIRED,
  parsePlaybackRate,
  playbackRateLabel,
  recordingOpenError,
  recordingView,
  type PlaybackRate,
  type SubmissionFile,
} from './recording-review-model.ts'

type Source =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; url: string }
  | { kind: 'failed'; message: string }

/**
 * Teslim edilmiş konuşma kaydının oynatıcısı (IST-052; DOM-BEC-052, 053). Kısa ömürlü imzalı
 * bağlantı yalnız "Kaydı dinle" ile istenir: her bağlantı üretimi sunucuda denetim kaydıdır ve
 * kimin dinleyebileceğine sunucu karar verir (yetkisiz kişi 404 alır, varlık sızdırılmaz).
 * Oynatıcı tarayıcının yerel `<audio controls>` denetimidir (klavyeyle oynat/duraklat/sar); hız
 * ayrı bir seçim kutusundadır. Döküm (transkript) üretilmez (DOM-BEC-051). Bağlantının süresi
 * dolup ses yüklenemezse yeni bağlantı istenebilir.
 */
export function RecordingPlayer({ file, title }: { file: SubmissionFile; title: string }) {
  const fetchUrl = useFileUrlFetcher()
  const [source, setSource] = useState<Source>({ kind: 'idle' })
  const [rate, setRate] = useState<PlaybackRate>(DEFAULT_PLAYBACK_RATE)
  const titleId = useId()
  const rateId = useId()
  const view = recordingView(file)

  async function open() {
    setSource({ kind: 'loading' })
    try {
      const { url } = await fetchUrl(file.id)
      setSource({ kind: 'ready', url })
    } catch (error) {
      console.error('[kampus]', 'Konuşma kaydı bağlantısı alınamadı', error)
      setSource({ kind: 'failed', message: recordingOpenError(error) })
    }
  }

  return (
    <div role="group" aria-labelledby={titleId} className="grid gap-2 rounded-card border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Icon name="Mic" size={16} aria-hidden="true" />
        <span id={titleId} className="font-medium">
          {title}
        </span>
        {view.kind === 'ready' && view.duration ? (
          <span className="text-muted-foreground">Süre {view.duration}</span>
        ) : null}
      </div>
      {view.kind === 'unavailable' ? (
        <p className="text-sm text-muted-foreground">{view.message}</p>
      ) : source.kind === 'ready' ? (
        <div className="flex flex-wrap items-end gap-3">
          <audio
            // Kaynak değişince tarayıcı hızı sıfırlar; her çizimde ve yüklenince yeniden yazılır.
            ref={(element) => {
              if (element) {
                element.defaultPlaybackRate = rate
                element.playbackRate = rate
              }
            }}
            src={source.url}
            controls
            preload="metadata"
            aria-labelledby={titleId}
            className="w-full max-w-md"
            onLoadedMetadata={(event) => {
              event.currentTarget.playbackRate = rate
            }}
            onError={() => setSource({ kind: 'failed', message: RECORDING_EXPIRED })}
          />
          <label htmlFor={rateId} className="grid gap-1 text-sm font-medium">
            Oynatma hızı
            <NativeSelect
              id={rateId}
              value={String(rate)}
              onChange={(event) => setRate(parsePlaybackRate(event.target.value))}
              className="min-h-9 text-sm"
            >
              {PLAYBACK_RATES.map((item) => (
                <NativeSelectOption key={item} value={String(item)}>
                  {playbackRateLabel(item)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            aria-describedby={titleId}
            disabled={source.kind === 'loading'}
            aria-busy={source.kind === 'loading' || undefined}
            onClick={() => void open()}
          >
            <Icon name="Play" size={15} aria-hidden="true" />
            Kaydı dinle
          </Button>
          {source.kind === 'failed' ? (
            <p role="alert" className="text-sm text-destructive">
              {source.message}
            </p>
          ) : null}
        </div>
      )}
    </div>
  )
}
