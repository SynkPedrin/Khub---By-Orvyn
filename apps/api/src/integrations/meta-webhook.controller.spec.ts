import { createHmac } from 'node:crypto';
import { MetaWebhookController } from './meta-webhook.controller';

// Unit tests: these doubles verify the HTTP boundary, not PostgreSQL isolation.
function setup(mapped = true) {
  const rows = new Map<string, unknown>();
  const upsert = jest.fn(async ({where,create}: any) => {
    const key = JSON.stringify(where);
    if (!rows.has(key)) rows.set(key,create);
    return rows.get(key);
  });
  const prisma = {$queryRaw:jest.fn(async()=>mapped?[{tenant_id:'tenant-a'}]:[]),withTenant:jest.fn(async(_t:string,fn:any)=>fn({outboxEvent:{upsert}}))};
  const parse = jest.fn(()=>[{pageId:'page-a',leadgenId:'lead-a'}]);
  const controller = new MetaWebhookController({get:(key:string)=>key==='META_APP_SECRET'?'test-secret':'verify-token'} as any,prisma as any,{parse} as any);
  const response:any={status:jest.fn().mockReturnThis(),send:jest.fn().mockReturnThis(),type:jest.fn().mockReturnThis()};
  function request(body:unknown,signature?:string) {
    const rawBody=Buffer.from(JSON.stringify(body));
    return {body,rawBody,get:()=>signature??`sha256=${createHmac('sha256','test-secret').update(rawBody).digest('hex')}`} as any;
  }
  return {controller,response,request,prisma,rows,upsert};
}
const body={entry:[{changes:[{field:'leadgen',value:{page_id:'page-a',leadgen_id:'lead-a'}}]}]};
describe('Meta webhook HTTP boundary',()=>{
  it('validates verification token and echoes challenge',()=>{
    const s=setup();s.controller.verify('subscribe','verify-token','challenge',s.response);
    expect(s.response.send).toHaveBeenCalledWith('challenge');
  });
  it.each(['sha256=bad',`sha256=${'é'.repeat(64)}`,`sha256=${'0'.repeat(64)}`])('rejects invalid signature without writes: %s',async signature=>{
    const s=setup();await s.controller.receive(s.request(body,signature),s.response);
    expect(s.response.status).toHaveBeenCalledWith(403);expect(s.prisma.$queryRaw).not.toHaveBeenCalled();
  });
  it('rejects signed malformed payload',async()=>{
    const s=setup();await s.controller.receive(s.request({entry:{}}),s.response);
    expect(s.response.status).toHaveBeenCalledWith(400);expect(s.upsert).not.toHaveBeenCalled();
  });
  it('reports unmapped page without acknowledging discarded event',async()=>{
    const s=setup(false);await s.controller.receive(s.request(body),s.response);
    expect(s.response.status).toHaveBeenCalledWith(503);expect(s.upsert).not.toHaveBeenCalled();
  });
  it('uses identical tenant dedupe key on redelivery',async()=>{
    const s=setup();await s.controller.receive(s.request(body),s.response);await s.controller.receive(s.request(body),s.response);
    expect(s.rows.size).toBe(1);
    expect(s.upsert).toHaveBeenCalledWith(expect.objectContaining({where:{tenantId_dedupeKey:{tenantId:'tenant-a',dedupeKey:'meta:page-a:lead-a'}}}));
  });
  it('does not acknowledge a database failure',async()=>{
    const s=setup();s.upsert.mockRejectedValueOnce(new Error('db unavailable'));
    await expect(s.controller.receive(s.request(body),s.response)).rejects.toThrow('db unavailable');
    expect(s.response.send).not.toHaveBeenCalled();
  });
});
