import { eventosDeConversa } from './meta-canais.parse';

// Payloads no formato da documentação oficial da Meta:
// - Messenger: https://developers.facebook.com/docs/messenger-platform/webhooks
// - Instagram DM: https://developers.facebook.com/docs/messenger-platform/instagram/features/webhook
// - Instagram comments: https://developers.facebook.com/documentation/instagram-platform/webhooks/examples
// - Page feed: https://developers.facebook.com/docs/graph-api/webhooks/reference/page/

const MESSENGER = {
  object: 'page',
  entry: [{
    id: 'PAGE_ID', time: 1458692752478,
    messaging: [{ sender: { id: 'PSID' }, recipient: { id: 'PAGE_ID' }, timestamp: 1458692752478, message: { mid: 'mid.1457764197618:41d102a3e1ae206a38', text: 'hello, world!' } }],
  }],
};

const INSTAGRAM_DM = {
  object: 'instagram',
  entry: [{
    id: 'IGID', time: 1569262486134,
    messaging: [
      { sender: { id: 'IGSID' }, recipient: { id: 'IGID' }, timestamp: 1569262485349, message: { mid: 'MESSAGE-ID', text: 'MESSAGE-TEXT' } },
      // Eco: enviado pela própria conta (is_echo) — não entra como mensagem do cliente.
      { sender: { id: 'IGID' }, recipient: { id: 'IGSID' }, timestamp: 1569262485350, message: { mid: 'ECO-ID', text: 'resposta', is_echo: true } },
      // Sem texto (figurinha/reação): ignorado.
      { sender: { id: 'IGSID' }, recipient: { id: 'IGID' }, timestamp: 1569262485351, message: { mid: 'SEM-TEXTO' } },
    ],
  }],
};

const INSTAGRAM_COMENTARIO = {
  object: 'instagram',
  entry: [{
    id: 'IGID', time: 1700000000,
    changes: [
      { field: 'comments', value: { from: { id: 'IGSCID', username: 'fulana' }, comment_id: 'C1', text: 'Quanto custa?', media: { id: 'MEDIA1', media_product_type: 'FEED' } } },
      { field: 'comments', value: { from: { id: 'IGSCID2', username: 'ciclano' }, comment_id: 'C2', parent_id: 'C1', text: 'Também quero saber', media: { id: 'MEDIA1', media_product_type: 'FEED' } } },
    ],
  }],
};

const PAGINA_FEED = {
  object: 'page',
  entry: [{
    id: 'PAGE_ID', time: 1700000000,
    changes: [
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'FC1', post_id: 'PAGE_ID_POST', parent_id: 'PAGE_ID_POST', from: { id: 'U1', name: 'Beltrano' }, message: 'Tem desconto?', created_time: 1700000001 } },
      { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'FC2', post_id: 'PAGE_ID_POST', parent_id: 'FC1', from: { id: 'U2', name: 'Outro' }, message: 'Resposta no fio', created_time: 1700000002 } },
      { field: 'feed', value: { item: 'comment', verb: 'remove', comment_id: 'FC3', post_id: 'PAGE_ID_POST', from: { id: 'U1', name: 'Beltrano' } } },
      { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: 'PAGE_ID_POST', from: { id: 'U1' } } },
      // Lead Ads continua com o MetaLeadsService: aqui é ignorado.
      { field: 'leadgen', value: { page_id: 'PAGE_ID', leadgen_id: 'L1' } },
    ],
  }],
};

describe('eventosDeConversa', () => {
  it('Messenger: DM do cliente com mid como id externo', () => {
    const [e, ...resto] = eventosDeConversa(MESSENGER);
    expect(resto).toHaveLength(0);
    expect(e).toMatchObject({ rede: 'messenger', canal: 'Messenger', tipo: 'dm', contaId: 'PAGE_ID', autorId: 'PSID', texto: 'hello, world!', idExterno: 'mid.1457764197618:41d102a3e1ae206a38' });
    expect(e.recebidoEm.getTime()).toBe(1458692752478);
  });

  it('Instagram DM: ignora eco e mensagem sem texto', () => {
    const r = eventosDeConversa(INSTAGRAM_DM);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ rede: 'instagram', canal: 'Instagram', tipo: 'dm', autorId: 'IGSID', idExterno: 'MESSAGE-ID' });
  });

  it('Instagram comentário: resposta entra no fio do comentário raiz (parent_id)', () => {
    const [topo, resposta] = eventosDeConversa(INSTAGRAM_COMENTARIO);
    expect(topo).toMatchObject({ tipo: 'comentario', canal: 'Instagram', autorNome: 'fulana', idExterno: 'C1', fioId: 'C1', origem: { midiaId: 'MEDIA1', tipoMidia: 'FEED' } });
    expect(resposta).toMatchObject({ idExterno: 'C2', fioId: 'C1' });
    expect(topo.recebidoEm.getTime()).toBe(1700000000 * 1000);
  });

  it('Página: comentário de topo (parent_id = post_id) e resposta no fio; remove/reação/leadgen ignorados', () => {
    const r = eventosDeConversa(PAGINA_FEED);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ rede: 'messenger', canal: 'Facebook', tipo: 'comentario', idExterno: 'FC1', fioId: 'FC1', autorNome: 'Beltrano', origem: { postId: 'PAGE_ID_POST' } });
    expect(r[1]).toMatchObject({ idExterno: 'FC2', fioId: 'FC1' });
  });

  it('comentário feito pela própria conta não vira conversa', () => {
    const proprio = { object: 'instagram', entry: [{ id: 'IGID', changes: [{ field: 'comments', value: { from: { id: 'IGID', username: 'eu' }, comment_id: 'C9', text: 'obrigado!' } }] }] };
    expect(eventosDeConversa(proprio)).toEqual([]);
  });

  it('objeto desconhecido ou corpo inválido = nada', () => {
    expect(eventosDeConversa({ object: 'whatsapp_business_account', entry: [] })).toEqual([]);
    expect(eventosDeConversa(null)).toEqual([]);
    expect(eventosDeConversa({ object: 'page', entry: 'x' })).toEqual([]);
  });
});
