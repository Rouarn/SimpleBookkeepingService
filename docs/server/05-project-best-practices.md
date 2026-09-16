# 05 · 项目结构与最佳实践

## 1. 目录结构（NestJS 标准分层 + 按特性模块组织）

服务端工程建议独立仓库（或 monorepo 中的 `server/` 目录），与客户端工程物理隔离：

```
simple-bookkeeping-server/
├── src/
│   ├── main.ts                     # 引导：全局前缀/版本/管道/过滤器/拦截器/CORS/helmet/Swagger
│   ├── app.module.ts               # 根模块，只做模块组装
│   ├── config/                     # 配置层
│   │   ├── configuration.ts        # 环境变量 → 强类型配置对象
│   │   ├── config.module.ts
│   │   └── env.validation.ts       # 启动时 Joi/Zod 校验，缺关键配置直接 fail-fast
│   ├── database/
│   │   ├── database.module.ts      # TypeORM forRoot 全局模块（连接池/慢查询/时区）
│   │   ├── naming.strategy.ts      # SnakeNamingStrategy（DB snake_case ↔ DTO camelCase）
│   │   └── migrations/             # 仅迁移文件放这里
│   │       ├── 1726400000000-InitSchema.ts
│   │       └── 1726400001000-SeedDictionaries.ts
│   ├── common/                     # 跨模块基础设施
│   │   ├── decorators/
│   │   │   ├── current-user.decorator.ts   # @CurrentUser() 取 req.user
│   │   │   ├── public.decorator.ts         # @Public() 标记免登录路由
│   │   │   └── api-paginated.decorator.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── throttler.decorators.ts    # 自定义限流档位声明
│   │   ├── interceptors/
│   │   │   ├── transform.interceptor.ts   # 统一成功包裹 {code,message,data}
│   │   │   └── logging.interceptor.ts     # traceId + 耗时 + 审计入库
│   │   ├── filters/
│   │   │   └── all-exceptions.filter.ts   # 统一错误结构 + 日志脱敏
│   │   ├── pipes/
│   │   │   └── bigint-id.pipe.ts          # 路径 id 字符串校验/转换
│   │   ├── exceptions/
│   │   │   ├── business.exception.ts      # BusinessException(code, httpStatus)
│   │   │   └── error-codes.ts             # 错误码常量表（与03文档同步）
│   │   ├── dto/
│   │   │   ├── pagination.dto.ts          # PageDto / PageResult<T>
│   │   │   └── month-query.dto.ts
│   │   └── utils/
│   │       ├── money.ts                   # round2（与客户端口径一致）
│   │       ├── date.util.ts               # 月份半开区间/已过天数/周X文案
│   │       └── serialize.ts               # BIGINT → string、DECIMAL → number(2dp)
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── auth.module.ts
│   │   │   ├── auth.controller.ts
│   │   │   ├── auth.service.ts
│   │   │   ├── strategies/jwt.strategy.ts
│   │   │   ├── dto/                       # register/login/refresh.dto.ts
│   │   │   └── token.service.ts           # 签发/校验/轮换/吊销（含 Redis 锁）
│   │   ├── users/
│   │   │   ├── users.module.ts
│   │   │   ├── users.controller.ts
│   │   │   ├── users.service.ts
│   │   │   ├── dto/
│   │   │   └── users.repository.ts        # 自定义 Repository（复杂 SQL 集中处）
│   │   ├── books/
│   │   ├── bills/
│   │   │   ├── bills.controller.ts
│   │   │   ├── bills.service.ts           # 业务校验 + 事务边界
│   │   │   ├── bills.repository.ts        # 列表/聚合 SQL（createQueryBuilder）
│   │   │   ├── dto/                       # create/update/query bill dto
│   │   │   └── vo/                        # 返回视图模型组装（BillVo/GroupedVo）
│   │   ├── dictionaries/
│   │   │   ├── dictionaries.module.ts
│   │   │   ├── dictionaries.controller.ts # /categories /pay-methods
│   │   │   └── dictionaries.service.ts    # Redis 缓存
│   │   ├── statistics/
│   │   │   ├── statistics.controller.ts
│   │   │   └── statistics.service.ts      # 复用 bills.repository 的聚合方法
│   │   ├── overview/
│   │   │   └── overview.controller.ts     # 只编排，逻辑下沉 bills/books service
│   │   └── uploads/
│   │       ├── uploads.controller.ts      # POST /uploads/image
│   │       ├── files.controller.ts        # GET /files/:key 签名读取（@Public + FileSignGuard）
│   │       ├── uploads.service.ts         # 校验/sharp 压缩/写本地磁盘
│   │       ├── storage.service.ts         # 磁盘读写：路径生成/越界校验/流式输出/物理删除
│   │       ├── guards/file-sign.guard.ts  # HMAC 签名 + 过期校验
│   │       └── image.validate.ts          # 魔术字节/MIME/尺寸校验
│   └── entities/                         # TypeORM 实体（全局共享，按表一文件）
│       ├── user.entity.ts
│       ├── book.entity.ts
│       ├── bill.entity.ts
│       ├── bill-photo.entity.ts
│       ├── category.entity.ts
│       ├── pay-method.entity.ts
│       ├── refresh-token.entity.ts
│       ├── user-preference.entity.ts
│       └── operation-log.entity.ts
├── test/                               # 预留（本项目不强制测试，见 06 §5）
├── uploads/                            # 图片存储根目录（UPLOAD_DIR，.gitignore；开发本地、生产挂持久卷）
│   ├── bills/                          # 账单凭证 bills/{userId}/{yyyy}/{MM}/{dd}/有意义文件名
│   └── avatars/                        # 头像 avatars/{userId}/avatar-时间戳-随机.jpg
├── .env.development
├── .env.production                     # 不入库，由部署系统注入；仓库提供 .env.example
├── nest-cli.json
├── tsconfig.json
├── .eslintrc.cjs / eslint.config.mjs
├── .prettierrc
├── Dockerfile
├── docker-compose.yml
└── package.json
```

