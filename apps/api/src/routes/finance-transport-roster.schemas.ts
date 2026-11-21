import { z } from 'zod'

import {
  TRANSPORT_ROSTER_PURPOSES,
  transportRosterPurposeSchema,
} from '@kampus/school-core/lib/finance-transport-roster.ts'
import { TRANSPORT_DIRECTIONS } from '@kampus/school-core/lib/finance-transport.ts'
import { GUARDIAN_RELATIONSHIP_KEYS } from '@kampus/school-core/lib/guardianship.ts'

import { dataResponse } from './common.schemas.ts'

/**
 * Servis listesi şemaları (DOM-FIN-148; ON-148; K-499…K-501). Sağlık ve alerji alanı yoktur
 * (ON-165); sürücü telefonu her zaman maskeli, veli telefonu `purpose` ile maskeli ya da tam.
 */

export const transportRosterQuery = z.strictObject({ purpose: transportRosterPurposeSchema })

const contactSchema = z.object({
  // kvkk: K (veli kimliği)
  name: z.string().nullable().describe('Veli adı (hesap adı, yoksa veli kaydı)'),
  relationship: z
    .enum(GUARDIAN_RELATIONSHIP_KEYS)
    .nullable()
    .describe('Yakınlık; bilinmiyorsa boş'),
  // kvkk: K (veli iletişimi)
  phone: z
    .string()
    .nullable()
    .describe('Veli telefonu: `office` amacında maskeli (`0532 *** ** 12`), `driver` amacında tam'),
})

const studentSchema = z.object({
  // kvkk: K (öğrenci)
  studentName: z.string(),
  className: z.string().nullable(),
  contacts: z.array(contactSchema).describe('Acil iletişim, en çok iki kişi (K-501)'),
})

export const transportRosterSchema = z.object({
  route: z.object({
    id: z.string(),
    name: z.string(),
    direction: z.enum(TRANSPORT_DIRECTIONS),
    vehiclePlate: z.string().nullable().describe('Plaka, boşluksuz büyük harf'),
    capacity: z.number().int(),
    // kvkk: K (sürücü kimliği)
    driverName: z.string().nullable(),
    driverPhoneMasked: z
      .string()
      .nullable()
      .describe('Sürücü telefonu, her amaçta maskeli (K-481)'),
    guideName: z.string().nullable().describe('Rehber personelin adı'),
  }),
  purpose: z.enum(TRANSPORT_ROSTER_PURPOSES),
  phonesMasked: z.boolean().describe('Veli telefonları maskeli mi (`office`)'),
  listDate: z.string().describe('Listenin günü (YYYY-MM-DD, Europe/Istanbul)'),
  total: z.number().int().describe('Listedeki öğrenci sayısı'),
  stops: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int(),
        name: z.string().describe('Durak adı ya da semt'),
        time: z.string().describe('Geçiş saati (SS:DD)'),
        students: z.array(studentSchema).describe('Durağın kayıtlı öğrencileri, ada göre'),
      }),
    )
    .describe('Duraklar sırasıyla; boş durak da yazılır'),
})

export const transportRosterResponse = dataResponse(transportRosterSchema)
