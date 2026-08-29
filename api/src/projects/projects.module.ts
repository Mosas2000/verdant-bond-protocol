import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { IpfsService } from './ipfs.service';
import { IpfsUploadPolicy } from './ipfs-upload.policy';

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    IpfsService,
    {
      provide: IpfsUploadPolicy,
      useFactory: () => new IpfsUploadPolicy(),
    },
  ],
  exports: [IpfsService, ProjectsService],
})
export class ProjectsModule {}
