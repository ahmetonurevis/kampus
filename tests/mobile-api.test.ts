import test, { describe } from 'node:test'
import assert from 'node:assert/strict'
import { ApiError, networkApiError } from '../packages/api-client/src/errors.ts'
import {
  cacheActionFor,
  clearInstitutionCache,
  createKampusQueryClient,
} from '../packages/react-shared/src/query-client.ts'
import { institutionKey, ME_QUERY_KEY } from '../packages/react-shared/src/query-keys.ts'
import { parseApiUrl, resolveAppMode } from '../apps/mobile/src/api/config.ts'
import {
  apiAuthState,
  institutionChoices,
  isModuleOpen,
  nativeAuthHeaders,
  resolveChild,
  sessionExpired,
  sessionScopeKey,
  toMobileSession,
  type Me,
} from '../apps/mobile/src/api/session-state.ts'
import { API_THEME_KEY, parseStoredTheme } from '../apps/mobile/src/api/stored-theme.ts'

// Test kimlikleri önekli; gerçek kişi verisi yok.
function me(overrides: Partial<Me> = {}): Me {
  return {
    user: { id: 'test-user-1', name: 'Test Veli', email: 'test-veli@ornek.test' },
    activeInstitution: {
      id: 'test-inst-a',
      name: 'Test Okulu A',
      slug: 'test-okulu-a',
      type: 'school',
      enabledModules: { academic: true, finance: false },
      academicYear: 2026,
    },
    activeMembership: {
      id: 'test-mem-a',
      role: 'veli',
      links: [
        { kind: 'child', recordId: 'test-s1' },
        { kind: 'child', recordId: 'test-s2' },
      ],
    },
    memberships: [
      {
        id: 'test-mem-a',
        institutionId: 'test-inst-a',
        institutionName: 'Zeytin Koleji',
        institutionType: 'school',
        role: 'veli',
      },
      {
        id: 'test-mem-b',
        institutionId: 'test-inst-b',
        institutionName: 'Çınar Dil Akademisi',
        institutionType: 'language_school',
        role: 'ogretmen',
      },
    ],
    ...overrides,
  }
}

describe('uygulama modu', () => {
  test('adres yoksa veya boşsa çevrimdışı demo açılır', () => {
    assert.deepEqual(resolveAppMode(undefined), { kind: 'demo' })
    assert.deepEqual(resolveAppMode(''), { kind: 'demo' })
    assert.deepEqual(resolveAppMode('   '), { kind: 'demo' })
  })

  test('geçerli adres API modunu açar; sondaki eğik çizgi ve boşluk atılır', () => {
    assert.deepEqual(resolveAppMode('https://api.ornek.test/'), {
      kind: 'api',
      url: 'https://api.ornek.test',
    })
    assert.deepEqual(resolveAppMode(' http://127.0.0.1:3080 ', true), {
      kind: 'api',
      url: 'http://127.0.0.1:3080',
    })
    assert.equal(parseApiUrl('http://[::1]:3080/kampus//', true), 'http://[::1]:3080/kampus')
  })

  test('geçersiz adres demoyu sessizce açmaz, yapılandırma hatası verir', () => {
    for (const raw of [
      'api.ornek.test',
      'ftp://api.ornek.test',
      'https://kullanici:parola@api.ornek.test',
      'https://api.ornek.test/?x=1',
      'https://api.ornek.test/#parca',
      'http://127.0.0.1:0',
      'http://127.0.0.1:70000',
      'https://api ornek.test',
    ]) {
      for (const dev of [false, true]) {
        assert.deepEqual(resolveAppMode(raw, dev), { kind: 'invalid' }, raw)
        assert.equal(parseApiUrl(raw, dev), null, raw)
      }
    }
  })

  test('üretimde http geçersiz, https geçerlidir', () => {
    for (const raw of ['http://127.0.0.1:3080', 'http://10.0.2.2:3080', 'HTTP://api.ornek.test']) {
      assert.deepEqual(resolveAppMode(raw, false), { kind: 'invalid' }, raw)
      assert.equal(parseApiUrl(raw, false), null, raw)
    }
    assert.deepEqual(resolveAppMode('https://api.ornek.test', false), {
      kind: 'api',
      url: 'https://api.ornek.test',
    })
  })

  test('geliştirmede yerel ve LAN http adresleri geçerlidir', () => {
    for (const raw of [
      'http://127.0.0.1:3080',
      'http://10.0.2.2:3080',
      'http://192.168.1.20:3080',
    ]) {
      assert.deepEqual(resolveAppMode(raw, true), { kind: 'api', url: raw }, raw)
    }
  })

  test('bayrak verilmezse (birim ortamında __DEV__ yok) üretim sayılır', () => {
    assert.deepEqual(resolveAppMode('http://127.0.0.1:3080'), { kind: 'invalid' })
  })
})

