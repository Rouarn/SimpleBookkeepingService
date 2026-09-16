# 06 · 开发与部署指南

## 1. 开发环境搭建

### 1.1 本机必备软件

| 软件             | 版本                           | 说明                                                           |
| ---------------- | ------------------------------ | -------------------------------------------------------------- |
| Node.js          | 22 LTS（≥ 22.12，建议 22.22+） | 安装后 `node -v` 校验                                          |
| pnpm             | 9.x                            | `npm i -g pnpm`                                                |
| MySQL            | **5.7.44**                     | Docker 或本机安装均可（见 §2）                                 |
| Redis            | 7.2+                           | 限流/缓存，Docker 最省事                                       |
| Git              | 2.40+                          |                                                                |
| （可选）Nest CLI | 12                             | `pnpm add -g @nestjs/cli@^12`，用于 `nest g resource` 代码生成 |

### 1.2 启动步骤

```bash
# 1. 安装依赖
pnpm install

# 2. 准备环境变量
cp .env.example .env.development
# 按实际填写 DB/Redis/JWT/UPLOAD_DIR；JWT 与文件签名密钥可用: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# 3. 启动本地依赖（MySQL 5.7 + Redis 7）
docker compose up -d mysql redis

# 4. 执行数据库迁移 + 字典种子
pnpm migration:run

# 5. 开发模式启动（watch）
pnpm start:dev
# → http://localhost:3000 ；Swagger 文档 http://localhost:3000/api/docs
```

`package.json` 核心脚本：

```jsonc
{
  "scripts": {
    "start:dev": "nest start --watch",
    "build": "nest build",
    "start:prod": "node dist/main.js",
    "lint": "eslint \"src/**/*.ts\" --max-warnings 0",
    "format": "prettier --write \"src/**/*.ts\"",
    "typecheck": "tsc --noEmit",
    "migration:run": "typeorm migration:run -d dist/database/data-source.js",
    "migration:revert": "typeorm migration:revert -d dist/database/data-source.js",
    "migration:generate": "typeorm migration:generate -d dist/database/data-source.js",
  },
}
```

### 1.3 客户端联调

- H5：`vite.config.js` 代理 `/api` → `http://localhost:3000`；
- App 真机：API baseUrl 填**电脑局域网 IP**（与更新系统同样不能用 localhost），如 `http://192.168.1.13:3000`；
- Android 模拟器：`http://10.0.2.2:3000`；
- 小程序：开发工具勾选「不校验合法域名」，真机预览需在小程序后台配置 request 合法域名（生产必须 HTTPS）。
- **更新模块保持原配置不动**（`utils/app-update/config.js` 的 9867 端口与本服务 3000 端口互不干扰）。

## 2. 数据库搭建方案

### 2.1 推荐：Docker Compose（开发与小规模生产通用）

```yaml
# docker-compose.yml（节选）
services:
  mysql:
    image: mysql:5.7.44
    command:
      - --character-set-server=utf8mb4
      - --collation-server=utf8mb4_unicode_ci
      - --default-time-zone=+08:00
      - --slow-query-log=ON
      - --long-query-time=0.5
      - --max-connections=200
      - --innodb-buffer-pool-size=512M
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_DATABASE: bookkeeping
      MYSQL_USER: app
      MYSQL_PASSWORD: ${MYSQL_APP_PASSWORD}
    ports: ["3306:3306"]
    volumes:
      - mysql-data:/var/lib/mysql
  redis:
    image: redis:7.2-alpine
    command:
      [
        "redis-server",
        "--requirepass",
        "${REDIS_PASSWORD}",
        "--appendonly",
        "yes",
      ]
    ports: ["6379:6379"]
    volumes: ["redis-data:/data"]
  api:
    image: bookkeeping-api:dev
    environment:
      UPLOAD_DIR: /data/uploads
    volumes:
      - ./uploads-data:/data/uploads # 图片持久化目录；多实例必须改为共享 NAS/NFS 卷
volumes: { mysql-data: {}, redis-data: {} }
```

宿主机准备图片目录（一次性）：

```bash
mkdir -p /data/bookkeeping/uploads/bills /data/bookkeeping/uploads/avatars
chown -R 1000:1000 /data/bookkeeping/uploads   # 与容器内 node 用户 uid/gid 对齐
chmod 700 /data/bookkeeping/uploads
```

