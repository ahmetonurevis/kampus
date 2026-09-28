<script setup>
import { computed } from 'vue'
import { subjectById } from '../data/curriculum.js'
import Icon from './Icon.vue'
const props = defineProps({
  subjectId: { type: String, required: true },
  level: { type: String, default: '' },
})
const subject = computed(() => subjectById(props.subjectId))
</script>
<template>
  <div class="lesson-cover" :class="subject?.color || 'blue'" aria-hidden="true">
    <div class="cover-heading">
      <span>{{ subject?.name || 'Ders videosu' }}</span
      ><span>{{ level }}</span>
    </div>
    <div v-if="subjectId === 'math'" class="cover-equation">
      <small>BİRİNCİ DERECEDEN DENKLEMLER</small><strong>2x + 6 = 18</strong
      ><span>Her iki taraftan 6 çıkaralım.</span>
    </div>
    <div v-else-if="subjectId === 'science'" class="cover-biology">
      <svg viewBox="0 0 200 120">
        <rect
          x="14"
          y="12"
          width="165"
          height="96"
          rx="32"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        />
        <rect x="21" y="19" width="151" height="82" rx="26" fill="none" stroke="currentColor" />
        <ellipse cx="78" cy="59" rx="24" ry="21" fill="currentColor" opacity=".12" />
        <circle cx="78" cy="59" r="13" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="78" cy="59" r="4" fill="currentColor" />
        <ellipse cx="131" cy="60" rx="24" ry="27" fill="currentColor" opacity=".1" />
        <g fill="currentColor">
          <ellipse cx="49" cy="35" rx="8" ry="4" />
          <ellipse cx="52" cy="87" rx="8" ry="4" />
          <ellipse cx="129" cy="28" rx="8" ry="4" />
          <ellipse cx="152" cy="87" rx="8" ry="4" />
        </g>
      </svg>
      <div>
        <small>CANLILARIN YAPISI</small><strong>Hücreyi<br />tanıyalım.</strong>
      </div>
    </div>
    <div v-else class="cover-generic">
      <Icon :name="subject?.icon || 'BookOpen'" :size="58" /><strong>{{ subject?.name }}</strong>
    </div>
    <span class="cover-footer">KAMPÜS / DERS NOTLARI</span>
  </div>
</template>
<style scoped>
.lesson-cover {
  width: 100%;
  height: 100%;
  padding: 24px;
  display: flex;
  flex-direction: column;
  text-align: left;
}
.cover-heading {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: calc(12px - var(--font-size-reduction));
  font-weight: 600;
}
.cover-equation {
  padding-block: 24px;
}
.cover-equation small,
.cover-biology small {
  font-size: calc(9px - var(--font-size-reduction));
  letter-spacing: 1px;
  font-weight: 600;
}
.cover-equation strong {
  display: block;
  font-size: calc(clamp(24px, 2.6vw, 40px) - var(--font-size-reduction));
  font-weight: 500;
  letter-spacing: -1px;
  margin: 6px 0;
}
.cover-equation > span {
  font-size: calc(12px - var(--font-size-reduction));
}
.cover-biology {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-block: 18px;
}
.cover-biology svg {
  width: 52%;
}
.cover-biology strong {
  display: block;
  font-size: calc(25px - var(--font-size-reduction));
  line-height: 1.25;
  margin-top: 8px;
  font-weight: 500;
}
.cover-footer {
  font-size: calc(9px - var(--font-size-reduction));
  letter-spacing: 1.6px;
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid currentColor;
}
.cover-generic {
  display: flex;
  align-items: center;
  gap: 18px;
  flex: 1;
}
@media (max-width: 650px) {
  .lesson-cover {
    padding: 20px;
  }
  .cover-equation strong {
    font-size: calc(34px - var(--font-size-reduction));
  }
}
</style>
