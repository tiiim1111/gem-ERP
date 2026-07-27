import { Global, Module } from '@nestjs/common';
import { BranchScopeService } from './branch-scope.service';

@Global()
@Module({
  providers: [BranchScopeService],
  exports: [BranchScopeService],
})
export class RbacModule {}
