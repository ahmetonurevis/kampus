import { useMemo } from 'react'
import { useCollectionAll } from '@kampus/react-shared/use-collection.ts'
import { CollectionList } from '@/components/CollectionList.tsx'
import { Icon } from '@/components/Icon.tsx'
import { PageHeading } from '@/components/PageHeading.tsx'
import { QueryError } from '@/components/QueryError.tsx'
import { StatusBadge } from '@/components/StatusBadge.tsx'
import { useCoreAll } from '@/hooks/use-core-collection.ts'
import { useDetailPanel } from '@/hooks/use-detail-panel.ts'
import { useDocumentTitle } from '@/hooks/use-document-title.ts'
import type { FilterField } from '@/lib/list-query.ts'
import type { NavPage } from '@/lib/navigation.ts'
import { VideoPanel } from './VideoPanel.tsx'
import {
  progressByVideo,
  progressText,
  videoRow,
  watchAction,
  type VideoProgress,
  type VideoRow,
} from './video-rows.ts'

const NONE: readonly never[] = []
const FILTERS: readonly FilterField[] = [{ key: 'subject', label: 'Ders' }]
const SEARCH_KEYS = ['title', 'subject', 'topic', 'teacher'] as const

/**
 * Ders Videoları (öğrenci, Vue `Learning.vue` `videolar`): öğrencinin düzeyindeki ders videoları,
 * ders filtresi, başlık/konu araması ve oynatıcı penceresi (`?video=<kimlik>`). Kapsamı sunucu
 * uygular: öğrenci yalnız kendi düzeyinin videolarını ve kendi izleme ilerlemesini okur. İlerleme
 * yüzdesi kayıttan okunur, saklanmaz. Yalnız okuma.
 * TODO(api-video-progress): izleme ilerlemesini yazan uç yok; oynatırken ilerleme kaydedilmez.
 */
export function StudentVideosPage({ page }: { page: NavPage }) {
  useDocumentTitle(page.title)
  const videos = useCoreAll('videos')
  const progress = useCollectionAll<VideoProgress>('videoProgress')
  const teachers = useCoreAll('teachers')
  const panel = useDetailPanel('video')

  const error = videos.error ?? progress.error ?? teachers.error ?? null
  const pending = videos.isPending || progress.isPending || teachers.isPending
  const retry = () => {
    for (const query of [videos, progress, teachers]) if (query.error) void query.refetch()
  }

  const rows = useMemo(() => {
    if (pending || error) return undefined
    const watched = progressByVideo((progress.data ?? NONE).map((item) => item.record))
    const names = new Map((teachers.data ?? NONE).map((item) => [item.id, item.record.name]))
    return (videos.data ?? NONE).map((item) => videoRow(item, watched, names))
  }, [pending, error, videos.data, progress.data, teachers.data])

  const selected = rows?.find((row) => row.id === panel.selectedId)

  return (
    <>
      <PageHeading title={page.title} description={page.description} />
      {error ? (
        <div role="alert" className="rounded-card border bg-surface p-[45px] text-center">
          <QueryError error={error} onRetry={retry} />
        </div>
      ) : rows === undefined ? (
        <p
          role="status"
          className="rounded-card border bg-surface p-[45px] text-center text-base text-muted-foreground"
        >
          Videolar yükleniyor…
        </p>
      ) : (
        <CollectionList
          listKey="videolar"
          rows={rows}
          filters={FILTERS}
          searchLabel="Video ara"
          searchKeys={SEARCH_KEYS}
        >
          {(items) =>
            items.map((video) => <VideoCard key={video.id} video={video} onOpen={panel.open} />)
          }
        </CollectionList>
      )}
      <VideoPanel
        videoId={panel.selectedId}
        progress={selected?.progress ?? 0}
        teacher={selected?.teacher ?? '—'}
        onClose={panel.close}
      />
    </>
  )
}

function VideoCard({ video, onOpen }: { video: VideoRow; onOpen: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(video.id)}
      aria-label={`${video.title} videosunu aç`}
      className="video-card grid overflow-hidden rounded-card border bg-surface text-left hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span className="video-thumbnail grid aspect-video place-items-center bg-surface-soft">
        {video.poster ? (
          <img src={video.poster} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <Icon name="Play" size={32} aria-hidden="true" />
        )}
      </span>
      <span className="video-card-body grid gap-2 p-4">
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge text={video.level} tone="purple" />
          <small className="text-muted-foreground">
            {video.subject} · {video.topic}
          </small>
        </span>
        <strong className="text-base font-semibold [overflow-wrap:anywhere]">{video.title}</strong>
        <span className="text-sm text-muted-foreground">{video.teacher}</span>
        <span
          role="progressbar"
          aria-label={`${video.title} izleme ilerlemesi`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={video.progress}
          className="block h-1.5 overflow-hidden rounded-full bg-secondary"
        >
          <span className="block h-full bg-primary" style={{ width: `${video.progress}%` }} />
        </span>
        <span className="flex items-center justify-between gap-2 text-sm">
          <small className="text-muted-foreground">{progressText(video.progress)}</small>
          <span className="watch-label inline-flex items-center gap-1 font-medium text-primary">
            <Icon name="Play" size={15} aria-hidden="true" />
            {watchAction(video.progress)}
          </span>
        </span>
        <small className="text-muted-foreground">
          {video.duration} dk{video.captions ? ' · Altyazılı' : ''}
        </small>
      </span>
    </button>
  )
}
