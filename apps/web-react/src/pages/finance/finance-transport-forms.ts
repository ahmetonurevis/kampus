import { z } from 'zod'

import type {
  TransportRouteBody,
  TransportRouteDetail,
  TransportRouteUpdateBody,
  TransportVehicle,
  TransportVehicleBody,
  TransportVehicleUpdateBody,
} from '@kampus/react-shared/use-finance-transport.ts'
import {
  normalizeTripPlate,
  TRIP_PLATE_PATTERN,
} from '@kampus/school-core/lib/finance-trip-plans.ts'
import {
  TRANSPORT_DIRECTION_LABELS,
  TRANSPORT_DIRECTIONS,
  TRANSPORT_DRIVER_NAME_MAX,
  TRANSPORT_PHONE_PATTERN,
  TRANSPORT_ROUTE_NAME_MAX,
  TRANSPORT_ROUTE_STOPS_MAX,
  TRANSPORT_STOP_NAME_MAX,
  TRANSPORT_TIME_PATTERN,
  TRANSPORT_VEHICLE_CAPACITY_MAX,
  transportLoadLabel,
  transportPlateLabel,
  type TransportDirection,
} from '@kampus/school-core/lib/finance-transport.ts'

/**
 * Servis sekmesinin saf mantığı (DOM-FIN-142; ON-098; K-481, K-482): araç ve güzergâh formlarının
 * şeması, gövdesi ve tablo metinleri. Kural ayrıntısı sunucudadır; alan hatası `setError` ile döner.
 * Sürücü telefonu yalnız yazılır: düzenlemede boş bırakılırsa değişmez.
 */

export const directionText = (direction: TransportDirection) =>
  TRANSPORT_DIRECTION_LABELS[direction]
export const plateText = (plate: string | null) =>
  plate === null ? '—' : transportPlateLabel(plate)
export const loadText = (load: number, capacity: number) => transportLoadLabel(load, capacity)

/** İlk ve son durak saati: `07:10–07:45`. */
export function timeRangeText(first: string | null, last: string | null) {
  if (first === null) return '—'
  return last === null || last === first ? first : `${first}–${last}`
}

const phoneDigits = (value: string) => value.replace(/[\s()-]+/g, '')
const integerText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max,
      `${label} 1 ile ${String(max)} arasında bir tam sayı olmalı.`,
    )

export function vehicleFormSchema(editing: boolean) {
  return z.object({
    plate: z
      .string()
      .refine(
        (value) => TRIP_PLATE_PATTERN.test(normalizeTripPlate(value)),
        'Plakayı 34 ABC 123 biçiminde girin.',
      ),
    capacity: integerText(TRANSPORT_VEHICLE_CAPACITY_MAX, 'Kapasite'),
    driverName: z
      .string()
      .trim()
      .min(2, 'Sürücünün adını en az 2 karakterle yazın.')
      .max(TRANSPORT_DRIVER_NAME_MAX, `En çok ${String(TRANSPORT_DRIVER_NAME_MAX)} karakter.`),
    driverPhone: z
      .string()
      .refine(
        (value) =>
          (editing && phoneDigits(value) === '') ||
          TRANSPORT_PHONE_PATTERN.test(phoneDigits(value)),
        'Telefonu 0XXXXXXXXXX biçiminde, 11 haneli girin.',
      ),
    guideMembershipId: z.string(),
  })
}
export type VehicleFormValues = z.infer<ReturnType<typeof vehicleFormSchema>>

export function vehicleDefaults(vehicle?: TransportVehicle): VehicleFormValues {
  return {
    plate: vehicle === undefined ? '' : transportPlateLabel(vehicle.plate),
    capacity: vehicle === undefined ? '' : String(vehicle.capacity),
    driverName: vehicle?.driverName ?? '',
    driverPhone: '',
    guideMembershipId: vehicle?.guideMembershipId ?? '',
  }
}

export function vehicleCreateBody(values: VehicleFormValues): TransportVehicleBody {
  return {
    plate: normalizeTripPlate(values.plate),
    capacity: Number(values.capacity),
    driverName: values.driverName.trim(),
    driverPhone: phoneDigits(values.driverPhone),
    guideMembershipId: values.guideMembershipId === '' ? null : values.guideMembershipId,
  }
}

/** Yalnız değişen alanlar; boş telefon gönderilmez (tam numara okunmaz). Değişiklik yoksa `null`. */
export function vehicleUpdateBody(
  values: VehicleFormValues,
  vehicle: TransportVehicle,
): TransportVehicleUpdateBody | null {
  const next = vehicleCreateBody(values)
  const body: TransportVehicleUpdateBody = {
    ...(next.plate === vehicle.plate ? {} : { plate: next.plate }),
    ...(next.capacity === vehicle.capacity ? {} : { capacity: next.capacity }),
    ...(next.driverName === vehicle.driverName ? {} : { driverName: next.driverName }),
    ...(next.driverPhone === '' ? {} : { driverPhone: next.driverPhone }),
    ...(next.guideMembershipId === vehicle.guideMembershipId
      ? {}
      : { guideMembershipId: next.guideMembershipId }),
  }
  return Object.keys(body).length === 0 ? null : body
}

