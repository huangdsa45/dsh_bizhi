// Minimal asar reader: list or extract files from an Electron asar archive.
// usage: node asar.mjs list <archive> [substrFilter]
//        node asar.mjs cat  <archive> <internalPath>
//        node asar.mjs dump <archive> <internalPrefix> <outDir>
import fs from 'node:fs'
import path from 'node:path'

const [cmd, archivePath, ...rest] = process.argv.slice(2)
if (!cmd || !archivePath) {
  console.error('usage: node asar.mjs <list|cat|dump> <archive> [...]')
  process.exit(2)
}

const fd = fs.openSync(archivePath, 'r')
const head = Buffer.alloc(16)
fs.readSync(fd, head, 0, 16, 0)
const headerSize = head.readUInt32LE(4)
const headerBuf = Buffer.alloc(headerSize)
fs.readSync(fd, headerBuf, 0, headerSize, 8)
const jsonSize = headerBuf.readUInt32LE(4)
const json = JSON.parse(headerBuf.subarray(8, 8 + jsonSize).toString('utf8'))
const baseOffset = 8 + headerSize

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files ?? {})) {
    const p = prefix ? `${prefix}/${name}` : name
    if (entry.files) walk(entry, p, out)
    else out.push({ path: p, size: entry.size ?? 0, offset: entry.offset ? Number(entry.offset) : null, unpacked: !!entry.unpacked })
  }
  return out
}

function readFile(internal) {
  const parts = internal.split('/').filter(Boolean)
  let node = json
  for (const part of parts) {
    node = node.files?.[part]
    if (!node) throw new Error(`not found: ${internal}`)
  }
  if (node.files) throw new Error(`is a directory: ${internal}`)
  if (node.unpacked) {
    const unpackedPath = path.join(archivePath + '.unpacked', ...parts)
    return fs.readFileSync(unpackedPath)
  }
  const buf = Buffer.alloc(node.size)
  fs.readSync(fd, buf, 0, node.size, baseOffset + Number(node.offset))
  return buf
}

if (cmd === 'list') {
  const filter = rest[0]
  const all = walk(json, '', [])
  for (const f of all) if (!filter || f.path.includes(filter)) console.log(f.size.toString().padStart(9), f.path)
} else if (cmd === 'cat') {
  process.stdout.write(readFile(rest[0]))
} else if (cmd === 'dump') {
  const [prefix, outDir] = rest
  const all = walk(json, '', []).filter((f) => f.path.startsWith(prefix))
  for (const f of all) {
    const dest = path.join(outDir, ...f.path.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, readFile(f.path))
  }
  console.log(`dumped ${all.length} files to ${outDir}`)
}
