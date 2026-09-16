# 04b · 接口详细文档 —— 账单模块（Bills）

对应客户端：`store/modules/bill.js` + `composables/useBookkeeping.js` 中的首页今日流水、流水页分组、账单详情。
所有接口均需登录；所有查询服务端强制按 `req.user.id` 隔离，访问他人资源一律返回 `40400`。

模块接口清单：

| #   | 方法   | 路径                    | 说明                               |
| --- | ------ | ----------------------- | ---------------------------------- |
| 1   | GET    | `/api/v1/bills`         | 账单分页列表（按月/类型/账本筛选） |
| 2   | GET    | `/api/v1/bills/today`   | 今日流水（首页用）                 |
| 3   | GET    | `/api/v1/bills/grouped` | 指定月份按天分组流水（流水页用）   |
| 4   | GET    | `/api/v1/bills/summary` | 月度收支汇总                       |
| 5   | GET    | `/api/v1/bills/:id`     | 账单详情                           |
| 6   | POST   | `/api/v1/bills`         | 新增账单                           |
| 7   | PATCH  | `/api/v1/bills/:id`     | 编辑账单（局部更新）               |
| 8   | DELETE | `/api/v1/bills/:id`     | 删除单条账单                       |
| 9   | DELETE | `/api/v1/bills`         | 清空账单（可限定账本）             |

**公共视图模型（BillVM，列表/分组/今日共用）**

| 字段        | 类型     | 说明                                                                                     |
| ----------- | -------- | ---------------------------------------------------------------------------------------- |
| id          | string   | 账单 id                                                                                  |
| type        | string   | `expense` / `income`                                                                     |
| amount      | number   | **带符号金额**：支出为负、收入为正，两位小数（对应现 `toViewModel`）                     |
| amountAbs   | number   | 金额绝对值（恒正），便于不依赖符号的展示                                                 |
| categoryId  | string   | 分类 id                                                                                  |
| category    | string   | 分类名（= 列表标题 title）                                                               |
| iconText    | string   | emoji 图标                                                                               |
| iconColor   | string   | 分类主题色                                                                               |
| iconBg      | string   | 分类浅底色                                                                               |
| payMethodId | string   | 支付方式 id                                                                              |
| payMethod   | string   | 支付方式名                                                                               |
| date        | string   | 记账日期 `YYYY-MM-DD`                                                                    |
| time        | string   | 记账时间 `HH:mm`                                                                         |
| remark      | string   | 备注（无则 `""`）                                                                        |
| photos      | string[] | 凭证图片签名 URL 数组（0~3 个，按 `sort_order` 升序；URL 指向服务端 `/files`，12h 有效） |
| bookId      | string   | 所属账本 id                                                                              |

> 字典元数据（图标/色值）在服务端 JOIN 字典表后随账单返回，客户端无需再查字典接口拼装；图片文件存于服务端本地磁盘，`photos` 返回服务端实时签发的临时 URL（形如 `https://api.example.com/api/v1/files/bills/...?e=...&sign=...`，12h 有效），客户端只渲染不持久化签名串。

---

## 1. 账单分页列表

`GET /api/v1/bills`

查询参数：

| 参数       | 类型   | 必填 | 默认     | 说明                                   |
| ---------- | ------ | ---- | -------- | -------------------------------------- |
| month      | string | 否   | 当前月   | `YYYY-MM`；与 startDate/endDate 二选一 |
| startDate  | string | 否   | —        | `YYYY-MM-DD`，半开区间起（含）         |
| endDate    | string | 否   | —        | `YYYY-MM-DD`，半开区间止（不含）       |
| type       | string | 否   | ALL      | `ALL`/`expense`/`income`               |
| bookId     | string | 否   | 全部账本 | 限定账本，须属于当前用户               |
| categoryId | string | 否   | —        | 分类筛选                               |
| page       | number | 否   | 1        | ≥1                                     |
| pageSize   | number | 否   | 20       | 1~100                                  |