export const routeFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Güzergâh adını en az 2 karakterle yazın.')
    .max(TRANSPORT_ROUTE_NAME_MAX, `En çok ${String(TRANSPORT_ROUTE_NAME_MAX)} karakter.`),
  direction: z.enum(TRANSPORT_DIRECTIONS, 'Yönü seçin.'),
  vehicleId: z.string().min(1, 'Aracı seçin.'),
  stops: z
    .array(
      z.object({
        stopId: z.string(),
        name: z
          .string()
          .trim()
          .min(2, 'Durak adını yazın.')
          .max(TRANSPORT_STOP_NAME_MAX, `En çok ${String(TRANSPORT_STOP_NAME_MAX)} karakter.`),
        time: z.string().regex(TRANSPORT_TIME_PATTERN, 'Saati SS:DD biçiminde girin.'),
      }),
    )
    .min(1, 'En az bir durak girin.')
    .max(TRANSPORT_ROUTE_STOPS_MAX, `En çok ${String(TRANSPORT_ROUTE_STOPS_MAX)} durak.`)
    .superRefine((stops, context) => {
      stops.forEach((stop, index) => {
        const previous = stops[index - 1]
        if (previous !== undefined && stop.time < previous.time)
          context.addIssue({
            code: 'custom',
            path: [index, 'time'],
            message: 'Saat önceki duraktan önce olamaz.',
          })
      })
    }),
})
export type RouteFormValues = z.infer<typeof routeFormSchema>

export const emptyStop = () => ({ stopId: '', name: '', time: '' })

export function routeDefaults(route?: TransportRouteDetail): RouteFormValues {
  return {
    name: route?.name ?? '',
    direction: route?.direction ?? 'morning',
    vehicleId: route?.vehicleId ?? '',
    stops:
      route === undefined
        ? [emptyStop()]
        : route.stops.map((stop) => ({ stopId: stop.id, name: stop.name, time: stop.time })),
  }
}

export function routeCreateBody(values: RouteFormValues): TransportRouteBody {
  return {
    name: values.name.trim(),
    direction: values.direction,
    vehicleId: values.vehicleId,
    stops: values.stops.map((stop) => ({ name: stop.name.trim(), time: stop.time })),
  }
}

/** Değişen alanlar; durak listesi değiştiyse bütün liste (kimlikli duraklar korunur). */
export function routeUpdateBody(
  values: RouteFormValues,
  route: TransportRouteDetail,
): TransportRouteUpdateBody | null {
  const stops = values.stops.map((stop) => ({
    ...(stop.stopId === '' ? {} : { id: stop.stopId }),
    name: stop.name.trim(),
    time: stop.time,
  }))
  const sameStops =
    stops.length === route.stops.length &&
    stops.every((stop, index) => {
      const current = route.stops[index]
      return (
        current !== undefined &&
        'id' in stop &&
        stop.id === current.id &&
        stop.name === current.name &&
        stop.time === current.time
      )
    })
  const name = values.name.trim()
  const body: TransportRouteUpdateBody = {
    ...(name === route.name ? {} : { name }),
    ...(values.vehicleId === route.vehicleId ? {} : { vehicleId: values.vehicleId }),
    ...(sameStops ? {} : { stops }),
  }
  return Object.keys(body).length === 0 ? null : body
}

const VEHICLE_FIELDS = [
  'plate',
  'capacity',
  'driverName',
  'driverPhone',
  'guideMembershipId',
] as const
/** Sunucu alanını araç formuna eşler; eşleşmeyen alan kök hatadır. */
export function vehicleFormField(name: string): (typeof VEHICLE_FIELDS)[number] | null {
  return VEHICLE_FIELDS.find((field) => field === name) ?? null
}

/** Sunucu alanını güzergâh formuna eşler (`stops.1.time` → `stops.1.time`). */
export function routeFormField(
  name: string,
): 'name' | 'vehicleId' | 'stops' | `stops.${number}.name` | `stops.${number}.time` | null {
  if (name === 'name' || name === 'vehicleId' || name === 'stops') return name
  const match = /^stops\.(\d+)\.(name|time|id)$/.exec(name)
  if (match === null) return null
  const field = match[2] === 'time' ? 'time' : 'name'
  return `stops.${Number(match[1])}.${field}`
}
