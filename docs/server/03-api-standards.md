# 03 · 接口设计规范

## 1. RESTful 设计原则与命名规范

### 1.1 基本原则

1. 一切围绕**资源**建模，URL 只表达「是什么」，HTTP 方法表达「做什么」。
2. 资源名使用**小写、复数名词**：`/bills`、`/books`、`/categories`。
3. 路径层级最多两级：`/books/:bookId/bills` 这类嵌套能不嵌就不嵌——本项目账单通过 `?bookId=` 查询参数过滤，保持 `/bills` 扁平。
4. 非 CRUD 的「动作/计算结果」用子资源表达：`/bills/grouped`、`/bills/summary`、`/statistics/categories`、`/auth/refresh`。
5. 用查询参数表达筛选、分页、排序，不把动词塞进 URL（不允许 `/getBills`、`/deleteBill?id=1`）。
6. 幂等约定：`GET/PUT/DELETE` 幂等；`POST` 新建不幂等（可配合幂等键，见 §8）；`PATCH` 局部更新。
7. 时间一律 **Asia/Shanghai**，日期 `YYYY-MM-DD`、月份 `YYYY-MM`、时间 `HH:mm`（接口层）/`HH:mm:ss`（数据库层）。

### 1.2 HTTP 方法语义

| 方法 | 语义 | 本项目示例 |
| --- | --- | --- |
| GET | 查询，不产生副作用，可缓存 | `GET /v1/bills?month=2026-09` |
| POST | 新建资源；登录等非资源动作 | `POST /v1/bills`、`POST /v1/auth/login` |
| PATCH | 局部更新（只传需要改的字段） | `PATCH /v1/bills/123` |
| PUT | 整体替换/状态设置 | `PUT /v1/users/me/preferences` |
| DELETE | 删除资源 | `DELETE /v1/bills/123` |

### 1.3 URL 全量前缀与版本

- 业务接口统一前缀：**`/api/v1`**（NestJS 全局前缀 `api` + URI 版本 `v1`，Nginx 将 `/api/` 代理到服务）。
- 完整示例：`https://api.example.com/api/v1/bills?month=2026-09`
- 健康检查与文档不带版本：`GET /health`、`GET /api/docs`（仅非生产开放）。
- 在线更新接口（`/app-updates/*`）由独立服务承载，**不属于本前缀**。

## 2. 请求格式标准

### 2.1 通用请求头

| Header | 必填 | 说明 |
| --- | --- | --- |
| `Content-Type` | POST/PATCH/PUT 必填 | `application/json; charset=utf-8`；文件上传用 `multipart/form-data` |
| `Authorization` | 除白名单外必填 | `Bearer <accessToken>` |
| `X-Client-Platform` | 建议 | `app` / `h5` / `mp-weixin` / `mp-alipay` / `mp-douyin` |
| `X-Client-Version` | 建议 | 客户端版本名，如 `1.2.0`（与在线更新系统的 versionName 同值，仅作统计） |
| `X-Request-Id` | 可选 | 客户端生成的请求 ID（UUID 去横线）；不传则服务端生成，响应头原样返回 |
| `Idempotency-Key` | 可选 | 写操作幂等键，见 §8 |

### 2.2 参数传递位置

- 路径参数：资源主键 `id`（数字字符串）。
- Query：筛选（`month`、`type`、`bookId`）、分页（`page`、`pageSize`）、排序。
- Body：创建/更新的资源字段，JSON 对象。
- 布尔/枚举在 query 中传字符串，服务端 DTO 转换。

### 2.3 字段命名

- JSON 字段统一 **camelCase**（`recordDate`、`payMethodId`），数据库 snake_case，由 TypeORM `命名策略（SnakeNamingStrategy）+ DTO 显式映射` 两层转换。
- 金额字段 JSON 中为 **number**（固定两位小数语义），不用字符串、不用分为单位；`id` 为 string。
- 枚举值：`type` 只用小写英文 `expense | income`；`flowType` 只用 `ALL | EXPENSE | INCOME`。中文文案（全部类型/支出/收入）仅在客户端维护。

## 3. 统一响应格式

### 3.1 成功响应包裹