排序固定：`record_date DESC, record_time DESC, created_at DESC`。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "list": [
      {
        "id": "300128",
        "type": "expense",
        "amount": -38.5,
        "amountAbs": 38.5,
        "categoryId": "4",
        "category": "餐饮",
        "iconText": "🍽️",
        "iconColor": "#ff6a3d",
        "iconBg": "#ffefea",
        "payMethodId": "2",
        "payMethod": "微信支付",
        "date": "2026-09-16",
        "time": "12:18",
        "remark": "午饭",
        "photos": [],
        "bookId": "20001"
      }
    ],
    "pagination": { "page": 1, "pageSize": 20, "total": 137, "totalPages": 7 }
  },
  "traceId": "...",
  "timestamp": "..."
}
```

错误：`40000` 月份/日期格式非法；`40401` bookId 不属于当前用户。

---

## 2. 今日流水

`GET /api/v1/bills/today?bookId=20001`

**说明**：服务端以服务器时区（Asia/Shanghai）的当天为准；对应首页 `todayViewModels`、`todayExpense/Income`。

| 参数   | 类型   | 必填 | 说明                       |
| ------ | ------ | ---- | -------------------------- |
| bookId | string | 否   | 不传则统计当前用户全部账本 |

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "date": "2026-09-16",
    "expense": 126.8,
    "income": 0,
    "list": [{ "...BillVM": "见公共视图模型" }]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

`expense/income` 为当日合计正数（两位小数），列表按时间倒序。

---

## 3. 按天分组流水（流水页）

`GET /api/v1/bills/grouped`

查询参数：

| 参数   | 类型   | 必填 | 默认     | 说明                     |
| ------ | ------ | ---- | -------- | ------------------------ |
| month  | string | 是   | —        | `YYYY-MM`                |
| type   | string | 否   | ALL      | `ALL`/`expense`/`income` |
| bookId | string | 否   | 全部账本 | —                        |

`200` 响应（结构对齐现 `groupedByDay`；仅 `day`/`date` 这类纯展示文案由服务端按中文习惯生成，客户端可直接用也可按 date 自行计算）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "month": "2026-09",
    "type": "ALL",
    "truncated": false,
    "groups": [
      {
        "day": "今天",
        "date": "9月16日",
        "recordDate": "2026-09-16",
        "expense": 126.8,
        "income": 0,
        "items": [{ "...BillVM": "..." }]
      },
      {
        "day": "昨天",
        "date": "9月15日",
        "recordDate": "2026-09-15",
        "expense": 45.0,
        "income": 200.0,
        "items": []
      }
    ]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

说明：

- 分组按 `recordDate` 倒序；组内 `items` 按时间倒序。
- `expense/income` 为 number（两位小数）；若客户端需要固定两位小数字符串，沿用现 `fmtMoney` 在展示层处理。
- 单月账单超过 1000 条时仅返回最近 1000 条并置 `truncated: true`（个人场景的保护性上限）。
- `day` 文案规则：当天「今天」、前一天「昨天」、其余「周X」，与现 `utils/date.js` 的 `dayLabel` 一致。

---

## 4. 月度收支汇总

`GET /api/v1/bills/summary?month=2026-09&bookId=20001`

| 参数   | 类型   | 必填 | 说明                                   |
| ------ | ------ | ---- | -------------------------------------- |
| month  | string | 是   | `YYYY-MM`                              |
| bookId | string | 否   | 不传跨全部账本（账本归属仍按用户隔离） |

`200` 响应（字段与现 `MonthSummary` 一致）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "month": "2026-09",
    "expense": 3280.6,
    "income": 9800.0,
    "balance": 6519.4,
    "expenseCount": 42,
    "incomeCount": 3,
    "count": 45
  },
  "traceId": "...",
  "timestamp": "..."
}
```

口径：`balance = income - expense`；全部金额两位小数；SQL 用 `SUM` 精确计算，舍入在服务端完成。

---

## 5. 账单详情

`GET /api/v1/bills/:id`

