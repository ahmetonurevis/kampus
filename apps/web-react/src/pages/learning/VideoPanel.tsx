import type { ResumeSource } from '@kampus/react-shared/video-progress.ts'
import { Modal } from '@/components/Modal.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreItem } from '@/hooks/use-core-collection.ts'
import { SummaryLoading } from '../management/SummaryParts.tsx'
import { LessonPlayer } from './LessonPlayer.tsx'

type Props = {
  videoId: string
  /** Öğrencinin bu videodaki kayıtlı ilerlemesi: yüzde (0–100) ve son konum (DOM-KYN-005). */
  resume: ResumeSource
  teacher: string
  onClose: () => void
}

/**
 * Video oynatıcı penceresi (`?video=<kimlik>`): video tek kayıt ucundan okunur, bağlantıyla gelinen
 * ya da kapsam dışı kimlik "Kayıt bulunamadı" verir. Oynatıcı kaldığı yerden başlar ve ilerlemeyi
 * API'ye yazar (`LessonPlayer`).
 */
export function VideoPanel({ videoId, resume, teacher, onClose }: Props) {
  const item = useCoreItem('videos', videoId === '' ? null : videoId)
  const video = item.data?.record
  return (
    <Modal
      open={videoId !== ''}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={video?.title ?? 'Ders videosu'}
      size="wide"
    >
      {item.error ? (
        <QueryError error={item.error} onRetry={() => void item.refetch()} />
      ) : !video ? (
        <SummaryLoading />
      ) : (
        <div className="grid gap-4">
          {video.src ? (
            <LessonPlayer
              key={video.id}
              videoId={video.id}
              title={video.title}
              src={video.src}
              poster={video.poster}
              captions={video.captions}
              resume={resume}
            />
          ) : (
            <p className="rounded-card border bg-surface-soft p-4 text-sm">
              Bu video için oynatılabilir dosya yok.
            </p>
          )}
          <div className="video-description flex items-start justify-between gap-4">
            <div className="grid gap-1.5">
              <StatusBadge text={video.subject} />
              <h3 className="text-base font-semibold">{teacher}</h3>
              <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">
                {video.description}
              </p>
            </div>
            <StatusBadge text={`%${resume.progress} izlendi`} />
          </div>
          {video.transcript.length ? (
            <details className="lesson-transcript rounded-card border p-4 text-sm">
              <summary className="cursor-pointer font-medium">Ders notları ve metin dökümü</summary>
              <div className="mt-3 grid gap-2">
                {video.transcript.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </Modal>
  )
}
