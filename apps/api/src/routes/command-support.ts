import type { FastifyReply, FastifyRequest } from 'fastify'

import type { WrittenRecord } from '../db/records.ts'
import { AppError, MESSAGES, ValidationError } from '../errors.ts'
import { requestFingerprint } from '../services/idempotency.ts'
import type {
  CommandResponse,
  IdempotencyRequest,
  OperationResponse,
} from '../services/operation-runner.ts'
import { IDEMPOTENCY_KEY_PATTERN } from './commands.schemas.ts'

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

/** `If-Match` başlığındaki sürüm (`"4"`, `4`, `W/"4"`); yoksa `null`. */
export function ifMatchVersion(request: FastifyRequest): number | null {
  const raw = singleHeader(request, 'if-match')
  if (raw === undefined) return null
  const match = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim())
  const version = match?.[1] === undefined ? Number.NaN : Number(match[1])
  if (!Number.isSafeInteger(version) || version < 1)
    throw new ValidationError([
      { path: ['headers', 'if-match'], code: 'invalid_format', message: 'Sürüm geçersiz.' },
    ])
  return version
}

/** Değişiklik özeti ve yazılan kayıtlar: `{ data: CommandResult }`. */
export function commandBody(
  entity: { collection: string; id: string } | null,
  changes: readonly WrittenRecord[],
): OperationResponse {
  const count = (kind: WrittenRecord['kind']) =>
    changes.filter((change) => change.kind === kind).length
  return {
    statusCode: 200,
    body: {
      data: {
        entity,
        changes: {
          inserted: count('insert'),
          updated: count('update'),
          archived: count('archive'),
          restored: count('restore'),
        },
        records: changes.map((change) => ({
          collection: change.collection,
          id: change.id,
          version: change.version,
          change: change.kind,
        })),
      },
    },
  }
}

export function sendCommand(reply: FastifyReply, response: CommandResponse) {
  if (response.replayed) reply.header('idempotent-replayed', 'true')
  return reply.status(response.statusCode).send(response.body)
}
