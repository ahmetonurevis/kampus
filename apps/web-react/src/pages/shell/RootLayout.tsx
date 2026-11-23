import { Outlet, ScrollRestoration } from 'react-router'

/** Kök: sayfa kaydırması yol başına korunur (geri/ileri dahil). */
export function RootLayout() {
  return (
    <>
      <Outlet />
      <ScrollRestoration getKey={(location) => location.pathname} />
    </>
  )
}
