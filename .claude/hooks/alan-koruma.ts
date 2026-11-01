// PreToolUse (Edit|Write|MultiEdit|NotebookEdit): diğer geliştiricinin alanına yazmayı durdurur.
// Alan haritası .claude/alanlar.json; kurallar .claude/rules/ortak-calisma.md.
// Çıkış 0 = izin (gerekirse additionalContext ile hatırlatma), 2 = engel (gerekçe stderr'de).
// `git ls-files | node .claude/hooks/alan-koruma.ts --classify` her yolun sahibini listeler.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

interface Owner {
  name: string
  /** İyelik ekli ad, ör. "Onur'un"; Türkçe ek ünlü uyumuna göre değiştiği için elle yazılır. */
  possessive?: string
  gitName?: string
  area?: string
  paths: string[]
}

export interface AreaMap {
  defaultOwner: string
  owners: Record<string, Owner>
  shared: string[]
}

export type Classification = { kind: 'shared' } | { kind: 'owner'; owner: string }

const hookDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(hookDir, '..', '..')

function escapeRegex(text: string): string {
  return text.replace(/[.+^$()|[\]\\]/g, '\\$&')
}

/** `{a,b}`, `**`, `*` ve `?` destekli glob'u büyük-küçük harf duyarsız düzenli ifadeye çevirir. */
export function globToRegex(glob: string): RegExp {
  let source = ''
  let depth = 0
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      i += 1
      if (glob[i + 1] === '/') {
        source += '(?:.*/)?'
        i += 1
      } else {
        source += '.*'
      }
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else if (char === '{') {
      source += '(?:'
      depth += 1
    } else if (char === '}' && depth > 0) {
      source += ')'
      depth -= 1
    } else if (char === ',' && depth > 0) source += '|'
    else source += escapeRegex(char ?? '')
  }
  // Desen bir klasörle eşleşirse altındaki her dosyayı da kapsar (gitignore gibi).
  return new RegExp(`^${source}(?:/.*)?$`, 'i')
}

const regexCache = new Map<string, RegExp>()
export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => {
    let regex = regexCache.get(glob)
    if (!regex) {
      regex = globToRegex(glob.replace(/^\.\//, '').replace(/\/+$/, ''))
      regexCache.set(glob, regex)
    }
    return regex.test(path)
  })
}

export function readAreaMap(file = join(projectRoot, '.claude', 'alanlar.json')): AreaMap {
  return JSON.parse(readFileSync(file, 'utf8')) as AreaMap
}

/** Önce ortak dosyalar, sonra sahiplerin yolları; hiçbirine uymayan yol varsayılan sahibindir. */
export function classify(path: string, map: AreaMap): Classification {
  if (matchesAny(path, map.shared)) return { kind: 'shared' }
  for (const [id, owner] of Object.entries(map.owners)) {
    if (matchesAny(path, owner.paths)) return { kind: 'owner', owner: id }
  }
  return { kind: 'owner', owner: map.defaultOwner }
}

