import { randomUUID } from 'node:crypto'

import { expect } from '@playwright/test'

import type { ApiClient } from './api.ts'

/** Komut ucuna `Idempotency-Key` ile gönderir ve oluşan kaydın kimliğini verir. */
export async function postCommand(client: ApiClient, path: string, data: unknown): Promise<string> {
  const response = await client.context.fetch(path, {
    method: 'POST',
    data,
    headers: { 'idempotency-key': randomUUID() },
    failOnStatusCode: false,
  })
  expect([200, 201], `${path}: ${await response.text()}`).toContain(response.status())
  const body = (await response.json()) as { data: { entity: { id: string } } }
  return body.data.entity.id
}

/** Europe/Istanbul takvim günü (`YYYY-MM-DD`), bugünden `offsetDays` gün sonrası. */
export function istanbulDay(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  )
}
