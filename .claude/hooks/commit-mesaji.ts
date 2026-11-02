// Git `commit-msg` hook'u (.githooks/commit-msg): commit ve merge mesajını standarda göre denetler.
// Kural: docs/muhendislik/git-ve-surum.md §2. `pnpm install` hook yolunu kurar (kök `prepare`).
// Çıkış 0 = geçti, 1 = engel (gerekçe stderr'de; git commit'i oluşturmaz).
import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MAX_SUBJECT_LENGTH = 72
const INTEGRATION_BRANCH = 'feature/platform-gecisi'

const TASK_REF = /\b(?:OG|ON)-\d{3}\b|#\d+\b/
const STATUS_SUBJECT = 'Görev durumunu güncelle'
const STATUSES = ['bekliyor', 'çalışılıyor', 'revizyon', 'engelli', 'bitti', 'iptal', 'eklendi']
const CONVENTIONAL_PREFIX = /^[a-z]+(?:\([^)]*\))?!?:\s/
const GIT_MERGE = /^Merge (?:branch|remote-tracking branch|commit|tag|pull request) /
const SYNC_MERGE = new RegExp(
  `^Merge (?:remote-tracking )?branch '(?:origin/)?${INTEGRATION_BRANCH}'(?: of \\S+)?(?: into \\S+)?$`,
)
const AUTOSQUASH = /^(?:fixup|squash|amend)! /
const CO_AUTHOR = /^Co-Authored-By: .+ <[^<>\s]+@[^<>\s]+>$/
// İngilizce emir kipi başlığı ("Add …", "Fix …") Türkçe kurala aykırıdır.
const ENGLISH_VERBS = new Set([
  'add',
  'adds',
  'allow',
  'bump',
  'change',
  'chore',
  'clean',
  'create',
  'delete',
  'drop',
  'enable',
  'fix',
  'fixes',
  'implement',
  'improve',
  'make',
  'move',
  'refactor',
  'remove',
  'rename',
  'replace',
  'support',
  'update',
  'use',
])
const VAGUE_SUBJECTS = new Set([
  'wip',
  'fix',
  'düzelt',
  'düzeltme',
  'güncelle',
  'güncelleme',
  'update',
  'test',
  'deneme',
  'tmp',
  'temp',
  'x',
  'değişiklik',
  'değişiklikler',
])

/** Git'in editörde bıraktığı yorum satırlarını ve makas çizgisinin altını atar. */
export function cleanMessage(raw: string): string {
  const scissors = raw.search(/^# -+ >8 -+$/m)
  const body = scissors === -1 ? raw : raw.slice(0, scissors)
  return body
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd()
}

/**
 * Mesajı denetler; boş dizi = geçti. Görev ID'si kuralı her dalda geçerlidir; entegrasyon dalını
 * eşitleyen merge, revert ve autosquash (`fixup!`) commit'leri muaftır.
 */
export function checkCommitMessage(raw: string): string[] {
  const message = cleanMessage(raw)
  const lines = message.split('\n')
  const subject = lines[0] ?? ''
  const errors: string[] = []

  if (!subject.trim()) return ['Mesaj boş.']
  if (AUTOSQUASH.test(subject)) return []
  if (lines.length > 1 && lines[1] !== '') {
    errors.push('Başlık ile gövde arasında boş satır olmalı.')
  }

  const coAuthorLines = lines.filter((line) => /^co-authored-by:/i.test(line))
  for (const line of coAuthorLines) {
    if (!CO_AUTHOR.test(line)) {
      errors.push(`Ortak yazar satırı "Co-Authored-By: Ad <e-posta>" biçiminde olmalı: "${line}".`)
    }
  }

  if (subject.startsWith('Revert "')) return errors
  if (GIT_MERGE.test(subject)) {
    if (!SYNC_MERGE.test(subject) && !TASK_REF.test(message)) {
      errors.push(
        'Çalışma dalını birleştiren merge mesajı görev ID\'sini anar: -m "Merge branch \'<dal>\' into <hedef>" -m "OG-012: <özet>".',
      )
    }
    return errors
  }

  const length = [...subject].length
  if (length > MAX_SUBJECT_LENGTH) {
    errors.push(
      `Başlık en fazla ${MAX_SUBJECT_LENGTH} karakter (şu an ${length}); ayrıntı gövdeye.`,
    )
  }
  if (/[.!:;,]$/.test(subject)) errors.push('Başlık noktalama işaretiyle bitmez.')
  if (CONVENTIONAL_PREFIX.test(subject)) {
    errors.push('Başlıkta önek (`feat:`, `fix(api):` …) kullanılmaz; doğrudan Türkçe emir kipi.')
  }
  const firstWord = subject.split(/\s+/)[0] ?? ''
  if (ENGLISH_VERBS.has(firstWord.toLowerCase())) {
    errors.push(`Başlık Türkçe ve emir kipinde yazılır ("${firstWord} …" İngilizce).`)
  }
  if (/^\p{Ll}+$/u.test(firstWord)) {
    errors.push('Başlık büyük harfle başlar (kod adı ise ters tırnak içinde yaz).')
  }
  if (VAGUE_SUBJECTS.has(subject.trim().toLocaleLowerCase('tr')) || !/\s/.test(subject.trim())) {
    errors.push('Başlık neyin değiştiğini söyler; tek kelimelik ya da belirsiz başlık olmaz.')
  }

  if (subject.startsWith(STATUS_SUBJECT)) {
    const rest = subject.slice(STATUS_SUBJECT.length)
    const hasId = /\b(?:OG|ON)-\d{3}\b/.test(rest)
    const hasStatus = STATUSES.some((status) => rest.includes(status))
    if (!rest.startsWith(': ') || !hasId || !hasStatus) {
      errors.push(
        `Durum commit'i "${STATUS_SUBJECT}: OG-012 çalışılıyor" biçimindedir (durum: ${STATUSES.join(', ')}).`,
      )
    }
  } else if (!TASK_REF.test(message)) {
    errors.push(
      "Görev ID'si (OG-012, ON-007) ya da iş isteği (#12) başlık sonunda parantezde ya da gövdede geçer.",
    )
  }
  return errors
}

function main(file: string): number {
  const errors = checkCommitMessage(readFileSync(file, 'utf8'))
  if (errors.length === 0) return 0
  const branch = spawnSync('git', ['symbolic-ref', '--short', '-q', 'HEAD'], { encoding: 'utf8' })
  process.stderr.write(
    [
      `Commit mesajı standarda uymuyor${branch.stdout.trim() ? ` (${branch.stdout.trim()})` : ''}:`,
      ...errors.map((error) => `  - ${error}`),
      '',
      'Örnek:',
      '  Veli etüt listesini seçili çocuğa daralt (OG-012)',
      '',
      '  Neden ve etki; satırlar 72 karakterde kırılır.',
      '',
      '  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>',
      'Kural: docs/muhendislik/git-ve-surum.md §2.',
      '',
    ].join('\n'),
  )
  return 1
}

// Sembolik bağlantılı yolda (/tmp → /private/tmp) da çalışsın diye gerçek yollar karşılaştırılır.
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    process.stderr.write('Kullanım: node commit-mesaji.ts <mesaj-dosyası>\n')
    process.exit(2)
  }
  process.exit(main(file))
}
