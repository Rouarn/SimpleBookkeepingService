import {
  validateEnv,
  readInt,
  readList,
  readString,
} from './env.validation.js';

/**
 * 强类型配置树。所有模块只允许通过 ConfigService 读取配置，
 * 禁止在业务代码中硬编码密钥、内网地址、绝对存储路径（05 §7）。
 */
export interface AppConfig {
  app: {
    nodeEnv: 'development' | 'production' | 'test';
    isProduction: boolean;
    port: number;
    corsOrigins: string[];
    /** Express trust proxy 跳数：nginx 反代填 1；直连填 0（防 XFF 伪造绕过限流） */
    trustProxyHops: number;
  };
  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    connectionLimit: number;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  };
  uploads: {
    dir: string;
    filesBaseUrl: string;
    filesSignSecret: string;
    filesLinkTtlSeconds: number;
    maxSizeBytes: number;
    billMaxEdge: number;
    avatarMaxEdge: number;
  };
}

/** 简单时长解析：支持 `12h`、`30d`、`2h`、`43200`(秒)、`90m`。 */
function parseTtlSeconds(raw: string): number {
  const match = /^(\d+)\s*([smhd])?$/.exec(raw.trim());
  if (!match)
    throw new Error(`[env] 无法解析时长 "${raw}"，示例：2h / 30d / 43200`);
  const value = Number(match[1]);
  const unit = match[2] ?? 's';
  const factor =
    unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : 86400;
  return value * factor;
}

/**
 * 环境变量 → 强类型配置对象。
 * ConfigModule 加载 .env 文件后调用本工厂；校验失败直接 fail-fast。
 */
export default (): AppConfig => {
  validateEnv(process.env);

  const nodeEnv = (process.env.NODE_ENV ??
    'development') as AppConfig['app']['nodeEnv'];
  const accessTtl = readString(process.env, 'JWT_ACCESS_TTL', '2h');
  const refreshTtl = readString(process.env, 'JWT_REFRESH_TTL', '30d');

  return {
    app: {
      nodeEnv,
      isProduction: nodeEnv === 'production',
      port: readInt(process.env, 'PORT', 3000, 1, 65535),
      corsOrigins: readList(process.env, 'CORS_ORIGINS', []),
      trustProxyHops: readInt(process.env, 'TRUST_PROXY_HOPS', 1, 0, 10),
    },
    database: {
      host: readString(process.env, 'DB_HOST'),
      port: readInt(process.env, 'DB_PORT', 3306, 1, 65535),
      user: readString(process.env, 'DB_USER'),
      password: process.env.DB_PASSWORD ?? '',
      name: readString(process.env, 'DB_NAME'),
      connectionLimit: readInt(process.env, 'DB_CONNECTION_LIMIT', 10, 1, 100),
    },
    redis: {
      host: readString(process.env, 'REDIS_HOST'),
      port: readInt(process.env, 'REDIS_PORT', 6379, 1, 65535),
      password: process.env.REDIS_PASSWORD ?? '',
      db: readInt(process.env, 'REDIS_DB', 0, 0, 15),
    },
    jwt: {
      accessSecret: readString(process.env, 'JWT_ACCESS_SECRET'),
      refreshSecret: readString(process.env, 'JWT_REFRESH_SECRET'),
      accessTtl,
      refreshTtl,
      accessTtlSeconds: parseTtlSeconds(accessTtl),
      refreshTtlSeconds: parseTtlSeconds(refreshTtl),
    },
    uploads: {
      dir: readString(process.env, 'UPLOAD_DIR', './uploads'),
      filesBaseUrl: readString(
        process.env,
        'FILES_BASE_URL',
        'http://localhost:3000/api/v1/files',
      ),
      filesSignSecret: readString(process.env, 'FILES_SIGN_SECRET'),
      filesLinkTtlSeconds: readInt(
        process.env,
        'FILES_LINK_TTL',
        12 * 3600,
        60,
        7 * 86400,
      ),
      maxSizeBytes:
        readInt(process.env, 'UPLOAD_MAX_SIZE_MB', 5, 1, 50) * 1024 * 1024,
      billMaxEdge: readInt(process.env, 'UPLOAD_BILL_MAX_EDGE', 1440, 64, 4096),
      avatarMaxEdge: readInt(
        process.env,
        'UPLOAD_AVATAR_MAX_EDGE',
        512,
        64,
        4096,
      ),
    },
  };
};
