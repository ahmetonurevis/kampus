<script setup>
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import Icon from './Icon.vue'
const props = defineProps({
  modelValue: { type: [String, Boolean, Number], required: true },
  options: { type: Array, required: true },
  label: { type: String, required: true },
})
const emit = defineEmits(['update:modelValue'])
const root = ref(null),
  track = ref(null),
  indicator = ref(null)
let observer
function measure() {
  const active = track.value?.querySelector('[aria-pressed="true"]')
  indicator.value = active
    ? { transform: `translateX(${active.offsetLeft}px) scaleX(${active.offsetWidth})` }
    : null
}
function observe() {
  observer?.disconnect()
  for (const element of [
    root.value,
    track.value,
    ...(track.value?.querySelectorAll('button') || []),
  ])
    if (element) observer?.observe(element)
  measure()
}
watch(
  () => [props.modelValue, props.options],
  async () => {
    await nextTick()
    observe()
  },
  { deep: true },
)
onMounted(() => {
  observer = new ResizeObserver(measure)
  observe()
})
onBeforeUnmount(() => observer?.disconnect())
function navigate(event, index) {
  const last = props.options.length - 1
  const target = {
    ArrowRight: (index + 1) % (last + 1),
    ArrowLeft: (index + last) % (last + 1),
    Home: 0,
    End: last,
  }[event.key]
  if (target === undefined) return
  event.preventDefault()
  emit('update:modelValue', props.options[target].value)
  track.value.querySelectorAll('button')[target]?.focus()
}
</script>
<template>
  <div ref="root" class="line-tabs" role="group" :aria-label="label">
    <div ref="track" class="line-tabs-track">
      <button
        v-for="(option, index) in options"
        :key="String(option.value)"
        type="button"
        :aria-pressed="modelValue === option.value"
        :tabindex="modelValue === option.value ? 0 : -1"
        @click="emit('update:modelValue', option.value)"
        @keydown="navigate($event, index)"
      >
        <Icon v-if="option.icon" :name="option.icon" :size="16" />{{ option.label }}
        <span v-if="option.count != null" class="tab-count">{{ option.count }}</span>
      </button>
      <span v-if="indicator" class="tab-indicator" :style="indicator" aria-hidden="true"></span>
    </div>
  </div>
</template>
