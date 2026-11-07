export type DomainErrorKind = 'rule' | 'conflict' | 'forbidden' | 'not_found'

/**
 * İş kuralı reddi. API `kind` değerini HTTP durumuna eşler (rule 422, conflict 409,
 * forbidden 403, not_found 404); `message` kullanıcıya gösterilen Türkçe metindir.
 */
export class DomainError extends Error {
  readonly code: string
  readonly kind: DomainErrorKind
  readonly path: readonly string[] | undefined

  constructor(
    code: string,
    message: string,
    options: { kind?: DomainErrorKind; path?: string[]; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'DomainError'
    this.code = code
    this.kind = options.kind ?? 'rule'
    this.path = options.path
  }
}
