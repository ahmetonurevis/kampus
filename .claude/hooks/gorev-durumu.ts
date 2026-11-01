// Oturum başı görev durumu (session-context.sh çağırır): iki geliştiricinin görev tablolarını
// (docs/is-bolumu/<sahip>.md) okur ve kısa bir özet yazar. Tablo önce entegrasyon dalından
// (`git show origin/feature/platform-gecisi:…`), yoksa ya da çözülemezse yerel dosyadan okunur.
// Biçim bozuksa satır atlanır; hiçbir hata oturumu durdurmaz (çıkış hep 0).
// Kullanım: node .claude/hooks/gorev-durumu.ts <sahip> [kök]
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readAreaMap, type AreaMap } from './alan-koruma.ts'

export const STATUSES = [
  'bekliyor',
  'çalışılıyor',
  'revizyon',
  'engelli',
  'bitti',
  'iptal',
] as const
export type Status = (typeof STATUSES)[number]

export interface Task {
  id: string
  title: string
  status: Status
  branch: string
  note: string
  /** Satırın bulunduğu `## ` başlığı (dalga), ör. "D1 · Temel". */
  section: string
}

export interface Party {
  /** Dosya adı ve etiketteki kimlik: `onur`, `oguzhan`. */
  id: string
  name: string
  possessive: string
  tasks: Task[]
  /** Tablonun okunduğu yer, ör. `origin/feature/platform-gecisi` ya da `yerel dosya`. */
  source: string
}

export const INTEGRATION_REF = 'origin/feature/platform-gecisi'
const TASK_ID = /^[A-Z]{2}-\d{3}$/
const NEXT_LIMIT = 5
const TITLE_LIMIT = 110

function isStatus(value: string): value is Status {
  return (STATUSES as readonly string[]).includes(value)
}

/** Tablo satırını hücrelere böler; `\|` hücre içi çizgidir. Tablo satırı değilse `undefined`. */
function splitRow(line: string): string[] | undefined {
  const text = line.trim()
  if (text.length < 2 || !text.startsWith('|') || !text.endsWith('|')) return undefined
  return text
    .slice(1, -1)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, '|').trim())
}

/** Kanca sessiz kalır; ayrıntı yalnız `KAMPUS_HOOK_DEBUG` verilince yazılır. */
function debug(error: unknown): void {
  if (process.env.KAMPUS_HOOK_DEBUG) console.error(error)
}