describe('oturum durumu', () => {
  test('/me etkin üyelikten mobil oturum üretir; veli çocukları bağlantılardan gelir', () => {
    const session = toMobileSession(me())
    assert.ok(session)
    assert.equal(session.role, 'veli')
    assert.equal(session.membershipId, 'test-mem-a')
    assert.deepEqual(session.institution, {
      id: 'test-inst-a',
      name: 'Test Okulu A',
      type: 'school',
    })
    assert.deepEqual(session.childIds, ['test-s1', 'test-s2'])
    assert.deepEqual(session.modules, { academic: true, finance: false })
  })

  test('veli dışındaki rolde çocuk listesi boştur', () => {
    const session = toMobileSession(
      me({
        activeMembership: {
          id: 'test-mem-t',
          role: 'ogretmen',
          links: [{ kind: 'teacher', recordId: 'test-t1' }],
        },
      }),
    )
    assert.deepEqual(session?.childIds, [])
  })

  test('etkin kurum veya üyelik yoksa oturum üretilmez', () => {
    assert.equal(toMobileSession(me({ activeInstitution: null })), null)
    assert.equal(toMobileSession(me({ activeMembership: null })), null)
  })

  test('Better Auth ve /me durumları uygulama durumuna eşlenir', () => {
    const none = { data: undefined, error: null }
    assert.deepEqual(apiAuthState('loading', none), { status: 'loading' })
    assert.deepEqual(apiAuthState('unauthenticated', none), { status: 'signed-out' })
    assert.deepEqual(apiAuthState('authenticated', none), { status: 'loading' })
    const signedIn = apiAuthState('authenticated', { data: me(), error: null })
    assert.equal(signedIn.status, 'signed-in')
    assert.deepEqual(
      apiAuthState('authenticated', { data: me({ activeMembership: null }), error: null }),
      { status: 'no-membership' },
    )
  })

  test('/me 401 verirse oturum kapanmış sayılır', () => {
    const expired = new ApiError({ status: 401, code: 'unauthenticated', message: 'Oturum yok.' })
    assert.deepEqual(apiAuthState('authenticated', { data: me(), error: expired }), {
      status: 'signed-out',
    })
  })

  test('/me okunamazsa Türkçe mesaj gösterilir, teknik ayrıntı gösterilmez', () => {
    const network = apiAuthState('authenticated', { data: undefined, error: networkApiError('x') })
    assert.deepEqual(network, {
      status: 'error',
      message: 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edip yeniden deneyin.',
    })
    const unknown = apiAuthState('authenticated', {
      data: undefined,
      error: new TypeError('fetch failed at 10.0.0.1'),
    })
    assert.deepEqual(unknown, {
      status: 'error',
      message: 'Hesap bilgileri alınamadı. Lütfen tekrar deneyin.',
    })
  })
})

describe('oturum süresi dolumu', () => {
  test('açık oturum kullanıcı çıkmadan kapanınca süre doldu bildirilir', () => {
    assert.equal(sessionExpired('signed-in', 'signed-out', false), true)
  })

  test('kullanıcının kendi çıkışı süre dolumu sayılmaz', () => {
    assert.equal(sessionExpired('signed-in', 'signed-out', true), false)
  })

  test('ilk açılışta oturum yoksa veya başka geçişlerde bildirim yok', () => {
    assert.equal(sessionExpired(null, 'signed-out', false), false)
    assert.equal(sessionExpired('signed-out', 'signed-out', false), false)
    assert.equal(sessionExpired('signed-in', 'signed-in', false), false)
    assert.equal(sessionExpired('signed-in', 'error', false), false)
    assert.equal(sessionExpired('error', 'signed-out', false), false)
  })
})

