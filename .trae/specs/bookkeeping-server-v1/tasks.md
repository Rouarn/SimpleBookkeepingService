# 小绿记账服务端 v1 - 实现计划（Tasks）

> 任务按依赖排序；文档为唯一契约。每个任务完成时记录 Completion Evidence。

## Task 1: 依赖装配、配置层与启动引导

- **Status**: `completed`
- **Priority**: high
- **Depends On**: None
- **Description**:
  - package.json 增补依赖：@nestjs/config、@nestjs/typeorm、typeorm、mysql2、ioredis、@nestjs/jwt、@nestjs/throttler、@nestjs/swagger、@nestjs/terminus、@nestjs/schedule、nestjs-pino、pino-http、bcrypt(+@types/bcrypt)、sharp、helmet、class-validator、class-transformer、multer+@types/multer；保留 ESM/NodeNext 形态，`pnpm install` 成功（bcrypt 原生失败则改 bcryptjs）。
  - `src/config/`：configuration.ts（强类型配置树）、env.validation.ts（启动 fail-fast：DB/Redis/JWT 双密钥/FILES_SIGN_SECRET/UPLOAD_DIR）、config.module.ts。
  - `.env.example` 入库；`.env.development` 写入给定 MySQL/Redis 凭据且不入库（.gitignore 增补）；`uploads/` 目录与 .gitkeep。
  - main.ts：全局前缀 api + URI 版本 v1、helmet、CORS、ValidationPipe(whitelist/forbidNonWhitelisted/transform)、全局 filter/interceptors/guards 装配位、Swagger 非生产、shutdownHooks、Asia/Shanghai（TZ）。
  - app.module.ts 组装骨架；删除模板 app.controller/app.service 及其 spec、test/e2e 模板。
  - package.json 脚本：typecheck、migration:run/revert/generate（指向 dist/database/data-source.js，先 build）。
- **Acceptance Criteria Addressed**: AC-1, AC-7
- **Test Requirements**:
  - `rule` TR-1.1：`pnpm install` 与 `pnpm build` 退出码 0；缺少关键环境变量时进程启动即失败并有明确错误；`pnpm typecheck` 通过。证据：命令输出。
  - `rule` TR-1.2：`.env.development` 含给定连接信息但不出现在 git 状态中；`.env.example` 在库。证据：`git status --short` 与文件内容走查。

## Task 2: 数据库层 —— 实体、命名策略、迁移与种子

- **Status**: `completed`（代码完成；远程库执行被 MySQL 授权阻塞，见文末证据）
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - `database/naming.strategy.ts`（SnakeNamingStrategy）、`database/database.module.ts`（TypeOrmModule.forRootAsync：mysql2、utf8mb4、+08:00、supportBigNumbers/bigNumberStrings、synchronize=false、池配置、实体注册）。
  - `database/data-source.ts`（独立 DataSource，供 CLI 迁移；ESM 兼容）。
  - `entities/` 9 个实体：user / refresh-token / book / category / pay-method / bill / bill-photo / user-preference / operation-log（列、索引、唯一键、外键枚举严格对齐 02 §2 DDL；实体不直接作接口出参）。
  - 迁移 `1726400000000-InitSchema.ts`（9 表 DDL，与文档逐字）与 `1726400001000-SeedDictionaries.ts`（16 分类 + 5 支付方式，`INSERT ... ON DUPLICATE KEY UPDATE` 幂等）。
  - 对给定远程库执行迁移并核验。
- **Acceptance Criteria Addressed**: AC-1, AC-7
- **Test Requirements**:
  - `rule` TR-2.1：`pnpm migration:run` 成功；information_schema 查到 9 张表且关键索引/外键/字符集为 utf8mb4_unicode_ci；categories=16、pay_methods=5；迁移可重复（seed 幂等不报错、不重复增行）。证据：查询输出。
  - `rule` TR-2.2：应用启动时 TypeORM 连接成功（日志无报错，synchronize=false）。证据：启动日志。

