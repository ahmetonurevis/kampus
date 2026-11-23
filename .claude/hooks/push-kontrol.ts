// PreToolUse (Bash): yalnız `git push` komutlarını denetler. Force push, `+refspec`, toplu push ve
// `main`'e push her dalda engellenir. Entegrasyon dalına push'ta güncel entegrasyonun birleştirilmiş
// olması ve migration numaralarının tekilliği de aranır. Kurallar: docs/muhendislik/git-ve-surum.md §7.
// Çıkış 0 = izin (uyarı additionalContext ile), 2 = engel (gerekçe stderr'de).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const INTEGRATION_BRANCH = 'feature/platform-gecisi'
const PROTECTED_BRANCH = 'main'
const MIGRATIONS_DIR = 'apps/api/drizzle'

export interface PushCommand {
  cwd: string
  remote: string
  force: boolean
  bulk: boolean
  deleteMode: boolean
  refspecs: string[]
}

export type Verdict = { block: string } | { warnings: string[] }

/** Tırnakları ve kaçışları gözeterek komutu `&&`, `||`, `;`, `|`, `&` ve satır sonunda böler. */
export function splitCommand(command: string): string[][] {
  const segments: string[][] = []
  let tokens: string[] = []
  let current = ''
  let hasToken = false
  let quote: '"' | "'" | undefined
  const endToken = () => {
    if (hasToken) tokens.push(current)
    current = ''
    hasToken = false
  }
  const endSegment = () => {
    endToken()
    if (tokens.length > 0) segments.push(tokens)
    tokens = []
  }
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] ?? ''
    if (quote) {
      if (char === quote) quote = undefined
      else if (char === '\\' && quote === '"' && i + 1 < command.length) current += command[++i]
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      hasToken = true
    } else if (char === '\\' && i + 1 < command.length) {
      current += command[++i]
      hasToken = true
    } else if (/\s/.test(char) && char !== '\n') endToken()
    else if (char === '\n' || char === ';' || char === '&' || char === '|') endSegment()
    else if (char === '(' || char === ')') endToken()
    else {
      current += char
      hasToken = true
    }
  }
  endSegment()
  return segments
}

const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
const PUSH_OPTIONS_WITH_VALUE = new Set([
  '--repo',
  '--push-option',
  '--receive-pack',
  '--exec',
  '-o',
])

/** Komuttaki `git push` çağrılarını, önceki `cd` ve `git -C` dizinleriyle birlikte çıkarır. */
export function findPushes(command: string, cwd: string): PushCommand[] {
  const pushes: PushCommand[] = []
  let dir = cwd
  for (const segment of splitCommand(command)) {
    let i = 0
    while (i < segment.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(segment[i] ?? '')) i += 1
    const [head, next] = [segment[i], segment[i + 1]]
    if (head === 'cd' && next) {
      dir = isAbsolute(next) ? next : resolve(dir, next)
      continue
    }
    if (head !== 'git') continue
    let gitDir = dir
    i += 1
    while (i < segment.length && segment[i]?.startsWith('-')) {
      const option = segment[i] ?? ''
      if (GIT_OPTIONS_WITH_VALUE.has(option)) {
        if (option === '-C') {
          const value = segment[i + 1] ?? ''
          gitDir = isAbsolute(value) ? value : resolve(gitDir, value)
        }
        i += 2
      } else i += 1
    }
    if (segment[i] !== 'push') continue
    const push: PushCommand = {
      cwd: gitDir,
      remote: '',
      force: false,
      bulk: false,
      deleteMode: false,
      refspecs: [],
    }
    const positional: string[] = []
    for (i += 1; i < segment.length; i += 1) {
      const arg = segment[i] ?? ''
      if (arg === '--') {
        positional.push(...segment.slice(i + 1))
        break
      }
      if (arg.startsWith('--')) {
        const name = arg.split('=')[0] ?? arg
        if (/^--(force|force-with-lease|force-if-includes)$/.test(name)) push.force = true
        else if (/^--(all|branches|mirror|tags)$/.test(name)) push.bulk = true
        else if (name === '--delete') push.deleteMode = true
        else if (PUSH_OPTIONS_WITH_VALUE.has(name) && !arg.includes('=')) i += 1
        continue
      }
      if (arg.startsWith('-') && arg.length > 1) {
        // Kısa seçenek kümesi (-uf gibi); `-o` sonrası değer alır.
        const flags = arg.slice(1)
        if (flags.includes('f')) push.force = true
        if (flags.includes('d')) push.deleteMode = true
        if (flags.endsWith('o')) i += 1
        continue
      }
      positional.push(arg)
    }
    push.remote = positional[0] ?? ''
    push.refspecs = positional.slice(1)
    pushes.push(push)
  }
  return pushes
}

function git(cwd: string, args: string[], timeout = 5000): { ok: boolean; out: string } {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { ok: result.status === 0, out: (result.stdout ?? '').trim() }
}