function normalizeName(name: string): string {
  return name.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/** `kampus.sahip` önceliklidir; yoksa git kullanıcı adındaki sözcükten çıkarılır. */
export function detectUser(
  config: { owner?: string; userName?: string },
  map: AreaMap,
): string | undefined {
  const ids = Object.keys(map.owners)
  const explicit = normalizeName(config.owner?.trim() ?? '')
  if (ids.includes(explicit)) return explicit
  const words = normalizeName(config.userName ?? '').split(/[^a-z0-9]+/)
  return ids.find((id) => words.includes(id))
}

/** Dosyanın bulunduğu çalışma ağacının kökü; worktree'lerde `.git` bir dosyadır. */
function worktreeRoot(file: string): string | undefined {
  let dir = dirname(file)
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

function allowedGlobs(roots: readonly string[]): string[] {
  const globs: string[] = []
  for (const root of new Set(roots)) {
    const file = join(root, '.claude', 'alan-izni.local')
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const glob = line.replace(/#.*/, '').trim()
      if (glob) globs.push(glob)
    }
  }
  return globs
}

/** Tek git çağrısıyla `kampus.sahip` ve `user.name` okunur (hook hızlı kalmalı). */
function readGitIdentity(root: string): { owner?: string; userName?: string } {
  let output = ''
  try {
    output = execFileSync(
      'git',
      ['-C', root, 'config', '--get-regexp', '^(kampus\\.sahip|user\\.name)$'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 },
    )
  } catch (error) {
    // Anahtar yoksa git 1 ile çıkar; kullanıcı bilinmiyor sayılır ve hook uyarıyla izin verir.
    if (process.env.KAMPUS_HOOK_DEBUG) console.error(error)
  }
  const identity: { owner?: string; userName?: string } = {}
  // Kapsamlar sistem → global → yerel sırasıyla gelir; son değer geçerlidir.
  for (const line of output.split('\n')) {
    const [key, ...value] = line.split(' ')
    if (key === 'kampus.sahip') identity.owner = value.join(' ')
    if (key === 'user.name') identity.userName = value.join(' ')
  }
  return identity
}

function addContext(text: string): void {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: text },
    }),
  )
}

interface HookInput {
  cwd?: string
  tool_input?: { file_path?: string; notebook_path?: string }
}

function runHook(raw: string): number {
  let input: HookInput
  try {
    input = JSON.parse(raw) as HookInput
  } catch (error) {
    if (process.env.KAMPUS_HOOK_DEBUG) console.error(error)
    return 0
  }
  const target = input.tool_input?.file_path ?? input.tool_input?.notebook_path
  if (!target) return 0
  const absolute = isAbsolute(target) ? target : resolve(input.cwd ?? process.cwd(), target)
  const root = worktreeRoot(absolute)
  if (!root) return 0
  const path = relative(root, absolute).split(sep).join('/')
  if (!path || path.startsWith('../')) return 0

  const map = readAreaMap()
  const result = classify(path, map)
  if (result.kind === 'shared') {
    addContext(
      `Ortak dosya (${path}): kendi bloğuna yaz; blok dışına çıkarsan görev satırının Not'una yaz.`,
    )
    return 0
  }
  const owner = map.owners[result.owner]
  const ownerName = owner?.name ?? result.owner
  const user = detectUser(readGitIdentity(root), map)
  if (!user) {
    addContext(
      `Alan koruması kullanıcıyı tanıyamadı; \`git config kampus.sahip onur|oguzhan\` ile tanımlayın. ${path} ${ownerName} alanındadır.`,
    )
    return 0
  }
  if (result.owner === user) return 0
  const roots = [root, process.env.CLAUDE_PROJECT_DIR].filter((dir): dir is string => Boolean(dir))
  if (matchesAny(path, allowedGlobs(roots))) {
    addContext(
      `${path} ${ownerName} alanında; .claude/alan-izni.local ile izinli. Görev satırının Not'unda ve karşı tarafa açılan issue'da duyur.`,
    )
    return 0
  }
  process.stderr.write(
    `Bu dosya ${owner?.possessive ?? ownerName} alanında (.claude/alanlar.json): ${path}. Karşı alana yazılmaz; durmadan iş isteği aç: ` +
      `gh issue create -R ahmetonurevis/kampus --label sahip:${result.owner} (gerekçe, istenen davranış, dosyalar) ` +
      "ve kendi tarafına geçici veriyle devam et. Kullanıcı dosyayı açmak isterse yolu git'e girmeyen .claude/alan-izni.local dosyasına ekler.\n",
  )
  return 2
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const raw = readFileSync(0, 'utf8')
  if (process.argv.includes('--classify')) {
    const map = readAreaMap()
    for (const path of raw.split(/\r?\n/).filter(Boolean)) {
      const result = classify(path, map)
      process.stdout.write(`${result.kind === 'shared' ? 'ortak' : result.owner}\t${path}\n`)
    }
  } else {
    process.exitCode = runHook(raw)
  }
}
