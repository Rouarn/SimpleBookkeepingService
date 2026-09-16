import { Module } from '@nestjs/common';
import { DictionariesController } from './dictionaries.controller.js';
import { CategoriesService } from './services/categories.service.js';
import { PayMethodsService } from './services/pay-methods.service.js';

/** 字典领域：供账单/偏好/统计模块按需引入。 */
@Module({
  controllers: [DictionariesController],
  providers: [CategoriesService, PayMethodsService],
  exports: [CategoriesService, PayMethodsService],
})
export class DictionariesModule {}
