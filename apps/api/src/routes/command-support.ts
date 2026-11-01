import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'

import { AppError, MESSAGES, ValidationError } from '../errors.ts'
import { requestFingerprint } from '../services/idempotency.ts'
import type { CommandResponse, IdempotencyRequest } from '../services/operation-runner.ts'
import {
  commandResponseSchema,
  IDEMPOTENCY_KEY_PATTERN,
  type CommandResponseBody,
} from './commands.schemas.ts'

/** Komut uçlarının HTTP yardımcıları: başlık okuma ve tek yanıt biçimi (`CommandResult`). */

function singleHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name]
  if (Array.isArray(value)) {
    if (value.length > 1)
      throw new ValidationError([
        { path: ['headers', name], code: 'invalid_value', message: 'Başlık bir kez gönderilir.' },
      ])
    return value[0]
  }
  return value
}

/**
 * `Idempotency-Key` ve istek özeti. Zorunlu uçta başlık yoksa 400 `idempotency_key_required`
 * (api-tasarimi.md §7). Biçim başlık şemasında doğrulanır; burada yeniden denetlenir, çünkü
 * özet bu değere bağlıdır.
 */
export function idempotencyOf(
  request: FastifyRequest,
  required: boolean,
): IdempotencyRequest | null {
  const key = singleHeader(request, 'idempotency-key')
  if (key === undefined) {
    if (required)
      throw new AppError(400, 'idempotency_key_required', MESSAGES.idempotency_key_required)
    return null
  }
  if (!IDEMPOTENCY_KEY_PATTERN.test(key))
    throw new ValidationError([
      {
        path: ['headers', 'idempotency-key'],
        code: 'invalid_format',
        message: 'İstek anahtarı geçersiz.',
      },
    ])
  return { key, fingerprint: requestFingerprint(request.method, request.url, request.body) }
}

/**
 * `If-Match` başlığındaki sürüm (`"4"`, `4`, `W/"4"`); yoksa `null`. `supported: false`: işlemin
 * önceden var olan konusu yok (oluşturma komutu); başlık gelirse 400 `if_match_not_supported`
 * (api-tasarimi.md §6): istemci kilit beklediği halde sessizce kilitsiz yazılmaz.
 */
export function ifMatchVersion(request: FastifyRequest, supported = true): number | null {
  const raw = singleHeader(request, 'if-match')
  if (raw === undefined) return null
  if (!supported) throw new AppError(400, 'if_match_not_supported', MESSAGES.if_match_not_supported)
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim())
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1)
    throw new ValidationError([
      { path: ['headers', 'if-match'], code: 'invalid_format', message: 'Sürüm geçersiz.' },
    ])
  return version
}

/**
 * Komut yanıtını yazar ve gövdeyi döndürür. Tekrarlanan yanıt veritabanından geldiği için
 * gövde yanıt şemasıyla yeniden okunur; biçim dışı saklı yanıt 500 olur, istemciye gitmez.
 */
export function sendCommand(reply: FastifyReply, response: CommandResponse): CommandResponseBody
export function sendCommand<T extends CommandResponseBody>(
  reply: FastifyReply,
  response: CommandResponse,
  /** Uca özgü yanıt şeması (ek alanlı komut sonucu, ör. kesin kayıtta `contractId`). */
  schema: z.ZodType<T>,
): T
export function sendCommand(
  reply: FastifyReply,
  response: CommandResponse,
  schema: z.ZodType<CommandResponseBody> = commandResponseSchema,
): CommandResponseBody {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  reply.status(response.statusCode)
  return schema.parse(response.body)
}