### 分层职责（硬性约束）

| 层         | 允许做                                             | 禁止做                                           |
| ---------- | -------------------------------------------------- | ------------------------------------------------ |
| Controller | 路由声明、DTO 接收、Swagger 注解、调用一个 Service | 写业务规则、直接操作 Repository、拼 SQL          |
| Service    | 业务校验、事务编排、跨模块协作、VO 组装、缓存策略  | 接触 HTTP 对象（req/res）、返回 Entity 原始对象  |
| Repository | 数据查询与聚合（QueryBuilder）、锁查询             | 写业务判断（如「默认账本不可删」必须在 Service） |
| DTO        | 入参结构与 class-validator 规则                    | 任何运行时逻辑                                   |
| VO         | 出参结构（Swagger 模型）                           | 带业务方法                                       |
| Entity     | 表映射与关系                                       | 作为接口出参直接返回（必须经 VO/序列化）         |

## 2. 模块化与服务拆分原则

1. **一个特性模块 = 一张/一组相关表 + 一组路由**；`imports` 只引入真正需要协作的模块，被依赖方通过模块 `exports` 暴露 Service，不导出 Repository。
2. **跨模块只读协作**：`StatisticsService` 可注入 `BillsService` 暴露的聚合方法，但不能反向让 bills 依赖 statistics。
3. **循环依赖**原则上禁止；确需双向时用 `forwardRef` 必须在 PR 中说明理由（当前模块划分无此需求）。
4. 全局模块仅三个：`ConfigModule`、`DatabaseModule`、`CommonModule`；feature 模块禁止标 `@Global()`。
5. 每个功能模块自包含（controller/service/dto/vo），可整体复制为新服务的雏形；不搞全局 `utils.service`。
6. 数据隔离规则在 Repository 层落实：所有查询方法第一个参数恒为 `userId`，签名形如 `findMonthBills(userId: number, month: string)`，从结构上杜绝漏带归属条件。

## 3. 核心代码范式

