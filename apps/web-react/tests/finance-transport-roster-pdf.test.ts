import assert from 'node:assert/strict'
import test from 'node:test'

import type { TransportRoster } from '@kampus/react-shared/use-finance-transport-roster.ts'

import {
  rosterContactText,
  transportRosterDocument,
  transportRosterFilename,
  transportRosterReference,
} from '../src/lib/pdf/templates/finance-transport-roster.ts'
import { allTexts, measurer } from './support/pdf-measurer.ts'

// Servis listesi PDF'i (DOM-FIN-148; ON-148; K-499…K-501).

const NOW = new Date('2026-10-06T09:00:00.000Z')

function roster(overrides: Partial<TransportRoster> = {}): TransportRoster {
  return {
    route: {
      id: '1a2b3c4d-0000-4000-8000-000000000148',
      name: 'Moda hattı',
      direction: 'morning',
      vehiclePlate: '34KMP148',
      capacity: 16,
      driverName: 'Ali Sürücü',
      driverPhoneMasked: '0532 *** ** 67',
      guideName: 'Selin Kaya',
    },
    purpose: 'office',
    phonesMasked: true,
    listDate: '2026-10-06',
    total: 2,
    stops: [
      {
        id: 'st1',
        position: 1,
        name: 'Moda',
        time: '07:10',
        students: [
          {
            studentName: 'Deniz Yılmaz',
            className: '7-A',
            contacts: [{ name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 12' }],
          },
          { studentName: 'Ece Yılmaz', className: null, contacts: [] },
        ],
      },
      { id: 'st2', position: 2, name: 'Bahariye', time: '07:25', students: [] },
    ],
    ...overrides,
  }
}

test('DOM-FIN-148: belge numarası ve dosya adı liste günü ve güzergâhtan', () => {
  assert.equal(transportRosterReference(roster()), 'SRV-20261006-1A2B3C4D')
  assert.equal(transportRosterFilename(roster()), 'servis-listesi-SRV-20261006-1A2B3C4D.pdf')
})

test('DOM-FIN-148: acil iletişim hücresi ad, yakınlık ve telefon; eksikler okunur yazılır', () => {
  assert.equal(
    rosterContactText({
      contacts: [
        { name: 'Ayşe Yılmaz', relationship: 'mother', phone: '0532 *** ** 12' },
        { name: null, relationship: null, phone: null },
      ],
    }),
    'Ayşe Yılmaz (Anne) 0532 *** ** 12; Veli telefon yok',
  )
  assert.equal(rosterContactText({ contacts: [] }), '—')
})

test('DOM-FIN-148: PDF araç ve personel bilgisi, durak grupları, imza alanı; sürücü telefonu maskeli', () => {
  const document = transportRosterDocument(measurer, roster(), {
    institution: 'Akademi Özel Okulları',
    generatedAt: NOW,
  })
  const texts = allTexts(document).join('\n')
  for (const expected of [
    'SERVİS LİSTESİ',
    'SABAH',
    'Akademi Özel Okulları',
    '34 KMP 148',
    'Ali Sürücü',
    '0532 *** ** 67',
    'Selin Kaya',
    '1. Moda · 07:10',
    '2. Bahariye · 07:25',
    'Deniz Yılmaz',
    '7-A',
    'Bu durakta öğrenci yok.',
    'Servis sorumlusu',
    'Okul müdürü',
    '2 / 16',
  ])
    assert.ok(texts.includes(expected), expected)
  assert.ok(texts.includes('maskelidir'))
  assert.ok(!/alerji:|sağlık durumu/i.test(texts))
})

test('DOM-FIN-148: sürücü listesi tam telefonu API’den geldiği gibi yazar, notu değişir', () => {
  const driver = roster({
    purpose: 'driver',
    phonesMasked: false,
    stops: [
      {
        id: 'st1',
        position: 1,
        name: 'Moda',
        time: '07:10',
        students: [
          {
            studentName: 'Deniz Yılmaz',
            className: '7-A',
            contacts: [{ name: 'Ayşe Yılmaz', relationship: 'mother', phone: '05321234512' }],
          },
        ],
      },
    ],
    total: 1,
  })
  const texts = allTexts(
    transportRosterDocument(measurer, driver, { institution: 'Kampüs', learnerTitle: 'Kursiyer' }),
  ).join('\n')
  assert.ok(texts.includes('05321234512'))
  assert.ok(texts.includes('Sürücüye verilecek'))
  assert.ok(texts.includes('Kursiyer'))
  assert.ok(texts.includes('0532 *** ** 67'))
})

test('DOM-FIN-148: durağı olmayan güzergâhta boş liste notu', () => {
  const texts = allTexts(
    transportRosterDocument(measurer, roster({ stops: [], total: 0 }), { institution: 'Kampüs' }),
  )
  assert.ok(texts.includes('Güzergâhta durak yok.'))
})
