import { formatTimestamp } from '../../../common/utils/date.util.js';
import type { MessageType } from '../../../entities/message.entity.js';

interface MessageRow {
  id: string | number;
  type: MessageType;
  title: string;
  content: string;
  payload: unknown;
  is_read: number | string;
  read_at: Date | string | null;
  created_at: Date | string;
}

/** GET /users/me/messages 列表项。 */
export interface MessageVo {
  id: string;
  type: MessageType;
  title: string;
  content: string;
  payload: unknown;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export function toMessageVo(row: MessageRow): MessageVo {
  return {
    id: String(row.id),
    type: row.type,
    title: row.title,
    content: row.content,
    payload: row.payload ?? null,
    isRead: Number(row.is_read) === 1,
    readAt: row.read_at ? formatTimestamp(new Date(row.read_at)) : null,
    createdAt: formatTimestamp(new Date(row.created_at)),
  };
}
