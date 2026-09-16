# 01 · 系统架构设计

## 1. 设计目标与约束

| 项       | 说明                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 业务规模 | 个人记账工具，单用户数据量小（千级账单/年），但用户总量可能很大 → 按「用户隔离 + 索引覆盖 + 无状态水平扩展」设计 |
| 客户端   | uni-app 一套代码三端（Android App、H5、各家小程序），接口必须兼容 `uni.request`                                  |
| 数据库   | **MySQL 5.7** 明确锁定（生产既有版本，不使用 8.0 特性：无 CHECK 强制、无窗口函数、无降序索引）                   |
| 可用性   | 单机房即可起步，应用层无状态，支持多实例 + Nginx 负载均衡                                                        |
| 改造原则 | 保持客户端现有页面交互、跳转逻辑、数据口径不变，仅将 Pinia 本地读写替换为 API 调用                               |
| 明确排除 | APP 在线更新系统（见 README §1.2），保持独立服务                                                                 |

## 2. 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                              客户端层                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐  │
│  │ Android App  │   │     H5       │   │ 微信/支付宝/抖音 小程序     │  │
│  │ (uni-app)    │   │ (uni-app)    │   │ (uni-app)                │  │
│  └──────┬───────┘   └──────┬───────┘   └──────────┬───────────────┘  │
│         │  业务 API Client（统一封装：baseURL / token 注入 / 401 刷新） │
│         │  Authorization: Bearer <accessToken>                        │
└─────────┼──────────────────┼─────────────────────┼───────────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       接入层 Nginx（独立于更新系统）                    │
│   HTTPS 终止 · 静态资源回源 · 反向代理 /api/ · 限流兜底 · 安全响应头     │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ /api/v1/**
                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│                        应用层 NestJS 集群（无状态）                     │
│                                                                       │
│  Guard: JwtAuthGuard   Pipe: ValidationPipe   ThrottlerGuard（限流）    │
│  Interceptor: TransformInterceptor（统一包裹）/ LoggingInterceptor      │
│  Filter: AllExceptionsFilter（统一错误）                                │
│                                                                       │
│  ┌─────────┬─────────┬─────────┬─────────┬──────────────┬───────────┐ │
│  │  auth   │  users  │  books  │  bills  │ dictionaries │ statistics│ │
│  │ 认证授权 │ 资料偏好 │ 账本预算 │ 账单流水 │ 分类/支付方式 │ 统计概览  │ │
│  └────┬────┴────┬────┴────┬────┴────┬────┴──────┬───────┴─────┬─────┘ │
│       └─────────┴─────────┴─────────┴────────────┴─────────────┘      │
│                                   │                                   │
│  ┌──────────┐  ┌────────────┐  ┌───┴────────┐  ┌───────────────────┐  │
│  │ uploads  │  │  config    │  │  database  │  │ common（基础设施） │  │
│  │ 文件上传  │  │ 环境配置    │  │ TypeORM    │  │ decorators/guard  │  │
│  └────┬─────┘  └────────────┘  └────────────┘  │ filters/...       │  │
└───────┼─────────────────────────────────────────┴───────────────────┘
        │                                              │
        ▼                                              ▼
┌──────────────────────────────────────┐  ┌──────────────────────────────┐
│  服务端本地磁盘（持久化数据卷）         │  │  数据/缓存层                   │
│  头像/凭证图片                          │  │  ┌────────────┐ ┌──────────┐ │
│  UPLOAD_DIR                           │  │  │ MySQL 5.7  │ │ Redis 7  │ │
│  bills/{uid}/yyyy/mm/dd/有意义文件名   │  │  │ 主库（InnoDB）│ │ 限流/字典 │ │
│  avatars/{uid}/有意义文件名            │  │  └────────────┘ └──────────┘ │
│  经 /files 签名 URL 只读访问           │  │                              │
└──────────────────────────────────────┘  └──────────────────────────────┘
        ▲ 多实例部署时该目录必须挂载为共享卷（NAS/NFS），见 06 文档

┌──────────────────────────────────────────────────────────────────────┐
│          【完全独立、不改造】APP 在线更新服务 static.shixian.xyz        │
│  /app-updates/check · APK 包下载 · 更新埋点上报（客户端直连，不经过本服务）│
└──────────────────────────────────────────────────────────────────────┘
```

## 3. 技术栈详细说明

### 3.1 运行时与框架（版本锁定）

| 依赖                           | 版本                                                  | 用途与选型理由                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js**                    | **22 LTS（≥ 22.12，推荐 22.22+）**                    | NestJS 12 运行基线；长期支持版                                                                                                                                  |
| **NestJS**                     | **^12.0.0**（2026-08 发布的当前稳定大版本）           | 模块化/DI/IoC 体系完整，装饰器风格与 TypeScript 契合；本项目使用官方仍完整支持的 **class-validator + class-transformer** 校验体系（不强制迁移 Standard Schema） |
| 模块格式                       | **CommonJS**（Nest 12 允许 CommonJS 应用消费 ESM 包） | 保守选择：`multer`、部分运维脚本生态兼容性最好；后续可平滑迁移 ESM                                                                                              |
| HTTP 平台                      | `@nestjs/platform-express` ^12                        | 默认平台，`uni.request` 兼容性最成熟，文件上传走 Multer                                                                                                         |
| **TypeScript**                 | \~5.6（`strict: true`）                               | 全量类型，DTO 即契约                                                                                                                                            |
| **TypeORM**                    | ^0.3.20                                               | 对 MySQL 5.7 支持成熟；迁移（migration）机制完善；参数化查询从根本上防注入                                                                                      |
| mysql2                         | ^3.11                                                 | TypeORM 驱动；支持连接池、`DECIMAL`/`DATETIME` 正确映射                                                                                                         |
| **Redis**                      | 7.x；客户端 `ioredis` ^5                              | 限流计数、字典缓存、（可选）refresh token 白名单                                                                                                                |
| `@nestjs/jwt`                  | ^11/^12 配套版                                        | access / refresh 双令牌签发与校验                                                                                                                               |
| `@nestjs/throttler`            | ^6                                                    | 接口限流，Redis 存储实现多实例一致计数                                                                                                                          |
| `@nestjs/config`               | ^4                                                    | `.env` 配置 + 环境变量校验                                                                                                                                      |
| `@nestjs/swagger`              | ^11/^12 配套版                                        | 自动生成 OpenAPI 文档（`/api/docs`，生产关闭）                                                                                                                  |
| `@nestjs/terminus`             | ^11/^12 配套版                                        | `/health` 健康检查（DB/Redis/磁盘）                                                                                                                             |
| `nestjs-pino`                  | ^4                                                    | 结构化 JSON 日志，带请求级 `traceId`                                                                                                                            |
| `bcrypt`                       | ^5（或 `bcryptjs`）                                   | 密码哈希，cost=12                                                                                                                                               |
| `sharp`                        | ^0.33                                                 | 图片重编码压缩、EXIF 清除（落本地磁盘前处理；原生模块，Docker 镜像选用 bookworm 而非 alpine）                                                                   |
| `@nestjs/serve-static`（可选） | ^5                                                    | 本地磁盘文件的静态/签名访问（v1 统一走内置 FilesController，仅在需要纯静态直出时引入）                                                                          |
| `helmet`                       | ^8                                                    | 安全响应头                                                                                                                                                      |
| 包管理                         | **pnpm** 9                                            | 磁盘节省、依赖严格（`node-linker=hoisted` 兼容原生模块）                                                                                                        |

> 版本注记：所有 `@nestjs/*` 包必须由 `nest upgrade` 统一升级同一 major，禁止混大版本。实际脚手架时以 `pnpm up --latest "@nestjs/*"` 锁定到当时的最新 12.x。

### 3.2 基础设施版本

| 组件     | 版本                                    | 说明                                                                                                                                                                          |
| -------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL    | **5.7.x（锁定 5.7 最新小版本 5.7.44）** | `utf8mb4 / utf8mb4_unicode_ci`，引擎统一 InnoDB；字符集与排序规则在库、表、连接三层保持一致                                                                                   |
| Redis    | 7.2+                                    | 仅做易失性数据（限流、缓存），不存业务真相                                                                                                                                    |
| Nginx    | 1.24+                                   | TLS 1.2/1.3、反代、`client_max_body_size` 配合上传限制                                                                                                                        |
| 容器     | Docker 24+ / Compose v2                 | 开发与部署统一；生产可用 PM2 替代                                                                                                                                             |
| 文件存储 | **服务端本地磁盘（持久化卷）**          | 根目录由 `UPLOAD_DIR` 指定（开发默认 `./uploads`，生产建议 `/data/bookkeeping/uploads`）；**不使用任何对象存储桶**。多实例时必须挂载共享卷（NAS/NFS）或固定单实例，见 06 §4.2 |

## 4. 模块划分及职责

NestJS 特性模块（feature module）与客户端现有 store 一一映射，降低团队认知成本：

| 模块                                    | 职责                                                                                                                             | 对应客户端                                                    |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **AuthModule**                          | 注册、登录、JWT 签发/校验/刷新、登出（令牌吊销）、限流策略（登录防爆破）                                                         | 新增能力（现无登录）                                          |
| **UsersModule**                         | 当前用户资料查询/修改、头像更新、记账统计（总笔数/记账天数/账本数/加入天数）、UI 偏好同步                                        | `store/modules/user.js`、`store/modules/app.js`               |
| **BooksModule**                         | 账本 CRUD、当前激活账本切换、月预算设置；默认账本保护                                                                            | `store/modules/book.js`（books / activeBookId / budget 部分） |
| **BillsModule**                         | 账单 CRUD、今日流水、按天分组、月汇总、详情（账本名/记录时间/当月截止支出）、清空                                                | `store/modules/bill.js`                                       |
| **DictionariesModule**                  | 收支分类字典、支付方式字典（只读，系统种子数据），Redis 缓存                                                                     | `store/modules/category.js`、`book.js` 的 PAY_META            |
| **StatisticsModule**                    | 分类聚合、支付方式聚合、近 6 月趋势、环比/日均、首页聚合概览                                                                     | 统计页、首页派生数据                                          |
| **UploadsModule**（含 FilesController） | 图片上传（Multer 接收 → 校验 → sharp 重编码 → **写入本地磁盘 UPLOAD_DIR** → 返回相对 key 与签名 URL）；签名 URL 的签发与读取鉴权 | `utils/image.js` + 凭证/头像                                  |
| **DatabaseModule**                      | TypeORM 全局配置、连接池、慢查询日志钩子                                                                                         | —                                                             |
| **ConfigModule**                        | 环境变量加载与启动校验（JWT 密钥/数据库/UPLOAD_DIR 缺失或目录不可写即 fail-fast）                                                | —                                                             |
| **CommonModule**（基础设施目录）        | 全局拦截器、异常过滤器、守卫、装饰器（`@CurrentUser`）、分页工具、业务异常类                                                     | —                                                             |

模块依赖方向（只允许上层依赖下层，禁止 feature 模块横向直接引用对方的 repository）：

```
controller → service → repository(TypeORM)
     └─────────── 需要跨模块数据时：注入对方模块导出的 Service（经模块 exports 暴露）
```

跨模块示例：`StatisticsService` 注入 `BillsRepository`（同模块聚合查询）+ `DictionariesService`（补图标色值）；`BillsService.create` 注入 `BooksService`（校验账本归属）+ `DictionariesService`（校验分类/支付方式）。

## 5. 一次请求的生命周期（横切关注点顺序）

```
HTTP 请求
  → Nginx（TLS、IP 白名单可选、body 大小限制）
  → ThrottlerGuard        限流（Redis 滑窗，超限 429）
  → JwtAuthGuard          校验 Bearer Token，注入 req.user（白名单：/auth/**、/health）
  → 路由匹配 + DTO 实例化
  → ValidationPipe        class-validator 白名单校验（whitelist + forbidNonWhitelisted）
  → LoggingInterceptor    生成/透传 traceId，记录入参摘要
  → Controller
  → Service（业务校验 → 抛 BusinessException；事务 @Transactional 风格的 queryRunner）
  → Repository（参数化 SQL）
  → TransformInterceptor  成功响应统一包裹 { code:0, message:'ok', data, traceId }
  → AllExceptionsFilter   业务异常/校验异常/未知异常 → 统一错误结构 + 状态码
HTTP 响应
```

## 6. 客户端改造方式（配套说明）

服务端落地后，客户端按以下方式切换，**页面与跳转逻辑零改动**（符合项目既有工程约定）：

1. 新增 `api/` 目录：`http.js`（基于 `uni.request` 的 Promise 封装，注入 `Authorization`、401 自动 refresh 重试一次、统一解包 `data`）、各资源文件 `auth.js / bills.js / books.js …`。
2. Pinia 五个 store 的 state 保留为「接口数据缓存」，actions 内部由本地数组操作改为 `await api.xxx()`；`composables/useBookkeeping.js` 的函数签名尽量保持不变，页面层无感。
3. 列表渲染继续使用 `item.id` 作为 `key`（服务端返回数字 id 的**字符串形式**，前端按不透明字符串处理）。
4. 图片不再转 base64 入库：`uni.chooseImage` 后调 `POST /v1/uploads/image` 得到 URL，账单/头像只存 URL。
5. `store/modules/app.js` 的 UI 选择态默认仍只存本地；登录后可选调用 preferences 接口做跨设备同步。
6. 在线更新相关文件一行不动。

## 7. 数据流与一致性原则

- **数据真相（source of truth）只在 MySQL**；Redis 中字典缓存设置 24h TTL，字典后台变更（v1 无后台，仅迁移脚本）后走主动失效。
- 所有聚合统计（月汇总、分类排行、趋势）由 **SQL 实时聚合**，不维护冗余汇总表——当前数据规模下索引覆盖足够，避免引入一致性维护成本；若未来单用户账单超 50 万行，再引入 `monthly_statistics` 汇总表（预留演进路径，不在 v1 实施）。
- 软删除：账单/账本仅做逻辑删除标志位预留（v1 账单删除为物理删除，账本删除为 RESTRICT；字段已在表中预留 `deleted_at`，方便未来回收）。
