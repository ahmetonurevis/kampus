import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { e2e } from './env.ts'

/** Alt sürece yalnız gerekli ortam geçilir: geliştiricinin kabuğundaki değerler sızmaz. */
export function cleanEnv(extra: Record<string, string>): Record<string, string> {
  const base: Record<string, string> = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'TZ']) {
    const value = process.env[key]
    if (value) base[key] = value
  }
  return { ...base, ...extra }
}

function logPath(name: string): string {
  mkdirSync(e2e.paths.artifacts, { recursive: true })
  return join(e2e.paths.artifacts, `${name}.log`)
}

function tail(name: string): string {
  try {
    return readFileSync(logPath(name), 'utf8').split('\n').slice(-25).join('\n')
  } catch {
    return '(günlük yok)'
  }
}

interface Options {
  cwd: string
  env: Record<string, string>
}

/** Bitmesini bekleyerek çalıştırır (migrate, seed, build); çıktı günlük dosyasına gider. */
export async function run(name: string, args: string[], options: Options): Promise<void> {
  const fd = openSync(logPath(name), 'w')
  try {
    const child = spawn(process.execPath, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', fd, fd],
    })
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', resolve)
    })
    if (code !== 0) throw new Error(`${name} başarısız (çıkış ${code}):\n${tail(name)}`)
  } finally {
    closeSync(fd)
  }
}

export interface Service {
  name: string
  stop: () => Promise<void>
}

/** Arka plan sunucusu başlatır; `readyUrl` 200 dönene kadar bekler. */
export async function startService(
  name: string,
  args: string[],
  options: Options & { readyUrl: string; timeoutMs?: number },
): Promise<Service> {
  const fd = openSync(logPath(name), 'w')
  const child: ChildProcess = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
  let exited = false
  child.once('exit', () => {
    exited = true
  })
  const service: Service = {
    name,
    stop: async () => {
      if (exited) return
      const done = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      child.kill('SIGTERM')
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
      await done
      clearTimeout(timer)
    },
  }
  const deadline = Date.now() + (options.timeoutMs ?? 60_000)
  while (Date.now() < deadline) {
    if (exited) throw new Error(`${name} beklenmedik şekilde kapandı:\n${tail(name)}`)
    try {
      const response = await fetch(options.readyUrl)
      if (response.ok) return service
    } catch {
      // Sunucu henüz dinlemiyor.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  await service.stop()
  throw new Error(`${name} ${options.readyUrl} adresinde hazır olmadı:\n${tail(name)}`)
}
