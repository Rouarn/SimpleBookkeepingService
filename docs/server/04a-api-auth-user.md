# 04a · 接口详细文档 —— 认证与用户模块（Auth / Users）

对应客户端：`store/modules/user.js`（昵称/头像/加入日期/记账统计）、`store/modules/app.js`（UI 偏好，可选同步）。
鉴权说明：除标注「公开」外均需 `Authorization: Bearer <accessToken>`。

模块接口清单：

| #   | 方法  | 路径                           | 说明                            | 鉴权                     |
| --- | ----- | ------------------------------ | ------------------------------- | ------------------------ |
| 1   | POST  | `/api/v1/auth/register`        | 手机号注册（自动创建默认账本）  | 公开                     |
| 2   | POST  | `/api/v1/auth/login`           | 手机号密码登录                  | 公开                     |
| 3   | POST  | `/api/v1/auth/refresh`         | 刷新令牌（轮换）                | 公开（凭 refresh token） |
| 4   | POST  | `/api/v1/auth/logout`          | 登出并吊销 refresh token        | 登录                     |
| 5   | GET   | `/api/v1/users/me`             | 当前用户资料                    | 登录                     |
| 6   | PATCH | `/api/v1/users/me`             | 修改昵称                        | 登录                     |
| 7   | POST  | `/api/v1/users/me/avatar`      | 更换头像（multipart 直传）      | 登录                     |
| 8   | GET   | `/api/v1/users/me/stats`       | 记账总笔数/天数/账本数/加入天数 | 登录                     |
| 9   | GET   | `/api/v1/users/me/preferences` | 获取 UI 偏好                    | 登录                     |
| 10  | PUT   | `/api/v1/users/me/preferences` | 全量同步 UI 偏好                | 登录                     |

---

## 1. 注册

`POST /api/v1/auth/register`

**说明**：注册成功即在同一事务内创建用户、默认账本「个人账本」（budget=0）、偏好行；直接签发双令牌，无需再调登录。

**权限/限流**：公开；3 次 / 小时 / IP（42900）。

请求体：

| 字段     | 类型   | 必填 | 约束                                 | 说明                              |
| -------- | ------ | ---- | ------------------------------------ | --------------------------------- |
| phone    | string | 是   | 11 位大陆手机号 `^1[3-9]\d{9}$`      | 作为登录账号                      |
| password | string | 是   | 8~32 位                              | bcrypt cost=12 存库               |
| nickname | string | 否   | ≤ 12 字                              | 不传默认「小绿」                  |
| deviceId | string | 否   | ≤ 64                                 | 设备标识，用于 refresh token 管理 |
| platform | string | 否   | app/h5/mp-weixin/mp-alipay/mp-douyin | 同请求头                          |

请求示例：

```json
{
  "phone": "13800138000",
  "password": "Lvt2026!xy",
  "nickname": "小绿",
  "deviceId": "dev-a8f3k1",
  "platform": "app"
}
```

`201` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "refreshToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 7200,
    "user": {
      "id": "10001",
      "phone": "138****8000",
      "nickname": "小绿",
      "avatarUrl": "",
      "joinDate": "2026-09-16",
      "joinDays": 1
    }
  },
  "traceId": "...",
  "timestamp": "2026-09-16T10:00:00.000+08:00"
}
```

错误：`40000` 参数错误；手机号已注册返回 `40000`，message「该手机号已注册」（details.field=`phone`）；`42900` 超限。

---

## 2. 登录

`POST /api/v1/auth/login`

**权限/限流**：公开；同手机号 5 次 / 15 分钟（超限 `40103`，锁定 15 分钟），同 IP 20 次 / 15 分钟。

请求体：

| 字段     | 类型   | 必填 | 说明     |
| -------- | ------ | ---- | -------- |
| phone    | string | 是   | 手机号   |
| password | string | 是   | 密码     |
| deviceId | string | 否   | 设备标识 |
| platform | string | 否   | 平台     |

`200` 响应：结构同注册成功（`user` 内额外返回 `lastLoginAt` ISO 时间）。登录成功时服务端刷新 `users.last_login_at`。

错误：`40000` 手机号或密码错误（统一文案「手机号或密码错误」，不区分账号是否存在，防枚举）；`40300` 账号冻结；`40103` 尝试过多。

---

## 3. 刷新令牌

`POST /api/v1/auth/refresh`

**说明**：access token 过期后调用；服务端执行**刷新轮换**——旧 refresh 立即吊销、签发新双令牌。检测到已吊销的 refresh 被再次使用时，吊销该用户全部 refresh token（疑似泄漏），返回 `40102` 强制重新登录。

**权限/限流**：公开；30 次 / 分钟。

请求体：

| 字段         | 类型   | 必填 | 说明                                   |
| ------------ | ------ | ---- | -------------------------------------- |
| refreshToken | string | 是   | 登录/注册/上次刷新获得的 refresh token |

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "eyJhbGciOi...(new)",
    "refreshToken": "eyJhbGciOi...(new)",
    "tokenType": "Bearer",
    "expiresIn": 7200
  },
  "traceId": "...",
  "timestamp": "..."
}
```

