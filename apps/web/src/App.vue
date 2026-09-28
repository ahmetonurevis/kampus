<script setup>
import { computed, ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { navigation, roles } from './modules/navigation.js'
import {
  state,
  role,
  setRole,
  theme,
  toasts,
  selectedChildId,
  currentStudent,
  teacherId,
  teacherById,
  classById,
} from './stores/demo.js'
import { dateLabel } from './lib/format.js'
import Icon from './components/Icon.vue'
import Avatar from './components/Avatar.vue'
import Modal from './components/Modal.vue'
import PdfPreview from './components/PdfPreview.vue'
import { closePdfPreview } from './lib/download.js'
import { readView, writeView, viewScope } from './lib/view-memory.js'
import { useMediaQuery } from './lib/use-media-query.js'
const route = useRoute(),
  router = useRouter()
const mobileOpen = ref(false),
  roleSelectPointerFocus = ref(false),
  helpOpen = ref(false),
  notificationsOpen = ref(false)
const activeRole = computed(() => ({
  ...(roles[role.value] || roles.yonetici),
  ...(role.value === 'ogretmen'
    ? { name: teacherById(teacherId).name, subtitle: `${teacherById(teacherId).subject} Öğretmeni` }
    : role.value === 'ogrenci'
      ? {
          name: currentStudent.value.name,
          subtitle: `${classById(currentStudent.value.classId).name} · ${classById(currentStudent.value.classId).grade < 9 ? 'Ortaokul' : 'Lise'}`,
        }
      : {}),
}))
const menu = computed(() =>
  (navigation[role.value] || []).filter((item) => !item.module || state.modules[item.module]),
)
const groups = computed(() => [...new Set(menu.value.map((item) => item.group))])
function groupLabel(group) {
  return group.charAt(0).toLocaleUpperCase('tr') + group.slice(1).toLocaleLowerCase('tr')
}
const mobileMenu = useMediaQuery('(max-width: 860px)')
const sidebar = ref(null)
const savedGroups = readView('navigation-groups', {})
const expandedGroups = ref(
  savedGroups && typeof savedGroups === 'object' && !Array.isArray(savedGroups) ? savedGroups : {},
)
function groupExpanded(group) {
  return expandedGroups.value[`${role.value}:${group}`] ?? group === 'GENEL'
}
function toggleGroup(group) {
  expandedGroups.value[`${role.value}:${group}`] = !groupExpanded(group)
  writeView('navigation-groups', expandedGroups.value)
}
watch(
  () => route.path,
  () => {
    if (route.meta.group) expandedGroups.value[`${role.value}:${route.meta.group}`] = true
  },
  { immediate: true },
)
let menuTrigger
watch(mobileOpen, async (open) => {
  if (!mobileMenu.value) return
  if (open) {
    menuTrigger = document.activeElement
    await nextTick()
    sidebar.value?.querySelector('.sidebar-close')?.focus()
  } else {
    await nextTick()
    menuTrigger?.focus()
  }
})
function menuKeyboard(event) {
  if (!mobileOpen.value || !mobileMenu.value || document.querySelector('[role="dialog"]')) return
  if (event.key === 'Escape') mobileOpen.value = false
  if (event.key === 'Tab') {
    const elements = [...sidebar.value.querySelectorAll('button, a[href], select')].filter(
      (el) => el.offsetParent !== null,
    )
    if (event.shiftKey && document.activeElement === elements[0]) {
      event.preventDefault()
      elements.at(-1)?.focus()
    } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
      event.preventDefault()
      elements[0]?.focus()
    }
  }
}
onMounted(() => document.addEventListener('keydown', menuKeyboard))
onBeforeUnmount(() => document.removeEventListener('keydown', menuKeyboard))
const childOptions = computed(() =>
  state.parents[0].studentIds.map((id) => state.students.find((s) => s.id === id)),
)
const announcements = computed(() =>
  state.announcements
    .filter(
      (a) =>
        !a.classId ||
        !['ogrenci', 'veli'].includes(role.value) ||
        a.classId === currentStudent.value.classId,
    )
    .slice(0, 4),
)
watch(
  () => route.fullPath + selectedChildId.value,
  () => {
    mobileOpen.value = false
    notificationsOpen.value = false
    closePdfPreview()
  },
)
watch(selectedChildId, async (value, previous) => {
  if (role.value !== 'veli') return
  writeView(`${viewScope(route.path, previous)}:scroll`, { top: window.scrollY, left: 0 })
  await nextTick()
  window.scrollTo(readView(`${viewScope(route.path, value)}:scroll`, { top: 0, left: 0 }))
})
function changeRole(event) {
  setRole(event.target.value)
  router.push(`/${event.target.value}/dashboard`)
}
function logout() {
  setRole('')
  router.push('/giris')
}
</script>
<template>
  <a class="skip-link" href="#main">İçeriğe geç</a>
  <div v-if="route.path !== '/giris'" class="app-shell">
    <div v-if="mobileOpen" class="sidebar-scrim" @click="mobileOpen = false"></div>
    <aside
      ref="sidebar"
      class="sidebar"
      :class="{ open: mobileOpen }"
      :inert="mobileMenu && !mobileOpen"
      aria-label="Ana gezinme"
    >
      <button
        class="icon-button sidebar-close"
        aria-label="Menüyü kapat"
        @click="mobileOpen = false"
      >
        <Icon name="X" />
      </button>
      <RouterLink :to="`/${role || 'yonetici'}/dashboard`" class="brand"
        ><span class="brand-icon"><Icon name="GraduationCap" :size="27" /></span
        ><span
          >kampüs<span class="brand-period">.</span><small>EĞİTİMİN YENİ ADRESİ</small></span
        ></RouterLink
      >
      <div class="workspace-switch">
        <span class="workspace-avatar">A</span>
        <div><strong>Akademi Özel Okulları</strong><small>2026–2027 Eğitim Dönemi</small></div>
      </div>
      <nav class="side-nav">
        <div v-for="(group, index) in groups" :key="`${role}:${group}`" class="nav-group">
          <button
            type="button"
            class="nav-group-toggle"
            :aria-expanded="groupExpanded(group)"
            :aria-controls="`nav-group-${index}`"
            @click="toggleGroup(group)"
          >
            {{ groupLabel(group)
            }}<Icon name="ChevronDown" :size="15" :class="{ rotated: groupExpanded(group) }" />
          </button>
          <div v-show="groupExpanded(group)" :id="`nav-group-${index}`">
            <RouterLink
              v-for="item in menu.filter((m) => m.group === group)"
              :key="item.path"
              :to="`/${role}/${item.path}`"
              class="nav-link"
              ><Icon :name="item.icon" :size="19" /><span>{{ item.title }}</span
              ><span v-if="item.path === 'sorular'" class="nav-count">{{
                state.questions.filter((q) => q.teacherId === 't1' && !q.answeredAt).length
              }}</span
              ><span v-if="item.path === 'risk-listesi'" class="nav-alert"></span
            ></RouterLink>
          </div>
        </div>
      </nav>
      <div class="sidebar-bottom">
        <button class="sidebar-help" @click="helpOpen = true">
          <Icon name="CircleHelp" :size="19" /><span>Yardım & Demo Rehberi</span
          ><Icon name="ArrowUpRight" :size="16" />
        </button>
        <div class="sidebar-user">
          <Avatar :name="activeRole.name" />
          <div>
            <strong>{{ activeRole.name }}</strong
            ><small>{{ activeRole.subtitle }}</small>
          </div>
          <button class="icon-button" aria-label="Oturumu kapat" @click="logout">
            <Icon name="LogOut" :size="18" />
          </button>
        </div>
      </div>
    </aside>
    <div class="main-shell" :inert="mobileMenu && mobileOpen">
      <header class="topbar">
        <div class="topbar-left">
          <button
            class="icon-button mobile-menu"
            aria-label="Menüyü aç"
            :aria-expanded="mobileOpen"
            @click="mobileOpen = !mobileOpen"
          >
            <Icon name="Menu" /></button
          ><span class="breadcrumb"
            ><span>{{ activeRole.label }} Paneli</span
            ><Icon name="ChevronRight" :size="14" /><strong>{{ route.meta.title }}</strong></span
          >
        </div>
        <div class="topbar-actions">
          <label
            class="role-select"
            :class="{ 'pointer-focus': roleSelectPointerFocus }"
            @pointerdown="roleSelectPointerFocus = true"
            @keydown="roleSelectPointerFocus = false"
            ><Icon name="UsersRound" :size="16" /><select
              :value="role"
              aria-label="Rol değiştir"
              @blur="roleSelectPointerFocus = false"
              @change="changeRole"
            >
              <option v-for="(r, key) in roles" :key="key" :value="key">
                {{ r.label }}
              </option>
            </select></label
          ><button
            class="icon-button"
            :aria-label="theme === 'light' ? 'Koyu temaya geç' : 'Açık temaya geç'"
            @click="theme = theme === 'light' ? 'dark' : 'light'"
          >
            <Icon :name="theme === 'light' ? 'Moon' : 'Sun'" :size="19" />
          </button>
          <div class="notification-wrap">
            <button
              class="icon-button notification-button"
              aria-label="Bildirimler"
              :aria-expanded="notificationsOpen"
              @click="notificationsOpen = !notificationsOpen"
            >
              <Icon name="Bell" :size="20" /><i></i>
            </button>
            <div v-if="notificationsOpen" class="notification-menu">
              <h3>Güncel duyurular</h3>
              <article v-for="a in announcements" :key="a.id">
                <strong>{{ a.title }}</strong
                ><small>{{ dateLabel(a.date) }} · {{ a.category }}</small>
                <p>{{ a.text.slice(0, 100) }}…</p>
              </article>
            </div>
          </div>
          <Avatar :name="activeRole.name" size="small" />
        </div>
      </header>
      <main id="main" class="main-content">
        <div v-if="role === 'veli'" class="child-bar">
          <span><Icon name="HeartHandshake" :size="18" />Şu an görüntülenen öğrenci</span
          ><select v-model="selectedChildId" aria-label="Çocuk seç">
            <option v-for="child in childOptions" :key="child.id" :value="child.id">
              {{ child.name }}
            </option></select
          ><span class="muted">Tüm bilgiler seçili çocuğunuza aittir.</span>
        </div>
        <RouterView :key="route.path + (role === 'veli' ? selectedChildId : '')" />
      </main>
      <footer class="app-footer">
        <span>© {{ new Date().getFullYear() }} Kampüs · Öğrenmenin her adımında.</span
        ><span
          ><i class="status-dot"></i>Demo verileri hazır<span class="footer-divider">|</span>Demo
          v1.0</span
        >
      </footer>
    </div>
  </div>
  <RouterView v-else />
  <PdfPreview />
  <div class="toast-stack" aria-live="polite" aria-atomic="true">
    <div v-for="toast in toasts" :key="toast.id" class="toast" :class="toast.type">
      <Icon
        :name="toast.type === 'error' || toast.type === 'warning' ? 'TriangleAlert' : 'CircleCheck'"
        :size="21"
      /><span>{{ toast.message }}</span
      ><button
        class="icon-button"
        aria-label="Bildirimi kapat"
        @click="toasts.splice(toasts.indexOf(toast), 1)"
      >
        <Icon name="X" :size="16" />
      </button>
    </div>
  </div>
  <Modal v-if="helpOpen" title="Kampüs demo rehberi" @close="helpOpen = false"
    ><div class="guide">
      <div class="guide-icon"><Icon name="GraduationCap" :size="36" /></div>
      <h3>Tek kurum, beş farklı bakış açısı.</h3>
      <p>
        Üst bardaki rol seçiciyi kullanarak paneller arasında geçiş yapabilirsiniz. Formlardan
        yaptığınız değişiklikler tüm rollere yansır ve bu tarayıcıda saklanır.
      </p>
      <ol>
        <li>Ön bürodan aday ekleyin ve kesin kayda dönüştürün.</li>
        <li>Öğretmen olarak yoklama alın, ödev atayın veya soruları yanıtlayın.</li>
        <li>Öğrenci olarak quiz çözün, ödev gönderin ve soru sorun.</li>
        <li>Veli olarak iki çocuğunuzu takip edin, demo ödeme yapın.</li>
        <li>Yönetici ayarlarından modülleri yönetin veya verileri sıfırlayın.</li>
      </ol>
      <div class="info-box">
        Tüm kişiler ve işlemler örnektir. Demo ödeme para çekmez; hatırlatmalar gerçek SMS veya
        e-posta göndermez.
      </div>
    </div></Modal
  >
</template>
