import { createRouter, createWebHistory } from 'vue-router'
import { navigation } from './modules/navigation.js'
import { state, role, setRole, notify } from './stores/demo.js'
import { readView, writeView, viewScope } from './lib/view-memory.js'
import { nextTick } from 'vue'

const views = {
  Dashboard: () => import('./views/Dashboard.vue'),
  SchoolManagement: () => import('./views/SchoolManagement.vue'),
  Management: () => import('./views/Management.vue'),
  Finance: () => import('./views/Finance.vue'),
  Crm: () => import('./views/Crm.vue'),
  Academic: () => import('./views/Academic.vue'),
  Learning: () => import('./views/Learning.vue'),
  Communication: () => import('./views/Communication.vue'),
  Settings: () => import('./views/Settings.vue'),
}
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: () => (role.value ? `/${role.value}/dashboard` : '/giris') },
    {
      path: '/giris',
      component: () => import('./views/Login.vue'),
      meta: { title: 'Hoş geldiniz' },
    },
    ...Object.entries(navigation).flatMap(([r, items]) =>
      items.map((p) => ({
        path: `/${r}/${p.path}`,
        component: views[p.view],
        meta: { ...p, role: r },
      })),
    ),
    {
      path: '/onburo/aday/:id',
      component: views.Crm,
      meta: {
        role: 'onburo',
        module: 'crm',
        title: 'Aday Detayı',
        group: 'KAYIT & SATIŞ',
        description: 'İletişim geçmişi ve kayıt yolculuğu.',
      },
    },
    {
      path: '/ogretmen/ogrenci/:id',
      component: views.Academic,
      meta: {
        role: 'ogretmen',
        module: 'academic',
        title: 'Öğrenci Profili',
        group: 'AKADEMİK',
        description: 'Öğrencinizin akademik gelişimini yakından inceleyin.',
      },
    },
    {
      path: '/:pathMatch(.*)*',
      component: () => import('./views/NotFound.vue'),
      meta: { title: 'Sayfa bulunamadı' },
    },
  ],
  async scrollBehavior(to, from, savedPosition) {
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return savedPosition || readView(`${viewScope(to.path)}:scroll`, { top: 0, left: 0 })
  },
})
router.beforeEach((to, from) => {
  if (from.matched.length)
    writeView(`${viewScope(from.path)}:scroll`, { top: window.scrollY, left: window.scrollX })
  if (to.meta.role === 'ogretmen' && !state.teachers.find((t) => t.id === 't1')?.isActive) {
    notify(
      'Demo öğretmen hesabı arşivde. Eğitim Kadrosu ekranından yeniden etkinleştirebilirsiniz.',
      'warning',
    )
    return state.modules.academic ? '/yonetici/personel' : '/yonetici/ayarlar'
  }
  if (to.meta.module && !state.modules[to.meta.module]) {
    notify('Bu modül kurum ayarlarından kapatılmış.', 'warning')
    return `/${to.meta.role}/dashboard`
  }
  if (to.meta.role) setRole(to.meta.role)
  document.title = `${to.meta.title || 'Kampüs'} · Kampüs`
})
