import { useEffect, useRef } from 'react'
import { useRecordVideoProgress } from '@kampus/react-shared/use-video-progress.ts'
import {
  createVideoProgressReporter,
  resumePosition,
  type ResumeSource,
  type VideoProgressReporter,
} from '@kampus/react-shared/video-progress.ts'

type Props = {
  videoId: string
  title: string
  src: string
  poster: string | undefined
  captions: string | undefined
  /** Açılışta kayıtlı ilerleme ve son konum (DOM-KYN-005); oynatıcı buradan devam eder. */
  resume: ResumeSource
}

/**
 * Ders videosu oynatıcısı. Açılışta kayıtlı son konuma gider (bitişe yakın ya da konumsuz kayıtta
 * baştan başlar). Oynatırken ilerleme API'ye seyrek yazılır: en çok 15 sn'de bir, ayrıca duraklatma,
 * bitiş, sekme gizlenmesi ve pencere kapanışında. Yazma hatası kullanıcıya gösterilmez ve tekrar
 * denenmez; ilerleme bir sonraki aralıkta yeniden yazılır. Altyazı varsa Türkçe parça varsayılandır.
 */
export function LessonPlayer({ videoId, title, src, poster, captions, resume }: Props) {
  const { mutate } = useRecordVideoProgress()
  const player = useRef<HTMLVideoElement>(null)
  const reporter = useRef<VideoProgressReporter | null>(null)
  // Açılıştaki kayıt: oynatırken yenilenen liste verisi konumu yeniden belirlemez.
  const opening = useRef(resume)

  useEffect(() => {
    const instance = createVideoProgressReporter({
      send: (sample) => mutate({ videoId, ...sample }),
      ...(opening.current.positionSeconds === undefined
        ? {}
        : { initialPositionSeconds: opening.current.positionSeconds }),
    })
    reporter.current = instance
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushFrom(player.current, instance)
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      // Pencere kapanırken oynatıcı DOM'dan çoktan kalkmıştır: son örnekle yazılır.
      instance.flush()
      reporter.current = null
    }
  }, [mutate, videoId])

  return (
    <video
      key={videoId}
      ref={player}
      controls
      playsInline
      preload="metadata"
      poster={poster}
      aria-label={title}
      className="lesson-player aspect-video w-full rounded-card bg-black"
      onLoadedMetadata={(event) => {
        const element = event.currentTarget
        const target = resumePosition(opening.current, element.duration)
        if (target > 0) element.currentTime = target
      }}
      onTimeUpdate={(event) => {
        const element = event.currentTarget
        reporter.current?.tick({
          positionSeconds: element.currentTime,
          durationSeconds: element.duration,
        })
      }}
      onPause={(event) => reporter.current && flushFrom(event.currentTarget, reporter.current)}
      onEnded={(event) => reporter.current && flushFrom(event.currentTarget, reporter.current)}
    >
      <source src={src} type="video/mp4" />
      {captions ? (
        <track kind="captions" src={captions} srcLang="tr" label="Türkçe" default />
      ) : null}
      Tarayıcınız video oynatmayı desteklemiyor.
    </video>
  )
}

/** Oynatıcının şimdiki konumuyla yazar; oynatıcı yoksa reporter'ın son örneği. */
function flushFrom(element: HTMLVideoElement | null, instance: VideoProgressReporter) {
  if (element === null) instance.flush()
  else instance.flush({ positionSeconds: element.currentTime, durationSeconds: element.duration })
}