**说明**：在 BillVM 基础上补充账本名、记录时间、当月截止支出、记录人，对齐现 `detailById` + `recorder`。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "300128",
    "type": "expense",
    "amount": -38.5,
    "amountAbs": 38.5,
    "categoryId": "4",
    "category": "餐饮",
    "iconText": "🍽️",
    "iconColor": "#ff6a3d",
    "iconBg": "#ffefea",
    "payMethodId": "2",
    "payMethod": "微信支付",
    "date": "2026-09-16",
    "time": "12:18",
    "remark": "午饭",
    "photos": [
      "https://api.example.com/api/v1/files/bills/10001/2026/09/16/20260916-121830-a1b2c3d4.jpg?e=1726466400&sign=8f2c..."
    ],
    "bookId": "20001",
    "bookName": "个人账本",
    "recorder": "小绿",
    "recordTime": "2026-09-16 12:18:00",
    "monthExpense": 2651.3,
    "createdAt": "2026-09-16T12:18:42.231+08:00",
    "updatedAt": "2026-09-16T12:20:00.000+08:00"
  },
  "traceId": "...",
  "timestamp": "..."
}
```

`monthExpense` 口径（SQL 见数据库文档 §4.3）：同用户、支出、同月、日期更早，或同日时间不晚于本单的金额合计（含本单），两位小数。

错误：`40400` 账单不存在（或无权访问）。

---

## 6. 新增账单

`POST /api/v1/bills`

**权限/限流**：登录；30 次 / 分钟。支持可选 `Idempotency-Key` 头防重复提交。

请求体：

| 字段        | 类型           | 必填 | 约束 / 默认                                 | 说明                                                                     |
| ----------- | -------------- | ---- | ------------------------------------------- | ------------------------------------------------------------------------ |
| type        | string         | 否   | `expense`                                   | `expense`/`income`                                                       |
| amount      | number\|string | 是   | > 0、≤ 99,999,999.99、最多两位小数          | 服务端按「乘 100 四舍五入」清洗                                          |
| categoryId  | string         | 是   | 必须是对应 type 下启用的分类 id             | 不合法返回 `42200`（不做「其他」静默回退）                               |
| payMethodId | string         | 是   | 启用中的支付方式 id                         | 不合法 `42201`（不做「现金」静默回退）                                   |
| bookId      | string         | 否   | 当前激活账本（偏好中），无则默认账本        | 须属于当前用户，否则 `40401`                                             |
| date        | string         | 否   | 当天                                        | `YYYY-MM-DD`，不可晚于当天（允许补记历史，不允许未来账）                 |
| time        | string         | 否   | date=当天时为当前时刻；历史日期默认 `12:00` | `HH:mm`，与现默认逻辑一致                                                |
| remark      | string         | 否   | `""`                                        | trim 后 ≤ 50 字                                                          |
| photos      | string[]       | 否   | `[]`                                        | 0~3 个，须为本站上传接口返回的相对路径 key（只认本站 key，拒绝外域 URL） |

请求示例：

```json
{
  "type": "expense",
  "amount": "38.5",
  "categoryId": "4",
  "payMethodId": "2",
  "bookId": "20001",
  "date": "2026-09-16",
  "time": "12:18",
  "remark": "午饭",
  "photos": ["bills/10001/2026/09/16/20260916-121800-a1b2c3d4.jpg"]
}
```

`201` 响应：返回创建后的账单详情对象（同「GET /bills/:id」结构；`monthExpense` 同步计算）。

错误码：`40001` 金额非法；`40002` 备注超长；`40003` 图片超 3 张；`40004` 日期时间非法；`42200` 分类不匹配；`42201` 支付方式不可用；`40401` 账本不存在；`42900` 超限。

**服务端处理**：归属/字典校验 → `round2` 清洗与长度截断 → 事务内插入 `bills` + `bill_photos`（≤3）→ 提交。

---

## 7. 编辑账单

`PATCH /api/v1/bills/:id`

**说明**：局部更新，只传需要修改的字段；服务端在事务内 `SELECT ... FOR UPDATE` 后更新。若 `type` 改变，原 `categoryId` 必须与新 type 匹配（客户端切换收支方向时应同时重选分类，否则 `42200`）。传 `photos` 即代表**全量替换**凭证列表（不传则保持不变，传空数组即清空凭证）。

请求体：同新增，所有字段可选。额外可选：

| 字段      | 类型   | 说明                                              |
| --------- | ------ | ------------------------------------------------- |
| updatedAt | string | 乐观并发标记；与库中不一致返回 `409`（v1 可不传） |

`200` 响应：更新后的账单详情对象（同 GET 详情）。
错误：`40400` 不存在；`40001~40004`、`42200`、`42201` 同新增；`409` 并发冲突。

---

## 8. 删除单条账单

`DELETE /api/v1/bills/:id`

**权限/限流**：登录；删除类合计 20 次 / 分钟。

**行为**：物理删除账单，`bill_photos` 由外键 `ON DELETE CASCADE` 同步清除；磁盘上的图片文件进入每日清理任务（保留 7 天后 `fs.unlink` 物理回收，防止误删无法申诉）。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": { "id": "300128", "deleted": true },
  "traceId": "...",
  "timestamp": "..."
}
```

错误：`40400` 账单不存在（重复删除同样返回 404）；`42900` 超限。

---

## 9. 清空账单

`DELETE /api/v1/bills`

**说明**：对应现 `clearAllBills()`；高危操作，仅限删除**当前用户自己**的数据。建议客户端在「设置」中二次确认后调用（v1 菜单尚为占位，接口先行）。

查询参数 / 请求体：

| 字段    | 位置 | 类型    | 必填 | 说明                                     |
| ------- | ---- | ------- | ---- | ---------------------------------------- |
| bookId  | body | string  | 否   | 只清空指定账本；不传清空全部账本下的账单 |
| confirm | body | boolean | 是   | 必须显式传 `true`，否则 `40000`          |

```json
{ "bookId": "20001", "confirm": true }
```

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": { "deletedCount": 137 },
  "traceId": "...",
  "timestamp": "..."
}
```

**服务端处理**：单事务 `DELETE FROM bills WHERE user_id=? [AND book_id=?]`（照片级联）；删除条数计入审计日志（`operation_logs` 记录 method/path/操作人，不记录逐条明细）。
错误：`40000` 缺少 confirm；`40401` 账本不存在；`42900` 超限。
