/**
 * 启动时环境变量校验：缺失关键配置直接 fail-fast（05 §7）。
 * 不引入额外校验库，手工聚合所有错误后一次性抛出。
 */

/** 读取字符串环境变量（可带默认值）。 */
export function readString(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue?: string,
): string {
  const value = env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`[env] 缺少必需的环境变量 ${key}`);
  }
  return value;
}

/** 读取整型环境变量并校验范围。 */
export function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(
      `[env] 环境变量 ${key} 必须是 [${min}, ${max}] 区间内的整数，实际为 "${raw}"`,
    );
  }
  return value;
}

/** 读取逗号分隔列表。 */
export function readList(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: string[],
): string[] {
  const raw = env[key];
  if (!raw) return defaultValue;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 读取布尔环境变量：true/1/yes/on（不区分大小写）为真，其余视为假（P1-05）。 */
export function readBoolean(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: boolean,
): boolean {
  const raw = env[key];
  if (raw === undefined || raw === '') return defaultValue;
  return ['true', '1', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** 常见弱密钥片段（P1-05）：密钥中包含任一片段即拒绝（不区分大小写）。 */
const WEAK_SECRET_PATTERNS = [
  'change-me',
  'changeme',
  'secret',
  'example',
  'password',
  '123456',
] as const;

/** 统计字符类别数：小写字母 / 大写字母 / 数字 / 其他符号，共 4 类。 */
function countCharKinds(value: string): number {
  let kinds = 0;
  if (/[a-z]/.test(value)) kinds += 1;
  if (/[A-Z]/.test(value)) kinds += 1;
  if (/\d/.test(value)) kinds += 1;
  if (/[^a-zA-Z0-9]/.test(value)) kinds += 1;
  return kinds;
}

/**
 * 校验并返回归一化后的环境变量集合。
 * 任何错误聚合成一条异常信息，保证启动失败原因可一次看全。
 */
export function validateEnv(env: NodeJS.ProcessEnv): void {
  const errors: string[] = [];

  const requireString = (key: string): string | undefined => {
    try {
      return readString(env, key);
    } catch (error) {
      errors.push((error as Error).message);
      return undefined;
    }
  };

  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    errors.push(
      `[env] NODE_ENV 仅支持 development/production/test，实际为 "${nodeEnv}"`,
    );
  }

  // MySQL
  for (const key of ['DB_HOST', 'DB_USER', 'DB_NAME']) requireString(key);
  if (nodeEnv === 'production') requireString('DB_PASSWORD');

  // Redis
  requireString('REDIS_HOST');
  // P1-05：生产环境 Redis 必须设置密码，缺失即启动失败
  if (
    nodeEnv === 'production' &&
    (env.REDIS_PASSWORD === undefined || env.REDIS_PASSWORD.trim() === '')
  ) {
    errors.push('[env] 生产环境必须设置非空的 REDIS_PASSWORD');
  }

  // JWT/文件签名/refresh pepper 密钥：长度 >=32 字节 + 弱密钥片段与熵检测（P1-05/P2-13）
  for (const key of [
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'FILES_SIGN_SECRET',
    // P2-13：refresh token 哈希的服务端 pepper（HMAC-SHA256），复用同一强度口径
    'REFRESH_PEPPER',
  ]) {
    const value = requireString(key);
    if (value === undefined) continue;
    if (Buffer.byteLength(value, 'utf8') < 32) {
      errors.push(
        `[env] ${key} 长度必须 >= 32 字节（当前 ${Buffer.byteLength(value, 'utf8')} 字节）`,
      );
    }
    const lower = value.toLowerCase();
    const hit = WEAK_SECRET_PATTERNS.find((pattern) => lower.includes(pattern));
    if (hit !== undefined) {
      errors.push(
        `[env] ${key} 包含常见弱密钥片段 "${hit}"，请更换为随机生成的强密钥（如 openssl rand -base64 48）`,
      );
    }
    if (countCharKinds(value) < 3) {
      errors.push(
        `[env] ${key} 字符种类不足 3 类（需在小写字母/大写字母/数字/符号中至少占 3 类），疑似弱密钥，请更换为随机生成的强密钥`,
      );
    }
  }
  if (
    env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET &&
    env.JWT_ACCESS_SECRET !== undefined
  ) {
    errors.push('[env] JWT_ACCESS_SECRET 与 JWT_REFRESH_SECRET 不得相同');
  }
  // 签名密钥必须与 JWT 密钥独立（05 §7：一密一用，环境隔离）
  if (
    env.FILES_SIGN_SECRET !== undefined &&
    (env.FILES_SIGN_SECRET === env.JWT_ACCESS_SECRET ||
      env.FILES_SIGN_SECRET === env.JWT_REFRESH_SECRET)
  ) {
    errors.push('[env] FILES_SIGN_SECRET 不得与 JWT 密钥相同');
  }
  // P2-13：refresh pepper 一密一用，不得复用 JWT/文件签名密钥
  if (env.REFRESH_PEPPER !== undefined) {
    if (
      env.REFRESH_PEPPER === env.JWT_ACCESS_SECRET ||
      env.REFRESH_PEPPER === env.JWT_REFRESH_SECRET ||
      env.REFRESH_PEPPER === env.FILES_SIGN_SECRET
    ) {
      errors.push('[env] REFRESH_PEPPER 不得与 JWT/FILES_SIGN 密钥相同');
    }
  }

  // CORS_ORIGINS（P2-13）：逐条校验形态，仅允许 http(s)://host[:port]，不含路径；
  // 生产环境拒绝空值、通配符 * 以及 localhost/127.0.0.1 回环来源
  const corsRaw = env.CORS_ORIGINS;
  if (corsRaw === undefined || corsRaw.trim() === '') {
    if (nodeEnv === 'production') {
      errors.push('[env] 生产环境必须显式配置非空的 CORS_ORIGINS');
    }
  } else {
    const origins = corsRaw
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    for (const origin of origins) {
      if (origin === '*') {
        errors.push(
          '[env] CORS_ORIGINS 不允许配置通配符 "*"（等于放行任意站点的跨域请求），请逐条列出 http(s) 来源',
        );
        continue;
      }
      if (!/^https?:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(origin)) {
        errors.push(
          `[env] CORS_ORIGINS 条目形态非法："${origin}"，需形如 http(s)://host[:port]，不含路径/通配符`,
        );
        continue;
      }
      if (nodeEnv === 'production') {
        const host = origin
          .replace(/^https?:\/\//, '')
          .replace(/:\d+$/, '')
          .toLowerCase();
        if (host === 'localhost' || host === '127.0.0.1') {
          errors.push(
            `[env] 生产环境 CORS_ORIGINS 不得指向本机回环地址："${origin}"`,
          );
        }
      }
    }
  }

  // Swagger 文档开关（P2-13）：development 默认开启；production 必须显式
  // ENABLE_SWAGGER=true 才挂载，且强制 Basic Auth（账号非空、密码 >=16 字节）
  const swaggerEnabled = readBoolean(
    env,
    'ENABLE_SWAGGER',
    nodeEnv !== 'production',
  );
  if (swaggerEnabled && nodeEnv === 'production') {
    if (
      env.SWAGGER_BASIC_USER === undefined ||
      env.SWAGGER_BASIC_USER.trim() === ''
    ) {
      errors.push(
        '[env] 生产环境 ENABLE_SWAGGER=true 时必须配置非空的 SWAGGER_BASIC_USER',
      );
    }
    if (
      env.SWAGGER_BASIC_PASSWORD === undefined ||
      Buffer.byteLength(env.SWAGGER_BASIC_PASSWORD, 'utf8') < 16
    ) {
      errors.push(
        '[env] 生产环境 ENABLE_SWAGGER=true 时 SWAGGER_BASIC_PASSWORD 必填且长度 >= 16 字节',
      );
    }
  }

  requireString('UPLOAD_DIR');

  if (errors.length > 0) {
    throw new Error(
      `环境变量校验失败，请检查 .env.${nodeEnv}：\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    );
  }
}
