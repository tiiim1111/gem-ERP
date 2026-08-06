import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated } from '@gemerp/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/types/auth-request';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import {
  NotificationsService,
  NotificationView,
} from './notifications.service';

/**
 * In-app notifications (api-outline 7.3). Always self-scoped — a user only
 * ever sees their own notifications, so no @RequirePermissions: the
 * authenticated session is the whole authorization story.
 */
@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'Own notifications (filters: read, type). Self-scoped.',
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryNotificationsDto,
  ): Promise<Paginated<NotificationView>> {
    return this.notifications.list(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread badge count.' })
  unreadCount(@CurrentUser() user: AuthUser): Promise<{ unread: number }> {
    return this.notifications.unreadCount(user);
  }

  @Post('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark every own notification read.' })
  readAll(@CurrentUser() user: AuthUser): Promise<{ marked: number }> {
    return this.notifications.markAllRead(user);
  }

  @Post(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark one own notification read.' })
  read(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<NotificationView> {
    return this.notifications.markRead(user, id);
  }
}
