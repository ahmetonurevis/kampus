import test, { after, describe } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkCommitMessage, cleanMessage } from '../../.claude/hooks/commit-mesaji.ts'

// Commit mesajı standardı (docs/muhendislik/git-ve-surum.md §2) ve .githooks/commit-msg bağlantısı.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const sandbox = realpathSync(mkdtempSync(join(tmpdir(), 'kampus-commit-msg-')))
after(() => rmSync(sandbox, { recursive: true, force: true }))

const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'

function message(...paragraphs: string[]): string {
  return `${paragraphs.join('\n\n')}\n`
}

function errorsFor(raw: string): string {
  return checkCommitMessage(raw).join('\n')
}

describe('geçerli mesajlar', () => {
  test('ID başlıkta ya da gövdede geçen olağan commit geçer', () => {
    assert.deepEqual(checkCommitMessage(message('Veli etüt listesini daralt (OG-012)')), [])
    assert.deepEqual(
      checkCommitMessage(message('Veli etüt listesini daralt', 'Neden ve etki.\nON-007', TRAILER)),
      [],
    )
    assert.deepEqual(checkCommitMessage(message('Kayıt bildirimini ekle', 'İş isteği #11.')), [])
  })

  test('kod adıyla başlayan başlık ters tırnak ya da tire taşıyorsa küçük harf olabilir', () => {
    assert.deepEqual(checkCommitMessage(message('school-core paketini taşı (OG-008)')), [])
    assert.deepEqual(checkCommitMessage(message('`pnpm audit` açıklarını kapat (OG-014)')), [])
  })

  test('durum commit biçimleri geçer', () => {
    for (const subject of [
      'Görev durumunu güncelle: OG-012 çalışılıyor',
      'Görev durumunu güncelle: OG-006 bitti (migration 0023)',
      'Görev durumunu güncelle: OG-001, OG-002, OG-969 bitti',
      'Görev durumunu güncelle: OG-007 bitti, OG-970 ve OG-971 eklendi',
      'Görev durumunu güncelle: ON-014 engelli',
    ]) {
      assert.deepEqual(checkCommitMessage(message(subject, TRAILER)), [], subject)
    }
  })

  test('ID anan iş dalı merge mesajı, eşitleme merge, revert ve fixup geçer', () => {
    assert.deepEqual(
      checkCommitMessage(
        message("Merge branch 'oguzhan/ci-hizlandir' into feature/platform-gecisi", 'OG-012: CI.'),
      ),
      [],
    )
    for (const subject of [
      "Merge remote-tracking branch 'origin/feature/platform-gecisi' into oguzhan/ci-hizlandir",
      "Merge branch 'feature/platform-gecisi' into onur/tahsilat",
      "Merge branch 'feature/platform-gecisi' of github.com:ahmetonurevis/kampus",
      'Revert "Merge branch \'oguzhan/ci-hizlandir\' into feature/platform-gecisi"',
      'fixup! Veli etüt listesini daralt',
    ]) {
      assert.deepEqual(checkCommitMessage(message(subject)), [], subject)
    }
  })

  test('git yorum satırları ve makas çizgisinin altı denetlenmez', () => {
    const raw = [
      'Veli etüt listesini daralt (OG-012)',
      '',
      '# Please enter the commit message for your changes.',
      '# ------------------------ >8 ------------------------',
      'diff --git a/x b/x',
    ].join('\n')
    assert.equal(cleanMessage(raw), 'Veli etüt listesini daralt (OG-012)')
    assert.deepEqual(checkCommitMessage(raw), [])
  })
})

