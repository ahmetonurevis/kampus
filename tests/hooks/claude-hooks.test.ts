import test, { after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { classify, readAreaMap } from '../../.claude/hooks/alan-koruma.ts'
import { findPushes } from '../../.claude/hooks/push-kontrol.ts'

// İki geliştiricili çalışma hook'ları (.claude/hooks): alan koruması ve push denetimi.
// Her test geçici git deposu kurar; kullanıcının global git ayarı testlere sızmaz.
const hooks = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '.claude', 'hooks')
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'kampus-hooks-')))
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

let sequence = 0
function repo(userName?: string, owner?: string): string {
  const dir = join(sandbox, `repo-${++sequence}`)
  mkdirSync(dir)
  git(dir, 'init', '--quiet', '--initial-branch=main')
  if (userName) git(dir, 'config', 'user.name', userName)
  if (owner) git(dir, 'config', 'kampus.sahip', owner)
  return dir
}

function runHook(script: string, input: unknown, env: Record<string, string> = {}) {
  const result = spawnSync('bash', [join(hooks, script)], {
    input: JSON.stringify(input),
    env: { ...gitEnv, ...env },
    encoding: 'utf8',
  })
  const context = result.stdout
    ? (JSON.parse(result.stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext
    : ''
  return { status: result.status, stderr: result.stderr, context }
}

const edit = (root: string, path: string, env?: Record<string, string>) =>
  runHook('alan-koruma.sh', { cwd: root, tool_input: { file_path: join(root, path) } }, env)

describe('alan-koruma', () => {
  test("Onur'un dosyası Oğuzhan'a engellenir", () => {
    const root = repo('Oguzhan Demirci')
    const result = edit(root, 'apps/api/src/services/payments.ts')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Onur'un alanında \(\.claude\/alanlar\.json\)/)
    assert.match(result.stderr, /gh issue create -R ahmetonurevis\/kampus --label sahip:onur/)
  })

  test("Oğuzhan'ın dosyası Onur'a engellenir", () => {
    const root = repo('Ahmet Onur Evis')
    const result = edit(root, 'apps/api/src/services/notifications.ts')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Oğuzhan'ın alanında/)
    assert.match(result.stderr, /--label sahip:oguzhan/)
  })

  test('Kendi alanındaki dosya sessizce geçer', () => {
    assert.deepEqual(edit(repo('Ahmet Onur Evis'), 'apps/web-react/src/pages/crm/X.tsx'), {
      status: 0,
      stderr: '',
      context: '',
    })
  })

  test('Ortak dosyada engel yok, hatırlatma çıkar', () => {
    const result = edit(repo('Ahmet Onur Evis'), 'packages/school-core/src/lib/scope.ts')
    assert.equal(result.status, 0)
    assert.match(
      result.context,
      /Ortak dosya .*kendi bloğuna yaz; blok dışına çıkarsan görev satırının Not'una yaz/,
    )
  })

  test('alan-izni.local engeli açar (yol ve glob)', () => {
    const root = repo('Oguzhan Demirci')
    mkdirSync(join(root, '.claude'))
    writeFileSync(
      join(root, '.claude', 'alan-izni.local'),
      '# kullanıcı izni\napps/api/src/services/payments.ts\napps/web-react/src/pages/finance/**\n',
    )
    const exact = edit(root, 'apps/api/src/services/payments.ts')
    assert.equal(exact.status, 0)
    assert.match(exact.context, /alan-izni\.local ile izinli/)
    assert.equal(edit(root, 'apps/web-react/src/pages/finance/A.tsx').status, 0)
    assert.equal(edit(root, 'apps/api/src/services/withdrawals.ts').status, 2)
  })

  test('kampus.sahip git kullanıcı adından önce gelir', () => {
    const root = repo('Oguzhan Demirci', 'onur')
    assert.equal(edit(root, 'apps/api/src/services/payments.ts').status, 0)
    assert.equal(edit(root, 'apps/api/src/services/notifications.ts').status, 2)
  })

  test('Kullanıcı tanınmazsa uyarıyla izin verilir', () => {
    const result = edit(repo('Biri Başka'), 'apps/api/src/services/payments.ts')
    assert.equal(result.status, 0)
    assert.match(result.context, /kullanıcıyı tanıyamadı/)
  })

  test('Repo dışındaki dosyaya karışılmaz', () => {
    const result = runHook('alan-koruma.sh', { tool_input: { file_path: '/nonexistent/x.ts' } })
    assert.deepEqual(result, { status: 0, stderr: '', context: '' })
  })

  test('Alan haritası gerçek dosya adlarını doğru sınıflar', () => {
    const map = readAreaMap()
    const owner = (path: string) => {
      const result = classify(path, map)
      return result.kind === 'shared' ? 'ortak' : result.owner
    }
    assert.equal(owner('apps/web-react/src/pages/settings/PaymentSettingsSection.tsx'), 'onur')
    assert.equal(owner('packages/react-shared/src/use-prospect-commands.ts'), 'onur')
    assert.equal(owner('apps/api/src/db/schema/student-identities.ts'), 'onur')
    assert.equal(owner('docs/domain/finans.md'), 'onur')
    assert.equal(owner('apps/api/src/services/identity.ts'), 'oguzhan')
    assert.equal(owner('docs/domain/yetki-ve-kapsam.md'), 'oguzhan')
    assert.equal(owner('apps/api/drizzle/0014_create_payments.sql'), 'ortak')
    assert.equal(owner('packages/school-core/src/modules/commands.ts'), 'ortak')
    // Mobil ekran kaydı ortak dosya önerisi (#25) onaylanana kadar Oğuzhan'ındır. Onur'un mobil
    // ekran dosyası küçük harfli ve kendi kalıbına uyan adla yazılır; PascalCase ad kalıba uymaz.
    assert.equal(owner('apps/mobile/src/api/screen-registry.ts'), 'oguzhan')
    assert.equal(owner('apps/mobile/src/api/pages.ts'), 'oguzhan')
    assert.equal(owner('apps/mobile/src/api/screens/finance-parent.tsx'), 'onur')
    assert.equal(owner('apps/mobile/src/api/screens/contract-approval.tsx'), 'onur')
    assert.equal(owner('apps/mobile/src/api/screens/ParentFinance.tsx'), 'oguzhan')
    assert.equal(owner('apps/api/package.json'), 'ortak')
    assert.equal(owner('packages/school-core/changes/odeme-iadesi.md'), 'ortak')
    assert.equal(owner('docs/is-bolumu/README.md'), 'ortak')
    assert.equal(owner('docs/is-bolumu/ilk-kurulum.md'), 'ortak')
    assert.equal(owner('docs/is-bolumu/onur.md'), 'onur')
    assert.equal(owner('docs/is-bolumu/oguzhan.md'), 'oguzhan')
  })
})

describe('push-kontrol', () => {
  const push = (cwd: string, command: string) =>
    runHook('push-kontrol.sh', { cwd, tool_input: { command } })

  test('Force push her biçimiyle engellenir', () => {
    for (const command of [
      'git push --force origin oguzhan/x',
      'git push -f origin oguzhan/x',
      'git push -uf origin oguzhan/x',
      'git push origin oguzhan/x --force-with-lease',
      'git push --force-with-lease=oguzhan/x origin oguzhan/x',
      'git push origin +oguzhan/x',
      'pnpm test && git -C . push --force',
    ]) {
      const result = push(sandbox, command)
      assert.equal(result.status, 2, command)
      assert.match(result.stderr, /Force push yasak/)
    }
  })

  test("main'e push engellenir", () => {
    for (const command of [
      'git push origin main',
      'git push origin HEAD:main',
      'git push origin oguzhan/x:refs/heads/main',
    ]) {
      assert.equal(push(sandbox, command).status, 2, command)
    }
  })

  test('Push olmayan ya da tırnak içindeki komutlar geçer', () => {
    assert.equal(push(sandbox, 'git status').status, 0)
    assert.equal(push(sandbox, 'echo "git push --force"').status, 0)
    assert.equal(push(sandbox, 'git log --grep push').status, 0)
  })

  test('cd ve git -C dizini push çağrısına taşınır', () => {
    const [found] = findPushes('cd /a && git -C b push -u origin oguzhan/x', '/x')
    assert.equal(found?.cwd, '/a/b')
    assert.equal(found?.remote, 'origin')
    assert.deepEqual(found?.refspecs, ['oguzhan/x'])
  })

  // Entegrasyon dalı: origin'de 0000 migration'ı olan bir başlangıç, yerelde çalışma kopyası.
  function integrationRepo(): { work: string; origin: string } {
    const origin = join(sandbox, `origin-${++sequence}.git`)
    git(sandbox, 'init', '--quiet', '--bare', origin)
    const work = repo('Oguzhan Demirci')
    git(work, 'remote', 'add', 'origin', origin)
    git(work, 'switch', '--quiet', '-c', 'feature/platform-gecisi')
    migration(work, '0000_create_identity_tables')
    git(work, 'push', '--quiet', 'origin', 'feature/platform-gecisi')
    return { work, origin }
  }

  function migration(work: string, tag: string, journal = true) {
    const dir = join(work, 'apps', 'api', 'drizzle')
    mkdirSync(join(dir, 'meta'), { recursive: true })
    writeFileSync(join(dir, `${tag}.sql`), 'select 1;\n')
    if (journal) {
      const tags = git(work, 'ls-files', 'apps/api/drizzle/*.sql')
        .split('\n')
        .filter(Boolean)
        .map((file) => file.replace(/^.*\//, '').replace(/\.sql$/, ''))
      const entries = [...new Set([...tags, tag])].map((name, idx) => ({ idx, tag: name }))
      writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify({ entries }))
    }
    git(work, 'add', '-A')
    git(work, 'commit', '--quiet', '-m', tag)
  }

  test('Entegrasyonu birleştirmiş temiz dal entegrasyona push edebilir', () => {
    const { work } = integrationRepo()
    git(work, 'switch', '--quiet', '-c', 'oguzhan/is')
    migration(work, '0001_add_x')
    git(work, 'switch', '--quiet', 'feature/platform-gecisi')
    git(work, 'merge', '--quiet', '--no-ff', '-m', 'Birleştir', 'oguzhan/is')
    assert.deepEqual(push(work, 'git push origin feature/platform-gecisi'), {
      status: 0,
      stderr: '',
      context: '',
    })
  })

  test('Güncel entegrasyon birleştirilmeden push engellenir', () => {
    const { work, origin } = integrationRepo()
    const other = join(sandbox, `other-${++sequence}`)
    git(sandbox, 'clone', '--quiet', '--branch', 'feature/platform-gecisi', origin, other)
    migration(other, '0001_from_onur')
    git(other, 'push', '--quiet', 'origin', 'feature/platform-gecisi')
    migration(work, '0001_from_oguzhan')
    const result = push(work, 'git push origin HEAD:feature/platform-gecisi')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Önce entegrasyonu birleştir/)
  })

  test('Aynı numaralı migration engellenir', () => {
    const { work } = integrationRepo()
    migration(work, '0001_from_onur')
    migration(work, '0001_from_oguzhan')
    const result = push(work, 'git push')
    assert.equal(result.status, 2)
    assert.match(
      result.stderr,
      /Aynı numaralı migration var: 0001_from_oguzhan\.sql, 0001_from_onur\.sql/,
    )
  })

  test('Günlükle tutarsız migration sayısı uyarılır', () => {
    const { work } = integrationRepo()
    migration(work, '0001_no_journal', false)
    const result = push(work, 'git push origin feature/platform-gecisi')
    assert.equal(result.status, 0)
    assert.match(result.context, /_journal\.json 1 kayıt, apps\/api\/drizzle 2 \.sql/)
  })

  test('Diğer dallarda yalnız force ve main denetlenir', () => {
    const { work } = integrationRepo()
    git(work, 'switch', '--quiet', '-c', 'oguzhan/dup')
    migration(work, '0001_a')
    migration(work, '0001_b')
    assert.equal(push(work, 'git push -u origin oguzhan/dup').status, 0)
  })
})
