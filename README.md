# simple-bookkeeping-service

「小绿记账」后端服务：NestJS 12 + TypeORM 1.1（MySQL raw SQL）+ Redis + 本地磁盘文件存储。

## 本地开发

```bash
pnpm install
cp .env.example .env.development   # 按需修改
pnpm run start:dev                 # 默认 http://localhost:3000
```

- 开发环境（`NODE_ENV !== production`）TypeORM `synchronize: true`，表结构自动同步；
- 生产环境**永久关闭** synchronize，所有 DDL 手动执行。

## 生产部署

### 1. 环境变量

`cp .env.example .env.production` 并逐项修改。**必须完成**：

| 变量 | 要求 |
| --- | --- |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` / `FILES_SIGN_SECRET` | 全部更换为独立随机值，`openssl rand -base64 48` 生成；dev/prod 隔离 |
| `DB_PASSWORD` / `REDIS_PASSWORD` | 更换强口令；数据库账号仅授予业务库最小权限 |
| `TRUST_PROXY_HOPS` | nginx 反代填 `1`；服务直连公网（无代理）**必须填 `0`**，否则 X-Forwarded-For 可伪造，限流/登录失败计数被绕过 |
| `UPLOAD_DIR` | 生产建议 `/data/bookkeeping/uploads`，目录须存在且进程可写 |
| `FILES_BASE_URL` | 对外可访问的 HTTPS 域名，如 `https://xl.shixian.xyz/api/v1/files` |

### 2. 构建与启动

```bash
pnpm install
pnpm run build
NODE_ENV=production node dist/main.js
```

建议用 systemd 托管（`Restart=always`、`EnvironmentFile=/path/to/.env.production`）。

### 3. 网络与 nginx（关键安全项）

- Node 进程只监听 `127.0.0.1:3000` 或用防火墙/安全组**禁止 3000 端口对公网开放**，全部流量走 nginx 443；
- X-Forwarded-For 必须**覆盖式**下发（防伪造），不要用 `$proxy_add_x_forwarded_for` 追加链：

```nginx
server {
    listen 443 ssl http2;
    server_name xl.shixian.xyz;
    # ssl_certificate ...

    client_max_body_size 10m;   # 图片上传，大于服务端 UPLOAD_MAX_SIZE_MB 即可

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        # 覆盖式设置：客户端伪造的 X-Forwarded-For 不会进入日志与限流逻辑
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- HTTPS 证书有效（APP 端 API/上传/APK 下载均强制 https）；
- 静态 uploads 目录**不要**由 nginx 直接对外映射，文件访问一律走 `/api/v1/files`（HMAC 签名，限时有效）。

## 运维脚本

### 修复孤儿凭证图片记录（bill_photos 无对应 bills）

```bash
node scripts/fix-orphan-bill-photos.mjs            # 默认 dry-run，仅打印待处理行
DOTENV_PATH=.env.production node scripts/fix-orphan-bill-photos.mjs --apply
```

- `--apply` 会先向 Redis 墓碑 ZSET `bk:cleanup:tombstone:bills` 写入删除标记，再删除 DB 记录，防止清理任务误删磁盘文件；
- 建议先 dry-run 核对数量后再执行。

### 测试数据

```bash
DOTENV_PATH=.env.development SEED_PHONE=138xxxx0001 node scripts/seed-test-data.mjs
# 可选：SEED_IMAGE_DIR=/path/to/images 指定凭证图片素材目录
```

## 常用命令

```bash
pnpm run typecheck   # 类型检查
pnpm run lint        # oxlint
pnpm run build       # 构建 dist/
```
