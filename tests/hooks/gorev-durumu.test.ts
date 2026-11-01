import test, { after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  parseTasks,
  readTasks,
  STATUSES,
  summarize,
  type Party,
  type Task,
} from '../../.claude/hooks/gorev-durumu.ts'

// Görev tabloları (docs/is-bolumu/<sahip>.md) ve oturum başı özeti (session-context.sh).
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const hooks = join(repoRoot, '.claude', 'hooks')
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'kampus-gorev-')))
after(() => rmSync(sandbox, { recursive: true, force: true }))

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  CLAUDE_PROJECT_DIR: '',
}

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, env: gitEnv, encoding: 'utf8' })
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`)
  return result.stdout.trim()
}

const header = '| ID | Görev | Durum | Dal / commit | Not |\n| --- | --- | --- | --- | --- |'
const table = (prefix: string, rows: string[], section = 'D1 · Temel') =>
  `# ${prefix}\n\n- açıklama | ID kuralı\n\n## ${section}\n\n${header}\n${rows.join('\n')}\n\nAra nokta.\n`

function task(id: string, status: Task['status'], extra: Partial<Task> = {}): Task {
  return { id, title: `${id} işi`, status, branch: '', note: '', section: 'D1 · Temel', ...extra }
}

function party(id: string, tasks: Task[]): Party {
  const names: Record<string, [string, string]> = {
    onur: ['Onur', "Onur'un"],
    oguzhan: ['Oğuzhan', "Oğuzhan'ın"],
  }
  const [name, possessive] = names[id] ?? [id, id]
  return { id, name, possessive, tasks, source: 'yerel dosya' }
}

describe('parseTasks', () => {
  test('Geçerli satırları alanlarıyla ve dalga başlığıyla okur', () => {
    const tasks = parseTasks(
      table('Tablo', [
        '| OG-001 | Bildirim merkezi (IST-065) | çalışılıyor | `feature/bildirim-merkezi` | |',
        '| OG-002 | Rıza uçları | bitti | `a1b2c3d` | Onur bekliyor |',
      ]) + `\n## D2 · İlk yayın\n\n${header}\n| OG-003 | Vue'yu sil | bekliyor | | |\n`,
    )
    assert.deepEqual(tasks, [
      {
        id: 'OG-001',
        title: 'Bildirim merkezi (IST-065)',
        status: 'çalışılıyor',
        branch: 'feature/bildirim-merkezi',
        note: '',
        section: 'D1 · Temel',
      },
      {
        id: 'OG-002',
        title: 'Rıza uçları',
        status: 'bitti',
        branch: 'a1b2c3d',
        note: 'Onur bekliyor',
        section: 'D1 · Temel',
      },
      {
        id: 'OG-003',
        title: "Vue'yu sil",
        status: 'bekliyor',
        branch: '',
        note: '',
        section: 'D2 · İlk yayın',
      },
    ])
  })

  test('Bozuk satırlar sessizce atlanır', () => {
    const tasks = parseTasks(
      table('Tablo', [
        '| OG-001 | Durumu tanımsız | yapılıyor | | |',
        '| OG-2 | Kimlik biçimi bozuk | bekliyor | | |',
        '| OG-003 | Eksik sütun | bekliyor |',
        'OG-004 | Çizgisiz satır | bekliyor | | |',
        '| OG-005 | Geçerli | `engelli` | | ON-014 bekleniyor |',
      ]),
    )
    assert.deepEqual(
      tasks.map((item) => [item.id, item.status, item.note]),
      [['OG-005', 'engelli', 'ON-014 bekleniyor']],
    )
  })

  test('Büyük harf, ayrışık Unicode ve hücre içi çizgi tolere edilir', () => {
    const decomposed = 'çalışılıyor'.normalize('NFD')
    const [first, second] = parseTasks(
      table('Tablo', [
        `| ON-001 | Kur \\| grup | ${decomposed} | onur/kur | |`,
        '| ON-002 | Sözleşme | REVİZYON | onur/sozlesme | #12 |',
      ]),
    )
    assert.equal(first?.title, 'Kur | grup')
    assert.equal(first?.status, 'çalışılıyor')
    assert.equal(second?.status, 'revizyon')
  })

  test('Sütunlar başlıktan okunur: ek Boyut sütunu', () => {
    const [item] = parseTasks(
      '## D1\n\n| ID | Görev | Boyut | Durum | Dal / commit | Not |\n| --- | --- | --- | --- | --- | --- |\n' +
        '| OG-001 | S3 sürücüsü | M | çalışılıyor | `oguzhan/s3` | dış servis, ADR |\n',
    )
    assert.deepEqual(item, {
      id: 'OG-001',
      title: 'S3 sürücüsü',
      status: 'çalışılıyor',
      branch: 'oguzhan/s3',
      note: 'dış servis, ADR',
      section: 'D1',
    })
  })

  test('Boş ya da tablosuz metin boş liste verir', () => {
    assert.deepEqual(parseTasks(''), [])
    assert.deepEqual(parseTasks('# Liste\n\n- [ ] Eski biçim madde\n'), [])
  })
})

