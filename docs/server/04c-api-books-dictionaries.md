# 04c · 接口详细文档 —— 账本 / 字典 / 文件上传

对应客户端：`store/modules/book.js`（账本/预算/激活账本）、`store/modules/category.js`（分类字典）、`store/modules/book.js` 的 PAY_META（支付方式字典）、账单凭证图片上传。
全部接口需登录，按用户隔离。

## 一、账本模块（Books）

接口清单：

| #   | 方法   | 路径                   | 说明                           |
| --- | ------ | ---------------------- | ------------------------------ |
| 1   | GET    | `/api/v1/books`        | 账本列表（含激活态、账单笔数） |
| 2   | POST   | `/api/v1/books`        | 新建账本                       |
| 3   | GET    | `/api/v1/books/active` | 获取当前激活账本               |
| 4   | PUT    | `/api/v1/books/active` | 切换当前激活账本               |
| 5   | GET    | `/api/v1/books/:id`    | 账本详情                       |
| 6   | PATCH  | `/api/v1/books/:id`    | 修改账本名 / 月预算            |
| 7   | DELETE | `/api/v1/books/:id`    | 删除账本（可带迁移目标）       |

**账本视图模型（BookVM）**

| 字段      | 类型    | 说明                                       |
| --------- | ------- | ------------------------------------------ |
| id        | string  | 账本 id                                    |
| name      | string  | 账本名（≤12 字）                           |
| budget    | number  | 月预算（元），0 表示未设置                 |
| isDefault | boolean | 是否注册时创建的默认账本（不可删）         |
| active    | boolean | 是否当前激活账本                           |
| billCount | number  | 账本下账单总笔数（列表展示用，实时 COUNT） |
| sortOrder | number  | 排序值                                     |
| createdAt | string  | ISO 时间                                   |

### 1. 账本列表

`GET /api/v1/books`

`200` 响应（按 `sort_order, id` 升序；默认账本始终排第一）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "20001",
        "name": "个人账本",
        "budget": 5000,
        "isDefault": true,
        "active": true,
        "billCount": 137,
        "sortOrder": 0,
        "createdAt": "2026-06-09T09:12:00.000+08:00"
      }
    ]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

### 2. 新建账本

`POST /api/v1/books`

请求体：

| 字段     | 类型    | 必填 | 约束                                          |
| -------- | ------- | ---- | --------------------------------------------- |
| name     | string  | 是   | trim 后 1~12 字                               |
| budget   | number  | 否   | ≥ 0，默认 0                                   |
| activate | boolean | 否   | `true` 则新建后同时切换为激活账本，默认 false |

```json
{ "name": "旅行基金", "budget": 3000, "activate": true }
```

`201` 响应：返回 BookVM。同一用户账本名允许重复（不强制唯一，与现本地实现一致）；账本数量软上限 20 个，超出返回 `40000`「账本数量已达上限」。

### 3. 获取激活账本

`GET /api/v1/books/active`

`200` 响应：单个 BookVM。偏好中激活账本缺失（异常情况）时回退默认账本。

### 4. 切换激活账本

`PUT /api/v1/books/active`

```json
{ "bookId": "20002" }
```

`200` 响应：返回切换后的 BookVM。
错误：`40401` 目标账本不存在或不属于当前用户。

### 5. 账本详情

`GET /api/v1/books/:id` → BookVM；不存在/越权返回 `40401`。

### 6. 修改账本名 / 预算

`PATCH /api/v1/books/:id`

请求体（均可选，局部更新）：

| 字段   | 类型   | 约束                          |
| ------ | ------ | ----------------------------- |
| name   | string | trim 后 1~12 字，超长 `40010` |
| budget | number | ≥ 0，为负 `40011`             |

`200` 响应：更新后的 BookVM。
错误：`40401`；`40010`；`40011`。

### 7. 删除账本

`DELETE /api/v1/books/:id?migrateBookId=20001`

| 参数          | 位置  | 类型   | 必填 | 说明                                                                     |
| ------------- | ----- | ------ | ---- | ------------------------------------------------------------------------ |
| migrateBookId | query | string | 否   | 非空账本删除时，账单迁移目标账本（须同属当前用户、且不能是被删账本自身） |

处理规则（事务，见数据库文档 §4.2 事务⑤）：

