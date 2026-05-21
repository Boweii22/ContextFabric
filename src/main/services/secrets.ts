import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

type SecretFile = Record<string, string>

export class SecretStore {
  private filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), 'secure-secrets.json')
  }

  isBackedByOS(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  get(key: string): string | null {
    const data = this.read()
    const encrypted = data[key]
    if (!encrypted) return null
    try {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    } catch {
      return null
    }
  }

  set(key: string, value: string): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS secure storage is not available on this device')
    }
    const data = this.read()
    data[key] = safeStorage.encryptString(value).toString('base64')
    this.write(data)
  }

  delete(key: string): void {
    const data = this.read()
    if (!(key in data)) return
    delete data[key]
    this.write(data)
  }

  private read(): SecretFile {
    if (!existsSync(this.filePath)) return {}
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as SecretFile
    } catch {
      return {}
    }
  }

  private write(data: SecretFile): void {
    const dir = dirname(this.filePath)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 })
  }
}