describe('summarize', () => {
  test('Kendi açık işlerini, sıradaki beşi ve karşı tarafın sürenlerini gösterir', () => {
    const mine = [
      task('OG-001', 'bitti', { branch: 'abc1234' }),
      task('OG-002', 'çalışılıyor', { branch: 'oguzhan/bildirim' }),
      task('OG-003', 'revizyon', { note: '#14' }),
      task('OG-004', 'engelli', { note: 'ON-012 bekleniyor' }),
      ...Array.from({ length: 7 }, (_, i) => task(`OG-0${10 + i}`, 'bekliyor')),
      task('OG-020', 'iptal'),
    ]
    const theirs = [
      task('ON-001', 'çalışılıyor', { branch: 'onur/inceleme' }),
      task('ON-002', 'revizyon', { note: 'kullanıcı düzeltme istedi' }),
      task('ON-003', 'bitti'),
      task('ON-004', 'bekliyor'),
    ]
    const text = summarize(party('oguzhan', mine), party('onur', theirs)).join('\n')
    assert.match(text, /Görev tablon \(docs\/is-bolumu\/oguzhan\.md, yerel dosya\): 1\/12 bitti\./)
    assert.match(text, /OG-002 OG-002 işi \[oguzhan\/bildirim\]/)
    assert.match(text, /Revizyondakiler:\n {2}OG-003 OG-003 işi \[#14\]/)
    assert.match(text, /Engelliler:\n {2}OG-004 OG-004 işi \[ON-012 bekleniyor\]/)
    assert.match(text, /Sıradaki 5 bekleyen/)
    assert.match(text, /OG-014/)
    assert.doesNotMatch(text, /OG-015|OG-020/)
    assert.match(text, /Onur'un durumu \(docs\/is-bolumu\/onur\.md, yerel dosya\): 1\/4 bitti\./)
    assert.match(text, /Onur şunlarda çalışıyor:\n {2}ON-001 ON-001 işi \[onur\/inceleme\]/)
    assert.match(text, /Onur'un revizyondakileri:\n {2}ON-002/)
    assert.doesNotMatch(text, /ON-004/)
  })

  test('Uzun liste kısaltılır, uzun başlık kırpılır', () => {
    const blocked = Array.from({ length: 5 }, (_, i) =>
      task(`ON-00${i + 1}`, 'engelli', { title: 'Uzun '.repeat(40), note: 'ON-099 bekleniyor' }),
    )
    const lines = summarize(party('onur', blocked), undefined)
    assert.ok(lines.includes('  … ve 2 görev daha'))
    assert.ok(lines.every((item) => item.length < 220))
  })

  test('Tablo boşsa hiçbir şey yazılmaz', () => {
    assert.deepEqual(summarize(party('onur', []), party('oguzhan', [])), [])
  })
})

describe('readTasks', () => {
  function repoWithTables(): string {
    const dir = join(sandbox, `repo-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(dir, 'docs', 'is-bolumu'), { recursive: true })
    git(dir, 'init', '--quiet', '--initial-branch=main')
    return dir
  }

  test('Entegrasyon dalındaki tablo yerel dosyadan önce gelir', () => {
    const dir = repoWithTables()
    const file = join(dir, 'docs', 'is-bolumu', 'onur.md')
    writeFileSync(file, table('Onur', ['| ON-001 | İnceleme | bitti | abc1234 | |']))
    git(dir, 'add', '.')
    git(dir, 'commit', '--quiet', '-m', 'tablo')
    git(dir, 'branch', 'entegrasyon')
    writeFileSync(file, table('Onur', ['| ON-001 | İnceleme | çalışılıyor | onur/inceleme | |']))

    assert.deepEqual(readTasks(dir, 'onur', 'entegrasyon').tasks[0]?.status, 'bitti')
    assert.equal(readTasks(dir, 'onur', 'entegrasyon').source, 'entegrasyon')
    const local = readTasks(dir, 'onur', 'olmayan-dal')
    assert.equal(local.source, 'yerel dosya')
    assert.equal(local.tasks[0]?.status, 'çalışılıyor')
  })

  test('Dosya yoksa boş liste döner', () => {
    assert.deepEqual(readTasks(repoWithTables(), 'oguzhan', 'olmayan-dal').tasks, [])
  })
})

describe('session-context.sh', () => {
  test('Ana klonda görev özetini ve ilk kurulum uyarısını yazar', () => {
    const dir = join(sandbox, 'session')
    mkdirSync(join(dir, 'docs', 'is-bolumu'), { recursive: true })
    mkdirSync(join(dir, '.claude'))
    git(dir, 'init', '--quiet', '--initial-branch=main')
    git(dir, 'config', 'kampus.sahip', 'onur')
    writeFileSync(
      join(dir, '.claude', 'alanlar.json'),
      readFileSync(join(repoRoot, '.claude', 'alanlar.json'), 'utf8'),
    )
    writeFileSync(
      join(dir, 'docs', 'is-bolumu', 'onur.md'),
      table('Onur', ['| ON-001 | Birleştirmeyi incele (#9) | bekliyor | | |']),
    )
    writeFileSync(
      join(dir, 'docs', 'is-bolumu', 'oguzhan.md'),
      table('Oğuzhan', [
        '| OG-001 | Bildirim merkezi | çalışılıyor | feature/bildirim-merkezi | |',
      ]),
    )
    const started = Date.now()
    const result = spawnSync('bash', [join(hooks, 'session-context.sh')], {
      env: { ...gitEnv, CLAUDE_PROJECT_DIR: dir, PATH: process.env.PATH ?? '' },
      encoding: 'utf8',
    })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(Date.now() - started < 4000, 'kanca yavaş')
    assert.match(result.stdout, /İlk kurulum: docs\/is-bolumu\/ilk-kurulum\.md/)
    assert.match(
      result.stdout,
      /Sıradaki 5 bekleyen görevin[^\n]*\n {2}ON-001 Birleştirmeyi incele \(#9\)/,
    )
    assert.match(
      result.stdout,
      /Oğuzhan şunlarda çalışıyor:\n {2}OG-001 Bildirim merkezi \[feature\/bildirim-merkezi\]/,
    )
  })
})

describe('docs/is-bolumu tabloları', () => {
  for (const [owner, prefix] of [
    ['onur', 'ON'],
    ['oguzhan', 'OG'],
  ] as const) {
    test(`${owner}.md: her görev satırı ayrışır, kimlikler tekil ve doğru önekli`, () => {
      const markdown = readFileSync(join(repoRoot, 'docs', 'is-bolumu', `${owner}.md`), 'utf8')
      const rows = markdown.split('\n').filter((row) => /^\|\s*[A-Z]{2}-\d/.test(row))
      const tasks = parseTasks(markdown)
      assert.equal(tasks.length, rows.length, 'bozuk satır sessizce atlandı')
      assert.ok(tasks.length > 0)
      assert.equal(new Set(tasks.map((item) => item.id)).size, tasks.length, 'yinelenen kimlik')
      for (const item of tasks) {
        assert.ok(item.id.startsWith(`${prefix}-`), item.id)
        assert.ok((STATUSES as readonly string[]).includes(item.status))
        if (item.status === 'engelli') assert.match(item.note, /\b(ON|OG)-\d{3}\b/, item.id)
        if (item.status === 'çalışılıyor' || item.status === 'revizyon')
          assert.ok(item.branch, item.id)
      }
    })
  }
})
