import { DefaultNamingStrategy, type NamingStrategyInterface } from 'typeorm';

/**
 * camelCase（实体/DTO）↔ snake_case（数据库列）命名策略（03 §2.3 / 05 §1）。
 * 表名一律在实体上显式声明（复数蛇形），列名默认按属性名蛇形转换。
 */
export class SnakeNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  override tableName(
    className: string,
    customName: string | undefined,
  ): string {
    return customName ?? this.toSnake(className);
  }

  override columnName(
    propertyName: string,
    customName: string | undefined,
    embeddedPrefixes: string[],
  ): string {
    if (customName) return customName;
    const parts = embeddedPrefixes.map((prefix) => this.toSnake(prefix));
    parts.push(this.toSnake(propertyName));
    return parts.join('_');
  }

  override relationName(propertyName: string): string {
    return this.toSnake(propertyName);
  }

  override joinColumnName(
    relationName: string,
    referencedColumnName: string,
  ): string {
    return this.toSnake(`${relationName}_${referencedColumnName}`);
  }

  private toSnake(value: string): string {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
      .toLowerCase();
  }
}
