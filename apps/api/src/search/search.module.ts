import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * Phase 3.5 global search (api-outline §4.7): one bounded, permission- and
 * branch-filtered query across assets, items, employees, suppliers, and
 * document numbers. Cross-cutting services (Prisma, RBAC) are global.
 * Wire THIS module into AppModule.
 */
@Module({
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
