#!/usr/bin/env node
/**
 * @file 生产环境密钥轮换脚本（scripts/rotate-secrets.mjs）
 * @description 轮换应用侧三个强密钥：
 *                JWT_ACCESS_SECRET / JWT_REFRESH_SECRET / FILES_SIGN_SECRET。
 *              - 生成标准与 src/config/env.validation.ts 对齐：48 字节随机值的
 *                base64 编码（含小写/大写/数字/符号，且不含弱子串），自检不通过自动重生；
 *              - 默认 dry-run，仅展示「将替换哪些键、当前值指纹」，不写文件；
 *                加 --apply 才执行：先在同目录写带时间戳的备份，再定点替换；
 *              - 终端默认只回显密钥指纹（前4后4），加 --show 才打印完整新值
 *                （用于同步到部署平台/多实例环境变量）。
 *
 *              注意（轮换影响，务必知悉）：
 *              1. 两个 JWT 密钥更换后，线上全部 access/refresh token 立即验签失败，
 *                 所有用户需重新登录（属预期效果，等价于一次全员登出）；
 *              2. FILES_SIGN_SECRET 更换后，此前签发的签名图片链接立即失效，
 *                 App 重新进入页面拉取新链接即可恢复；
 *              3. 改完必须重启服务进程；多实例/容器/部署平台上需同步更新全部实例
 *                 的环境变量，实例间密钥不一致会导致跨实例验签失败；
 *              4. DB_PASSWORD / REDIS_PASSWORD 不在本脚本范围——它们需先在
 *                 MySQL/Redis 侧改密，再同步本配置，单方面改配置会导致连不上。
 *
 * @example
 *   node scripts/rotate-secrets.mjs                       # dry-run（默认 .env.production）
 *   node scripts/rotate-secrets.mjs --apply               # 备份并替换
 *   node scripts/rotate-secrets.mjs --apply --show        # 替换并打印完整新值
 *   node scripts/rotate-secrets.mjs --env-file .env.staging --apply
 *
 * @date 2026-10-11
 */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod, access } from 'node:fs/promises';
import { resolve, basename, dirname } from 'node:path';
import { constants as FS } from 'node:fs';

const SECRET_KEYS = [
  { name: 'JWT_ACCESS_SECRET', label: 'Access JWT 签名密钥' },
  { name: 'JWT_REFRESH_SECRET', label: 'Refresh JWT 签名密钥' },
  { name: 'FILES_SIGN_SECRET', label: '文件签名 HMAC 密钥' },
];

/** 与 env.validation.ts 一致的弱子串名单（小写匹配） */
const WEAK_PATTERNS = [
  'change-me',
  'changeme',
  'secret',
  'example',
  'password',
  '123456',
];

// ===== 参数解析 =====
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const showFull = args.includes('--show');
const envFileIdx = args.indexOf('--env-file');
const envFile = resolve(
  process.cwd(),
  envFileIdx !== -1 && args[envFileIdx + 1]
    ? args[envFileIdx + 1]
    : '.env.production',
);

/**
 * 统计字符种类：小写/大写/数字/符号，至少占 3 类（与 env.validation 对齐）
 * @param {string} v
 * @returns {number}
 */
function charKinds(v) {
  let kinds = 0;
  if (/[a-z]/.test(v)) kinds++;
  if (/[A-Z]/.test(v)) kinds++;
  if (/[0-9]/.test(v)) kinds++;
  if (/[^A-Za-z0-9]/.test(v)) kinds++;
  return kinds;
}

/**
 * 生成一个通过全部生产校验的强密钥（48 字节随机 → base64），自检失败自动重生
 * @returns {string}
 */
function generateSecret() {
  for (let i = 0; i < 10; i++) {
    const v = randomBytes(48).toString('base64');
    if (v.length < 32 || charKinds(v) < 3) continue;
    if (WEAK_PATTERNS.some((p) => v.toLowerCase().includes(p))) continue;
    return v;
  }
  console.error('[rotate] 密钥生成自检连续失败，请检查系统随机源');
  process.exit(1);
}

/**
 * 密钥指纹：仅前 4 后 4 位，避免终端二次泄露
 * @param {string} v
 */
function fingerprint(v) {
  if (!v) return '(未设置)';
  if (v.length <= 12) return '****';
  return `${v.slice(0, 4)}…${v.slice(-4)}（${v.length} 字符）`;
}

/**
 * 从文件内容中取某 KEY 的当前值（支持 KEY=value 与 KEY = value）
 * @param {string} content
 * @param {string} key
 * @returns {string|undefined}
 */