const plain = (cell: string) => cell.replace(/`/g, '').trim()

interface Columns {
  title: number
  status: number
  branch: number
  note: number
}

/** Sütun yeri başlık satırından okunur (ör. ek `Boyut` sütunu); başlık yoksa varsayılan sıra. */
const DEFAULT_COLUMNS: Columns = { title: 1, status: 2, branch: 3, note: 4 }

function headerColumns(cells: string[]): Columns | undefined {
  // Türkçe yerelde "ID" küçülünce "ıd" olur; başlık yerelsiz küçültülür.
  const names = cells.map((cell) => plain(cell).normalize('NFC').toLowerCase())
  if (names[0] !== 'id') return undefined
  const find = (test: (name: string) => boolean, fallback: number) => {
    const index = names.findIndex(test)
    return index > 0 ? index : fallback
  }
  return {
    title: find((name) => name === 'görev', DEFAULT_COLUMNS.title),
    status: find((name) => name === 'durum', DEFAULT_COLUMNS.status),
    branch: find((name) => name.startsWith('dal'), DEFAULT_COLUMNS.branch),
    note: find((name) => name === 'not', DEFAULT_COLUMNS.note),
  }
}

/** Görev tablosunu ayrıştırır. Kimliği ya da durumu geçersiz satırlar sessizce atlanır. */
export function parseTasks(markdown: string): Task[] {
  const tasks: Task[] = []
  let section = ''
  let columns = DEFAULT_COLUMNS
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim()
      columns = DEFAULT_COLUMNS
      continue
    }
    const cells = splitRow(line)
    if (!cells) continue
    const header = headerColumns(cells)
    if (header) {
      columns = header
      continue
    }
    const id = cells[0] ?? ''
    const rawStatus = cells[columns.status]
    if (rawStatus === undefined || cells.length <= columns.note) continue
    const status = plain(rawStatus).normalize('NFC').toLocaleLowerCase('tr')
    if (!TASK_ID.test(id) || !isStatus(status)) continue
    const title = cells[columns.title] ?? ''
    const branch = plain(cells[columns.branch] ?? '')
    const note = cells[columns.note] ?? ''
    tasks.push({ id, title, status, branch, note, section })
  }
  return tasks
}

function shorten(text: string, limit = TITLE_LIMIT): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > limit ? `${flat.slice(0, limit - 1).trimEnd()}…` : flat
}

function line(task: Task, extra: 'branch' | 'note'): string {
  const detail = extra === 'branch' ? task.branch : task.note
  return `  ${task.id} ${shorten(task.title)}${detail ? ` [${shorten(detail, 70)}]` : ''}`
}

/** Başlık ve en çok `limit` satır; kalan sayı tek satırda söylenir. */
function block(title: string, tasks: Task[], extra: 'branch' | 'note', limit = 8): string[] {
  if (!tasks.length) return []
  const rest = tasks.length - limit
  return [
    title,
    ...tasks.slice(0, limit).map((task) => line(task, extra)),
    ...(rest > 0 ? [`  … ve ${rest} görev daha`] : []),
  ]
}

const done = (tasks: Task[]) => tasks.filter((task) => task.status === 'bitti').length

/** Oturum başında gösterilecek metin; tablolar boşsa boş dizi. */
export function summarize(me: Party, other: Party | undefined): string[] {
  const out: string[] = []
  if (me.tasks.length) {
    const own = (status: Status) => me.tasks.filter((task) => task.status === status)
    out.push(
      `Görev tablon (docs/is-bolumu/${me.id}.md, ${me.source}): ${done(me.tasks)}/${me.tasks.length} bitti.`,
      ...block('Üzerinde çalıştıkların (çalışılıyor):', own('çalışılıyor'), 'branch'),
      ...block('Revizyondakiler:', own('revizyon'), 'note'),
      ...block('Engelliler:', own('engelli'), 'note', 3),
      ...block(
        `Sıradaki ${NEXT_LIMIT} bekleyen görevin (is-baslat ile al):`,
        own('bekliyor').slice(0, NEXT_LIMIT),
        'note',
      ),
    )
  }
  if (other?.tasks.length) {
    const theirs = (status: Status) => other.tasks.filter((task) => task.status === status)
    out.push(
      `${other.possessive} durumu (docs/is-bolumu/${other.id}.md, ${other.source}): ${done(other.tasks)}/${other.tasks.length} bitti.`,
      ...block(`${other.name} şunlarda çalışıyor:`, theirs('çalışılıyor'), 'branch'),
      ...block(`${other.possessive} revizyondakileri:`, theirs('revizyon'), 'note'),
    )
  }
  return out
}

/** Önce entegrasyon dalındaki tablo; yoksa ya da satır çıkmazsa yerel dosya. */
export function readTasks(
  root: string,
  owner: string,
  ref = INTEGRATION_REF,
): { tasks: Task[]; source: string } {
  const path = `docs/is-bolumu/${owner}.md`
  try {
    const remote = execFileSync('git', ['-C', root, 'show', `${ref}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    })
    const tasks = parseTasks(remote)
    if (tasks.length) return { tasks, source: ref }
  } catch (error) {
    // Uzak dal ya da dosya yok: yerel dosyaya düşülür.
    debug(error)
  }
  const local = join(root, path)
  try {
    if (existsSync(local))
      return { tasks: parseTasks(readFileSync(local, 'utf8')), source: 'yerel dosya' }
  } catch (error) {
    // Okunamayan dosya boş tablo sayılır.
    debug(error)
  }
  return { tasks: [], source: 'yerel dosya' }
}

function party(map: AreaMap, id: string, root: string): Party {
  const owner = map.owners[id]
  const name = owner?.name ?? id
  return { id, name, possessive: owner?.possessive ?? name, ...readTasks(root, id) }
}

export function run(owner: string, root: string): string[] {
  const mapFile = join(root, '.claude', 'alanlar.json')
  const map = existsSync(mapFile) ? readAreaMap(mapFile) : readAreaMap()
  if (!map.owners[owner]) return []
  const otherId = Object.keys(map.owners).find((id) => id !== owner)
  return summarize(party(map, owner, root), otherId ? party(map, otherId, root) : undefined)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [owner = '', root = process.cwd()] = process.argv.slice(2)
    const lines = run(owner, root)
    if (lines.length) process.stdout.write(`${lines.join('\n')}\n`)
  } catch (error) {
    debug(error)
  }
}