describe('kapsam yardımcıları', () => {
  test('seçili çocuk hâlâ hesabın çocuğuysa korunur, değilse ilk çocuk seçilir', () => {
    assert.equal(resolveChild(['test-s1', 'test-s2'], 'test-s2'), 'test-s2')
    assert.equal(resolveChild(['test-s1', 'test-s2'], 'test-baska'), 'test-s1')
    assert.equal(resolveChild(['test-s1'], null), 'test-s1')
    assert.equal(resolveChild([], 'test-s1'), '')
  })

  test('kapalı modül kapalıdır; modülsüz veya listede olmayan sayfa açıktır', () => {
    const modules = { academic: true, finance: false }
    assert.equal(isModuleOpen(modules, 'academic'), true)
    assert.equal(isModuleOpen(modules, 'finance'), false)
    assert.equal(isModuleOpen(modules, null), true)
    assert.equal(isModuleOpen(modules, 'yeni-modul'), true)
  })

  test('yerel istemci güvenli depodaki çerezi başlıkla gönderir; boşsa başlık yok', () => {
    assert.deepEqual(nativeAuthHeaders('kampus.session_token=abc'), {
      cookie: 'kampus.session_token=abc',
    })
    assert.deepEqual(nativeAuthHeaders(''), {})
  })

  test('kurum seçici Türkçe ad sırasıyla gelir ve etkin kurumu işaretler', () => {
    const session = toMobileSession(me())
    assert.ok(session)
    const choices = institutionChoices(session)
    assert.deepEqual(
      choices.map((choice) => [choice.institutionName, choice.active]),
      [
        ['Çınar Dil Akademisi', false],
        ['Zeytin Koleji', true],
      ],
    )
  })
})

describe('kurum değişimi', () => {
  test('kurum veya rol değişince kapsam anahtarı değişir (yığın ve görünüm belleği sıfırlanır)', () => {
    const session = toMobileSession(me())
    assert.ok(session)
    const other = { ...session, institution: { ...session.institution, id: 'test-inst-b' } }
    assert.notEqual(sessionScopeKey(session), sessionScopeKey(other))
    assert.notEqual(sessionScopeKey(session), sessionScopeKey({ ...session, role: 'ogretmen' }))
    assert.equal(sessionScopeKey(session), sessionScopeKey({ ...session }))
  })

  test('kurum değişince eski kurumun sorguları silinir, oturum sorgusu korunur', async () => {
    const queryClient = createKampusQueryClient()
    queryClient.setQueryData(institutionKey('test-inst-a', 'grades', { page: 1 }), ['not'])
    queryClient.setQueryData(institutionKey('test-inst-a', 'students'), ['ogrenci'])
    queryClient.setQueryData(ME_QUERY_KEY, me())
    const action = cacheActionFor(
      { authenticated: true, institutionId: 'test-inst-a' },
      { authenticated: true, institutionId: 'test-inst-b' },
    )
    assert.equal(action, 'clear-institution')
    await clearInstitutionCache(queryClient)
    assert.equal(queryClient.getQueryData(institutionKey('test-inst-a', 'students')), undefined)
    assert.equal(
      queryClient.getQueryData(institutionKey('test-inst-a', 'grades', { page: 1 })),
      undefined,
    )
    assert.ok(queryClient.getQueryData(ME_QUERY_KEY))
    queryClient.clear()
  })

  test('oturum kapanınca önbelleğin tamamı silinir', () => {
    assert.equal(
      cacheActionFor(
        { authenticated: true, institutionId: 'test-inst-a' },
        { authenticated: false, institutionId: null },
      ),
      'clear-all',
    )
  })
})

describe('saklanan tema', () => {
  test('yalnız tema anahtarı saklanır; bozuk değer açık temaya döner', () => {
    assert.equal(API_THEME_KEY, 'kampus-mobile-api-theme-v1')
    assert.equal(parseStoredTheme('dark'), 'dark')
    assert.equal(parseStoredTheme('system'), 'system')
    assert.equal(parseStoredTheme('light'), 'light')
    assert.equal(parseStoredTheme(null), 'light')
    assert.equal(parseStoredTheme('{"token":"x"}'), 'light')
  })
})
