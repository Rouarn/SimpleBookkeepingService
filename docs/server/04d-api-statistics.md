# 04d · 接口详细文档 —— 统计与首页概览（Statistics / Overview）

对应客户端：`pages/statistics/index.vue`、`pages/index/index.vue` 以及 `composables/useBookkeeping.js` 中的 `useStatisticsData` / `useHomeData`。
全部接口需登录、按用户隔离；金额均为 number（两位小数），统计由 SQL 实时聚合，不建汇总表。

接口清单：

| # | 方法 | 路径 | 说明 |
| --- | --- | --- | --- |
| 1 | GET | `/api/v1/statistics/overview` | 月度概览卡（总额/环比/笔数/日均/结余） |
| 2 | GET | `/api/v1/statistics/categories` | 月度分类排行聚合 |
| 3 | GET | `/api/v1/statistics/pay-methods` | 月度支付方式聚合（仅支出口径） |
| 4 | GET | `/api/v1/statistics/trend` | 近 N 个月收支趋势 |
| 5 | GET | `/api/v1/overview/home` | 首页一屏聚合（统计卡 + 预算进度 + 今日流水） |

公共查询参数：

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| month | string | 视接口 | 当前月 | `YYYY-MM` |
| bookId | string | 否 | 全部账本 | 须属于当前用户，否则 `40401` |

---

## 1. 月度概览卡

`GET /api/v1/statistics/overview?month=2026-09&type=expense&bookId=20001`

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| type | string | 否 | `expense` | 卡片主视角：`expense` / `income` |

`200` 响应（对齐统计页概览卡）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "month": "2026-09",
    "type": "expense",
    "total": 2651.3,
    "oppositeTotal": 9800,
    "balance": 7148.7,
    "count": 42,
    "dailyAverage": 165.71,
    "elapsedDays": 16,
    "mom": {
      "up": false,
      "percent": 8.32,
      "text": "-8.32%"
    }
  },
  "traceId": "...",
  "timestamp": "..."
}
```

字段口径：

| 字段 | 口径 |
| --- | --- |
| total | 当月（type 方向）总额 |
| oppositeTotal | 对向金额：type=expense 时返回当月收入，反之返回当月支出 |
| balance | 当月 `收入 - 支出` |
| count | type 方向的记账笔数 |
| dailyAverage | 日均 = total ÷ elapsedDays，两位小数 |
| elapsedDays | 当月已过天数：**当前自然月取今天日期数**（9 月 16 日 = 16）；历史月取该月总天数（2 月按 28/29 天处理） |
| mom.up | 环比方向：与上月同口径总额相比，支出上升为 true、收入上升为 true；持平或下降为 false |
| mom.percent | 环比变化率绝对值，两位小数；上月为 0 而本月 > 0 时返回 `null`（不计算无穷环比） |
| mom.text | 带符号文案，直接可展示：上升 `+x.xx%`、下降 `-x.xx%`、持平 `0.00%`、不可比 `--` |

> 客户端现有文案为「较上月 -8.32%」，直接使用 `mom.text` 即可；上下箭头由 `mom.up` 决定（与现页面逻辑一致）。

---

## 2. 月度分类排行

`GET /api/v1/statistics/categories?month=2026-09&type=expense&bookId=20001`

`200` 响应（对齐现 `monthCategoryStats`，按金额倒序）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "month": "2026-09",
    "type": "expense",
    "total": 2651.3,
    "list": [
      {
        "categoryId": "4",
        "name": "餐饮",
        "icon": "🍽️",
        "color": "#ff6a3d",
        "bg": "#ffefea",
        "amount": 980.2,
        "count": 18,
        "percent": 36.97
      },
      {
        "categoryId": "3",
        "name": "交通",
        "icon": "🚌",
        "color": "#4a8cff",
        "bg": "#eaf2ff",
        "amount": 420.0,
        "count": 12,
        "percent": 15.84
      }
    ]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

口径：`percent = 该分类金额 ÷ 当月同方向总额 × 100`，两位小数；当月无记录时 `total=0`、`list=[]`。各项 percent 之和不强制 100（四舍五入误差，与现有实现一致）。

---

## 3. 月度支付方式聚合

`GET /api/v1/statistics/pay-methods?month=2026-09&bookId=20001`

**说明**：固定**支出**口径（与统计页仅在支出 Tab 展示该模块一致）。

`200` 响应（对齐现 `monthPayStats`，金额倒序）：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "month": "2026-09",
    "total": 2651.3,
    "list": [
      {
        "payMethodId": "2",
        "name": "微信支付",
        "shortName": "微",
        "color": "#07c160",
        "bg": "#e7f8ef",
        "amount": 1560.6,
        "count": 23,
        "percent": 58.86
      }
    ]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

---

## 4. 近 N 个月收支趋势

`GET /api/v1/statistics/trend?months=6&bookId=20001`

| 参数 | 类型 | 必填 | 默认 | 约束 |
| --- | --- | --- | --- | --- |
| months | number | 否 | 6 | 3~12 |

**说明**：返回包含当前月在内、向前推的连续 N 个月（无记录月份补零，保证柱状图连续），月份升序（最旧→最新），客户端按数组顺序渲染即可。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "months": 6,
    "list": [
      { "month": "2026-04", "label": "4月", "expense": 3012.5, "income": 9800 },
      { "month": "2026-05", "label": "5月", "expense": 4200.0, "income": 9800 },
      { "month": "2026-06", "label": "6月", "expense": 2890.3, "income": 10500 },
      { "month": "2026-07", "label": "7月", "expense": 3322.1, "income": 9800 },
      { "month": "2026-08", "label": "8月", "expense": 2892.4, "income": 9800 },
      { "month": "2026-09", "label": "9月", "expense": 2651.3, "income": 9800 }
    ]
  },
  "traceId": "...",
  "timestamp": "..."
}
```

