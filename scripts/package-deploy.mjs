/**
 * 生产部署包打包脚本（不输出源码）。
 *
 * 产物：
 *   deploy/                        可直接整体上传的部署目录
 *     ├─ dist/                     nest build 的编译产物（剔除 .d.ts）
 *     ├─ package.json              依赖清单与启动脚本（原样保留，配合 pnpm install --prod）
 *     ├─ pnpm-lock.yaml            锁定依赖版本
 *     ├─ pnpm-workspace.yaml       bcrypt 原生编译的 allowBuilds 审批，缺少会导致 pnpm 跳过编译
 *     └─ .env.example             服务器上据此创建 .env.production
 *
 * 服务器侧：
 *   将 deploy 目录上传到 /opt/bookkeeping
 *   cd /opt/bookkeeping
 *   pnpm install --prod --frozen-lockfile
 *   cp .env.example .env.production   # 按实际环境修改
 *   # 表结构变更需在生产库手动执行 DDL（开发环境由 TypeORM synchronize 自动同步）
 *   pnpm start:prod
 */
import { spawnSync } from 'node:child_process';
import { cp, copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(root, 'deploy');

/** 以继承的标准输入输出执行命令，失败即终止打包。 */
function run(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`命令执行失败: ${cmd} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

/** 递归复制目录，剔除声明文件与构建缓存（运行时只需要 .js / sourcemap）。 */
async function copyDist(src, dest) {
  await mkdir(dest, { recursive: true });
  for (const entry of await readdir(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDist(srcPath, destPath);
    } else if (
      entry.isFile() &&
      !entry.name.endsWith('.d.ts') &&
      !entry.name.endsWith('.tsbuildinfo')
    ) {
      await copyFile(srcPath, destPath);
    }
  }
}

/** 统计目录内文件数量与体积，打包结束后给出概览。 */
async function summarize(dir) {
  let count = 0;
  let bytes = 0;
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else {
        count += 1;
        bytes += (await stat(full)).size;
      }
    }
  }
  await walk(dir);
  return { count, bytes };
}

console.log('①/③ 构建项目：pnpm build');
run('pnpm', ['build']);

console.log('②/③ 准备 deploy 目录（清空旧产物）');
await rm(outDir, { recursive: true, force: true });
await mkdir(join(outDir, 'dist'), { recursive: true });

console.log('③/③ 复制运行时文件（不含 src 源码）');
await copyDist(join(root, 'dist'), join(outDir, 'dist'));
for (const file of [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.env.example',
]) {
  await cp(join(root, file), join(outDir, file));
}

const { count, bytes } = await summarize(outDir);
console.log('');
console.log('打包完成：');
console.log(
  `  部署目录 : ${outDir}（${count} 个文件，${(bytes / 1024 / 1024).toFixed(1)} MB）`,
);