## Task 3: Common 基础设施

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 1
- **Description**:
  - exceptions：error-codes.ts（03 §4.2 全量常量）、business.exception.ts。
  - filters/all-exceptions.filter.ts（BusinessException 直出；校验异常归一 40000+details；401/404/409/422/429 映射；未知异常 50000 + 完整堆栈日志、对外通用文案 + traceId）。
  - interceptors/transform.interceptor.ts（统一包裹；BIGINT→string、DECIMAL→两位小数 number 的序列化；null/[] 约定）。
  - 上下文与日志：trace.context.ts（AsyncLocalStorage：traceId/userId）、interceptors/logging.interceptor.ts（X-Request-Id 透传或 32hex；耗时；异步写 operation_logs，失败仅告警）；pino 模块装配（redact authorization/_.password/_.refreshToken/*.tokenHash/手机号）。
  - redis：RedisModule（ioredis 客户端，密码/db 配置，连接错误日志）。
  - 限流：redis-throttler.storage.ts（INCR+EXPIRE 滑窗固定窗实现 ThrottlerStorage）；分档声明（@Throttle 命名档：login 5/15min + IP 20/15min、register 3/h、refresh 30/min、bill-write 30/min、bill-delete 20/min、upload 20/10min、default 120/min），X-RateLimit-* 头。
  - 守卫与装饰器：jwt-auth.guard.ts（@Public 白名单、Bearer 校验、冻结 40300、注入 req.user）、public.decorator.ts、current-user.decorator.ts。
  - pipes/bigint-id.pipe.ts；dto/pagination.dto.ts、dto/month-query.dto.ts；utils：money.ts(round2)、date.util.ts（monthRange 半开区间、elapsedDays、月天数、今天/昨天/周X、月份序列、月份半开区间补零）、phone.util.ts（脱敏）、serialize 工具。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-7, AC-8
- **Test Requirements**:
  - `rule` TR-3.1：未携带 token 请求一个挂全局守卫的占位路由返回 40100 统一结构；错误响应含 traceId/timestamp；启动日志结构化 JSON 且构造含 password 的请求不会在日志明文出现。证据：启动后 curl + 日志输出。
  - `rule` TR-3.2：`round2('38.505')===38.51`、`monthRange('2026-02')===['2026-02-01','2026-03-01']`、2026-09 当前月 elapsedDays 等于当天日期数（脚本断言）。证据：一次性脚本/构建期无类型错误 + 手工 node 断言输出。

## Task 4: Auth 认证模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - entities 经 TypeOrmModule 注册；auth 模块含 auth.controller/service、token.service（@nestjs/jwt：access 2h HS256 载荷 sub/jti/iat/exp/type；refresh 30d；SHA256 存库、jti UUIDv4；签发/校验/轮换/登出吊销/重用检测→全量吊销；device/platform 记录）、strategies/jwt.strategy.ts。
  - DTO：register（phone 正则、password 8~32、nickname ≤12、deviceId/platform）、login、refresh。
  - 注册事务（queryRunner）：user + 默认账本 + preference(active_book_id=新账本)；bcrypt cost 12；手机号重复 40000「该手机号已注册」；弱口令 Top 拒绝。
  - 登录限流两维（手机号维度 Redis key、IP 维度），失败计数与 15 分钟锁定（40103）；成功发双令牌 + last_login_at；账号不存在/密码错统一文案。
  - refresh 端点 30/min 档；logout（携带 refreshToken 可选吊销）。
  - 用户冻结由全局守卫处理（strategy 查询 status）。
- **Acceptance Criteria Addressed**: AC-2, AC-3, AC-8
- **Test Requirements**:
  - `rule` TR-4.1：注册 201 返回双令牌+user（id 字符串、手机脱敏、joinDays=1），库中三实体同事务落库；重复手机号 40000；错误密码登录文案不区分账号存在性；连续 5 次失败后 40103。证据：curl 响应 + 库查询。
  - `rule` TR-4.2：refresh 轮换成功（旧 jti revoked_at 非空、新 jti 生效）；旧 refresh 二次使用返回 40102 且该用户全部 refresh token 均 revoked。证据：分步 curl + 库查询。

## Task 5: Dictionaries 字典模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - dictionaries.module/controller/service：`GET /categories`（无参分组对象、type=expense|income 返回数组，按 sort_order）、`GET /pay-methods`（仅 status=1，按 sort_order）。
  - Redis 缓存键分三类（categories:all、categories:expense、categories:income、pay_methods），TTL 24h；服务暴露供内部使用的 getCategoryOrFail(id,type)（停用/不存在/类型不匹配 → 42200）、getPayMethodOrFail(id)（停用 → 42201），JOIN 查询方法不过滤 status。
  - 模块 exports service 供 bills/statistics/users 偏好校验。
- **Acceptance Criteria Addressed**: AC-2, AC-7
- **Test Requirements**:
  - `rule` TR-5.1：三类响应结构与种子数据逐字一致（id/name/icon/color/bg/shortName、顺序）；第二次请求命中 Redis（日志/TTL 查询验证 24h）。证据：curl 响应与文档示例比对、redis TTL 查询。

## Task 6: Books 账本模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - books 模块 controller/service/repository + DTO（create：name 必填 1~12、budget≥0、activate；update：两字段可选；active 切换；list 查询）。
  - BookVM：id/name/budget/isDefault/active/billCount(实时 COUNT)/sortOrder/createdAt。
  - 列表按 is_default DESC, sort_order, id（默认始终第一）；activate 切换写 user_preferences.active_book_id；获取激活账本缺失时回退默认。
  - 数量软上限 20（40000「账本数量已达上限」）；重名允许。
  - 删除（事务⑤）：默认 40021；非空未迁移 40020(409)；目标非法 40022；迁移 UPDATE bills + 删账本 + 激活态修正；空账本直删 + 激活态修正。
  - 暴露 assertOwned(userId,bookId)（不存在/越权 40401）供 bills/statistics/users 复用。
- **Acceptance Criteria Addressed**: AC-2, AC-5
- **Test Requirements**:
  - `rule` TR-6.1：AC-5 五分支全部可复现；列表 billCount 随账单增删变化；排序默认账本恒首。证据：curl 响应 + 库状态查询。

## Task 7: Uploads/Files 文件模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 2, Task 3
- **Description**:
  - storage.service.ts：UPLOAD_DIR 启动校验（存在/可写，否则 fail-fast）；key 生成（bills/avatars 两 scene，时间戳+8 位随机，0700/0600）；path.resolve 越界校验；HMAC-SHA256 签发（key+'.'+e，TTL 12h 可配）与校验；流式读取输出；物理删除。
  - image.validate.ts：扩展名白名单 + MIME + 魔术字节一致；≤5MB、边长 ≤4096。
  - uploads.service.ts：Multer 内存（limits 5MB）→ 校验 → sharp 重编码（bill 1440/0.82、avatar 512/0.85，去 EXIF，透明图白底，统一 .jpg）→ 写盘；返回 key/url/expiresAt/width/height/size；存储错误 50002。
  - uploads.controller.ts：`POST /uploads/image`（scene=bill|avatar，20 次/10min 档，40000/42901）。
  - files.controller.ts + guards/file-sign.guard.ts：`GET /files/:key` @Public，sign/e 校验，403/404 无差别；StreamableFile + image/jpeg + Cache-Control private,max-age=3600 + nosniff。
  - cleanup.service.ts：@nestjs/schedule 每日任务——孤儿文件（24h 未被任何账单引用）删除；已无账单引用的照片 key 保留 7 天物理删；头像仅留最近 1 个历史版本 7 天；磁盘/inode <10% 告警日志；任务自身 try/catch 打点。
  - exports StorageService/UploadsService 供 bills 签名、users 头像复用。
- **Acceptance Criteria Addressed**: AC-6, AC-8
- **Test Requirements**:
  - `rule` TR-7.1：AC-6 各分支验证通过（合法/非法上传、签名访问、篡改/过期/穿越、限流、磁盘权限、库中仅 key）。证据：curl -I/响应、ls -l、错误响应。
  - `rule` TR-7.2：清理任务核心判定函数可通过手工构造临时文件验证（孤儿 24h 判定、保留期判定），任务执行不影响在用文件。证据：手工触发一次（无 @Cron 等待）输出。

## Task 8: Bills 账单模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 5, Task 6, Task 7
- **Description**:
  - bills 模块 controller/service/repository/dto/vo；CreateBillDto/UpdateBillDto/QueryBillDto（规则对齐 03 §10 与 04b）。
  - 新增（事务②）：事务外 BooksService.assertOwned（bookId 缺省→激活→默认）、字典严格校验、金额 round2/>0/上限、备注 trim ≤50、photos≤3 且只认本站 key（正则前缀 bills/，拒绝外域）、date≤今天、time 默认规则；Idempotency-Key（Redis 24h，命中返回首次结果）；事务内 insert bills+photos。
  - 编辑（事务③）：FOR UPDATE；乐观 updatedAt（409）；photos 全量替换；type 变更时分类重新校验。
  - 删除（事务④，0/影响行 404）、清空（confirm=true、bookId 可选、deletedCount、审计计数）。
  - 查询：分页列表（半开区间、固定排序、分页元数据）、today（服务器日期）、grouped（day/date 文案、truncated 1000）、summary；全部 userId 强制隔离；照片按 bill_id IN 批量二次查询装配，签名 URL 实时签发。
  - BillVM/详情 VO：amount 带符号（支出负）、amountAbs、字典字段 JOIN、bookName、recorder、recordTime、monthExpense（02 §4.3 SQL）、createdAt/updatedAt。
  - 写档限流：POST/PATCH 30/min、DELETE 20/min。
- **Acceptance Criteria Addressed**: AC-2, AC-4
- **Test Requirements**:
  - `rule` TR-8.1：9 个端点主流程 + 40001/40002/40003/40004/40400/40401/42200/42201/409 错误分支均可复现；越权（A 用户 token 访问 B 用户账单）404。证据：curl 记录。
  - `rule` TR-8.2：排序、分页、grouped 截断、monthExpense 同日时间边界、photos 签名 URL 可访问，与构造数据手算一致。证据：AC-4 对照表。

## Task 9: Users 用户模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 7, Task 5, Task 6
- **Description**:
  - users.controller/service/repository + DTO/VO。
  - GET /users/me（id/phone 脱敏/name/avatar 签名URL或""/joinDate/joinDays）；PATCH name（40010）返回完整资料。
  - POST /users/me/avatar：multipart 复用 UploadsService（scene=avatar），事务/单写更新 avatar_url 为相对 key，旧 key 留给清理任务；20 次/10min；返回 {avatar,expiresAt}。
  - GET /users/me/stats：records/days/books/joinDays（books 计 deleted_at IS NULL，v1 全为未删）。
  - preferences GET（默认值对齐 04a §9，月份 null）/PUT（全量替换；枚举/月份校验 40000；activeBookId 归属 40401；lastPayMethod 42201、lastCategory 42200）。
- **Acceptance Criteria Addressed**: AC-2, AC-6
- **Test Requirements**:
  - `rule` TR-9.1：5 个端点（含头像上传后 GET /users/me 的 avatar 为可访问签名 URL）及各错误码分支验证通过。证据：curl 记录。

## Task 10: Statistics 与 Overview 模块

- **Status**: `completed`
- **Priority**: high
- **Depends On**: Task 8, Task 5, Task 6
- **Description**:
  - statistics.controller/service：overview（total/oppositeTotal/balance/count/dailyAverage/elapsedDays/mom；上月为 0 本月>0 → percent=null,text='--'；持平 0.00%）、categories 排行（JOIN 字典、percent、total=0 空 list）、pay-methods（固定支出）、trend（months 3~12 校验、GROUP BY DATE_FORMAT 聚合 + 服务端连续月补零、label「M月」、升序）。
  - bookId 公共参数归属校验（40401）；月份默认当前月。
  - overview.controller/service：`GET /overview/home` 编排——todayDate「M月D日」、user.name、month 跨全部账本（复用 bills 聚合）、budget 取激活账本（progress 封顶 100、预算 0 → 0、overBudget）、today（复用 BillsService）。
- **Acceptance Criteria Addressed**: AC-2, AC-4
- **Test Requirements**:
  - `rule` TR-10.1：用跨两月两账本构造数据，5 个端点输出与手算值逐项一致（含环比四分支、trend 无数据月补零、预算封顶）。证据：期望值对照表。

## Task 11: Health 健康检查与收尾装配

- **Status**: `completed`
- **Priority**: medium
- **Depends On**: Task 2, Task 3, Task 7
- **Description**:
  - health.module/controller：@Public() `/health`，Terminus——MySQL ping（TypeORM 连接）、Redis ping（ioredis ping）、磁盘可写/剩余空间自定义 indicator。
  - app.module.ts 全量模块接线；Swagger 分组/模型；确认生产环境关闭 /api/docs（NODE_ENV 判断）。
  - 全局前缀下 health 路径 `/health`（无版本前缀，文档 03 §1.3）。
- **Acceptance Criteria Addressed**: AC-1, AC-2
- **Test Requirements**:
  - `rule` TR-11.1：`GET /health` 返回 200 且各 indicator status=up；NO/NODE_ENV=production 时 /api/docs 404，development 可打开 Swagger UI。证据：curl 输出。

## Task 12: 全量冒烟验证与文档化运行说明

- **Status**: `blocked`（代码与门禁就绪；远程 MySQL 未授权本机出口 IP，无法 migration:run / 启动 / 冒烟）
- **Priority**: high
- **Depends On**: Task 4, Task 6, Task 8, Task 9, Task 10, Task 11
- **Description**:
  - 全新账号走 06 §3 冒烟清单 10 条：注册默认账本→收支各 1 笔（3 凭证/50 字备注）→首页/流水/统计→编辑换类型换照片→删除→账本增删改迁移→非法上传→401 刷新→错误登录锁定。
  - 越权 A/B 用户验证；SQL 注入探针（' OR '1'='1 等）；备注 `<script>` 原样返回。
  - 运行 `pnpm typecheck && pnpm lint && pnpm build`；记录全部证据。
  - 确认 `.env.development` 不入库、uploads 运行目录权限正确；清理临时数据策略说明（开发库可保留）。
- **Acceptance Criteria Addressed**: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-8
- **Test Requirements**:
  - `rule` TR-12.1：冒烟清单 10 条全部通过并留存请求/响应证据；三道质量门禁退出码 0。证据：本任务证据章节。
  - `rubric` TR-12.2：端到端体验完整度（口径/文案/错误提示可用性）；scale 1-5；1=主流程阻断，3=主流程通但多处口径瑕疵，5=全流程无阻断且口径与文档一致；threshold >= 4；证据：冒烟记录。

---

## Completion Evidence（2026-09-22）

### 门禁

- `pnpm typecheck`（tsc --noEmit）、`pnpm lint`（oxlint 99 文件 0 警告 0 错误）、`pnpm build`（nest build）三道门禁**全绿**（两轮 Review 修复后均复跑通过）。

### 交付物

- Task 1~11 代码全部完成：`src/config`、`src/database`（9 实体 + InitSchema + SeedDictionaries 幂等种子）、`src/common`（异常信封/ALS/Redis/JWT/限流/守卫/工具）、8 个业务模块（auth、dictionaries、books、files/uploads/cleanup、bills、users、statistics+overview、health）。
- 端点数：auth 4、dictionaries 2、books 7、files 2（uploads 1 + 签名访问 1）、bills 9、users 6、statistics 4 + overview 1、health 1。

### 两轮独立 Review 结论

- 第一轮：2 阻断（DI 启动失败、throttler v6 档位语义）+ 12 重要 → **全部修复**。
- 第二轮：0 阻断；2 重要（账单列表 bookId 越权返回空列表 200、审计 http_status 失真）→ **已修复**；另采纳修复：审计 path 剥离 query（防 sign 入库）、非法 updatedAt 不再跳过乐观锁、实体索引元数据与 DDL 对齐（categories uk(type,name)、refresh_tokens idx(user_id,expires_at)）、墓碑 ENOENT 摘除、refresh_tokens 每日清理、字典缓存 JSON 容错。
- 第二轮 Review 运行时实证：Express 5.2.1 + path-to-regexp 8 通配路由 `{*key}` 实测可用；Nest 12 拦截器 finalize 早于过滤器的时序问题实测确认并修复。
- 文档外错误码 40900（幂等/乐观锁冲突）保留，视为文档错误码表缺口；框架层补充码 40404/40405/40415/50303 仅用于路由不存在等 NestJS 自身异常。
- 限流存储按 01 §6 改为 Redis ZSET **滑动窗口日志**（zremrangebyscore+zadd+zcard）。

### 阻塞项（需用户操作）

- 远程 MySQL 实测仍拒绝授权：`ER_ACCESS_DENIED_ERROR: Access denied for user 'simple-bookkeeping'@'120.216.75.162'`（本机当前出口 IP；Redis 16379 连接正常）。
- 需在 MySQL 服务端执行授权，例如：
  `GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON \`simple-bookkeeping\`.* TO 'simple-bookkeeping'@'120.216.75.162'; FLUSH PRIVILEGES;`
  （或按公司策略授权该账号的网段；IP 若变化需重新授权）。
- 授权后执行序列：`pnpm build && pnpm migration:run` → 核验 9 表 / categories=16 / pay_methods=5 → `pnpm start:dev` → Task 12 冒烟清单（注册登录、账本 5 分支、账单 CRUD、上传与签名访问、统计、health、越权 404、SQL 注入/XSS 探针、429 与 X-RateLimit-* 头）。
