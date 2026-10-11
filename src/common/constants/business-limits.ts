/**
 * 业务限制常量集中地（P2-12）：消除 DTO/工具中的散落魔数，
 * 口径与文档 03 §10 对齐；Service 层（bills.service 等）后续可直接复用，
 * 修改限额只需改这一处。
 */

/** 单笔金额上限（03 §10：0 < x ≤ 99,999,999.99） */
export const MAX_AMOUNT = 99_999_999.99;

/** 账单备注最大码点长度 */
export const REMARK_MAX_LENGTH = 50;

/** 单笔账单凭证图片上限 */
export const MAX_BILL_PHOTOS = 3;

/** 昵称最大码点长度（注册/资料修改同口径，最小 1） */
export const NICKNAME_MAX_LENGTH = 12;

/** 列表分页页码上限：防止恶意深翻页（OFFSET 巨大拖垮 DB），超限直接 400 */
export const MAX_PAGE = 10_000;

/** 列表分页每页条数上限（默认 20） */
export const MAX_PAGE_SIZE = 100;

/** 列表分页每页条数默认值 */
export const DEFAULT_PAGE_SIZE = 20;

/** 日期区间查询最大跨度（天）：约一年，防全表扫描式拉取 */
export const DATE_RANGE_MAX_DAYS = 370;
