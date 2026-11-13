import { corpoDaMidia, normalizarAtalho, validarMidia, variaveisDesconhecidas } from './midia';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const PDF = Buffer.from('%PDF-1.7 conteudo');

describe('validarMidia (Q2.5)', () => {
  it('aceita formato permitido com assinatura que confere', () => {
    expect(validarMidia('imagem', 'image/png', PNG)).toBeNull();
    expect(validarMidia('documento', 'application/pdf; charset=binary', PDF)).toBeNull();
    expect(validarMidia('audio', 'audio/ogg', Buffer.from('OggS...'))).toBeNull();
  });

  it('recusa MIME fora da lista, arquivo vazio, acima do limite e conteúdo que não confere', () => {
    expect(validarMidia('imagem', 'image/gif', PNG)).toBe('tipo_nao_aceito');
    expect(validarMidia('documento', 'application/x-msdownload', PDF)).toBe('tipo_nao_aceito');
    expect(validarMidia('documento', 'application/pdf', Buffer.alloc(0))).toBe('arquivo_vazio');
    expect(validarMidia('imagem', 'image/png', Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]))).toBe('arquivo_grande');
    // executável renomeado para .pdf
    expect(validarMidia('documento', 'application/pdf', Buffer.from('MZ\x90\x00'))).toBe('conteudo_nao_confere');
    expect(validarMidia('imagem', 'image/jpeg', PNG)).toBe('conteudo_nao_confere');
  });

  it('corpo da mensagem descreve o anexo (histórico, prévia e contexto do agente)', () => {
    expect(corpoDaMidia('documento', 'proposta.pdf')).toBe('📎 Documento: proposta.pdf');
    expect(corpoDaMidia('imagem', 'foto.png', '  segue a foto ')).toBe('📎 Imagem: foto.png\nsegue a foto');
  });
});

describe('respostas rápidas', () => {
  it('aponta só as variáveis desconhecidas', () => {
    expect(variaveisDesconhecidas('Oi {{contato.primeiro_nome}}, sou {{ atendente.nome }}')).toEqual([]);
    expect(variaveisDesconhecidas('Oi {{contato.cpf}} {{contato.cpf}} {{x}}')).toEqual(['contato.cpf', 'x']);
  });

  it('normaliza atalho', () => {
    expect(normalizarAtalho('/Boas Vindas')).toBe('boas-vindas');
    expect(normalizarAtalho('Preço')).toBe('preco');
  });
});
