import { updateParentDetails } from '@kampus/school-core/lib/registration-records.ts'
import { OPERATION_COMMANDS } from '@kampus/school-core/modules/commands.ts'

import type { ServiceContext } from '../plugins/authenticate.ts'
import { commandBody } from './command-result.ts'
import { environment, type CommandOptions } from './commands.ts'
import { runCommand, type CommandResponse } from './operation-runner.ts'

/**
 * Kayıt sonrası veli bilgisi düzeltme (ON-117; core `lib/registration-records.ts`, DOM-KAY-012).
 * Veli kaydı `records` `parents` koleksiyonundadır; yazma `If-Match` sürümüyle iyimser kilitli ve
 * kurum kilidi altında tek transaction'dır. Denetime yalnız değişen alan adları gider (telefon ve
 * e-posta değeri loglanmaz ve denetime yazılmaz).
 */
export function updateParentDetailsCommand(
  ctx: ServiceContext,
  parentId: string,
  input: unknown,
  options: CommandOptions,
): Promise<CommandResponse> {
  const spec = OPERATION_COMMANDS['parent.update']
  return runCommand(
    ctx,
    {
      action: 'parent.update',
      collections: spec.collections,
      ...(options.expectedVersion !== null
        ? {
            expectedVersions: [
              { collection: 'parents', id: parentId, version: options.expectedVersion },
            ],
          }
        : {}),
      entity: () => ({ type: 'parents', id: parentId }),
      load: async (tx) => {
        const { actor, scalars } = await environment(tx, ctx, spec)
        return {
          scalars,
          run: (state) => {
            updateParentDetails(state, actor, parentId, input)
            return { id: parentId }
          },
        }
      },
    },
    (outcome) =>
      commandBody({ collection: 'parents', id: outcome.result.id }, outcome.changes, 200),
    options.idempotency,
  )
}