describe('reddedilen mesajlar', () => {
  test('boş mesaj', () => {
    assert.match(errorsFor('\n# yalnız yorum\n'), /Mesaj boş/)
  })

  test('72 karakteri aşan başlık', () => {
    const subject = `${'Uzun başlık '.repeat(7)}(OG-012)`
    assert.ok([...subject].length > 72)
    assert.match(errorsFor(message(subject)), /en fazla 72 karakter/)
    // Türkçe karakterler bayt değil karakter olarak sayılır.
    const turkish = `Ğ${'ğ'.repeat(60)} ş (OG-012)`
    assert.equal([...turkish].length, 72)
    assert.deepEqual(checkCommitMessage(message(turkish)), [])
  })

  test('noktayla biten, önekli, İngilizce ya da küçük harfle başlayan başlık', () => {
    assert.match(errorsFor(message('Veli listesini daralt (OG-012).')), /noktalama/)
    assert.match(errorsFor(message('feat: veli listesini daralt (OG-012)')), /önek/)
    assert.match(errorsFor(message('fix(api): kapsamı düzelt (OG-012)')), /önek/)
    assert.match(errorsFor(message('Add parent filter (OG-012)')), /Türkçe/)
    assert.match(errorsFor(message('veli listesini daralt (OG-012)')), /büyük harfle/)
  })

  test('tek kelimelik ya da belirsiz başlık', () => {
    assert.match(errorsFor(message('Düzelt', 'OG-012')), /belirsiz/)
    assert.match(errorsFor(message('wip', 'OG-012')), /belirsiz/)
  })

  test('başlıkla gövde arasında boş satır yok', () => {
    assert.match(errorsFor('Veli listesini daralt (OG-012)\nNeden.\n'), /boş satır/)
  })

  test("görev ID'si ya da iş isteği yok", () => {
    assert.match(errorsFor(message('Veli listesini daralt', 'Neden ve etki.')), /Görev ID/)
    // Üç haneli olmayan ID sayılmaz.
    assert.match(errorsFor(message('Veli listesini daralt OG-12')), /Görev ID/)
  })

  test('ID anmayan iş dalı merge mesajı', () => {
    assert.match(
      errorsFor(message("Merge branch 'oguzhan/ci-hizlandir' into feature/platform-gecisi")),
      /merge mesajı görev ID/,
    )
  })

  test("durum commit'i biçim dışı", () => {
    assert.match(errorsFor(message('Görev durumunu güncelle OG-012')), /Durum commit/)
    assert.match(errorsFor(message('Görev durumunu güncelle: OG-012 yapıldı')), /Durum commit/)
  })

  test('bozuk ortak yazar satırı', () => {
    assert.match(
      errorsFor(message('Veli listesini daralt (OG-012)', 'co-authored-by: Claude')),
      /Ortak yazar/,
    )
  })
})

describe('.githooks/commit-msg', () => {
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  }

  function git(cwd: string, ...args: string[]) {
    return spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  }

  test('geçersiz mesajla commit oluşmaz, geçerli mesajla oluşur', () => {
    const dir = join(sandbox, 'repo')
    mkdirSync(dir)
    assert.equal(git(dir, 'init', '--quiet', '--initial-branch=oguzhan/deneme').status, 0)
    // Hook, depo kökündeki .claude/hooks/commit-mesaji.ts'i çağırır: gerçek dosyaya bağlanır.
    mkdirSync(join(dir, '.claude'))
    assert.equal(
      spawnSync('ln', ['-s', join(root, '.claude', 'hooks'), join(dir, '.claude', 'hooks')]).status,
      0,
    )
    assert.equal(git(dir, 'config', 'core.hooksPath', join(root, '.githooks')).status, 0)
    writeFileSync(join(dir, 'a.txt'), 'a\n')
    assert.equal(git(dir, 'add', 'a.txt').status, 0)

    const rejected = git(dir, 'commit', '--quiet', '-m', 'feat: add file')
    assert.notEqual(rejected.status, 0)
    assert.match(rejected.stderr, /Commit mesajı standarda uymuyor \(oguzhan\/deneme\)/)
    assert.notEqual(git(dir, 'rev-parse', '--verify', '--quiet', 'HEAD').status, 0)

    const accepted = git(dir, 'commit', '--quiet', '-m', 'Örnek dosyayı ekle (OG-972)')
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.equal(git(dir, 'log', '--format=%s').stdout.trim(), 'Örnek dosyayı ekle (OG-972)')
  })
})