错误：`40102` refresh 无效/过期/已吊销/泄漏作废。

---

## 4. 登出

`POST /api/v1/auth/logout`

**说明**：吊销当前 refresh token（按 jti）。access token 为无状态短期令牌，客户端自行丢弃即可。

请求头：`Authorization: Bearer <accessToken>`；请求体：`{ "refreshToken": "..." }`（refreshToken 可选，携带则一并吊销）。

`200` 响应：`{ "code": 0, "message": "ok", "data": null, ... }`。限流：全局默认。

---

## 5. 获取当前用户资料

`GET /api/v1/users/me`

**权限/限流**：登录；全局默认。

`200` 响应（字段与客户端 `UserProfile` + 派生字段对齐）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "10001",
    "phone": "138****8000",
    "name": "小绿",
    "avatar": "",
    "joinDate": "2026-06-09",
    "joinDays": 100
  },
  "traceId": "...",
  "timestamp": "..."
}
```

字段说明：

| 字段     | 说明                                                                                                 |
| -------- | ---------------------------------------------------------------------------------------------------- |
| name     | 昵称，对应现 store 的 `profile.name`                                                                 |
| avatar   | 头像 URL；未设置时为 `""`，客户端继续使用内置兜底图 `/static/other/01.png`（归一化逻辑保留在客户端） |
| joinDate | 加入日期 `YYYY-MM-DD`                                                                                |
| joinDays | 加入产品的第 N 天（含当天，最小 1），与现 `userStore.joinDays` 口径一致                              |

---

## 6. 修改昵称

`PATCH /api/v1/users/me`

**权限/限流**：登录；全局默认。

请求体（局部更新，当前仅开放昵称）：

| 字段 | 类型   | 必填 | 约束                 |
| ---- | ------ | ---- | -------------------- |
| name | string | 是   | 去首尾空格后 1~12 字 |

```json
{ "name": "夏季" }
```

`200` 响应：返回更新后的完整资料对象（同「GET /users/me」的 data）。

错误：`40010` 昵称为空或超长。

---

## 7. 更换头像

`POST /api/v1/users/me/avatar`

**说明**：`multipart/form-data` 直传，服务端校验 → sharp 压缩 → **写入服务端本地磁盘**（`UPLOAD_DIR/avatars/{userId}/`）→ 更新 `users.avatar_url`（存相对路径 key）一步完成（客户端不再把图片转 base64 入库）。

**权限/限流**：登录；20 次 / 10 分钟（42901）。

请求：

| 部分 | 类型   | 必填 | 约束                                                    |
| ---- | ------ | ---- | ------------------------------------------------------- |
| file | binary | 是   | JPEG/PNG/WebP；≤ 5 MB；服务端校验 MIME 与文件头魔术字节 |

`201` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "avatar": "https://api.example.com/api/v1/files/avatars/10001/avatar-20260916-100000-a1b2c3d4.jpg?e=1726466400&sign=8f2c...",
    "expiresAt": "2026-09-16T22:00:00.000+08:00"
  },
  "traceId": "...",
  "timestamp": "..."
}
```