1. 默认账本 → `40021`（默认账本不可删除）；
2. 账本下无账单 → 直接删除（若为激活账本，激活态重置到默认账本）；
3. 账本下有账单且未传 `migrateBookId` → `40020`（409，提示先迁移）；
4. 传了 `migrateBookId` 但目标非法 → `40022`；
5. 合法 → 迁移账单、删除账本、修正激活态，单事务提交。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "20002",
    "deleted": true,
    "migratedBillCount": 56
  },
  "traceId": "...",
  "timestamp": "..."
}
```

---

## 二、字典模块（Categories / Pay Methods）

字典为**系统种子数据、全局只读**，带 Redis 缓存（24h TTL，服务重启不预热，首次访问回源）。返回的色值/图标与客户端现有字典逐字一致，v1 不提供用户自定义分类能力。

### 8. 收支分类字典

`GET /api/v1/categories?type=expense`

| 参数 | 类型   | 必填 | 说明                                                 |
| ---- | ------ | ---- | ---------------------------------------------------- |
| type | string | 否   | `expense` / `income`；不传返回全部分类，按 type 分组 |

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "expense": [
      {
        "id": "1",
        "name": "其他",
        "icon": "📦",
        "color": "#ff6a3d",
        "bg": "#fff0ea"
      },
      {
        "id": "2",
        "name": "购物",
        "icon": "🛍️",
        "color": "#ff8f1f",
        "bg": "#fff3e6"
      }
    ],
    "income": [
      {
        "id": "10",
        "name": "其他",
        "icon": "📦",
        "color": "#ff6a3d",
        "bg": "#fff0ea"
      }
    ]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

指定 `type` 时 `data` 为数组：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "1",
      "name": "其他",
      "icon": "📦",
      "color": "#ff6a3d",
      "bg": "#fff0ea"
    }
  ]
}
```

字段顺序即展示顺序（按 `sort_order`）。注意「其他」在两个 type 下各有一条，**id 不同**，引用时必须带 type 语境。

### 9. 支付方式字典

