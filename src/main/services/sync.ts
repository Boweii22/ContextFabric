import express from 'express'
import type { Server } from 'http'
import { networkInterfaces } from 'os'
import type { DatabaseService } from './database'
import type { CRSQLiteChange, CRSQLiteStatus, SyncRunResult } from '../../shared/types'

interface HandshakeResponse {
  siteId: string
  dbVersion: number
  knownVersionForCaller: number
}

interface ChangesResponse {
  siteId: string
  dbVersion: number
  changes: CRSQLiteChange[]
}

export class SyncService {
  private server: Server | null = null

  constructor(
    private db: DatabaseService,
    private port = 47822
  ) {}

  start(): void {
    if (this.server) return

    const app = express()
    app.use(express.json({ limit: '50mb' }))

    app.use((req, res, next) => {
      const expected = this.db.getOrCreateSyncKey()
      const received = req.headers['x-contextfabric-sync-key']
      if (received !== expected) {
        res.status(401).json({ error: 'Invalid sync key' })
        return
      }
      next()
    })

    app.get('/health', (_req, res) => {
      res.json({ ok: true, name: 'ContextFabric Sync', status: this.status() })
    })

    app.get('/handshake', (req, res) => {
      const callerSiteId = String(req.headers['x-contextfabric-site-id'] || '')
      res.json({
        siteId: this.status().siteId,
        dbVersion: this.db.getCRSQLDbVersion(),
        knownVersionForCaller: callerSiteId ? this.db.getPeerReceivedVersion(callerSiteId) : -1,
      })
    })

    app.get('/changes', (req, res) => {
      const since = Number(req.query['since'] ?? -1)
      res.json({
        siteId: this.status().siteId,
        dbVersion: this.db.getCRSQLDbVersion(),
        changes: this.db.getCRSQLChanges(Number.isFinite(since) ? since : -1),
      })
    })

    app.post('/apply', (req, res) => {
      const callerSiteId = String(req.headers['x-contextfabric-site-id'] || req.body?.siteId || '')
      if (!callerSiteId) {
        res.status(400).json({ error: 'Missing peer site id' })
        return
      }
      const changes = Array.isArray(req.body?.changes) ? req.body.changes as CRSQLiteChange[] : []
      const result = this.db.applyCRSQLChanges(changes, callerSiteId, req.body?.peerUrl)
      res.json({ ok: true, ...result, dbVersion: this.db.getCRSQLDbVersion() })
    })

    this.server = app.listen(this.port, '0.0.0.0', () => {
      console.log(`[Sync] ContextFabric LAN sync server running on port ${this.port}`)
    })
  }

  stop(): void {
    this.server?.close()
    this.server = null
  }

  status(): CRSQLiteStatus {
    return this.db.getCRSQLiteStatus(this.port, this.getLanUrls())
  }

  async run(peerUrl: string, peerKey: string): Promise<SyncRunResult> {
    const normalizedPeerUrl = this.normalizePeerUrl(peerUrl)
    if (/^[a-f0-9]{64}$/i.test(peerKey)) {
      this.db.rotateGraphEncryptionKey(peerKey)
    }
    const localStatus = this.status()
    const headers = {
      'Content-Type': 'application/json',
      'X-ContextFabric-Sync-Key': peerKey,
      'X-ContextFabric-Site-Id': localStatus.siteId,
    }

    const handshake = await this.fetchJson<HandshakeResponse>(`${normalizedPeerUrl}/handshake`, { headers })
    const knownRemoteVersion = this.db.getPeerReceivedVersion(handshake.siteId)
    const remoteChanges = await this.fetchJson<ChangesResponse>(
      `${normalizedPeerUrl}/changes?since=${knownRemoteVersion}`,
      { headers }
    )

    const pulled = this.db.applyCRSQLChanges(remoteChanges.changes, handshake.siteId, normalizedPeerUrl)
    const localChanges = this.db.getCRSQLChanges(handshake.knownVersionForCaller)
    await this.fetchJson(`${normalizedPeerUrl}/apply`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        siteId: localStatus.siteId,
        peerUrl: localStatus.lanUrls[0],
        changes: localChanges,
      }),
    })

    const sentMax = localChanges.reduce((max, change) => Math.max(max, change.dbVersion), handshake.knownVersionForCaller)
    this.db.recordPeerSent(handshake.siteId, normalizedPeerUrl, sentMax)

    return {
      ok: true,
      peerUrl: normalizedPeerUrl,
      peerSiteId: handshake.siteId,
      pulled: pulled.applied,
      pushed: localChanges.length,
      localDbVersion: this.db.getCRSQLDbVersion(),
      remoteDbVersion: handshake.dbVersion,
      message: `Pulled ${pulled.applied} change(s), pushed ${localChanges.length} change(s).`,
    }
  }

  private normalizePeerUrl(peerUrl: string): string {
    const withProtocol = peerUrl.startsWith('http://') || peerUrl.startsWith('https://')
      ? peerUrl
      : `http://${peerUrl}`
    return withProtocol.replace(/\/$/, '')
  }

  private async fetchJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init)
    const text = await response.text()
    const body = text ? JSON.parse(text) : {}
    if (!response.ok) throw new Error(body?.error || `Sync request failed: ${response.status}`)
    return body as T
  }

  private getLanUrls(): string[] {
    const urls: string[] = []
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) {
          urls.push(`http://${address.address}:${this.port}`)
        }
      }
    }
    return urls
  }
}