> 头像文件保存在服务端本地磁盘 `UPLOAD_DIR/avatars/{userId}/`，文件名有意义、可读且不冲突：`avatar-{yyyyMMdd-HHmmss}-{8位随机}.jpg`（如 `avatar-20260916-100000-a1b2c3d4.jpg`），可直接从文件名看出所属用户与上传时间。数据库 `avatar_url` 只存**相对路径 key**（不存域名与签名），每次资料接口返回时由服务端用 HMAC 实时生成签名访问 URL（默认 12h 有效），客户端拿到即渲染、不长期缓存签名串。旧头像文件由每日清理任务回收（保留最近 1 个历史版本 7 天）。

错误：`40000` 文件类型/大小不合法；`50002` 文件存储不可用（磁盘不可写/空间不足）。

---

## 8. 我的页记账统计

`GET /api/v1/users/me/stats`

**说明**：对应「我的」页三个数字，实时聚合，不落库。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "records": 326,
    "days": 87,
    "books": 2,
    "joinDays": 100
  },
  "traceId": "...",
  "timestamp": "..."
}
```

| 字段     | 口径                             | SQL 来源                                                            |
| -------- | -------------------------------- | ------------------------------------------------------------------- |
| records  | 记账总笔数（全部账本、收支合计） | `SELECT COUNT(*) FROM bills WHERE user_id=?`                        |
| days     | 有记账记录的去重天数             | `SELECT COUNT(DISTINCT record_date) FROM bills WHERE user_id=?`     |
| books    | 账本数量                         | `SELECT COUNT(*) FROM books WHERE user_id=? AND deleted_at IS NULL` |
| joinDays | 加入第 N 天（含当天）            | 由 `users.join_date` 计算                                           |

---

## 9. 获取 UI 偏好

`GET /api/v1/users/me/preferences`

**说明**：对应 `store/modules/app.js`，用于登录后跨设备恢复选择态。用户从未写过时返回服务端默认值（字段值与客户端 `createDefaultUI()` 对齐，月份类字段为 `null`，客户端取到 null 时回退当前系统月）。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "activeBookId": "20001",
    "flowMonth": null,
    "flowType": "ALL",
    "statsMonth": null,
    "statsType": "expense",
    "lastBillType": "expense",
    "lastPayMethod": "1",
    "lastCategory": {
      "expense": "4",
      "income": "10"
    }
  },
  "traceId": "...",
  "timestamp": "..."
}
```

> `flowType` 使用枚举 `ALL|EXPENSE|INCOME`（中文「全部类型」等仅客户端展示）。`lastPayMethod` / `lastCategory` 的值为字典 id 字符串；id 失效（字典停用）时客户端忽略并回退「其他/现金」。

---

## 10. 同步 UI 偏好

`PUT /api/v1/users/me/preferences`

**说明**：整体替换（PUT 语义）。客户端在本地偏好变化后做**防抖 2 秒**上行；冲突策略为「后写覆盖」（纯个人选择态，无需乐观锁）。

请求体（所有字段可选；未传字段重置为默认值——客户端实现时应始终传完整对象）：

| 字段                 | 类型         | 约束                           |
| -------------------- | ------------ | ------------------------------ |
| activeBookId         | string\|null | 必须属于当前用户，否则 `40401` |
| flowMonth            | string\|null | `YYYY-MM`                      |
| flowType             | string       | `ALL`/`EXPENSE`/`INCOME`       |
| statsMonth           | string\|null | `YYYY-MM`                      |
| statsType            | string       | `expense`/`income`             |
| lastBillType         | string       | `expense`/`income`             |
| lastPayMethod        | string\|null | 支付方式 id                    |
| lastCategory.expense | string\|null | 支出分类 id                    |
| lastCategory.income  | string\|null | 收入分类 id                    |

```json
{
  "activeBookId": "20001",
  "flowMonth": "2026-09",
  "flowType": "ALL",
  "statsMonth": "2026-09",
  "statsType": "expense",
  "lastBillType": "expense",
  "lastPayMethod": "1",
  "lastCategory": { "expense": "4", "income": "10" }
}
```

`200` 响应：返回更新后的完整偏好对象（结构同 GET）。
错误：`40000` 枚举/月份格式非法；`42200`/`42201` 分类/支付方式 id 不存在；`40401` 账本不存在。