实现要点：一次查询 `GROUP BY DATE_FORMAT(record_date,'%Y-%m')` 后在 Service 用月份序列补零；月份列表由服务端按日历生成，不依赖账单中是否存在数据。

---

## 5. 首页聚合

`GET /api/v1/overview/home`

**说明**：首页一屏所需数据一次返回，减少串行请求；口径与现 `useHomeData` 完全一致。月份固定取服务器当前自然月（Asia/Shanghai）。

`200` 响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "todayDate": "9月16日",
    "user": {
      "name": "小绿"
    },
    "month": {
      "month": "2026-09",
      "expense": 2651.3,
      "income": 9800,
      "balance": 7148.7,
      "expenseCount": 42,
      "incomeCount": 3,
      "count": 45
    },
    "budget": {
      "budget": 5000,
      "progress": 53.03,
      "overBudget": false
    },
    "today": {
      "date": "2026-09-16",
      "expense": 126.8,
      "income": 0,
      "list": [ { "...BillVM": "结构同 04b 公共视图模型" } ]
    }
  },
  "traceId": "...",
  "timestamp": "..."
}
```

字段口径：

| 字段 | 口径 |
| --- | --- |
| month.* | 当前月收支汇总，结构同 `GET /bills/summary`（跨当前用户全部账本；预算只针对激活账本，故预算与收支口径按现首页实现保持：收支为全部账本，预算取激活账本） |
| budget.budget | 激活账本月预算，0 表示未设置 |
| budget.progress | 预算进度百分比 = 当月支出 ÷ 预算 × 100，**封顶 100**，两位小数；预算为 0 时返回 0 |
| budget.overBudget | 是否已超预算（支出 > 预算 且 预算 > 0） |
| today.* | 结构同 `GET /bills/today`（跨全部账本） |

> 说明：现首页统计卡的支出/收入取全部账单、预算取激活账本，服务端保持该口径；若未来产品要求「按激活账本统计」，只需新增 `bookId` 参数即可平滑演进（属兼容性变更，不升版本）。
