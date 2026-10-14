<script setup>
import { computed } from 'vue'
const props = defineProps({
  text: { type: String, default: '' },
  tone: { type: String, default: '' },
})
const color = computed(
  () =>
    props.tone ||
    (/Ödendi|Yanıtlandı|Onaylandı|Tamamlandı|Değerlendirildi|Kayıt oldu|Çözüldü|Geldi|Aktif|Ulaşıldı/.test(
      props.text,
    )
      ? 'green'
      : /Gecikmiş|Süre aşıldı|Yüksek|Gelmedi|Vazgeçti|Reddedildi/.test(props.text)
        ? 'red'
        : /Bekliyor|Yaklaşan|Süre azalıyor|İnceleniyor|Teklif|Geç geldi/.test(props.text)
          ? 'amber'
          : 'purple'),
)
</script>
<template>
  <span class="badge" :class="`badge-${color}`">{{ text }}<slot /></span>
</template>
