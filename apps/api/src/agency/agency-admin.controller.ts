import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayNotEmpty, ArrayUnique, IsArray, IsEmail, IsIn, IsObject, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AgencyAdminService } from './agency-admin.service';
class SettingsDto { @IsString() @MinLength(2) @MaxLength(120) nome!:string; @IsObject() settings!:Record<string,unknown>; }
class InviteDto {
  @IsEmail() email!:string;
  @IsIn(['admin','member','viewer']) role!:string;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsUUID('4',{each:true}) clientIds!:string[];
}
class AcceptDto {
  @IsString() @MinLength(20) @MaxLength(200) token!:string;
  @IsString() @MinLength(2) @MaxLength(120) nome!:string;
  @IsString() @MinLength(8) @MaxLength(200) password!:string;
}
@SkipAudit()
@Controller('agency')
export class AgencyAdminController {
  constructor(private readonly admin:AgencyAdminService){}
  @Get('settings') settings(@CurrentUser() u:AuthUser){return this.admin.settings(u.identityId);}
  @Patch('settings') update(@CurrentUser() u:AuthUser,@Body() d:SettingsDto){return this.admin.update(u.identityId,d.nome,d.settings);}
  @Get('invites') invites(@CurrentUser() u:AuthUser){return this.admin.invites(u.identityId);}
  @Post('invites') invite(@CurrentUser() u:AuthUser,@Body() d:InviteDto){return this.admin.invite(u.identityId,d.email,d.role,d.clientIds);}
  @Delete('invites/:id') revoke(@CurrentUser() u:AuthUser,@Param('id',ParseUUIDPipe) id:string){return this.admin.revoke(u.identityId,id);}
  @Public() @Post('invites/accept') accept(@Body() d:AcceptDto,@Headers('user-agent') ua?:string){return this.admin.accept(d.token,d.nome,d.password,ua);}
}
