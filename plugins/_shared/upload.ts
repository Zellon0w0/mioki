import crypto from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import axios from 'axios'

export interface R2Config {
  enabled: boolean
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  customDomain: string
  pathPrefix: string
}

let cachedClient: S3Client | null = null
let cachedConfigKey = ''

function getR2ClientAndConfig(config?: Partial<R2Config>): { client: S3Client; config: R2Config } | null {
  if (!config || !config.enabled) {
    return null
  }

  if (!config.accountId || !config.accessKeyId || !config.secretAccessKey || !config.bucketName) {
    return null
  }

  const merged: R2Config = {
    enabled: true,
    accountId: config.accountId,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucketName: config.bucketName,
    customDomain: config.customDomain || '',
    pathPrefix: config.pathPrefix || '',
  }

  const configKey = `${merged.accountId}:${merged.accessKeyId}:${merged.secretAccessKey}`
  if (!cachedClient || cachedConfigKey !== configKey) {
    cachedClient = new S3Client({
      region: 'auto',
      endpoint: `https://${merged.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: merged.accessKeyId,
        secretAccessKey: merged.secretAccessKey,
      },
    })
    cachedConfigKey = configKey
  }

  return { client: cachedClient, config: merged }
}

/**
 * 上传 Buffer 到 Cloudflare R2
 * @param buffer 二进制数据
 * @param key 存储键名（相对于 pathPrefix 的相对路径，或包含 pathPrefix 的路径）
 * @param contentType 内容类型
 * @param customConfig 局部覆盖配置
 */
export async function uploadBuffer(
  buffer: Buffer,
  key: string,
  contentType: string = 'application/octet-stream',
  customConfig?: Partial<R2Config>
): Promise<string> {
  const r2 = getR2ClientAndConfig(customConfig)
  if (!r2) {
    throw new Error('Cloudflare R2 存储未启用或配置不完整')
  }

  const { client, config } = r2

  // 拼接路径前缀。如果 key 已经包含了前缀，则不再重复拼接
  const prefix = config.pathPrefix ? config.pathPrefix.replace(/\/$/, '') + '/' : ''
  const finalKey = key.startsWith(prefix) ? key : `${prefix}${key}`

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucketName,
      Key: finalKey,
      Body: buffer,
      ContentType: contentType,
    })
  )

  const domain = config.customDomain
    ? config.customDomain.replace(/\/$/, '')
    : `https://${config.bucketName}.${config.accountId}.r2.cloudflarestorage.com`
  return `${domain}/${finalKey}`
}

/**
 * 自动转存远程 URL 到 Cloudflare R2
 * @param url 待转存的直链 URL
 * @param type 文件类别 ('image' | 'video' | 'record')
 * @param customConfig 局部覆盖配置
 * @returns R2 的 CDN 访问直链。若未启用 R2，则原样返回输入 URL。
 */
export async function uploadUrl(
  url: string,
  type: 'image' | 'video' | 'record',
  customConfig?: Partial<R2Config>
): Promise<string> {
  const r2 = getR2ClientAndConfig(customConfig)
  if (!r2) {
    return url
  }

  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' })
    const buffer = Buffer.from(response.data)

    let ext = 'bin'
    const contentType = response.headers['content-type'] || ''
    if (type === 'image') {
      if (contentType.includes('png')) ext = 'png'
      else if (contentType.includes('gif')) ext = 'gif'
      else if (contentType.includes('webp')) ext = 'webp'
      else ext = 'jpg'
    } else if (type === 'video') {
      ext = 'mp4'
    } else if (type === 'record') {
      ext = 'amr'
    }

    const fileHash = crypto.createHash('md5').update(buffer).digest('hex')
    const key = `${type}s/${fileHash}.${ext}`

    return await uploadBuffer(buffer, key, contentType || 'application/octet-stream', customConfig)
  } catch (err: any) {
    throw new Error(`上传 URL 到 R2 失败: ${err.message}`)
  }
}
