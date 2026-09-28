<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'

const story = ref(null)
const paused = ref(false)
const reducedMotion = ref(false)
const visible = ref(true)
const hidden = ref(false)
const motionEnabled = computed(
  () => !paused.value && !reducedMotion.value && visible.value && !hidden.value,
)
let motionPreference,
  pointerPreference,
  observer,
  frame = 0
let pointerX = 0,
  pointerY = 0

function resetPointer() {
  cancelAnimationFrame(frame)
  frame = 0
  story.value?.style.setProperty('--pointer-x', '0')
  story.value?.style.setProperty('--pointer-y', '0')
}
function moveScene(event) {
  if (!motionEnabled.value || !pointerPreference?.matches || event.pointerType !== 'mouse') return
  pointerX = event.clientX
  pointerY = event.clientY
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    const bounds = story.value?.getBoundingClientRect()
    if (!bounds?.width || !bounds.height) return
    const x = Math.max(-1, Math.min(1, ((pointerX - bounds.left) / bounds.width) * 2 - 1))
    const y = Math.max(-1, Math.min(1, ((pointerY - bounds.top) / bounds.height) * 2 - 1))
    story.value.style.setProperty('--pointer-x', x.toFixed(3))
    story.value.style.setProperty('--pointer-y', y.toFixed(3))
  })
}
function syncPreferences() {
  reducedMotion.value = motionPreference.matches
  resetPointer()
}
function syncVisibility() {
  hidden.value = document.hidden
}
watch(motionEnabled, (enabled) => {
  if (!enabled) resetPointer()
})

onMounted(() => {
  motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  pointerPreference = window.matchMedia('(hover: hover) and (pointer: fine)')
  syncPreferences()
  syncVisibility()
  motionPreference.addEventListener('change', syncPreferences)
  pointerPreference.addEventListener('change', resetPointer)
  document.addEventListener('visibilitychange', syncVisibility)
  window.addEventListener('resize', resetPointer, { passive: true })
  observer = new IntersectionObserver(
    ([entry]) => {
      visible.value = entry.isIntersecting
    },
    { threshold: 0 },
  )
  observer.observe(story.value)
})
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  observer?.disconnect()
  motionPreference?.removeEventListener('change', syncPreferences)
  pointerPreference?.removeEventListener('change', resetPointer)
  document.removeEventListener('visibilitychange', syncVisibility)
  window.removeEventListener('resize', resetPointer)
})
</script>

<template>
  <section
    ref="story"
    class="login-story"
    :class="{ 'is-still': !motionEnabled, 'is-reduced': reducedMotion }"
    @pointermove="moveScene"
    @pointerleave="resetPointer"
    @pointercancel="resetPointer"
  >
    <div class="story-header">
      <div class="brand">
        <span class="brand-icon"><Icon name="GraduationCap" :size="29" /></span
        ><span>kampüs<span class="brand-period">.</span></span>
      </div>
      <!-- Animasyon kontrolünü göstermek için aşağıdaki yorum bloğunu kaldırın.
      <button
        v-if="!reducedMotion"
        type="button"
        class="story-motion"
        :aria-label="paused ? 'Animasyonu başlat' : 'Animasyonu durdur'"
        :title="paused ? 'Animasyonu başlat' : 'Animasyonu durdur'"
        :aria-pressed="paused"
        @click="paused = !paused"
      >
        <Icon :name="paused ? 'CirclePlay' : 'CirclePause'" :size="20" />
      </button>
      -->
    </div>
    <div class="login-story-content">
      <span class="eyebrow">AKADEMİ ÖZEL OKULLARI</span>
      <h1>Okulun her günü,<br /><em>tek bir yerde.</em></h1>
      <p>
        Ders programı, öğrenci takibi ve veli iletişimi.<br />Okulunuzun günlük işleri için ortak
        çalışma alanı.
      </p>

      <div class="depth-stage" aria-hidden="true">
        <div class="scene-world">
          <div class="scene-center">
            <div class="academy-tile tile-underlay"></div>
            <div class="academy-tile tile-main">
              <Icon name="GraduationCap" :size="74" />
              <span class="tile-caption">KAMPÜS</span>
            </div>
          </div>
          <div class="scene-panels">
            <div class="scene-card scene-card-growth">
              <span class="scene-card-icon"><Icon name="TrendingUp" :size="22" /></span>
              <div>
                <strong>Akademik takip</strong><small>Dersler, notlar ve değerlendirmeler.</small
                ><span class="scene-chart"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
              </div>
            </div>
            <div class="scene-card scene-card-success">
              <span class="scene-card-icon"><Icon name="CircleCheck" :size="24" /></span>
              <div>
                <strong>Okul ve aile</strong><small>Duyurular ve öğretmen görüşmeleri.</small>
              </div>
            </div>
            <div class="scene-subject subject-science"><Icon name="FlaskConical" :size="23" /></div>
            <div class="scene-subject subject-book"><Icon name="BookOpen" :size="24" /></div>
          </div>
        </div>
      </div>
    </div>
    <div class="login-story-footer">
      <span>Akademi Özel Okulları</span><span>Özel Okul Yönetim Platformu</span>
    </div>
  </section>
