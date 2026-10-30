import { DomainError } from '../../packages/school-core/src/lib/errors.ts'

/** `assert.throws` için: DomainError örneği, kod ve tür (varsayılan `rule`) eşleşmeli. */
export function isDomainError(code, kind = 'rule') {
  return (error) => error instanceof DomainError && error.code === code && error.kind === kind
}