所有业务接口（含分页）HTTP 状态码为 `200`（新建为 `201`），Body 统一结构：

```json
{
  "code": 0,
  "message": "ok",
  "data": { },
  "traceId": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "timestamp": "2026-09-16T10:20:30.123+08:00"
}
```

`data` 为 `null` 表示无业务数据（如删除成功）。客户端 http 封装**只认 `code === 0`**，并把 `data` 解包返回业务层。

### 3.2 分页响应结构

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [],
    "pagination": {
      "page": 1,
      "pageSize": 20,
      "total": 137,
      "totalPages": 7
    }
  },
  "traceId": "...",
  "timestamp": "..."
}
```

分页参数约定：`page` 从 1 开始，默认 20，最大 100；`pageSize` 非法时回退默认值而非报错。账单流水页是「按月分组」结构，不使用分页（单月数据量可控，上限 1000 条，超出截断并在响应中置 `truncated=true`）。

### 3.3 空值与默认值约定

| 场景 | 约定 |
| --- | --- |
| 字符串类字段 | 不返回 `null`，空即 `""`（如 `remark`） |
| 对象/数组 | 不返回 `null`，空即 `{}` / `[]` |
| 可空关联（偏好未设置） | 返回 `null` |
| 金额 | 恒返回两位小数数字，不返回千分位、不返回货币符号；格式化由客户端负责 |
| 时间 | ISO 8601 带时区；日期类字段返回 `YYYY-MM-DD` 纯日期 |

## 4. 状态码使用规范

### 4.1 HTTP 状态码

| 状态码 | 使用场景 |
| --- | --- |
| 200 | 查询、更新、删除成功 |
| 201 | 资源创建成功（注册、新建账单/账本、上传成功） |
| 400 | 请求参数校验失败（含业务规则前置校验失败，如金额 ≤ 0） |
| 401 | 未登录 / access token 无效或过期 |
| 403 | 已登录但无权访问该资源（访问他人账单/账本） |
| 404 | 资源不存在（不区分「不存在」与「无权访问他人资源」，统一 404，防探测） |
| 409 | 资源状态冲突（账本下有账单不能删、默认账本不可删、幂等键重复冲突） |
| 422 | 语义校验失败（分类/支付方式在字典中不存在）—— 与 400 区分：格式对但业务不接受 |
| 429 | 触发限流 |
| 500 | 服务端内部错误（客户端提示「服务繁忙」，展示 traceId 供排查） |
| 503 | 维护中/依赖不可用（健康检查失败下线实例时由网关返回） |

### 4.2 业务错误码

HTTP 状态码表达大类，`code` 表达精确原因。规则：`0` 成功；`4xxxx` 客户端问题（前三位对齐 HTTP 语义）；`5xxxx` 服务端问题。

| code | HTTP | 含义 |
| --- | --- | --- |
| 0 | 200/201 | 成功 |
| 40000 | 400 | 参数校验失败（`details` 字段携带字段级错误） |
| 40001 | 400 | 金额必须大于 0 |
| 40002 | 400 | 备注超过 50 字 |
| 40003 | 400 | 凭证图片超过 3 张 |
| 40004 | 400 | 日期/时间格式非法 |
| 40010 | 400 | 账本名/昵称为空或超长（≤12） |
| 40011 | 400 | 预算不能为负 |
| 40020 | 409 | 账本非空，禁止删除（需迁移账单） |
| 40021 | 400 | 默认账本不可删除 |
| 40022 | 422 | 迁移目标账本不存在或不属于当前用户 |
| 40100 | 401 | 未登录或令牌缺失 |
| 40101 | 401 | access token 已过期（客户端用 refresh 换新后重试） |
| 40102 | 401 | refresh token 无效/已吊销 |
| 40103 | 429 | 登录尝试过多，账号临时锁定 |
| 40300 | 403 | 账号已冻结 |
| 40400 | 404 | 账单不存在（含无权访问他人资源） |
| 40401 | 404 | 账本不存在（含无权访问） |
| 42200 | 422 | 分类不存在或与收支类型不匹配 |
| 42201 | 422 | 支付方式不存在或已停用 |
| 42900 | 429 | 请求过于频繁 |
| 42901 | 429 | 上传过于频繁 |
| 50000 | 500 | 服务内部错误 |
| 50001 | 500 | 数据库暂不可用 |
| 50002 | 500 | 文件存储不可用（上传目录不可写 / 磁盘空间或 inode 已满） |

> 错误码一经发布只增不改不复用；废弃码在文档标记「已废弃」。

### 4.3 错误响应结构

```json
{
  "code": 42200,
  "message": "分类不存在或与收支类型不匹配",
  "data": null,
  "details": [
    { "field": "category", "value": "宠物", "reason": "income 类型下无此分类" }
  ],
  "traceId": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "timestamp": "2026-09-16T10:20:30.123+08:00"
}
```

## 5. 错误处理机制

### 5.1 服务端分层处理

```
DTO 校验（class-validator）
  → ValidationPipe 抛 BadRequestException(40000 + details)