应用连接串要点：`charset=utf8mb4&timezone=%2B08:00&supportBigNumbers=true&bigNumberStrings=true`（配合应用层 BIGINT→字符串序列化）。

### 2.2 建库语句（如手工建库）

```sql
CREATE DATABASE bookkeeping
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;
```

### 2.3 迁移与种子流程

1. `synchronize: false`（开发也关闭，避免实体与线上漂移）；
2. 首版两个迁移：`InitSchema`（02 文档全部 DDL）、`SeedDictionaries`（16 分类 + 5 支付方式，`INSERT ... ON DUPLICATE KEY UPDATE` 保证幂等可重入）；
3. 字典数据可用迁移管理，也可保留一份 `src/database/seeds/dictionaries.sql` 供全新环境快速导入；
4. 用户默认账本不走 SQL 种子，仅在注册事务中产生。

### 2.4 备份策略（轻量起步）

- 每日凌晨 `mysqldump --single-transaction --default-character-set=utf8mb4` 全量备份，保留 7 天 + 月末快照保留 6 个月，备份文件落独立备份盘/NAS 卷（与数据库不在同一物理盘）；
- **图片目录 `UPLOAD_DIR` 每日增量同步到备份卷**（`rsync -a --delete`），每周打包一次全量；磁盘故障是本地存储方案最需要防的风险点；
- 每月做一次恢复演练（恢复数据库到临时实例 + 抽查图片可正常签名访问）；
- Redis 仅缓存/限流，无备份价值（appendonly 仅为减少重启抖动）。

## 3. 质量门禁（本项目不引入自动化测试）

本项目按约定**不配置单元测试 / E2E 测试体系**，质量保证依赖以下轻量门禁，不额外搭建测试框架：

| 门禁         | 命令/方式                                             | 执行时机         |
| ------------ | ----------------------------------------------------- | ---------------- |
| 类型检查     | `pnpm typecheck`（`tsc --noEmit`）                    | 提交前 + CI 必过 |
| Lint         | `pnpm lint`（0 warning）                              | 提交前 + CI 必过 |
| 迁移评审     | 所有 migration 变更需在 PR 中附影响行数评估           | 合并前           |
| 接口契约自查 | 以 `docs/server/04*` 为检查单，用 Swagger UI 逐个手测 | 开发完成         |
| 手工冒烟清单 | 见下                                                  | 每次发版         |

发版前手工冒烟清单（约 15 分钟，注册一个新账号走全流程）：

1. 注册 → 自动出现「个人账本」、预算为 0；
2. 新增支出/收入各 1 笔（含 3 张凭证、50 字备注）→ 首页今日流水、数字、图标颜色正确；
3. 流水页切月份/切类型 → 分组顺序、当日收支合计正确；
4. 统计页 → 概览环比、日均、分类排行、支付方式排行、6 月趋势无缺月、无 NaN；
5. 编辑账单（改类型并换对应分类、替换照片）→ 详情页「当月截止支出」随之变化；
6. 删除账单 → 列表/统计同步减少；
7. 新建账本、切换、改名改预算；删除账本：默认账本被拒、非空账本要求迁移、迁移后账单归属正确；
8. 上传非法文件（.txt、>5MB）被拒；
9. token 过期 → 静默刷新成功；refresh 失效 → 回到登录；
10. 连续错误登录 5 次 → 锁定提示。

## 4. 部署流程与环境配置

### 4.1 环境划分

| 环境        | 用途      | 数据                                                                                       |
| ----------- | --------- | ------------------------------------------------------------------------------------------ |
| development | 本机开发  | 本地 Docker MySQL/Redis                                                                    |
| staging     | 联调/冒烟 | 独立小规格 MySQL（5.7 同版本），数据不与生产互通                                           |
| production  | 线上      | 独立 MySQL 实例 + Redis + 独立持久化数据盘存放 `UPLOAD_DIR`（建议挂载 NAS/NFS 并每日备份） |

### 4.2 构建与发布（Docker 路线，推荐）

```dockerfile
# Dockerfile（多阶段，CommonJS 产物）
FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:22-bookworm-slim
WORKDIR /app
ENV TZ=Asia/Shanghai NODE_ENV=production UPLOAD_DIR=/data/uploads
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN mkdir -p /data/uploads/bills /data/uploads/avatars && chown -R node:node /data/uploads
VOLUME ["/data/uploads"]
EXPOSE 3000
USER node
CMD ["node", "dist/main.js"]
```

