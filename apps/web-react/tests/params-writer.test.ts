import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createParamsWriter } from '../src/lib/params-writer.ts'

function setup(initial: string) {
  let search = initial
  const tasks: Array<() => void> = []
  const commits: string[] = []
  const write = createParamsWriter(
    () => search,
    (task) => tasks.push(task),
  )
  const apply = (next: string) => {
    commits.push(next)
    search = next
  }
  const flush = () => tasks.splice(0).forEach((task) => task())
  return { write, apply, flush, commits, read: () => search }
}

const set = (key: string, value: string | null) => (current: URLSearchParams) => {
  if (value === null) current.delete(key)
  else current.set(key, value)
  return current
}

test('aynı turda yazan iki liste tek gezinmede birleşir, biri ötekini silmez', () => {
  const { write, apply, flush, commits, read } = setup('?cocuk=s2')
  write(set('q', 'deniz'), apply)
  write(set('duyuru-q', 'gezi'), apply)
  assert.deepEqual(commits, [])
  flush()
  assert.deepEqual(commits, ['?cocuk=s2&q=deniz&duyuru-q=gezi'])
  assert.equal(read(), '?cocuk=s2&q=deniz&duyuru-q=gezi')
})

test('değişiklik yoksa gezinme yapılmaz', () => {
  const { write, apply, flush, commits } = setup('?q=ece')
  write(set('q', 'ece'), apply)
  write(set('sayfa', null), apply)
  flush()
  assert.deepEqual(commits, [])
})

test('son parametre silinince arama boş yazılır', () => {
  const { write, apply, flush, commits } = setup('?q=ece')
  write(set('q', null), apply)
  flush()
  assert.deepEqual(commits, [''])
})
