// Ana ekranın key'i korunur: her kategori seçiminde dashboard tekrar kurulmaz.
export function moduleNavigationState(state, page) {
  const home = state.routes.find((route) => route.name === 'Home') || { name: 'Home' }
  return {
    index: page === 'dashboard' ? 0 : 1,
    routes: [home, ...(page === 'dashboard' ? [] : [{ name: 'Module', params: { page } }])],
  }
}
