import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Icon } from '@/components/Icon.tsx'
import { useDocumentVisible } from '@/hooks/use-document-visible.ts'
import { useMediaQuery } from '@/hooks/use-media-query.ts'
import { cn } from '@/lib/utils'
import './login-scene.css'

const clamp = (value: number) => Math.max(-1, Math.min(1, value))

/**
 * Girişin 3B sahnesi (Vue `LoginStory.vue`). Fare ile hafif eğilir; azaltılmış hareket,
 * dokunmatik işaretçi, ekran dışında kalma ve görünmeyen sekmede durur.
 */
export function LoginStory() {
  const story = useRef<HTMLElement>(null)
  const frame = useRef(0)
  const pointer = useRef({ x: 0, y: 0 })
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
  const finePointer = useMediaQuery('(hover: hover) and (pointer: fine)')
  const documentVisible = useDocumentVisible()
  const [onScreen, setOnScreen] = useState(true)
  const motionEnabled = !reducedMotion && onScreen && documentVisible

  // Dış sistem: görünürlük gözlemcisi ve pencere boyutu.
  useEffect(() => {
    const element = story.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry?.isIntersecting ?? true),
      { threshold: 0 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  function resetPointer() {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    story.current?.style.setProperty('--pointer-x', '0')
    story.current?.style.setProperty('--pointer-y', '0')
  }

  useEffect(() => {
    if (!motionEnabled || !finePointer) resetPointer()
    window.addEventListener('resize', resetPointer, { passive: true })
    return () => {
      window.removeEventListener('resize', resetPointer)
      cancelAnimationFrame(frame.current)
    }
  }, [motionEnabled, finePointer])

  function moveScene(event: PointerEvent<HTMLElement>) {
    if (!motionEnabled || !finePointer || event.pointerType !== 'mouse') return
    pointer.current = { x: event.clientX, y: event.clientY }
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const element = story.current
      const bounds = element?.getBoundingClientRect()
      if (!element || !bounds?.width || !bounds.height) return
      const x = clamp(((pointer.current.x - bounds.left) / bounds.width) * 2 - 1)
      const y = clamp(((pointer.current.y - bounds.top) / bounds.height) * 2 - 1)
      element.style.setProperty('--pointer-x', x.toFixed(3))
      element.style.setProperty('--pointer-y', y.toFixed(3))
    })
  }

  return (
    <section
      ref={story}
      aria-label="Kampüs"
      onPointerMove={moveScene}
      onPointerLeave={resetPointer}
      onPointerCancel={resetPointer}
      className={cn(
        'login-story relative flex flex-col justify-between gap-8 overflow-hidden bg-sidebar p-[55px] text-on-sapphire max-[900px]:p-8 max-[650px]:px-6',
        !motionEnabled && 'is-still',
        reducedMotion && 'is-reduced',
      )}
    >
      <span className="flex items-center gap-3 text-[27px] font-semibold tracking-[-1.2px]">
        <span className="grid size-[41px] place-items-center rounded-xl bg-on-sapphire text-sapphire">
          <Icon name="GraduationCap" size={29} />
        </span>
        <span>
          kampüs<span className="text-brand">.</span>
        </span>
      </span>
      <div className="login-story-content flex max-w-[560px] flex-col gap-6">
        <p className="text-2xs font-semibold tracking-[1.5px]">AKADEMİ ÖZEL OKULLARI</p>
        <h2 className="text-[clamp(36px,3.6vw,54px)] leading-[1.08] font-medium tracking-[-1.5px]">
          Okulun her günü,
          <br />
          <span className="text-brand">tek bir yerde.</span>
        </h2>
        <p className="text-md leading-[1.75] text-sidebar-strong">
          Ders programı, öğrenci takibi ve veli iletişimi.
          <br />
          Okulunuzun günlük işleri için ortak çalışma alanı.
        </p>
        <div className="depth-stage" aria-hidden="true">
          <div className="scene-world">
            <div className="scene-center">
              <div className="academy-tile tile-underlay" />
              <div className="academy-tile tile-main">
                <Icon name="GraduationCap" size={74} />
                <span className="tile-caption">KAMPÜS</span>
              </div>
            </div>
            <div className="scene-panels">
              <div className="scene-card scene-card-growth">
                <span className="scene-card-icon">
                  <Icon name="TrendingUp" size={22} />
                </span>
                <div>
                  <strong>Akademik takip</strong>
                  <small>Dersler, notlar ve değerlendirmeler.</small>
                  <span className="scene-chart">
                    {[1, 2, 3, 4, 5, 6, 7].map((bar) => (
                      <i key={bar} />
                    ))}
                  </span>
                </div>
              </div>
              <div className="scene-card scene-card-success">
                <span className="scene-card-icon">
                  <Icon name="CircleCheck" size={24} />
                </span>
                <div>
                  <strong>Okul ve aile</strong>
                  <small>Duyurular ve öğretmen görüşmeleri.</small>
                </div>
              </div>
              <div className="scene-subject subject-science">
                <Icon name="FlaskConical" size={23} />
              </div>
              <div className="scene-subject subject-book">
                <Icon name="BookOpen" size={24} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="flex justify-between gap-4 text-2xs text-sidebar-strong">
        <span>Akademi Özel Okulları</span>
        <span>Özel Okul Yönetim Platformu</span>
      </div>
    </section>
  )
}