function readValue(content, key) {
  const m = content.match(new RegExp(`^${key}\\s*=\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : undefined;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(
    d.getMinutes(),
  )}${p(d.getSeconds())}`;
}

async function main() {
  // 目标文件必须存在
  try {
    await access(envFile, FS.R_OK | FS.W_OK);
  } catch {
    console.error(`[rotate] 目标文件不存在或不可读写：${envFile}`);
    console.error(
      '         请确认在服务端项目根目录执行，或用 --env-file 指定路径',
    );
    process.exit(1);
  }

  const content = await readFile(envFile, 'utf8');
  const plan = SECRET_KEYS.map((item) => ({
    ...item,
    oldValue: readValue(content, item.name),
    newValue: generateSecret(),
  }));

  console.log(`\n密钥轮换计划（目标文件：${envFile}）\n${'─'.repeat(56)}`);
  for (const p of plan) {
    console.log(`· ${p.name}（${p.label}）`);
    console.log(`    当前指纹：${fingerprint(p.oldValue)}`);
    console.log(`    新值指纹  ：${fingerprint(p.newValue)}`);
    if (!p.oldValue) {
      console.log('    ⚠ 该键当前不存在，--apply 时将追加到文件末尾');
    }
  }

  if (!apply) {
    console.log(
      `\n${'─'.repeat(56)}\n[dry-run] 未修改任何文件。确认无误后执行：\n` +
        `  node scripts/rotate-secrets.mjs --apply${showFull ? ' --show' : ''}` +
        (envFile !== resolve(process.cwd(), '.env.production')
          ? ` --env-file ${basename(envFile)}`
          : ''),
    );
    return;
  }

  // —— apply：先备份 ——
  const backup = `${envFile}.bak.${timestamp()}`;
  await writeFile(backup, content, { mode: 0o600 });

  // —— 定点替换；缺失则追加 ——
  let next = content;
  const appended = [];
  for (const p of plan) {
    const re = new RegExp(`^(${p.name}\\s*=).*$`, 'm');
    if (re.test(next)) {
      next = next.replace(re, `$1${p.newValue}`);
    } else {
      appended.push(`${p.name}=${p.newValue}`);
    }
  }
  if (appended.length) {
    next = `${next.replace(/\s*$/, '')}\n\n# ===== 由 rotate-secrets.mjs 追加 =====\n${appended.join('\n')}\n`;
  }
  await writeFile(envFile, next, { mode: 0o600 });
  await chmod(envFile, 0o600).catch(() => {});

  console.log(`\n${'─'.repeat(56)}`);
  console.log(`[apply] 已备份：${backup}（权限 600）`);
  console.log('[apply] 三个密钥已替换，文件权限已收紧为 600');
  if (showFull) {
    console.log('\n完整新值（请勿截图/提交仓库，仅用于同步到部署平台）：');
    for (const p of plan) console.log(`  ${p.name}=${p.newValue}`);
  } else {
    console.log(
      '\n（默认隐藏完整新值；需要同步到部署平台时加 --show 重跑 dry-run 无法复现，',
    );
    console.log(' 请直接从备份旁的目标文件读取，或重新执行轮换）');
  }

  console.log(
    `\n后续步骤：\n` +
      `  1. 同步新环境变量到全部生产实例/容器/部署平台（实例间必须一致）；\n` +
      `  2. 重启服务（NODE_ENV=production）；\n` +
      `  3. 全部用户需重新登录、旧签名图片链接即时失效（均为预期影响）；\n` +
      `  4. 确认服务正常后，妥善删除或归档备份文件 ${basename(backup)}。`,
  );

  // 备份文件入库风险提示
  try {
    const gitignore = await readFile(
      resolve(dirname(envFile), '.gitignore'),
      'utf8',
    ).catch(() => '');
    const base = basename(envFile);
    const covered = gitignore.split('\n').some((line) => {
      const pat = line.trim();
      if (!pat || pat.startsWith('#')) return false;
      // 粗略匹配：.env* / .env.production* / 精确文件名
      return (
        pat === '.env*' ||
        pat === '.env.production*' ||
        pat === base ||
        (pat.endsWith('*') && base.startsWith(pat.slice(0, -1)))
      );
    });
    if (!covered) {
      console.log(
        `\n⚠ .gitignore 未覆盖 ${base} 及其备份，请确认密钥文件不会被提交（建议加入 .env*）。`,
      );
    }
  } catch {
    // 忽略 .gitignore 检查失败
  }
}

main().catch((err) => {
  console.error('[rotate] 执行失败:', err.message);
  process.exit(1);
});
