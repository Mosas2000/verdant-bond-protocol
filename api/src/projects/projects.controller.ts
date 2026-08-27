import {
  Controller, Get, Post, Body, Param, Query, Req, UseGuards,
  HttpCode, HttpStatus, ParseIntPipe,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { ProjectResponse } from './interfaces/project.interface';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: CreateProjectDto): Promise<ProjectResponse> {
    return this.projectsService.register(dto, '');
  }

  @Get()
  async findAll(@Query() query: PaginationDto) {
    return this.projectsService.findAll(query.page, query.limit);
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProjectResponse> {
    return this.projectsService.findOne(id);
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProjectResponse> {
    return this.projectsService.approve(id);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProjectResponse> {
    return this.projectsService.reject(id);
  }

  @Post(':id/documents')
  @HttpCode(HttpStatus.OK)
  async uploadDocuments(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { files: any[] },
  ): Promise<any> {
    return this.projectsService.uploadDocuments(id, body.files || []);
  }

  @Get(':id/export')
  @UseGuards(JwtAuthGuard)
  async exportProject(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: any,
  ): Promise<any> {
    const auditorAddress = req.user?.walletAddress || '';
    return this.projectsService.exportProject(id, auditorAddress);
  }
}