function branchName(ref: string): string {
  return ref.replace(/^refs\/heads\//, '')
}

interface Target {
  source: string
  branch: string
  deletion: boolean
}

function targets(push: PushCommand, currentBranch: () => string): Target[] {
  if (push.refspecs.length === 0) {
    return [{ source: 'HEAD', branch: currentBranch(), deletion: false }]
  }
  return push.refspecs.map((spec) => {
    const colon = spec.indexOf(':')
    const source = colon === -1 ? spec : spec.slice(0, colon)
    const destination = colon === -1 ? spec : spec.slice(colon + 1)
    const deletion = push.deleteMode || (colon !== -1 && source === '')
    const branch = destination === 'HEAD' ? currentBranch() : branchName(destination)
    return { source: source || 'HEAD', branch, deletion }
  })
}

/** Aynı sayı önekini taşıyan migration dosyaları. */
export function duplicateMigrations(files: readonly string[]): string[] {
  const byNumber = new Map<string, string[]>()
  for (const file of files) {
    const match = /^(\d+)_.*\.sql$/.exec(file)
    if (!match?.[1]) continue
    byNumber.set(match[1], [...(byNumber.get(match[1]) ?? []), file])
  }
  return [...byNumber.values()].filter((group) => group.length > 1).flat()
}

function checkIntegration(
  push: PushCommand,
  source: string,
  warnings: string[],
): string | undefined {
  const remote = push.remote && !push.remote.includes('/') ? push.remote : 'origin'
  const remoteRef = `${remote}/${INTEGRATION_BRANCH}`
  const fetch = git(push.cwd, ['fetch', '--quiet', remote, INTEGRATION_BRANCH], 15000)
  if (!fetch.ok) warnings.push(`${remoteRef} alınamadı; denetim yereldeki son kopyayla yapıldı.`)
  if (git(push.cwd, ['rev-parse', '--verify', '--quiet', remoteRef]).ok) {
    if (!git(push.cwd, ['merge-base', '--is-ancestor', remoteRef, source]).ok) {
      return `Önce entegrasyonu birleştir: ${remoteRef} gönderilen commit'in atası değil. git fetch && git merge ${remoteRef}, testleri koş, sonra yeniden push et.`
    }
  }
  const tree = git(push.cwd, ['ls-tree', '--name-only', `${source}:${MIGRATIONS_DIR}`])
  const sqlFiles = tree.out.split('\n').filter((file) => file.endsWith('.sql'))
  const duplicates = duplicateMigrations(sqlFiles)
  if (duplicates.length > 0) {
    return `Aynı numaralı migration var: ${duplicates.join(', ')}. İkinci giren kendi migration'ını silip güncel entegrasyon üzerinde db:generate ile yeniden üretir.`
  }
  const journal = git(push.cwd, ['show', `${source}:${MIGRATIONS_DIR}/meta/_journal.json`])
  if (journal.ok) {
    try {
      const entries = (JSON.parse(journal.out) as { entries?: { tag?: string }[] }).entries ?? []
      const tags = new Set(entries.map((entry) => `${entry.tag}.sql`))
      const missing = sqlFiles.filter((file) => !tags.has(file))
      if (entries.length !== sqlFiles.length || missing.length > 0) {
        warnings.push(
          `_journal.json ${entries.length} kayıt, ${MIGRATIONS_DIR} ${sqlFiles.length} .sql dosyası içeriyor` +
            (missing.length > 0 ? ` (günlükte olmayan: ${missing.join(', ')})` : '') +
            '; migration zincirini denetle.',
        )
      }
    } catch (error) {
      warnings.push(`_journal.json okunamadı: ${String(error)}`)
    }
  }
  return undefined
}

export function evaluate(push: PushCommand): Verdict {
  if (push.force || push.refspecs.some((spec) => spec.startsWith('+'))) {
    return {
      block:
        'Force push yasak (--force, -f, --force-with-lease, +refspec). Gönderilmiş geçmiş yeniden yazılmaz; fetch, merge, test, sonra normal push.',
    }
  }
  if (push.bulk) {
    return { block: 'Toplu push (--all, --mirror, --tags) yapılmaz; dalı adıyla gönder.' }
  }
  let current: string | undefined
  const currentBranch = () =>
    (current ??= git(push.cwd, ['symbolic-ref', '--short', '-q', 'HEAD']).out || 'HEAD')
  const warnings: string[] = []
  for (const target of targets(push, currentBranch)) {
    if (target.branch === PROTECTED_BRANCH) {
      return { block: "`main`'e push yasak; değişiklik entegrasyon dalından PR ile girer." }
    }
    if (target.branch !== INTEGRATION_BRANCH) continue
    if (target.deletion) return { block: 'Entegrasyon dalı silinemez.' }
    const block = checkIntegration(push, target.source, warnings)
    if (block) return { block }
  }
  return { warnings }
}

interface HookInput {
  cwd?: string
  tool_input?: { command?: string }
}

function runHook(raw: string): number {
  let input: HookInput
  try {
    input = JSON.parse(raw) as HookInput
  } catch (error) {
    if (process.env.KAMPUS_HOOK_DEBUG) console.error(error)
    return 0
  }
  const command = input.tool_input?.command ?? ''
  if (!/\bgit\b[\s\S]*\bpush\b/.test(command)) return 0
  const warnings: string[] = []
  for (const push of findPushes(command, input.cwd ?? process.cwd())) {
    const verdict = evaluate(push)
    if ('block' in verdict) {
      process.stderr.write(`${verdict.block}\n`)
      return 2
    }
    warnings.push(...verdict.warnings)
  }
  if (warnings.length > 0) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warnings.join(' ') },
      }),
    )
  }
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runHook(readFileSync(0, 'utf8'))
}
