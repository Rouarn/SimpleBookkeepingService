# 小绿记账服务端 v1 - 产品需求规格（Spec）

## Overview

- **Summary**：按 `docs/server/` 下 11 份设计文档（README、01~07），实现「小绿记账」uni-app 客户端对应的 NestJS 服务端：认证授权、用户资料/偏好、账本预算、账单流水、字典、统计与首页概览、本地磁盘图片上传与签名访问。
- **Purpose**：将纯本地存储（Pinia）架构改造为前后端分离、按用户隔离的 RESTful API 架构，页面交互与业务口径保持不变。
- **Target Users**：小绿记账 App / H5 / 小程序的注册用户（个人记账场景）。

## Goals

- 交付可运行、可部署的 NestJS 12 服务端工程，覆盖文档 04a~04d 的全部接口（共 28 个业务端点 + 健康检查 + 文件签名读取）。
- 数据库 9 张表通过 TypeORM 迁移落库，16 个分类 + 5 个支付方式种子数据幂等入库。
- 全部业务口径（金额舍入、排序、月汇总、环比、预算进度、当月截止支出等）与文档逐字一致。
- 安全基线：JWT 双令牌轮换、bcrypt(12)、用户隔离、HMAC 签名文件 URL、全局限流与分档限流、统一错误码。
- 对提供的远程 MySQL（150.158.128.228:13306，库名 simple-bookkeeping）与 Redis（150.158.128.228:16379）完成迁移与冒烟验证。

## Non-Goals

- APP 在线更新系统（`static.shixian.xyz`，`/app-updates/*`）完全不开发、不代理。
- 邀请好友、记账提醒、意见反馈、关于我们、设置、消息铃铛等占位功能无服务端接口。
- 用户自定义分类、账号注销、月度汇总冗余表、RS256/JWT 黑名单（v2 事项）。
- 自动化单元/E2E 测试体系（06 §3 明确不引入）；以 typecheck + lint + Swagger/手工冒烟为准入。
- 前端客户端改造（本仓库只交付服务端）。

## Background & Context

- 仓库已有最小脚手架：NestJS 12、**ESM（`"type":"module"` + NodeNext + `.js` 导入后缀）**、TypeScript 6、vitest、oxlint。文档 01 §3.1 的保守选择是 CommonJS，但同时明确 Nest 12 支持 ESM 且「后续可平滑迁移 ESM」。
- 文档是唯一设计依据；本 spec 为其蒸馏，冲突时以 `docs/server/` 原文为准。
- 环境凭据由用户直接提供（MySQL/Redis 公网地址），作为开发环境使用，写入不入库的 `.env.development`；仓库只提交 `.env.example`。

## Functional Requirements

### FR-1 认证与用户（04a）

- 手机号注册：校验 `^1[3-9]\d{9}$`、密码 8~32、弱口令 Top 列表拒绝；同事务创建用户 + 默认账本「个人账本」(budget=0,is_default=1) + 偏好行；签发双令牌。
- 登录：手机号/密码统一错误文案防枚举；失败 5 次/15 分钟（同手机号）锁定，同 IP 20 次/15 分钟；成功刷新 last_login_at。
- refresh：30 天有效、库存 SHA256、刷新即轮换；旧令牌重用 → 吊销该用户全部 refresh，返回 40102。
- 登出吊销 refresh（可携带 refreshToken 一并吊销）。
- 用户资料 GET/PATCH `/users/me`（昵称 1~12 字，错误码 40010）；手机号脱敏 `138****8000`；joinDays 含当天。
- 我的页统计：records / days / books / joinDays 实时聚合。
- 偏好 GET/PUT：activeBookId、flowMonth、flowType(ALL|EXPENSE|INCOME)、statsMonth、statsType、lastBillType、lastPayMethod、lastCategory{expense,income}；PUT 为整体替换，字典/账本 id 校验。
- 头像 multipart 上传：sharp 长边 512/质量 0.85，写 `avatars/{userId}/avatar-ts-rand.jpg`，更新 users.avatar_key，返回签名 URL。

### FR-2 账本（04c §一）

