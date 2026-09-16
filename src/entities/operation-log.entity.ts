import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/** 请求审计日志（02 §2.9）：只记元数据，不记请求体/响应体。 */
@Entity('operation_logs')
@Index('idx_user_time', ['userId', 'createdAt'])
@Index('idx_trace', ['traceId'])
@Index('idx_created', ['createdAt'])
export class OperationLog {
  @PrimaryGeneratedColumn({ type: 'bigint', unsigned: true })
  id: string;

  @Column({ type: 'bigint', unsigned: true, nullable: true, name: 'user_id' })
  userId: string | null;

  @Column({ type: 'varchar', length: 8 })
  method: string;

  @Column({ type: 'varchar', length: 255 })
  path: string;

  @Column({ type: 'smallint', unsigned: true, name: 'http_status', default: 0 })
  httpStatus: number;

  @Column({ type: 'int', name: 'biz_code', default: 0 })
  bizCode: number;

  @Column({ type: 'varchar', length: 45, default: '' })
  ip: string;

  @Column({ type: 'varchar', length: 255, name: 'user_agent', default: '' })
  userAgent: string;

  @Column({ type: 'char', length: 32, name: 'trace_id', default: '' })
  traceId: string;

  @Column({ type: 'int', unsigned: true, name: 'cost_ms', default: 0 })
  costMs: number;

  @CreateDateColumn({ type: 'datetime', precision: 3, name: 'created_at' })
  createdAt: Date;
}