> 基础镜像选 bookworm 而非 alpine：sharp 为带预编译二进制的原生模块，glibc 镜像免编译、最省心。

发布流程：

```bash
# 1. CI：typecheck + lint + 构建
pnpm typecheck && pnpm lint && pnpm build
# 2. 构建镜像并推送
docker build -t registry.example.com/bookkeeping-api:<git-short-sha> .
docker push registry.example.com/bookkeeping-api:<git-short-sha>
# 3. 生产机拉取 → 迁移 → 滚动重启（先一台观察，再全量）
docker pull registry.example.com/bookkeeping-api:<sha>
docker run --rm --env-file .env.production registry.example.com/bookkeeping-api:<sha> \
  node dist/node_modules/typeorm/cli.js migration:run -d dist/database/data-source.js
docker compose up -d --no-deps api
```

- 应用计算逻辑**无状态**，限流与刷新令牌状态全在 Redis/MySQL；但用户上传的图片在**本地磁盘**，多实例水平扩展的前提是 `/data/uploads` 挂载为所有实例共享的 NAS/NFS 数据卷（或用 Nginx 把上传与 `/api/v1/files/` 固定路由到同一实例）；**不具备共享存储条件时，v1 直接采用单机 PM2 部署，不要起多实例**；
- 运行容器必须显式挂载卷：`-v /data/bookkeeping/uploads:/data/uploads`，镜像重建不丢图片；
- Nginx 前置做负载均衡与 HTTPS；多实例上线采用**逐台替换**（实例数 ≥2 时无需停机），单机用 `pm2 reload`；
- 迁移必须先于应用启动；只做「加列/加表」式兼容迁移，需要破坏性变更时拆两次发布（先兼容双写 → 再清理）。

### 4.3 PM2 路线（单机轻量替代方案）

```bash
pnpm build
NODE_ENV=production pm2 start dist/main.js --name bookkeeping-api -i 2 --time
pm2 save && pm2 startup
```

配合 `pm2 reload` 零停机重载；`ecosystem.config.js` 中通过 `env_production` 注入配置路径，密钥仍走环境变量不写文件入库。PM2 单机模式下 `UPLOAD_DIR=/data/bookkeeping/uploads` 直接使用本机持久化目录，提前创建并授权：

```bash
mkdir -p /data/bookkeeping/uploads/{bills,avatars}
chown -R $(whoami) /data/bookkeeping/uploads && chmod 700 /data/bookkeeping/uploads
```

### 4.4 Nginx 关键配置

```nginx
server {
  listen 443 ssl http2;
  server_name api.example.com;
  ssl_certificate     /etc/nginx/ssl/api.crt;
  ssl_certificate_key /etc/nginx/ssl/api.key;
  ssl_protocols TLSv1.2 TLSv1.3;

  client_max_body_size 8m;          # 上传上限 5MB + multipart 开销
  add_header X-Content-Type-Options nosniff always;
  add_header X-Frame-Options DENY always;
  add_header Referrer-Policy strict-origin-when-cross-origin always;

  location /api/ { proxy_pass http://api_upstream; proxy_set_header X-Real-IP $remote_addr;
                   proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
                   proxy_set_header X-Forwarded-Proto $scheme;
                   proxy_read_timeout 15s; }
  location = /health { proxy_pass http://api_upstream; access_log off; }

  # 图片签名 URL：默认反代给 Nest 的 FilesController 做 HMAC 校验（应用逻辑统一、版本可控）
  location /api/v1/files/ { proxy_pass http://api_upstream; proxy_set_header X-Real-IP $remote_addr;
                            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }

  # 可选（高性能卸载）：启用 Nginx 官方 secure_link 模块在边缘校验签名，命中后直接读盘，
  # 不再回源应用；签名算法需与 Nest 端 StorageService 保持一致：
  #   sign = base64url(md5(secret, uri, e))
  # location /files/ {
  #   secure_link $arg_sign,$arg_e;
  #   secure_link_md5 "$secure_link_expires$uri$files_secret";
  #   if ($secure_link = "") { return 403; }
  #   if ($secure_link = "0") { return 410; }
  #   alias /data/bookkeeping/uploads/;
  #   add_header X-Content-Type-Options nosniff always;
  #   add_header Cache-Control "private, max-age=3600";
  #   access_log off;
  # }

  # 注意：/app-updates/ 不在此 server 配置——它属于独立的更新服务
}
```

