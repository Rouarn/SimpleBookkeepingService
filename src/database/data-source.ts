import 'reflect-metadata';

import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DataSource, type DataSourceOptions } from 'typeorm';
import configuration from '../config/configuration.js';
import { SnakeNamingStrategy } from './naming.strategy.js';

// CLI 迁移入口：独立于 Nest 容器自行加载 .env（06 §1.2）
process.env.TZ = process.env.TZ ?? 'Asia/Shanghai';
const envName =
  process.env.NODE_ENV === 'production' ? 'production' : 'development';
const envFile = `.env.${envName}`;
if (existsSync(envFile)) {
  loadDotenv({ path: envFile });
}

const config = configuration();
const currentDir = dirname(fileURLToPath(import.meta.url));

export const dataSourceOptions: DataSourceOptions = {
  type: 'mysql',
  host: config.database.host,
  port: config.database.port,
  username: config.database.user,
  password: config.database.password,
  database: config.database.name,
  charset: 'utf8mb4',
  timezone: '+08:00',
  namingStrategy: new SnakeNamingStrategy(),
  entities: [join(currentDir, '../entities/*.js')],
  migrations: [join(currentDir, './migrations/*.js')],
  synchronize: false,
  migrationsRun: false,
  logging: ['error', 'warn'],
  extra: {
    supportBigNumbers: true,
    bigNumberStrings: true,
    connectionLimit: config.database.connectionLimit,
    waitForConnections: true,
    multipleStatements: false,
  },
};

export const AppDataSource = new DataSource(dataSourceOptions);