- 列表（含 active、billCount 实时 COUNT、默认账本排首、sort_order,id 排序）、新建（≤20 个，重名允许，activate 可选）、激活账本获取/切换、详情、PATCH 名称/预算（40010/40011）、删除。
- 删除规则（单事务）：默认账本 40021；有账单未带 migrateBookId → 40020(409)；目标非法 → 40022；合法则迁移账单、删账本、激活态重置默认账本；空账本直接删并修正激活态。

### FR-3 字典（04c §二）

- `GET /categories?type=`：不传按 `{expense:[...],income:[...]}` 分组，传 type 返回数组；字段 id/name/icon/color/bg，按 sort_order。
- `GET /pay-methods`：仅 status=1；账单 JOIN 不过滤状态（历史可追溯）。
- Redis 缓存 24h TTL，服务重启不预热。

### FR-4 账单（04b）

- 分页列表（month 或 startDate/endDate 半开区间、type、bookId、categoryId、page/pageSize；固定排序 record_date DESC, record_time DESC, created_at DESC；分页响应结构）。
- 今日流水、按月按天分组（今天/昨天/周X 文案、truncated 1000 上限）、月汇总（含 balance/count）、详情（bookName、recorder、recordTime、monthExpense、createdAt/updatedAt）。
- 新增：字典严格校验（42200/42201，不静默回退）、金额 round2 且 >0（40001）、备注 ≤50（40002）、photos ≤3 且只认本站 key（40003）、日期不可未来（40004）、账本归属（40401）、bookId 缺省取激活/默认账本；事务写 bills+bill_photos；支持 Idempotency-Key（Redis 24h）。
- 编辑：局部更新、SELECT...FOR UPDATE、photos 全量替换语义、updatedAt 乐观并发（409）。
- 删除：物理删除（照片级联），重复删除 404；清空：confirm=true 必填、可限定 bookId、返回 deletedCount。
- BillVM：amount 带符号、amountAbs、字典 JOIN 元数据、photos 为实时签名 URL 数组、bookId 字符串。

### FR-5 统计与首页（04d）

- overview：total/oppositeTotal/balance/count/dailyAverage/elapsedDays/mom（当前月 elapsedDays 取今天日序；环比 null/`--` 规则）。
- categories 排行、pay-methods 排行（固定支出口径）：percent 两位小数、total=0 时空列表。
- trend：months 3~12（默认 6），服务端生成连续月份补零，升序。
- `/overview/home`：todayDate、user.name、month（跨全部账本）、budget（激活账本，progress 封顶 100，overBudget）、today 列表。

### FR-6 上传与文件（04c §三）

- `POST /uploads/image`：multipart，scene=bill(默认)/avatar；JPEG/PNG/WebP、≤5MB、边长 ≤4096；扩展/MIME/魔术字节三重校验；Multer 内存；账单图长边 1440/质量 0.82、去 EXIF、PNG 填白底转 JPEG；写盘权限 0700/0600；返回 key/签名 url/expiresAt/width/height/size；20 次/10 分钟（42901）；存储不可用 50002。
- key 规则：`bills/{userId}/{yyyy}/{MM}/{dd}/{yyyyMMdd-HHmmss}-{8rand}.jpg`。
- `GET /files/:key?e=&sign=`：@Public + FileSignGuard，`HMAC_SHA256(secret, key+'.'+e)`，过期/篡改/穿越一律无差别 403/404；StreamableFile + jpeg + Cache-Control private,max-age=3600 + nosniff。
- 每日清理任务：账单照片删库后磁盘保留 7 天；24h 孤儿文件删除；头像旧版保留 1 个 7 天；磁盘/inode <10% 告警日志。
- 启动校验 UPLOAD_DIR 存在且可写，否则 fail-fast。

### FR-7 横切与运维

- 统一响应 `{code:0,message:'ok',data,traceId,timestamp}`；统一错误结构（code/message/data/details/traceId/timestamp）与 03 §4.2 全部错误码。
- ValidationPipe 全局 whitelist+forbidNonWhitelisted+transform；BIGINT 输出字符串、DECIMAL 输出两位小数 number。
- 全局 ThrottlerGuard（Redis 存储，默认 120/min）+ 分档（login/register/refresh/bills 写/删除/上传），返回 X-RateLimit-*。
- JwtAuthGuard 全局 + @Public 白名单；冻结用户 40300；所有按 id 查询强制 user_id 隔离。
- nestjs-pino 结构化日志 + traceId（X-Request-Id 透传/32 位 hex 生成）+ 异步审计 operation_logs（不记请求/响应体）；redact 密码/token/手机号。
- `/health` Terminus：MySQL ping、Redis ping、磁盘可写；Swagger `/api/docs` 仅非生产；helmet；CORS 白名单；优雅退出。