### 3.1 main.ts 全局装配

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix("api");
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });

  app.use(helmet());
  app.enableCors({
    origin: configService.get("cors.origins"),
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(), // 最外层：生成 traceId、计时
    new TransformInterceptor(), // 内层：包裹响应
  );
  app.useGlobalGuards(
    new ThrottlerGuard(), // 限流先于鉴权，挡住未登录流量
    app.get(JwtAuthGuard),
  );
  // Swagger 仅非生产
  if (configService.get("nodeEnv") !== "production") setupSwagger(app);
  app.enableShutdownHooks();
  await app.listen(configService.get("port"), "0.0.0.0");
}
```

### 3.2 业务异常与错误码

```ts
// common/exceptions/business.exception.ts
export class BusinessException extends HttpException {
  constructor(
    code: number,
    httpStatus: HttpStatus,
    message: string,
    details?: unknown,
  ) {
    super({ code, message, data: null, details }, httpStatus);
  }
}
// 使用
throw new BusinessException(
  42200,
  HttpStatus.UNPROCESSABLE_ENTITY,
  "分类不存在或与收支类型不匹配",
);
```

### 3.3 事务范式（queryRunner，禁止隐式依赖）

```ts
async createBill(userId: number, dto: CreateBillDto): Promise<BillVo> {
  // 事务外：归属/字典/金额等全部前置校验
  await this.booksService.assertOwned(userId, dto.bookId);
  const category = await this.dictionariesService.getCategoryOrFail(dto.categoryId, dto.type);
  const payMethod = await this.dictionariesService.getPayMethodOrFail(dto.payMethodId);
  if (dto.photos?.length > 3) throw new BusinessException(40003, HttpStatus.BAD_REQUEST, '凭证图片超过 3 张');

  const runner = this.dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const bill = await runner.manager.getRepository(Bill).save(/* ...round2 清洗后的实体 */);
    if (dto.photos?.length) {
      await runner.manager.getRepository(BillPhoto).save(toPhotoEntities(bill.id, userId, dto.photos));
    }
    await runner.commitTransaction();
    return this.buildBillVo(userId, bill.id);   // 事务提交后再做 JOIN 查询组装 VO
  } catch (e) {
    await runner.rollbackTransaction();
    throw e;
  } finally {
    await runner.release();
  }
}
```

规则：事务内只做必要写操作；外部调用（磁盘 I/O、Redis、日志）一律放在事务外——图片先落盘成功，再开事务写库，避免「库有记录、文件缺失」；事务方法名与普通方法区分（`createBillInTx` 风格或注释标注）。

### 3.4 金额与日期工具（与客户端同口径）

```ts
// common/utils/money.ts —— 与客户端 bill.js 的 round2 完全一致
export const round2 = (n: number | string): number =>
  Math.round((Number(n) || 0) * 100) / 100;
