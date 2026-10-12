import {
  validateEnv,
  readInt,
  readList,
  readString,
  readBoolean,
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
    /** 是否启用 MySQL TLS 加密连接（DB_TLS，默认 false，生产建议开启） */
    tls: boolean;
    /** MySQL TLS 证书校验开关（DB_TLS_REJECT_UNAUTHORIZED，默认 true；5.7 自签证书场景可关闭） */
    tlsRejectUnauthorized: boolean;
  };
  redis: {
    host: string;
    port: number;
    password: string;
    db: number;
    /** 是否启用 Redis TLS 加密连接（REDIS_TLS，默认 false，生产建议开启） */
    tls: boolean;
  };
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    /** JWT 标准声明 iss：签发方标识（P1-05，防跨系统令牌混用） */
    issuer: string;
    /** JWT 标准声明 aud：目标受众标识（P1-05） */
    audience: string;
    /** refresh token 哈希的服务端 pepper（P2-13）：HMAC-SHA256(pepper, token) 入库 */
    refreshPepper: string;
  };
  swagger: {
    /** 是否挂载 /api/docs：development 默认 true，production 仅 ENABLE_SWAGGER=true 时挂载 */
    enabled: boolean;
    /** 文档 Basic Auth 账号（生产开启时必填，env 校验拦截） */
    basicUser: string;
    /** 文档 Basic Auth 密码（生产开启时必填且 >=16 字节） */
    basicPassword: string;
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
  /** 账号注销：业务数据保留期（天），期满由每日清理任务回收 */
  userDeactivation: {
    retentionDays: number;
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
  // access token 默认 30m（P1-01）：配合 token_version 体系缩短失陷窗口
  const accessTtl = readString(process.env, 'JWT_ACCESS_TTL', '30m');
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
      tls: readBoolean(process.env, 'DB_TLS', false),
      tlsRejectUnauthorized: readBoolean(
        process.env,
        'DB_TLS_REJECT_UNAUTHORIZED',
        true,
      ),
    },
    redis: {
      host: readString(process.env, 'REDIS_HOST'),
      port: readInt(process.env, 'REDIS_PORT', 6379, 1, 65535),
      password: process.env.REDIS_PASSWORD ?? '',
      db: readInt(process.env, 'REDIS_DB', 0, 0, 15),
      tls: readBoolean(process.env, 'REDIS_TLS', false),
    },
    jwt: {
      accessSecret: readString(process.env, 'JWT_ACCESS_SECRET'),
      refreshSecret: readString(process.env, 'JWT_REFRESH_SECRET'),
      accessTtl,
      refreshTtl,
      accessTtlSeconds: parseTtlSeconds(accessTtl),
      refreshTtlSeconds: parseTtlSeconds(refreshTtl),
      issuer: 'simple-bookkeeping',
      audience: 'xiaolv-app',
      refreshPepper: readString(process.env, 'REFRESH_PEPPER'),
    },
    swagger: {
      // development 默认挂载文档；production 默认关闭，须显式 ENABLE_SWAGGER=true
      enabled: readBoolean(
        process.env,
        'ENABLE_SWAGGER',
        nodeEnv !== 'production',
      ),
      basicUser: (process.env.SWAGGER_BASIC_USER ?? '').trim(),
      basicPassword: process.env.SWAGGER_BASIC_PASSWORD ?? '',
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
        1800,
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
    userDeactivation: {
      retentionDays: readInt(
        process.env,
        'USER_DEACTIVATION_RETENTION_DAYS',
        30,
        1,
        3650,
      ),
    },
  };
};
