<script setup>
defineProps({ steps: { type: Array, required: true }, current: { type: Number, required: true } })
defineEmits(['back'])
</script>
<template>
  <ol class="form-steps" aria-label="Form adımları">
    <li
      v-for="(step, index) in steps"
      :key="step"
      :class="{ active: index === current, complete: index < current }"
      :aria-current="index === current ? 'step' : undefined"
    >
      <button v-if="index < current" type="button" @click="$emit('back', index)">
        <span>{{ index + 1 }}</span
        >{{ step }}
      </button>
      <div v-else>
        <span>{{ index + 1 }}</span
        >{{ step }}
      </div>
    </li>
  </ol>
</template>
