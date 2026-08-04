// 最小 ZIP 读写——xlsx 就是一个装着 XML 的 ZIP。
//
// 为什么自己写：decision:zero-deps。引 SDK 会让这个仓库从「一份可独立核对的参考实现」
// 变成「一份要先装 node_modules 才能读的东西」。ZIP 的中央目录格式是公开的，
// 解压用 Node 自带的 zlib，全部加起来不到一百行——比一条依赖便宜。
//
// 只实现两种存储方式：0（stored，不压缩）与 8（deflate）。
// xlsx 实际只会用这两种；遇到别的（如 bzip2、LZMA）如实报错，不猜。

import { inflateRawSync, deflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const CD_SIG = 0x02014b50

/** CRC-32（ZIP 用的那个多项式 0xEDB88320）。写 ZIP 时必须算对，否则 Excel 拒绝打开。 */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c
  }
  return t
})()

export function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/**
 * 读一个 ZIP，返回 Map<路径, Buffer>。
 *
 * 从尾部找中央目录结束记录（EOCD）而不是从头顺序扫本地头——因为顺序扫遇到
 * 数据描述符（flag bit 3，压缩流写完才回填大小）就没法知道数据到哪结束。
 * 中央目录里的大小永远是准的，这是 ZIP 唯一可靠的索引。
 */
export function unzip(buf) {
  let eocd = -1
  // EOCD 尾部可带最多 64KB 注释，从后往前找签名
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP：找不到中央目录结束记录（EOCD）')

  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out = new Map()

  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== CD_SIG) throw new Error(`中央目录第 ${n} 项签名不对，文件可能损坏`)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const cmtLen = buf.readUInt16LE(p + 32)
    const localAt = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)

    // 本地头的 extra 长度可能与中央目录不同（对齐填充），必须以本地头为准
    const lNameLen = buf.readUInt16LE(localAt + 26)
    const lExtraLen = buf.readUInt16LE(localAt + 28)
    const dataAt = localAt + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataAt, dataAt + compSize)

    if (method === 0) out.set(name, Buffer.from(raw))
    else if (method === 8) out.set(name, inflateRawSync(raw))
    else throw new Error(`条目 ${name} 用了不支持的压缩方式 ${method}（只支持 0 stored / 8 deflate）`)

    p += 46 + nameLen + extraLen + cmtLen
  }
  return out
}

/**
 * 写一个 ZIP。entries 为 Map<路径, string|Buffer>。
 *
 * 只在压缩确实变小时才用 deflate，否则 stored——省得为几百字节的 XML
 * 付一次压缩开销，也让生成的夹具更容易被人用十六进制看懂。
 */
export function zip(entries) {
  const files = []
  const chunks = []
  let offset = 0

  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8')
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(data)
    const useDeflate = deflated.length < data.length
    const payload = useDeflate ? deflated : data
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)            // version needed
    local.writeUInt16LE(0, 6)             // flags：不用数据描述符，大小直接写死
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)            // 时间：固定为 0，让同一份输入产出同一个字节流
    local.writeUInt16LE(0x21, 12)         // 日期：1980-01-01，同上，可复现比「真实时间」重要
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    chunks.push(local, nameBuf, payload)
    files.push({ nameBuf, method, crc: crc32(data), comp: payload.length, size: data.length, offset })
    offset += local.length + nameBuf.length + payload.length
  }

  const cdStart = offset
  for (const f of files) {
    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(CD_SIG, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt16LE(0, 8)
    cd.writeUInt16LE(f.method, 10)
    cd.writeUInt16LE(0, 12)
    cd.writeUInt16LE(0x21, 14)
    cd.writeUInt32LE(f.crc, 16)
    cd.writeUInt32LE(f.comp, 20)
    cd.writeUInt32LE(f.size, 24)
    cd.writeUInt16LE(f.nameBuf.length, 28)
    cd.writeUInt16LE(0, 30)
    cd.writeUInt16LE(0, 32)
    cd.writeUInt16LE(0, 34)
    cd.writeUInt16LE(0, 36)
    cd.writeUInt32LE(0, 38)
    cd.writeUInt32LE(f.offset, 42)
    chunks.push(cd, f.nameBuf)
    offset += 46 + f.nameBuf.length
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(EOCD_SIG, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(offset - cdStart, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  chunks.push(eocd)

  return Buffer.concat(chunks)
}
