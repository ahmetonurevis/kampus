import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { toastMessage } from '../src/lib/notify.ts'

// Toast ARIA rolleri: hata anında okunur (alert), bilgi nazikçe (status).
test('hata toast metni role="alert", bilgi toast metni role="status" taşır', () => {
  assert.equal(
    renderToStaticMarkup(toastMessage('alert', 'Kayıt kaydedilemedi.')),
    '<span role="alert">Kayıt kaydedilemedi.</span>',
  )
  assert.equal(
    renderToStaticMarkup(toastMessage('status', 'Sınıf eklendi.')),
    '<span role="status">Sınıf eklendi.</span>',
  )
})
