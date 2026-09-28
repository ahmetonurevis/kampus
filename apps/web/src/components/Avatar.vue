<script setup>
import { initials } from '../lib/format.js'
import { computed } from 'vue'
const props = defineProps({
  name: { type: String, default: '' },
  size: { type: String, default: '' },
})
const color = computed(() => {
  const name = props.name.normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr')
  let hash = 0
  for (const character of name) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0
  return hash % 5
})
</script>
<template>
  <span class="avatar" :class="[size, `avatar-${color}`]">{{ initials(name) }}</span>
</template>
