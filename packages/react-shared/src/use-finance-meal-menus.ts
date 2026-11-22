import type { operations } from '@kampus/api-client/schema.d.ts'

import { requireIfMatch, type CommandHeaders } from './commands.ts'
import { useApiCommand } from './use-api-command.ts'
import { useApiQuery } from './use-api-query.ts'
import { useFinanceListQuery } from './use-finance-list-query.ts'

// Yemek menüsü kancaları (`/finance/meal-menus*`, `/finance/meal-menu-settings`; DOM-FIN-157,
// ON-090, ON-149). Menü açma `Idempotency-Key`, hücre yazma, yayım, yayımdan kaldırma, arşiv ve
// öğün ayarı `If-Match` ile gider. Her yazma anahtarın tamamını tazeler.

type JsonBody<TOperation extends keyof operations> =
  NonNullable<operations[TOperation]['requestBody']> extends {
    content: { 'application/json': infer TBody }
  }
    ? TBody
    : never
type Query<TOperation extends keyof operations> = operations[TOperation]['parameters'] extends {
  query?: infer TQuery
}
  ? NonNullable<TQuery>
  : never
type Ok<TOperation extends keyof operations> = operations[TOperation]['responses'] extends {
  200: { content: { 'application/json': infer TBody } }
}
  ? TBody
  : never

export type MealMenuCreateBody = JsonBody<'createMealMenu'>
export type MealMenuUpdateBody = JsonBody<'updateMealMenu'>
export type MealMenuSettingsBody = JsonBody<'setMealMenuSettings'>
export type MealMenuRow = Ok<'listMealMenus'>['data'][number]
export type MealMenuDetail = Ok<'getMealMenu'>['data']
export type MealMenuDay = MealMenuDetail['days'][number]
export type MealMenuItem = MealMenuDay['meals'][number]['items'][number]
export type MealMenuSettings = Ok<'getMealMenuSettings'>['data']
export type MyMealMenus = Ok<'listMyMealMenus'>['data']
export type MealMenuQuery = Query<'listMealMenus'>

export const MEAL_MENUS_KEY = ['finance', 'meal-menus'] as const
const MESSAGES = {
  version_conflict: 'Menü başka biri tarafından değiştirildi. Menü güncellendi.',
}
const versioned = (headers: CommandHeaders) => ({
  'idempotency-key': headers['idempotency-key'],
  'if-match': requireIfMatch(headers),
})

export function useMealMenus(query: MealMenuQuery, enabled = true) {
  return useFinanceListQuery(
    {
      key: [...MEAL_MENUS_KEY, 'list', query],
      request: (client, signal) =>
        client.GET('/api/v1/finance/meal-menus', { params: { query }, signal }),
    },
    { enabled },
  )
}

export function useMealMenu(menuId: string, enabled = true) {
  return useApiQuery({
    key: [...MEAL_MENUS_KEY, 'menu', menuId],
    enabled: enabled && menuId !== '',
    request: (client, signal) =>
      client.GET('/api/v1/finance/meal-menus/{menuId}', { params: { path: { menuId } }, signal }),
  })
}

/** Veli ve öğrencinin haftalık yayımlanmış menüsü; `weekStart` haftanın herhangi bir günü. */
export function useMyMealMenus(weekStart?: string, enabled = true) {
  return useApiQuery({
    key: [...MEAL_MENUS_KEY, 'my', weekStart ?? ''],
    enabled,
    request: (client, signal) =>
      client.GET('/api/v1/finance/meal-menus/my', {
        params: { query: weekStart === undefined ? {} : { weekStart } },
        signal,
      }),
  })
}

export function useMealMenuSettings(enabled = true) {
  return useApiQuery({
    key: [...MEAL_MENUS_KEY, 'settings'],
    enabled,
    request: (client, signal) => client.GET('/api/v1/finance/meal-menu-settings', { signal }),
  })
}

export function useCreateMealMenu() {
  return useApiCommand({
    request: (client, body: MealMenuCreateBody, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/meal-menus', {
        params: { header: { 'idempotency-key': headers['idempotency-key'] } },
        body,
      }),
    invalidates: [MEAL_MENUS_KEY],
    exclusive: true,
  })
}

export function useUpdateMealMenu() {
  return useApiCommand({
    request: (
      client,
      input: { menuId: string; version: number; body: MealMenuUpdateBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/meal-menus/{menuId}', {
        params: { path: { menuId: input.menuId }, header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [MEAL_MENUS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function usePublishMealMenu() {
  return useApiCommand({
    request: (client, input: { menuId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/meal-menus/{menuId}/publish', {
        params: { path: { menuId: input.menuId }, header: versioned(headers) },
      }),
    invalidates: [MEAL_MENUS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useUnpublishMealMenu() {
  return useApiCommand({
    request: (client, input: { menuId: string; version: number }, headers: CommandHeaders) =>
      client.POST('/api/v1/finance/meal-menus/{menuId}/unpublish', {
        params: { path: { menuId: input.menuId }, header: versioned(headers) },
      }),
    invalidates: [MEAL_MENUS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
    exclusive: true,
  })
}

export function useArchiveMealMenu() {
  return useApiCommand({
    request: (client, input: { menuId: string; version: number }, headers: CommandHeaders) =>
      client.DELETE('/api/v1/finance/meal-menus/{menuId}', {
        params: { path: { menuId: input.menuId }, header: versioned(headers) },
      }),
    invalidates: [MEAL_MENUS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}

export function useSetMealMenuSettings() {
  return useApiCommand({
    request: (
      client,
      input: { version: number; body: MealMenuSettingsBody },
      headers: CommandHeaders,
    ) =>
      client.PATCH('/api/v1/finance/meal-menu-settings', {
        params: { header: versioned(headers) },
        body: input.body,
      }),
    invalidates: [MEAL_MENUS_KEY],
    version: (input) => input.version,
    messages: MESSAGES,
  })
}