### 4.5 环境变量注入原则

- 生产密钥**不进镜像、不进仓库**：由部署平台（docker `--env-file`、CI/CD secret、系统环境变量）注入；
- JWT 双密钥、数据库密码、文件签名密钥（`FILES_SIGN_SECRET`）每环境独立；轮换 JWT 密钥时支持新旧双密钥并存一个发布周期（access 寿命 2h，窗口很短）；轮换文件签名密钥后旧签名 URL 最多 12h 内自然失效，客户端重新拉取资料/账单即可获得新 URL。

## 5. 日志方案

1. **结构化日志**：`nestjs-pino` 输出 JSON，每请求一条入站日志 + 错误日志全堆栈；字段含 `time/level/traceId/userId?/method/path/status/costMs/ip`。
2. **traceId**：优先用请求头 `X-Request-Id`，无则服务端生成 32 位 hex；通过 AsyncLocalStorage 透传，响应头 `X-Request-Id` 回传，前端错误上报带上它即可串联。
3. **审计落库**：`LoggingInterceptor` 异步写 `operation_logs`（失败只告警不影响响应），用于安全审计与后台查询；业务明细不入审计表。
4. **脱敏**：密码、token、Authorization 头、完整手机号在日志层统一过滤（pino redact 路径）。
5. 采集：单机直接 `docker logs` + 文件轮转（pino-loki/ELK 可选）；按天滚动、保留 30 天。
6. 关键业务事件单独打点：登录成功/失败锁定、令牌泄漏作废、清空账单、删除账本迁移。

## 6. 监控与告警

| 类别     | 手段                                                                | 告警阈值（建议起步值）                                                     |
| -------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 存活探针 | `GET /health`（Terminus：DB ping、Redis ping、磁盘）                | Nginx/云负载均衡每 5s 探测，连续 3 次失败摘流并告警                        |
| 进程指标 | PM2/Docker 重启策略                                                 | 10 分钟内重启 ≥ 3 次告警                                                   |
| 接口质量 | access 日志聚合 P95/P99、5xx 率                                     | 5xx 率 > 1%（5 分钟窗口）；P95 > 800ms                                     |
| 慢查询   | MySQL slow log + TypeORM slow 事件                                  | 单条 > 500ms 记录，日出现 > 50 条告警                                      |
| 资源     | CPU / 内存 / 磁盘 / 连接数                                          | CPU>80% 持续 5 分钟；磁盘>80%；MySQL 连接使用率>80%                        |
| 业务安全 | 登录锁定次数、429 激增                                              | 单 IP 429 > 200/小时触发关注                                               |
| 文件存储 | 上传失败率、磁盘可用空间/inode、`UPLOAD_DIR` 可写性（健康检查覆盖） | 上传失败率 > 5%（10 分钟）；磁盘使用率 > 80% 预警、> 90% 告警；inode > 80% |

监控栈按团队现状选择：轻量用云监控 + 健康检查 + 日志关键词报警；进阶接入 Prometheus（`prom-client` 暴露 `/metrics`）+ Grafana，NestJS 12 亦可用官方 `@nestjs/observe` 对接可观测平台（可选，v1 不强制）。

## 7. 上线检查单

- [ ] `.env.production` 全部密钥就绪且非默认值；`NODE_ENV=production`
- [ ] `synchronize=false`；迁移在生产库演练（staging 先跑）
- [ ] Swagger 已关闭（生产不暴露 `/api/docs`）
- [ ] HTTPS 证书有效；小程序后台域名已配置
- [ ] `UPLOAD_DIR=/data/bookkeeping/uploads` 已挂持久化数据卷（多实例为共享 NAS/NFS），属主/权限为 node 用户 `0700`，磁盘容量与 inode 余量充足
- [ ] Nginx 不提供上传目录的列目录/裸文件直读，图片只能经 `/api/v1/files/` 签名 URL 访问
- [ ] 数据库与 `UPLOAD_DIR` 备份任务均已开启并验证过一次恢复
- [ ] 健康检查接入负载均衡；告警联系人可用
- [ ] 在线更新服务与本服务域名/端口确认隔离，互不影响
