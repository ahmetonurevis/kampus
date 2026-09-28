<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, useId } from 'vue'
import Icon from './Icon.vue'
import { modalStack, modalFocusOrigins } from '../lib/modal-stack.js'
defineProps({
  title: { type: String, required: true },
  wide: Boolean,
  document: Boolean,
  drawer: Boolean,
})
const emit = defineEmits(['close'])
const dialog = ref(null)
const dialogId = useId()
const stackIndex = modalStack.length
let previousFocus
let focusFallbacks = []
function keydown(event) {
  if (modalStack.at(-1) !== dialogId) return
  if (event.key === 'Escape') emit('close')
  if (event.key === 'Tab') {
    const focusable = [
      ...dialog.value.querySelectorAll(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], iframe, [tabindex="0"]',
      ),
    ].filter((el) => el.offsetParent !== null)
    const first = focusable[0],
      last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
}
onMounted(async () => {
  previousFocus = document.activeElement
  // Üst panel ve altındaki detay aynı anda kapanırsa odağı listeye geri ver.
  focusFallbacks = [...modalStack].reverse().map((id) => modalFocusOrigins.get(id))
  modalFocusOrigins.set(dialogId, previousFocus)
  modalStack.push(dialogId)
  document.body.style.overflow = 'hidden'
  await nextTick()
  dialog.value.querySelector('input, select, textarea, button')?.focus()
  document.addEventListener('keydown', keydown)
})
onBeforeUnmount(() => {
  const index = modalStack.indexOf(dialogId)
  const wasTop = index === modalStack.length - 1
  if (index >= 0) modalStack.splice(index, 1)
  modalFocusOrigins.delete(dialogId)
  if (!modalStack.length) document.body.style.overflow = ''
  document.removeEventListener('keydown', keydown)
  if (wasTop) [previousFocus, ...focusFallbacks].find((element) => element?.isConnected)?.focus()
})
</script>
<template>
  <Teleport to="body"
    ><div
      class="modal-backdrop"
      :class="{ 'drawer-backdrop': drawer }"
      :style="{ zIndex: 100 + stackIndex * 2 }"
      @click.self="emit('close')"
    >
      <section
        ref="dialog"
        class="modal"
        :class="{ wide, 'document-modal': document, drawer }"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="dialogId"
      >
        <header>
          <h2 :id="dialogId">{{ title }}</h2>
          <button class="icon-button" aria-label="Pencereyi kapat" @click="emit('close')">
            <Icon name="X" />
          </button>
        </header>
        <div class="modal-body"><slot /></div>
      </section></div
  ></Teleport>
</template>