```

- DECIMAL 从 mysql2 取出是字符串，经 `round2` 统一转 number；聚合 `SUM` 结果同样处理。
- 月份区间工具：`monthRange('2026-09') => ['2026-09-01','2026-10-01']`，所有月度查询只用半开区间，禁止 `DATE_FORMAT(record_date)` 入 WHERE。

## 4. 中间件 / 守卫 / 拦截器 / 过滤器 / 管道使用规范

| 组件             | 本项目用途                                                                                                         | 全局/局部 | 注意点                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ | --------- | --------------------------------------------------------- |
| Middleware       | 仅用于原始访问日志采样（可选）                                                                                     | —         | 业务逻辑不用 middleware，优先 guard/interceptor           |
| Guard            | `JwtAuthGuard`（鉴权+冻结校验+注入 user）、`ThrottlerGuard`（多档限流）                                            | 全局      | `@Public()` 装饰器白名单；执行顺序 Throttler → JWT        |
| Interceptor      | `LoggingInterceptor`（traceId、耗时、写 operation_logs）、`TransformInterceptor`（统一包裹+BIGINT/DECIMAL 序列化） | 全局      | Logging 最外、Transform 最内；模块私有拦截器按需声明      |
| Exception Filter | `AllExceptionsFilter`：业务异常直出、校验异常归一 40000+details、未知异常 50000                                    | 全局      | 5xx 必须记录完整堆栈，对外只回通用文案+traceId            |
| Pipe             | 全局 `ValidationPipe`；路径参数 `BigIntIdPipe`                                                                     | 全局+局部 | 不允许在 controller 内手写参数校验                        |
| Decorator        | `@CurrentUser()`、`@Public()`、`@ThrottleRate(...)`                                                                | —         | 自定义取参/标记一律走装饰器，不在 controller 读 `request` |

## 5. 代码规范与风格指南

1. **TypeScript strict 全开**：`strict: true`、`noImplicitOverride`、`exactOptionalPropertyTypes` 视团队接受度开启；禁止 `any`（确需时用 `unknown` 并收窄），`@ts-ignore` 需注释理由。
2. **ESLint + Prettier**：规则集 `@typescript-eslint/recommended` + `eslint-config-prettier`；保存自动格式化；CI 跑 `eslint --max-warnings 0`。
3. 命名：类 PascalCase、变量函数 camelCase、常量 UPPER_SNAKE、文件 kebab-case；文件名与其主类同名（`bill-photo.entity.ts` 导出 `BillPhoto`）。
4. 控制器方法命名与 HTTP 语义一致：`findAll/create/findOne/update/remove`。
5. 所有公开类与复杂函数写 JSDoc 中文注释，说明业务口径（特别是金额/日期/舍入）；接口方法标注 Swagger `@ApiOperation({ summary })`。
6. 配置一律走 `ConfigService`，代码中**不允许出现硬编码密钥、内网地址、绝对存储路径**；魔法值抽常量（如 `MAX_PHOTOS = 3`、`REMARK_MAX_LENGTH = 50`，数值与 03 文档校验表一致）。
7. 日志：`logger.info/warn/error` 结构化字段；禁止打印密码、完整 token、手机号（统一脱敏 `138****8000`）。
8. 异步：全部 `async/await`，禁止裸 Promise 不接 `catch`；可观测的后台任务（孤儿文件/过期图片每日磁盘清理）必须包 try/catch 并打点。
9. 提交信息建议 Conventional Commits：`feat(bills): ...`、`fix(auth): ...`、`refactor`、`chore`。

## 6. 依赖管理策略

1. **包管理器固定 pnpm**：`packageManager` 字段锁定版本；提交 `pnpm-lock.yaml`；CI 用 `pnpm install --frozen-lockfile`。
2. 依赖分级：
   - `dependencies`：仅运行时必需；
   - `devDependencies`：CLI、lint、类型、Swagger CLI 等；
   - 新增三方包前评估：周下载量、最近发版、是否原生模块（bcrypt 走 prebuild，部署镜像需匹配）。
3. **Nest 全家桶版本统一**：所有 `@nestjs/*` 同一 major（12.x），升级统一走 `nest upgrade`，禁止单独升某一个。
4. 安全更新：每周跑 `pnpm audit`；高危（有 PoC、远程可利用）当天升级，其余随版本迭代。
5. Node 版本固定：仓库根 `.nvmrc` 写 `22`；Docker 基础镜像 `node:22-alpine`（native 模块用 `node:22-bookworm` 或编译工具链）。
6. 不引入重型/重复能力的库：校验只用 class-validator；日期用原生 + 自有少量工具函数，不引 moment/dayjs（记账日历需求简单，避免包体与时区歧义）；SQL 只用 TypeORM QueryBuilder，不混用第二套 ORM。

## 7. 配置与环境管理

| 变量                                                                     | 说明                                                                                       |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `NODE_ENV`                                                               | development / production                                                                   |
| `PORT`                                                                   | 服务端口（默认 3000）                                                                      |
| `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME`                            | MySQL 连接；额外 `DB_CONNECTION_LIMIT`                                                     |
| `REDIS_HOST/REDIS_PORT/REDIS_PASSWORD/REDIS_DB`                          | Redis                                                                                      |
| `JWT_ACCESS_SECRET/JWT_REFRESH_SECRET`                                   | ≥32 字节随机串，dev/prod 隔离                                                              |
| `JWT_ACCESS_TTL=2h`、`JWT_REFRESH_TTL=30d`                               | 令牌寿命                                                                                   |
| `UPLOAD_DIR`                                                             | 图片存储根目录（开发默认 `./uploads`，生产 `/data/bookkeeping/uploads`，须存在且进程可写） |
| `FILES_BASE_URL`                                                         | 拼接签名 URL 的对外基址，如 `https://api.example.com/api/v1/files`                         |
| `FILES_SIGN_SECRET`                                                      | 文件签名 URL 的 HMAC 密钥（≥32 字节，独立于 JWT 密钥）                                     |
| `FILES_LINK_TTL`                                                         | 签名 URL 有效期，默认 `12h`                                                                |
| `UPLOAD_MAX_SIZE_MB` / `UPLOAD_BILL_MAX_EDGE` / `UPLOAD_AVATAR_MAX_EDGE` | 上传上限（5MB / 1440px / 512px）                                                           |
| `CORS_ORIGINS`                                                           | 允许来源逗号分隔（H5 域名/小程序后台域名）                                                 |

`.env.example` 入库，真实 `.env.*` 不入库；启动时 env 校验失败立即退出（fail-fast），禁止带默认密钥起服务。