Service 业务校验
  → 统一抛 BusinessException(code, httpStatus, message, details)
      ├─ 找不到/越权 → NotFoundException(40400/40401)
      ├─ 字典不合法 → UnprocessableEntityException(42200/42201)
      └─ 状态冲突   → ConflictException(40020)
TypeORM / 未知异常
  → AllExceptionsFilter 兜底：记录 error 级日志（含堆栈与 traceId），
    对外只返回 50000 + 通用文案 + traceId，不泄露 SQL/堆栈
```

### 5.2 客户端处理约定（http 封装职责）

1. `code === 0`：解包 `data` 返回。
2. `code === 40101`：用 refresh token 静默换新；成功则重放原请求（**仅重试一次**），refresh 也失败（40102）则清空本地令牌并跳登录。
3. `42900/42901`：toast「操作太频繁，请稍后再试」，不自动重试。
4. 其他 4xx：按 `message` 轻提示；表单类错误展示 `details[].field` 对应字段。
5. 5xx：toast「服务繁忙，请稍后重试」+ 日志附带 traceId。
6. 网络超时/断网：客户端本地提示，不产生错误码。

## 6. 认证与授权方案

### 6.1 方案总览：JWT 双令牌（无状态 access + 可吊销 refresh）

| 令牌 | 载体 | 有效期 | 存储（服务端） | 用途 |
| --- | --- | --- | --- | --- |
| access token | 响应体返回，客户端放内存（不写 localStorage 长期留存） | **2 小时** | 不存库，纯验签 | 访问业务接口 |
| refresh token | 响应体返回，客户端安全存储 | **30 天** | 库存 SHA256 哈希 + 过期/吊销状态 | 仅用于换新 access |

- 算法：`HS256`（v1 单服务）；密钥从环境变量注入，长度 ≥ 32 字节，区分 dev/prod。未来多服务可平滑升级 RS256。
- access payload：`{ sub: userId, jti, iat, exp, type:'access' }`，**不放手机号、不放权限外信息**。
- refresh payload：`{ sub: userId, jti, type:'refresh' }`；服务端凭 `jti` 查库校验未吊销、未过期。
- **刷新即轮换**：每次 `/auth/refresh` 吊销旧 refresh、签发新 refresh（检测到旧令牌被再次使用 → 判定泄漏，吊销该用户全部令牌并要求重新登录）。

### 6.2 接口分级

| 级别 | 鉴权 | 接口 |
| --- | --- | --- |
| 公开 | 无 | `POST /auth/register`、`POST /auth/login`、`POST /auth/refresh`、`GET /health` |
| 登录用户 | JwtAuthGuard | 其余全部业务接口 |
| 资源归属 | Guard + Service 双重校验 | 所有按 `id` 访问的账单/账本：SQL 强制带 `WHERE user_id = req.user.id`，查不到统一 404 |

> 本项目无多角色，不引入 RBAC；冻结账号由守卫在鉴权阶段返回 `40300`。

### 6.3 注册登录安全策略

- 密码：8~32 位，bcrypt cost=12；注册/登录接口独立限流（见 §7）。
- 登录失败 5 次/15 分钟：锁定该手机号登录 15 分钟（`40103`），计数存 Redis。
- 登出：吊销当前 refresh token（access 因无状态短期自然过期；如需即时失效，v2 引入 Redis 黑名单，TTL=access 剩余有效期）。

## 7. 限流策略

基于 `@nestjs/throttler` + Redis 存储（多实例计数一致）。以下限额按**用户 ID**（未登录按 IP）维度：

| 接口/分组 | 限额 | 超限 code | 说明 |
| --- | --- | --- | --- |
| 全局默认 | 120 次 / 分钟 | 42900 | 兜底保护 |
| `POST /auth/login` | 5 次 / 15 分钟（同手机号）；20 次 / 15 分钟（同 IP） | 40103 | 防爆破 |
| `POST /auth/register` | 3 次 / 小时（同 IP） | 42900 | 防批量注册 |
| `POST /auth/refresh` | 30 次 / 分钟 | 42900 | 客户端 bug 死循环保护 |
| `POST /bills`、`PATCH /bills/:id` | 30 次 / 分钟 | 42900 | 写入保护 |
| `DELETE /bills`、`DELETE /bills/:id` | 20 次 / 分钟 | 42900 | 防误操作脚本 |
| `POST /uploads/image` | 20 次 / 10 分钟 | 42901 | 防存储滥用；单文件 ≤ 5 MB |
| 字典/统计/查询类 | 走全局默认 | 42900 | — |

响应头返回限流余量：`X-RateLimit-Limit`、`X-RateLimit-Remaining`、`X-RateLimit-Reset`。

## 8. 幂等与并发

1. **写操作幂等键（可选）**：客户端对 `POST /bills` 可携带 `Idempotency-Key`（UUID），服务端 Redis 保留 key 24h；重复提交直接返回首次结果（账单录入可能因网络重试产生重复账单）。
2. **编辑乐观并发**：账单/账本更新可携带 `If-Unmodified-Since` 或 body 中 `updatedAt`；与库中不一致返回 `409`，提示「内容已被修改」。v1 前端为单端操作，默认不强制，编辑接口在事务内 `SELECT ... FOR UPDATE` 兜底。
3. **删除幂等**：`DELETE` 重复调用返回相同结果（首次 200，后续 404 或统一 200 均可），本项目统一返回 **404**，引导客户端刷新列表。

## 9. API 版本控制策略

1. 采用 **URI 版本**（`/api/v1`、`/api/v2`），最直观、对 `uni.request` 与 CDN 日志友好。
2. v1 内所有向后兼容变更（新增可选字段、新增接口、新增枚举值的**消费兼容**）直接上线，不升版本。
3. 以下情况升 v2：删除/重命名字段、变更字段语义或类型、变更错误码含义。
4. 下线策略：v2 发布后 v1 至少保留 **6 个月**；下线前在旧版本响应头加 `Deprecation: true`、`Sunset: <RFC1123日期>`，并通过客户端在线更新系统（独立通道）推动升级。
5. Swagger 文档与代码同版本维护：`/api/docs` 仅展示当前大版本。

## 10. 通用校验规则（DTO 基线）

| 字段类型 | 规则 |
| --- | --- |
| id（path/query） | 正整数字符串，`@IsNumberString()`；输出为字符串 |
| month | 正则 `/^\d{4}-(0[1-9]|1[0-2])$/` |
| date | 正则 `/^\d{4}-\d{2}-\d{2}$/`，且为真实日期（class-validator `@IsDateString` 严格模式） |
| time | `^([01]\d|2[0-3]):[0-5]\d$` |
| amount | 数字（或数字字符串，DTO 转换），`0 < x ≤ 99,999,999.99`，小数位 ≤ 2 |
| remark | 字符串，去首尾空格后 ≤ 50 字（按字符码点长度，emoji 算 1） |
| name（账本/昵称） | 非空、≤ 12 字 |
| budget | ≥ 0、≤ 99,999,999.99 |
| photos | 数组、长度 ≤ 3；每项为以 `https://` 开头的 URL、长度 ≤ 512 |
| 枚举 | `@IsIn(['expense','income'])`，非法枚举直接 40000 |
| 全局 | `whitelist: true` + `forbidNonWhitelisted: true`：多传字段直接 400；`transform: true` 自动类型转换 |