`GET /api/v1/pay-methods`

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "1",
      "name": "现金",
      "shortName": "现",
      "color": "#f2994a",
      "bg": "#fdf2e4"
    },
    {
      "id": "2",
      "name": "微信支付",
      "shortName": "微",
      "color": "#07c160",
      "bg": "#e7f8ef"
    },
    {
      "id": "3",
      "name": "支付宝",
      "shortName": "支",
      "color": "#1677ff",
      "bg": "#e8f2ff"
    },
    {
      "id": "4",
      "name": "信用卡",
      "shortName": "信",
      "color": "#ff7d00",
      "bg": "#fff2e3"
    },
    {
      "id": "5",
      "name": "储蓄卡",
      "shortName": "卡",
      "color": "#5a6072",
      "bg": "#eef0f5"
    }
  ],
  "traceId": "...",
  "timestamp": "..."
}
```

> 支付方式只返回启用项（`status=1`）。账单历史引用即使遇到停用字典也照常返回（JOIN 不过滤状态），仅录入候选项被过滤。

---

## 三、文件上传与读取（本地磁盘存储）

**存储总览**：所有图片保存在**服务端本地磁盘**的持久化目录（环境变量 `UPLOAD_DIR`，开发默认 `./uploads`，生产建议 `/data/bookkeeping/uploads`），不使用任何对象存储桶。目录按业务、用户、日期分层，文件名有意义：

```
${UPLOAD_DIR}/
├── bills/{userId}/{yyyy}/{MM}/{dd}/{yyyyMMdd-HHmmss}-{8位随机}.jpg   # 账单凭证
└── avatars/{userId}/avatar-{yyyyMMdd-HHmmss}-{8位随机}.jpg           # 头像
```

文件名规则（要求可读、可排序、同秒不冲突）：

- 账单凭证：`{记账上传时刻 yyyyMMdd-HHmmss}-{8位随机}.jpg`，如 `20260916-121830-a1b2c3d4.jpg`；
- 头像：`avatar-{yyyyMMdd-HHmmss}-{8位随机}.jpg`；
- 扩展名按真实重编码输出格式统一为 `.jpg`（PNG 透明图转存时填充白底）；
- 数据库只存**相对路径 key**（如 `bills/10001/2026/09/16/20260916-121830-a1b2c3d4.jpg`），绝不存绝对路径、域名或签名串。

文件读取统一走签名 URL（`GET /api/v1/files/{key}?e={过期时间戳}&sign={HMAC-SHA256}`，TTL 默认 12h），由 Nest 的 FilesController 校验签名与过期时间后流式输出（也可由 Nginx `secure_link` 模块直接校验卸载流量，见 06 §4.4）。`uni-app` 的 `<image>` 无法自定义请求头，因此图片不走 Bearer 鉴权，而用「不可猜测的 key 前缀（含 userId）+ HMAC 签名 + 短时效」保护。

### 10. 上传图片（账单凭证）

`POST /api/v1/uploads/image`

**说明**：multipart 上传，服务端处理后写入本地磁盘。客户端 `uni.chooseImage` 后直接上传，成功后把返回的 `key` 放入新增/编辑账单的 `photos` 数组；`url` 用于即时预览（账单保存时服务端只认本站签发的 key，拒绝外域 URL）。

**权限/限流**：登录；20 次 / 10 分钟（42901）。

请求（`multipart/form-data`）：

| 部分  | 类型   | 必填 | 约束                                              |
| ----- | ------ | ---- | ------------------------------------------------- |
| file  | binary | 是   | JPEG / PNG / WebP；≤ 5 MB；像素边长 ≤ 4096        |
| scene | string | 否   | `bill`（默认）/`avatar`；决定磁盘子目录与压缩策略 |

服务端处理：Multer 内存接收（不先落临时盘）→ 校验扩展/MIME/魔术字节 → sharp 按场景重编码压缩（账单凭证长边压至 1440px，质量 0.82，并清除 EXIF）→ 按规则生成 key → `fs.writeFile` 写入 `UPLOAD_DIR` 对应子目录（目录不存在则按 userId/日期递归创建，权限 `0700`，文件权限 `0600`）→ 返回相对 key 与签名访问 URL。启动时会校验 `UPLOAD_DIR` 存在且可写，否则 fail-fast。

`201` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "key": "bills/10001/2026/09/16/20260916-121830-a1b2c3d4.jpg",
    "url": "https://api.example.com/api/v1/files/bills/10001/2026/09/16/20260916-121830-a1b2c3d4.jpg?e=1726466400&sign=8f2c1d...",
    "expiresAt": "2026-09-17T10:00:00.000+08:00",
    "width": 1440,
    "height": 1080,
    "size": 215684
  },
  "traceId": "...",
  "timestamp": "..."
}
```

错误：`40000` 文件为空/类型不允许/超大；`42901` 上传超限；`50002` 文件存储不可用（目录不可写/磁盘空间不足）。

### 11. 读取图片（签名 URL，免 Bearer）

`GET /api/v1/files/{key}?e={unixExpire}&sign={hmac}`

**说明**：接口本身标记 `@Public()`，但由 `FileSignGuard` 校验：`sign = HMAC_SHA256(FILES_SIGN_SECRET, key + '.' + e)` 且 `e` 未过期；校验通过后做路径归一化（key 必须落在 `UPLOAD_DIR` 之内，防目录穿越），以 `StreamableFile` 输出，并设置 `Content-Type: image/jpeg`、`Cache-Control: private, max-age=3600`、`X-Content-Type-Options: nosniff`。

响应：`200` 图片二进制流；签名错误/过期/路径非法一律 `403`/`404`（不区分，防探测）。

资源回收（每日定时任务扫描磁盘）：

- 凭证 key 在账单提交后归属账单；账单删除后磁盘文件保留 7 天再物理删除（误删申诉窗口）；
- 上传后 **24 小时内未被任何账单引用**的孤儿文件直接删除；
- 头像替换后旧文件保留最近 1 个历史版本 7 天；
- 任务同时校验磁盘剩余空间/inode，低于 10% 触发告警（见 06 §6）。

> 头像上传走专用接口 `POST /api/v1/users/me/avatar`（见 04a §7），目录策略与压缩（长边 512px、质量 0.85）由该接口内部处理；本接口仅用于账单凭证。
>
> **多实例注意**：本地磁盘不随请求自动共享。若应用部署多实例，`UPLOAD_DIR` 必须挂载为所有实例共享的 NAS/NFS 数据卷，或在 Nginx 层将 `/api/v1/files/` 与上传请求固定路由到同一实例；v1 推荐单机 PM2 部署（见 06 §4）。
