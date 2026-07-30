import { chaveDoNicho, instrucaoDoNicho, validarResposta } from './guardrails';

describe('Guardrails (Sprint F) — camada 2, a que vale', () => {
  it('mapeia o nicho do tenant para o conjunto de regras', () => {
    expect(chaveDoNicho('Clínica médica / estética')).toBe('medico');
    expect(chaveDoNicho('Advocacia')).toBe('juridico');
    expect(chaveDoNicho('Contabilidade')).toBe('contabil');
    expect(chaveDoNicho('Agência de marketing')).toBeNull(); // sem regra de conselho
    expect(chaveDoNicho(null)).toBeNull();
  });

  it('a instrução do nicho entra no prompt (camada 1)', () => {
    expect(instrucaoDoNicho('Clínica médica')).toContain('CFM');
    expect(instrucaoDoNicho('Advocacia')).toContain('OAB');
    expect(instrucaoDoNicho('Agência')).toBe('');
  });

  describe('saúde (CFM)', () => {
    const barra = (t: string) => validarResposta(t, 'Clínica médica');

    it('barra diagnóstico', () => {
      const r = barra('Pelos sintomas, você está com uma infecção e precisa tratar.');
      expect(r.ok).toBe(false);
      expect(r.regra).toBe('cfm.diagnostico');
      expect(r.substituto).toContain('profissional da clínica');
    });

    it('barra prescrição de medicamento e dose', () => {
      expect(barra('Tome 500mg de dipirona a cada 8 horas.').ok).toBe(false);
      expect(barra('Pode usar amoxicilina por 7 dias.').ok).toBe(false);
    });

    it('barra promessa de cura e superlativo', () => {
      expect(barra('É cura garantida, sem risco algum.').ok).toBe(false);
      expect(barra('Somos a melhor clínica da região.').ok).toBe(false);
    });

    it('deixa passar o que é legítimo', () => {
      expect(barra('Posso agendar sua avaliação com a Dra. Marina na quinta às 14h?').ok).toBe(true);
      expect(barra('A consulta de retorno custa R$ 250, conforme a tabela da clínica.').ok).toBe(true);
      expect(barra('Entendo o incômodo. O ideal é o profissional te avaliar — quer que eu agende?').ok).toBe(true);
    });
  });

  describe('jurídico (OAB)', () => {
    const barra = (t: string) => validarResposta(t, 'Advocacia');

    it('barra garantia de resultado', () => {
      expect(barra('Pode ficar tranquilo: você vai ganhar essa ação.').ok).toBe(false);
      expect(barra('É êxito garantido no seu caso.').ok).toBe(false);
    });

    it('barra promessa de valor', () => {
      expect(barra('Você vai receber R$ 50.000 de indenização.').ok).toBe(false);
    });

    it('barra captação agressiva', () => {
      expect(barra('Processe agora e garanta dinheiro fácil!').ok).toBe(false);
    });

    it('deixa passar orientação honesta', () => {
      expect(barra('Seu caso tem fundamento; o advogado responsável precisa analisar os documentos.').ok).toBe(true);
    });
  });

  describe('contábil', () => {
    const barra = (t: string) => validarResposta(t, 'Contabilidade');
    it('barra garantia fiscal e orientação irregular', () => {
      expect(barra('É economia garantida no seu imposto.').ok).toBe(false);
      expect(barra('Você pode omitir essa receita sem problema.').ok).toBe(false);
    });
    it('deixa passar o legítimo', () => {
      expect(barra('O prazo do Simples é dia 20. Quer que eu abra uma tarefa de lembrete?').ok).toBe(true);
    });
  });

  it('nicho sem conselho regulador não barra (agência pode prometer resultado de campanha)', () => {
    expect(validarResposta('Vamos garantir 3x mais leads este mês!', 'Agência de marketing').ok).toBe(true);
  });
});