## Non-Functional Requirements

- **NFR-1 正确性**：金额 DECIMAL(12,2) 入库恒正、round2 与客户端同口径；所有统计 SQL 实时聚合；接口契约字段名/类型/状态码/错误码与文档完全一致。
- **NFR-2 安全**：满足 07 文档发版前清单中可在代码层落实的全部项（参数化 SQL、越权 404、文件校验/签名、密钥仅环境变量、日志脱敏）。
- **NFR-3 可运行性**：`pnpm install && pnpm migration:run && pnpm start:dev` 在本机可直连给定 MySQL/Redis 启动成功；`pnpm build` 与 `pnpm typecheck` 通过；`pnpm lint` 0 warning。
- **NFR-4 工程规约**：严格遵循 05 文档分层（Controller/Service/Repository/DTO/VO/Entity）、目录结构、命名、配置走 ConfigService、无硬编码密钥。
- **NFR-5 兼容性**：ESM 工程形态（沿用脚手架），Node 22；MySQL 5.7 不使用 8.0 特性（无 CHECK 依赖、无窗口函数、无降序索引）。

## Constraints

- **Technical**：NestJS 12 + TypeScript（strict）；TypeORM 0.3 + mysql2；ioredis 5；MySQL 5.7.44；Redis 7；JWT HS256（access 2h / refresh 30d）；sharp 0.33；pnpm；Asia/Shanghai。
- **Business**：业务口径以客户端现有实现为准（README §三 7 条），服务端不得擅改；v1 无多角色、无 RBAC。
- **Dependencies**：远程 MySQL/Redis 由用户提供（开发库）；UPLOAD_DIR 默认 `./uploads`。
- **环境适配决策**：脚手架已是 ESM（NodeNext），保留 ESM 而非文档的 CommonJS 保守项（文档明确允许 ESM 演进）；TypeORM 迁移经编译产物执行（`dist/database/data-source.js`）。

## Assumptions

- 给定 MySQL 账号具备建库表的 DDL 权限；数据库 `simple-bookkeeping` 已存在或账号可建（若不可建则连接已创建好的库）。
- 远程 Redis 可公网连接且仅用于开发数据（限流/缓存 key 可随时清空）。
- bcrypt 5 / sharp 0.33 的预编译二进制在本机（macOS）可直接安装；若 bcrypt 原生安装失败，经文档允许改用 bcryptjs（接口不变）。
- 本机 Node 为 22 LTS；如不是，按文档建议切换。
- 文件签名对外基址 `FILES_BASE_URL` 开发期取 `http://localhost:3000/api/v1/files`。

## Acceptance Criteria

### AC-1：工程可启动、可构建

- **Type**：`rule`
- **Given**：仓库代码与 `.env.development`（给定 MySQL/Redis 凭据）
- **When**：依次执行 `pnpm install`、`pnpm migration:run`、`pnpm build`、`pnpm typecheck`、`pnpm lint`
- **Then**：迁移成功建出 9 张表并写入 21 行字典；build/typecheck 通过；lint 0 warning；服务 `pnpm start:dev` 监听 3000 且 `GET /health` 返回 200（DB/Redis/磁盘均 up）
- **Pass Condition**：上述命令全部退出码 0，health 响应含 db/redis 状态 ok
- **Evidence**：命令输出、9 张表清单（information_schema 查询）、categories/pay_methods 行数

### AC-2：接口契约逐端点符合文档

- **Type**：`rule`
- **Given**：服务已启动且数据库为迁移后空库
- **When**：按 04a~04d + 04c 上传章节逐端点调用（curl/HTTP，含正常与错误分支）
- **Then**：路径、方法、请求字段、HTTP 状态码、业务 code、响应字段名/类型与文档逐字一致；统一包裹含 code/message/data/traceId/timestamp；BIGINT id 为字符串、金额为两位小数 number
- **Pass Condition**：注册/登录/刷新/登出、用户资料/统计/偏好、账本 7 个、字典 2 个、账单 9 个、统计 4 个、首页 1 个、上传/签名读 2 个，全部主流程 + 文档列明的错误码分支验证通过
- **Evidence**：冒烟请求与响应记录（关键端点请求/响应输出）

