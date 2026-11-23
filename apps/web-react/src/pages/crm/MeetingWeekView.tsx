import { Link } from 'react-router'
import { Icon } from '@/components/Icon.tsx'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MeetingDay } from './prospect-rows.ts'

type Props = {
  role: string
  title: string
  days: readonly MeetingDay[]
  atCurrent: boolean
  onPrevious: () => void
  onCurrent: () => void
  onNext: () => void
}

/**
 * Tanışma Görüşmeleri haftalık takvimi (Vue `WeekCalendar`): pazartesiden pazara günler, her günde
 * saat sırasıyla görüşme ve deneme dersleri; aday adı detayına bağlanır. Hafta gezinme düğmeleri
 * adresteki haftayı (`?hafta=`) değiştirir. Dar ekranda günler alt alta iner.
 */
export function MeetingWeekView({
  role,
  title,
  days,
  atCurrent,
  onPrevious,
  onCurrent,
  onNext,
}: Props) {
  return (
    <div className="grid gap-4 p-6 max-[650px]:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{title}</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onPrevious}>
            <Icon name="ChevronLeft" size={16} aria-hidden="true" />
            Önceki hafta
          </Button>
          <Button variant="secondary" onClick={onCurrent} disabled={atCurrent}>
            Bu hafta
          </Button>
          <Button variant="secondary" onClick={onNext}>
            Sonraki hafta
            <Icon name="ChevronRight" size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
      <ol
        aria-label="Haftalık görüşme takvimi"
        className="grid grid-cols-1 gap-3 min-[761px]:grid-cols-2 min-[1281px]:grid-cols-7"
      >
        {days.map((day) => (
          <li
            key={day.day}
            aria-current={day.today ? 'date' : undefined}
            className={cn(
              'grid min-w-0 content-start gap-2 rounded-card border bg-surface-soft p-3',
              day.today && 'border-primary',
            )}
          >
            <h4 className="text-sm font-semibold">
              {day.label}
              {day.today ? <span className="ml-1 text-xs text-primary">· Bugün</span> : null}
            </h4>
            {day.events.length === 0 ? (
              <p className="text-xs text-muted-foreground">Görüşme yok</p>
            ) : (
              <ul className="grid gap-2" aria-label={`${day.label} görüşmeleri`}>
                {day.events.map((event) => (
                  <li key={event.id} className="grid gap-0.5 rounded-lg border bg-surface p-2.5">
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {event.timeRange}
                    </span>
                    <Link
                      to={`/${role}/aday/${encodeURIComponent(event.prospectId)}`}
                      className="record-link text-sm font-medium [overflow-wrap:anywhere] text-primary hover:underline"
                    >
                      {event.name}
                    </Link>
                    <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {event.kindLabel} · {event.branch}
                      {event.place !== '—' ? ` · ${event.place}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