</template>

<style scoped>
.login-story {
  --pointer-x: 0;
  --pointer-y: 0;
  isolation: isolate;
}
.story-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.story-motion {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  border: 1px solid var(--sidebar-border);
  border-radius: 50%;
  color: var(--sidebar-text);
  background: #ffffff06;
  transition:
    background 180ms ease,
    border-color 180ms ease;
}
.story-motion:hover,
.story-motion[aria-pressed='true'] {
  background: var(--sidebar-raised);
  border-color: var(--sidebar-border);
}
.story-motion:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 4px;
}
.depth-stage {
  position: relative;
  width: 100%;
  max-width: 470px;
  height: 290px;
  margin: 20px auto 0;
  perspective: 1000px;
}
.scene-world {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  transform: rotateX(calc(var(--pointer-y) * -8deg)) rotateY(calc(var(--pointer-x) * 12deg));
  transition: transform 450ms cubic-bezier(0.2, 0.65, 0.3, 1);
}
.scene-center {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  animation: academy-levitate 7s ease-in-out infinite;
}
.academy-tile {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 140px;
  height: 150px;
  border-radius: 24px;
  transform-style: preserve-3d;
}
.tile-underlay {
  background: var(--scene-surface);
  border: 1px solid var(--scene-border);
  box-shadow:
    0 12px 0 var(--scene-edge),
    0 30px 45px var(--scene-shadow);
  transform: translate(-40%, -36%) rotateX(16deg) rotateY(-19deg) rotateZ(-13deg) translateZ(-12px);
}
.tile-main {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 10px;
  color: var(--sapphire-800);
  border: 1px solid var(--white);
  background: var(--scene-tile);
  box-shadow:
    inset 2px 2px 3px #ffffff50,
    inset -2px -2px 4px var(--scene-inset),
    1px 3px 0 var(--scene-step-1),
    2px 6px 0 var(--scene-step-2),
    3px 9px 0 var(--scene-step-3),
    3px 15px 22px var(--scene-shadow);
  transform: translate(-50%, -50%) rotateX(16deg) rotateY(-19deg) rotateZ(-9deg) translateZ(32px);
}
.tile-main > svg {
  filter: drop-shadow(0 4px 0 var(--scene-inset));
  transform: translateZ(10px);
}
.tile-caption {
  /* Mobilde sahne %66 ölçeklendiğinde de marka adı okunaklı kalır. */
  font-size: calc(22px - var(--font-size-reduction));
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.8px;
  white-space: nowrap;
  color: var(--sapphire-900);
  transform: translateZ(8px);
}
.scene-panels {
  position: absolute;
  inset: 0;
  transform-style: preserve-3d;
  animation: academy-sway 9s ease-in-out -3s infinite;
}
.scene-card {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--scene-border);
  background: var(--scene-surface);
  box-shadow:
    inset 0 1px 0 #ffffff17,
    0 5px 0 var(--scene-edge),
    0 22px 35px var(--scene-shadow);
}
.scene-card strong {
  display: block;
  color: var(--white);
  font-size: calc(11px - var(--font-size-reduction));
  font-weight: 500;
  line-height: 1.4;
}
.scene-card small {
  display: block;
  color: var(--sidebar-text);
  font-size: calc(9px - var(--font-size-reduction));
  margin-top: 5px;
  line-height: 1.5;
}
.scene-card-icon {
  width: 37px;
  height: 39px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  flex-shrink: 0;
  box-shadow: inset 0 1px 1px #ffffff17;
}
.scene-card-growth {
  left: 0;
  top: 18px;
  transform: translateZ(120px) rotateY(8deg) rotateZ(-8deg);
}
.scene-card-growth .scene-card-icon {
  color: var(--sidebar-text);
  background: var(--sidebar);
}
.scene-card-success {
  right: 0;
  bottom: 18px;
  transform: translateZ(140px) rotateY(-10deg) rotateZ(7deg);
}
.scene-card-success .scene-card-icon {
  color: var(--accent);
  background: var(--sidebar);
}
.scene-chart {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 20px;
  margin-top: 8px;
}
.scene-chart i {
  width: 12px;
  height: 5px;
  border-radius: 3px;
  background: var(--accent);
  opacity: 0.75;
}
.scene-chart i:nth-child(2) {
  height: 8px;
}
.scene-chart i:nth-child(3) {
  height: 7px;
}
.scene-chart i:nth-child(4) {
  height: 12px;
}
.scene-chart i:nth-child(5) {
  height: 14px;
}
.scene-chart i:nth-child(6) {
  height: 17px;
}
.scene-chart i:nth-child(7) {
  height: 20px;
}
.scene-subject {
  position: absolute;
  width: 49px;
  height: 51px;
  border-radius: 17px;
  display: grid;
  place-items: center;
  border: 1px solid #fff3;
  box-shadow:
    inset 1px 1px 1px #fff3,
    2px 4px 0 var(--scene-edge),
    0 12px 24px var(--scene-shadow);
}
.subject-science {
  right: 37px;
  top: 7px;
  background: var(--scene-tile);
  color: var(--sapphire-800);
  transform: translateZ(18px) rotateY(-20deg) rotateZ(16deg);
}
.subject-book {
  left: 43px;
  bottom: 14px;
  background: var(--accent);
  color: var(--on-accent);
  transform: translateZ(50px) rotateY(25deg) rotateZ(-14deg);
}
@keyframes academy-levitate {
  0%,
  100% {
    transform: translateY(5px) rotateZ(-1deg);
  }
  50% {
    transform: translateY(-9px) rotateZ(2deg);
  }
}
@keyframes academy-sway {
  0%,
  100% {
    transform: translateY(-5px) rotateX(1deg);
  }
  50% {
    transform: translateY(7px) rotateX(-1deg);
  }
}
.is-still .scene-center,
.is-still .scene-panels {
  animation-play-state: paused;
}
.is-reduced .scene-world {
  transition: none;
}
@media (max-width: 1200px) {
  .depth-stage {
    max-width: 380px;
    height: 265px;
  }
  .scene-card {
    padding: 12px;
    gap: 9px;
  }
  .scene-card strong {
    font-size: calc(10px - var(--font-size-reduction));
  }
  .scene-card small {
    font-size: calc(8px - var(--font-size-reduction));
  }
  .scene-card-growth {
    left: -4px;
  }
  .scene-card-success {
    right: -4px;
  }
}
@media (min-width: 651px) and (max-width: 900px) {
  .depth-stage {
    transform: scale(0.9);
    transform-origin: center;
  }
  .scene-card {
    padding: 10px;
    gap: 7px;
  }
  .scene-card-icon {
    width: 30px;
    height: 32px;
  }
  .scene-card small {
    max-width: 110px;
  }
}
@media (max-width: 650px) {
  .login-story-content {
    padding-top: 24px;
  }
  .login-story h1 {
    font-size: calc(34px - var(--font-size-reduction));
    max-width: 290px;
  }
  .login-story-content > p {
    max-width: 300px;
  }
  .depth-stage {
    height: 175px;
    max-width: 310px;
    margin: 0 auto -5px;
    perspective: 900px;
  }
  .scene-world {
    transform: scale(0.66) rotateX(calc(var(--pointer-y) * -8deg))
      rotateY(calc(var(--pointer-x) * 12deg));
  }
  .scene-card-growth {
    left: -58px;
    top: -5px;
  }
  .scene-card-success {
    right: -60px;
    bottom: -15px;
  }
  .scene-card small {
    max-width: none;
  }
  .subject-science {
    right: -10px;
    top: -28px;
  }
  .subject-book {
    left: -6px;
    bottom: -30px;
  }
  .story-motion {
    width: 44px;
    height: 44px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .scene-center,
  .scene-panels {
    animation: none;
  }
  .scene-world,
  .story-motion {
    transition: none;
  }
}
</style>
