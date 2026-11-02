import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { ApiError } from '@kampus/api-client/errors.ts'
import { runWithReauth } from '../src/auth/reauth-retry.ts'

const stale = () =>
  new ApiError({ status: 403, code: 'reauthentication_required', message: 'Oturum eski.' })
type Outcome = { status: 'success'; data: number } | { status: 'failed'; error: ApiError }
const other = () => new ApiError({ status: 403, code: 'forbidden', message: 'Yetkiniz yok.' })

function counter<T>(...steps: (() => Promise<T>)[]) {
  let calls = 0
  return {
    action: () => {
      const step = steps[Math.min(calls, steps.length - 1)]
      calls += 1
      return step!()
    },
    calls: () => calls,
  }
}
function asker(answer: boolean) {
  let asked = 0
  return {
    ask: async () => {
      asked += 1
      return answer
    },
    asked: () => asked,
  }
}

describe('taze oturum tekrar akışı', () => {
  test('guvenlik-kvkk: taze oturumda işlem bir kez çalışır, pencere açılmaz', async () => {
    const run = counter(async () => ({ status: 'success' as const, data: 1 }))
    const prompt = asker(true)
    assert.deepEqual(await runWithReauth(run.action, prompt.ask), {
      status: 'done',
      result: { status: 'success', data: 1 },
    })
    assert.equal(run.calls(), 1)
    assert.equal(prompt.asked(), 0)
  })

  test('guvenlik-kvkk: failed sonuç eski oturumu bildirirse pencere açılır, doğrulamadan sonra bir kez tekrarlanır', async () => {
    const run = counter<Outcome>(
      async () => ({ status: 'failed', error: stale() }),
      async () => ({ status: 'success', data: 2 }),
    )
    const prompt = asker(true)
    assert.deepEqual(await runWithReauth(run.action, prompt.ask), {
      status: 'done',
      result: { status: 'success', data: 2 },
    })
    assert.equal(run.calls(), 2)
    assert.equal(prompt.asked(), 1)
  })

  test('guvenlik-kvkk: fırlatılan reauthentication_required da pencereyi açar ve tekrarlanır', async () => {
    const run = counter<string>(
      async () => {
        throw stale()
      },
      async () => 'tamam',
    )
    const prompt = asker(true)
    assert.deepEqual(await runWithReauth(run.action, prompt.ask), {
      status: 'done',
      result: 'tamam',
    })
    assert.equal(run.calls(), 2)
  })

  test('vazgeçilirse işlem tekrarlanmaz ve sessizce iptal döner', async () => {
    const run = counter(async () => ({ status: 'failed' as const, error: stale() }))
    const prompt = asker(false)
    assert.deepEqual(await runWithReauth(run.action, prompt.ask), { status: 'cancelled' })
    assert.equal(run.calls(), 1)
    assert.equal(prompt.asked(), 1)
  })

  test('tekrar yine eski oturum derse döngü yoktur; sonuç çağırana döner', async () => {
    const run = counter(async () => ({ status: 'failed' as const, error: stale() }))
    const prompt = asker(true)
    const outcome = await runWithReauth(run.action, prompt.ask)
    assert.equal(outcome.status, 'done')
    assert.equal(run.calls(), 2)
    assert.equal(prompt.asked(), 1)
  })

  test('başka hatalar pencere açmadan çağırana döner ya da fırlar', async () => {
    const failed = counter(async () => ({ status: 'failed' as const, error: other() }))
    const prompt = asker(true)
    assert.deepEqual(await runWithReauth(failed.action, prompt.ask), {
      status: 'done',
      result: { status: 'failed', error: other() },
    })
    assert.equal(failed.calls(), 1)

    const thrown = counter<void>(async () => {
      throw other()
    })
    await assert.rejects(runWithReauth(thrown.action, prompt.ask), { code: 'forbidden' })
    assert.equal(prompt.asked(), 0)
  })

  test('tekrar sırasında fırlayan hata çağırana ulaşır', async () => {
    const run = counter<void>(
      async () => {
        throw stale()
      },
      async () => {
        throw other()
      },
    )
    await assert.rejects(runWithReauth(run.action, asker(true).ask), { code: 'forbidden' })
  })
})