### AC-3：注册事务与认证安全

- **Type**：`rule`
- **Given**：空库
- **When**：注册新手机号；用错误密码连续登录 5 次；用 refresh 换新后再次使用旧 refresh
- **Then**：注册后出现用户+默认账本（is_default=1,budget=0）+偏好行且 active_book_id 指向该账本；第 6 次登录返回 40103；旧 refresh 重用返回 40102 且该用户全部 refresh 被吊销；无 token 访问业务接口返回 40100
- **Pass Condition**：以上四项均可复现
- **Evidence**：数据库行查询结果与接口响应

### AC-4：账单与统计口径正确

- **Type**：`rule`
- **Given**：预置跨 2 个月、2 个账本、含收支与凭证的账单数据
- **When**：调用列表/今日/分组/汇总/详情/统计 4 端点/首页聚合
- **Then**：金额符号、排序（日期→时间→创建时间倒序）、balance、dailyAverage、elapsedDays（当前月按今天）、mom 各分支（上升/下降/持平/不可比）、percent、trend 补零连续、monthExpense（同日时间边界）、budget progress 封顶 100、越权访问返回 40400/40401
- **Pass Condition**：构造数据的手算值与接口输出逐项一致
- **Evidence**：造数 SQL/请求 + 期望值对照表

### AC-5：账本删除事务规则

- **Type**：`rule`
- **Given**：默认账本、空账本、有账单账本、第二账本
- **When**：分别尝试删默认账本、未带迁移删非空账本、非法 migrateBookId、合法迁移删除、删激活空账本
- **Then**：依次得到 40021、40020(409)、40022、200（migratedBillCount 正确、账单 book_id 变更、激活态回默认）、200（激活态回默认）
- **Pass Condition**：五种分支响应与数据库最终状态全部符合 04c §一·7
- **Evidence**：接口响应 + bills/books/user_preferences 校验查询

### AC-6：图片上传链路与签名访问

- **Type**：`rule`
- **When**：上传合法 JPEG/PNG、伪造 .txt/.svg/超 5MB、用返回 url 访问、篡改 sign/过期 sign/目录穿越 key 访问、触发 21 次上传
- **Then**：合法文件被重编码落盘（0600、尺寸/质量符合场景）并返回 key/url/尺寸；非法全部 40000；正确签名返回图片字节；篡改/过期/穿越返回无差别 403/404；第 21 次返回 42901；库中只存相对 key
- **Pass Condition**：各分支均符合 04c §三与 07 §7
- **Evidence**：上传/访问响应、磁盘文件元信息、错误响应

### AC-7：分层与代码质量

- **Type**：`rubric`
- **Dimension**：对 05 文档分层规约、目录结构、命名、事务范式（queryRunner）、参数化查询、配置管理的遵循度
- **Scale**：1-5
- **Anchors**：1 = 大面积跳过文档规约（如控制器写 SQL、硬编码密钥、Entity 直出）；3 = 主体合规但存在少量越层/风格漂移；5 = 严格按 05 目录与分层落地，命名/注释/错误码集中管理，无硬编码秘钥
- **Pass Threshold**：>= 4
- **Evidence**：代码走查（src 目录结构与关键文件）

### AC-8：安全基线落实

- **Type**：`rubric`
- **Dimension**：07 文档中代码层安全控制的覆盖与有效性（隔离、参数化、文件安全、日志脱敏、安全头、限流）
- **Scale**：1-5
- **Anchors**：1 = 关键控制缺失；3 = 主要控制存在但有绕过路径；5 = 纵深防御各层控制齐备且经冒烟验证
- **Pass Threshold**：>= 4
- **Evidence**：冒烟结果 + 关键实现走查（guard/filter/storage/pino redact/throttler）

## Open Questions

- 无阻塞性开放问题。以下决策已按文档默认项确定：保留 ESM 脚手架形态；bcrypt 优先（失败回退 bcryptjs）；迁移直接执行到给定开发库；定时清理任务用 `@nestjs/schedule`（04c 要求每日任务、文档未限定实现库）。
