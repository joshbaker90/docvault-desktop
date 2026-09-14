const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')

function auth(user, password) {
  return 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')
}

function parseUrl(cfg, remotePath) {
  const base = cfg.hetznerHost.replace(/\/$/, '')
  const encoded = remotePath.split('/').map(s => encodeURIComponent(s)).join('/')
  return new URL(base + encoded)
}

function request(cfg, method, remotePath, headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const url = parseUrl(cfg, remotePath)
    const opts = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers:  { Authorization: auth(cfg.hetznerUser, cfg.hetznerPassword), ...headers }
    }
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(opts, resolve)
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

async function downloadText(cfg, remotePath) {
  try {
    const res = await request(cfg, 'GET', remotePath)
    if (res.statusCode === 404) return null
    return new Promise((resolve, reject) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
      res.on('error', reject)
    })
  } catch (_) { return null }
}

async function uploadText(cfg, remotePath, text) {
  try {
    const buf = Buffer.from(text, 'utf8')
    const res = await request(cfg, 'PUT', remotePath, {
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': buf.length
    }, buf)
    await drainResponse(res)
    return res.statusCode >= 200 && res.statusCode < 300
  } catch (_) { return false }
}

async function downloadFile(cfg, remotePath, localPath) {
  try {
    fs.mkdirSync(path.dirname(localPath), { recursive: true })
    const res = await request(cfg, 'GET', remotePath)
    if (res.statusCode !== 200) { await drainResponse(res); return false }
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(localPath)
      res.pipe(out)
      out.on('finish', () => resolve(true))
      out.on('error', reject)
      res.on('error', reject)
    })
  } catch (_) { return false }
}

async function uploadFile(cfg, remotePath, localPath) {
  try {
    const buf = fs.readFileSync(localPath)
    const res = await request(cfg, 'PUT', remotePath, {
      'Content-Type':   'application/octet-stream',
      'Content-Length': buf.length
    }, buf)
    await drainResponse(res)
    return res.statusCode >= 200 && res.statusCode < 300
  } catch (_) { return false }
}

async function deleteFile(cfg, remotePath) {
  try {
    const res = await request(cfg, 'DELETE', remotePath)
    await drainResponse(res)
    return res.statusCode >= 200 && res.statusCode < 300
  } catch (_) { return false }
}

async function mkdirRemote(cfg, remotePath) {
  try {
    const res = await request(cfg, 'MKCOL', remotePath)
    await drainResponse(res)
    return true
  } catch (_) { return false }
}

async function listDirectory(cfg, remotePath) {
  try {
    const body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'
    const buf = Buffer.from(body, 'utf8')
    const res = await request(cfg, 'PROPFIND', remotePath, {
      Depth:            '1',
      'Content-Type':   'application/xml',
      'Content-Length': buf.length
    }, buf)
    const xml = await readResponse(res)
    if (res.statusCode !== 207) return []
    return parsePropfind(xml, remotePath)
  } catch (_) { return [] }
}

async function listLogDevices(cfg, basePath) {
  const entries = await listDirectory(cfg, basePath + '/')
  return entries
    .filter(e => !e.isDir && e.name.startsWith('.journal-') && e.name.endsWith('.jsonl'))
    .map(e => e.name.replace('.journal-', '').replace('.jsonl', ''))
}

async function downloadLog(cfg, basePath, device) {
  const text = await downloadText(cfg, `${basePath}/.journal-${device}.jsonl`)
  if (!text) return []
  return text.split('\n').filter(l => l.trim())
}

async function appendToLog(cfg, basePath, device, lines) {
  const logPath = `${basePath}/.journal-${device}.jsonl`
  const existing = await downloadText(cfg, logPath) || ''
  const newContent = existing + lines.map(l => JSON.stringify(l)).join('\n') + '\n'
  return uploadText(cfg, logPath, newContent)
}

function parsePropfind(xml, requestPath) {
  const hrefRegex = /<[Dd]:href>([^<]+)<\/[Dd]:href>/g
  const collectionRegex = /<[Dd]:collection\s*\/?>/
  const sizeRegex = /<[Dd]:getcontentlength>(\d+)<\/[Dd]:getcontentlength>/

  const results = []
  const responseBlocks = xml.split(/<\/?[Dd]:response>/g).filter(b => b.includes('href'))

  const normalised = decodeURIComponent(requestPath.trimEnd('/'))

  for (const block of responseBlocks) {
    const hrefMatch = block.match(/<[Dd]:href>([^<]+)<\/[Dd]:href>/)
    if (!hrefMatch) continue
    const href = decodeURIComponent(hrefMatch[1].trim())
    if (href.trimEnd('/') === normalised) continue
    const isDir = collectionRegex.test(block)
    const sizeMatch = block.match(/<[Dd]:getcontentlength>(\d+)<\/[Dd]:getcontentlength>/)
    const size = sizeMatch ? parseInt(sizeMatch[1]) : 0
    const name = href.trimEnd('/').split('/').pop()
    if (name) results.push({ name, isDir, size, href })
  }
  return results
}

function readResponse(res) {
  return new Promise((resolve, reject) => {
    let data = ''
    res.on('data', c => data += c)
    res.on('end', () => resolve(data))
    res.on('error', reject)
  })
}

function drainResponse(res) {
  return new Promise(resolve => {
    res.resume()
    res.on('end', resolve)
    res.on('error', resolve)
  })
}

module.exports = { downloadText, uploadText, downloadFile, uploadFile, deleteFile, mkdirRemote, listDirectory, listLogDevices, downloadLog, appendToLog }
