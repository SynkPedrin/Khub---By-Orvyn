import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { invitationEmail } from '../common/invite-email';
import { TokenService } from '../auth/token.service';
import { parsePreferences } from '../settings/account-preferences';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
const safeInvite = { id:true,email:true,role:true,expiresAt:true,acceptedAt:true,revokedAt:true,createdAt:true,clientIds:true } as const;

@Injectable()
export class AgencyAdminService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly mailer: MailerService, private readonly tokens: TokenService) {}
  private async member(identityId: string, write = false) {
    const m = await this.prisma.agencyMember.findFirst({ where:{ identityId }, include:{ agency:true } });
    if (!m || (write && !['owner','admin'].includes(m.role))) throw new ForbiddenException('Sem permissão para administrar esta agência.');
    return m;
  }
  async settings(identityId: string) {
    const m = await this.member(identityId);
    return { nome:m.agency.name,slug:m.agency.slug,settings:m.agency.settings,role:m.role,email:this.mailer.status() };
  }
  async update(identityId: string, nome: string, settings: Record<string,unknown>) {
    const m = await this.member(identityId,true);
    const parsed = parsePreferences(settings);
    return this.prisma.agency.update({ where:{id:m.agencyId},data:{name:nome.trim(),settings:parsed,updatedAt:new Date()}, select:{name:true,settings:true} });
  }
  async invites(identityId: string) {
    const m=await this.member(identityId,true);
    return this.prisma.agencyInvite.findMany({where:{agencyId:m.agencyId},select:safeInvite,orderBy:{createdAt:'desc'},take:100});
  }
  async invite(identityId: string, email: string, role: string, clientIds: string[]) {
    const m=await this.member(identityId,true);
    if(role==='admin' && m.role!=='owner') throw new ForbiddenException('Somente o proprietário convida administradores.');
    email=email.trim().toLowerCase();
    const raw=randomBytes(32).toString('base64url');
    const invite=await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM agencies WHERE id=${m.agencyId}::uuid FOR UPDATE`;
      const clients=await tx.agencyClientAccount.findMany({where:{agencyId:m.agencyId,id:{in:clientIds},status:'active'}});
      if(!clients.length || clients.length!==new Set(clientIds).size) throw new BadRequestException('Selecione operações ativas desta agência.');
      const existing=await tx.identity.findFirst({where:{email:{equals:email,mode:'insensitive'}}});
      if(existing && await tx.agencyMember.findFirst({where:{identityId:existing.id}})) throw new ConflictException('Esta pessoa já pertence a uma agência.');
      if(await tx.agencyInvite.findFirst({where:{agencyId:m.agencyId,email,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()}}})) throw new ConflictException('Já existe convite pendente para este e-mail.');
      return tx.agencyInvite.create({data:{agencyId:m.agencyId,email,role,clientIds,tokenHash:digest(raw),expiresAt:new Date(Date.now()+7*86400000)}});
    });
    const web=this.config.get('WEB_URL') ?? 'http://localhost:3210';
    const acceptUrl=`${web}/agency-invite?token=${raw}`;
    const mail=await this.mailer.send({to:email,...invitationEmail(m.agency.name,acceptUrl,web,true),idempotencyKey:`agency-invite/${invite.id}`});
    return {acceptUrl,emailSent:mail.sent,missing:mail.missing,erro:mail.erro};
  }
  async revoke(identityId: string,id:string) {
    const m=await this.member(identityId,true);
    const r=await this.prisma.agencyInvite.updateMany({where:{id,agencyId:m.agencyId,acceptedAt:null,revokedAt:null},data:{revokedAt:new Date()}});
    if(!r.count) throw new BadRequestException('Convite indisponível.');
    return {ok:true};
  }
  async accept(token:string,nome:string,password:string,userAgent?:string) {
    const invite=await this.prisma.agencyInvite.findUnique({where:{tokenHash:digest(token)}});
    if(!invite || invite.revokedAt || invite.acceptedAt || invite.expiresAt<=new Date()) throw new BadRequestException('Convite inválido, expirado ou revogado.');
    const existing=await this.prisma.identity.findFirst({where:{email:{equals:invite.email,mode:'insensitive'}}});
    if(existing && (!existing.passwordHash || !await verify(existing.passwordHash,password))) throw new ForbiddenException('Confirme a senha da conta existente.');
    const passwordHash=existing?undefined:await hash(password);
    const data=await this.prisma.$transaction(async tx=>{
      const claim=await tx.agencyInvite.updateMany({where:{id:invite.id,revokedAt:null,acceptedAt:null,expiresAt:{gt:new Date()}},data:{acceptedAt:new Date()}});
      if(claim.count!==1) throw new BadRequestException('Convite já utilizado.');
      const clients=await tx.agencyClientAccount.findMany({where:{agencyId:invite.agencyId,id:{in:invite.clientIds},status:'active'},orderBy:{createdAt:'asc'}});
      if(clients.length!==invite.clientIds.length || !clients.length) throw new BadRequestException('As operações do convite não estão mais disponíveis.');
      const identity=existing ?? await tx.identity.create({data:{email:invite.email,passwordHash,emailVerifiedAt:new Date()}});
      if(await tx.agencyMember.findFirst({where:{identityId:identity.id}})) throw new ConflictException('Esta pessoa já pertence a uma agência.');
      const member=await tx.agencyMember.create({data:{agencyId:invite.agencyId,identityId:identity.id,role:invite.role}});
      await tx.agencyMemberClientAccess.createMany({data:clients.map(c=>({agencyMemberId:member.id,clientAccountId:c.id}))});
      const role=invite.role==='admin'?'admin':invite.role==='viewer'?'viewer':'member';
      for(const client of clients) {
        await tx.$queryRaw`SELECT set_config('app.current_tenant_id',${client.tenantId},true)`;
        await tx.membership.upsert({where:{identityId_tenantId:{identityId:identity.id,tenantId:client.tenantId}},create:{identityId:identity.id,tenantId:client.tenantId,role,isDefault:false},update:{}});
        const user=await tx.user.findFirst({where:{tenantId:client.tenantId,identityId:identity.id}});
        if(!user) await tx.user.create({data:{tenantId:client.tenantId,identityId:identity.id,email:invite.email,nome,role}});
        await tx.$executeRaw`INSERT INTO audit_logs(tenant_id,actor_id,acao,entidade,entidade_id) VALUES(${client.tenantId}::uuid,${identity.id},'agency.invite.accept','agency_invite',${invite.id})`;
      }
      const tenantId=clients[0].tenantId;
      const membership=await tx.membership.findUniqueOrThrow({where:{identityId_tenantId:{identityId:identity.id,tenantId}}});
      return {identityId:identity.id,email:invite.email,nome,tenantId,role:membership.role};
    });
    return {access:this.tokens.signAccess({sub:data.identityId,tenant_id:data.tenantId,role:data.role,email:data.email}),refresh:await this.tokens.issueRefresh(data.identityId,data.tenantId,userAgent),user:data};
  }
}
