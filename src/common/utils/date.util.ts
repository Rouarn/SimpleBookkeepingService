/**
 * 日期工具（03 §1.1 / 04b / 04d）。
 * 不引 moment/dayjs（05 §6.8），全应用时区 Asia/Shanghai（main.ts 已设 TZ）。
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 当前本地日期 YYYY-MM-DD */
export function todayStr(base: Date = new Date()): string {
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
}

/** 当前月份 YYYY-MM */
export function currentMonth(base: Date = new Date()): string {
  return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`;
}

export function isMonthString(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** 当前年份 YYYY */
export function currentYear(base: Date = new Date()): string {
  return String(base.getFullYear());
}

export function isYearString(value: string): boolean {
  return /^\d{4}$/.test(value);
}

export function isDateString(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00`).getTime())
  );
}

export function isTimeString(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/**
 * 月份半开区间：['YYYY-MM-01', '下月1号']。
 * 月度查询只用半开区间，禁止 DATE_FORMAT(record_date) 入 WHERE（05 §3.4 / 02 §3.1）。
 */
export function monthRange(month: string): [string, string] {
  const [year, mon] = month.split('-').map(Number);
  const start = `${year}-${pad2(mon)}-01`;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMonth = mon === 12 ? 1 : mon + 1;
  const end = `${nextYear}-${pad2(nextMonth)}-01`;
  return [start, end];
}

/** 某月总天数（2 月按 28/29 处理） */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** 年份半开区间：['YYYY-01-01', 下一年1月1日]，与 monthRange 同口径 */
export function yearRange(year: string): [string, string] {
  const y = Number(year);
  return [`${y}-01-01`, `${y + 1}-01-01`];
}

/** 年份平移 delta 年（负数往前） */
export function shiftYear(year: string, delta: number): string {
  return String(Number(year) + delta);
}

/** 某年 1~12 月的 YYYY-MM 序列（升序） */
export function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${pad2(i + 1)}`);
}

/** 闰年判断 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * 年内已过月数（年维度日均/月均分母）：当前年取当前月份数；历史年取 12。
 */
export function elapsedMonths(year: string, base: Date = new Date()): number {
  if (year === currentYear(base)) return base.getMonth() + 1;
  return 12;
}

/**
 * 年内已过天数：当前年取今天是年内第几天；历史年取全年天数（365/366）。
 */
export function elapsedDaysOfYear(
  year: string,
  base: Date = new Date(),
): number {
  if (year === currentYear(base)) {
    const start = new Date(base.getFullYear(), 0, 1);
    return Math.floor((base.getTime() - start.getTime()) / 86_400_000) + 1;
  }
  return isLeapYear(Number(year)) ? 366 : 365;
}

/** 月份平移 delta 个月 */
export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(year, mon - 1 + delta, 1);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

/**
 * 已过天数（04d §1）：当前自然月取今天日期数；历史月取该月总天数。
 */
export function elapsedDays(month: string, base: Date = new Date()): number {
  if (month === currentMonth(base)) return base.getDate();
  const [year, mon] = month.split('-').map(Number);
  return daysInMonth(year, mon);
}

/** 包含当前月向前推 n 个月（升序，最旧→最新） */
export function recentMonths(count: number, base: Date = new Date()): string[] {
  const list: string[] = [];
  const current = currentMonth(base);
  for (let i = count - 1; i >= 0; i -= 1) {
    list.push(shiftMonth(current, -i));
  }
  return list;
}

/** 月份展示文案：2026-09 → 9月 */
export function monthLabel(month: string): string {
  const [, mon] = month.split('-').map(Number);
  return `${mon}月`;
}

/** 日期展示文案：2026-09-16 → 9月16日 */
export function dateLabel(date: string): string {
  const [, mon, day] = date.split('-').map(Number);
  return `${mon}月${day}日`;
}

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 分组 day 文案：当天「今天」、前一天「昨天」、其余「周X」（04b §3） */
export function dayLabel(recordDate: string, base: Date = new Date()): string {
  const today = todayStr(base);
  if (recordDate === today) return '今天';
  const yesterday = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate() - 1,
  );
  if (recordDate === todayStr(yesterday)) return '昨天';
  return WEEK_LABELS[new Date(`${recordDate}T00:00:00`).getDay()];
}

/**
 * 加入产品第 N 天（含当天，最小 1，04a §5/§8）。
 * 按 Asia/Shanghai 自然日差值计算，避免夏令时/时分秒干扰。
 */
export function joinDaysOf(joinDate: string, base: Date = new Date()): number {
  const start = new Date(`${joinDate}T00:00:00`);
  const today = new Date(`${todayStr(base)}T00:00:00`);
  const diffDays = Math.round((today.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, diffDays + 1);
}

/** HH:mm → HH:mm:ss（入库 TIME） */
export function timeToColumn(time: string): string {
  return `${time}:00`;
}

/** HH:mm:ss → HH:mm（接口输出） */
export function columnToTime(value: string): string {
  return value.slice(0, 5);
}

/** 本地 ISO 8601 带 +08:00 时区，如 2026-09-16T10:20:30.123+08:00 */
export function formatTimestamp(date: Date = new Date()): string {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
  return (
    `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` +
    `T${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}${offset}`
  );
}
