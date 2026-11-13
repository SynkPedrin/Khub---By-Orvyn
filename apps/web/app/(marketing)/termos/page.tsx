import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalShell, Secao } from '@/components/marketing/legal/LegalShell';

export const metadata: Metadata = { title: 'Termos de Uso · KHUB' };

export default function TermosPage() {
  return (
    <LegalShell titulo="Termos de Uso" atualizadoEm="[PREENCHER: data da última revisão]">
      <Secao titulo="1. Quem somos e o que este documento cobre">
        <p>
          O KHUB (&ldquo;KHUB&rdquo;, &ldquo;nós&rdquo;), desenvolvido e operado pela KHUB ai, é uma plataforma
          de CRM, atendimento, automação e inteligência artificial para operações de vendas e marketing. Este
          documento rege o uso do software por qualquer pessoa ou empresa (&ldquo;Cliente&rdquo;, &ldquo;você&rdquo;)
          que crie uma conta ou utilize a plataforma.
        </p>
        <p className="text-sm text-amber-700">
          [PREENCHER: razão social, CNPJ e endereço da empresa responsável pelo KHUB, obrigatório antes de
          publicar.]
        </p>
      </Secao>

      <Secao titulo="2. Conta, tenants e agências">
        <p>
          Cada conta opera em um ambiente isolado (&ldquo;tenant&rdquo;), com dados tecnicamente segregados de
          outros clientes. Uma conta de agência pode gerenciar múltiplos tenants em nome de seus clientes
          finais, caso em que a agência é responsável por garantir que possui autorização desses clientes
          para operar os dados em nome deles.
        </p>
      </Secao>

      <Secao titulo="3. Uso aceitável">
        <ul className="list-disc space-y-1.5 pl-5">
          <li>Não enviar mensagens em massa não solicitadas (spam) através dos canais de WhatsApp/e-mail integrados.</li>
          <li>Não usar a NICO (assistente de IA) para gerar conteúdo ilegal, enganoso ou que viole direitos de terceiros.</li>
          <li>Não tentar acessar dados de outro tenant, contornar o isolamento multi-tenant ou os limites de uso do plano.</li>
          <li>Respeitar as políticas de uso dos provedores integrados (Meta, WhatsApp/Evolution, Anthropic, Stripe), o KHUB não se responsabiliza por penalidades aplicadas por esses provedores por uso indevido.</li>
        </ul>
      </Secao>

      <Secao titulo="4. Canal de WhatsApp, aviso importante">
        <p>
          O KHUB oferece conexão de WhatsApp via API não-oficial (protocolo WhatsApp Web), sujeita a
          bloqueio do número pelo WhatsApp/Meta a qualquer momento, fora do controle do KHUB. O uso desse
          canal é por sua conta e risco; recomendamos a Cloud API oficial da Meta para operações críticas.
        </p>
      </Secao>

      <Secao titulo="5. Inteligência artificial (NICO)">
        <p>
          A NICO é assistida por modelos de linguagem de terceiros (Anthropic) e por uma base de
          conhecimento própria (RAG). Respostas da NICO podem conter imprecisões; a NICO não substitui
          aconselhamento médico, jurídico ou contábil profissional, e ações sensíveis (envio em massa,
          alteração de automação ativa, exclusão de dados) exigem aprovação humana explícita.
        </p>
      </Secao>

      <Secao titulo="6. Planos, cobrança e cancelamento">
        <p>
          Planos pagos são cobrados por assinatura recorrente via Stripe. Você pode cancelar a qualquer
          momento pelo portal de autoatendimento; o cancelamento tem efeito ao final do período já pago,
          sem reembolso proporcional, salvo disposição legal em contrário.
        </p>
        <p className="text-sm text-amber-700">[PREENCHER: política de reembolso, se houver período de teste gratuito, multas por atraso.]</p>
      </Secao>

      <Secao titulo="7. Seus dados">
        <p>
          O tratamento de dados pessoais é regido pela nossa{' '}
          <Link href="/privacidade" className="font-medium text-[var(--lp-accent)] hover:underline">Política de Privacidade</Link>,
          parte integrante destes Termos.
        </p>
      </Secao>

      <Secao titulo="8. Limitação de responsabilidade e rescisão">
        <p>
          A plataforma é fornecida &ldquo;como está&rdquo;. Na extensão máxima permitida por lei, o KHUB não
          se responsabiliza por lucros cessantes, perda de dados por mau uso do Cliente, ou indisponibilidade
          de serviços de terceiros integrados. Podemos suspender contas que violem estes Termos, com aviso
          prévio sempre que razoavelmente possível.
        </p>
      </Secao>

      <Secao titulo="9. Foro e lei aplicável">
        <p className="text-sm text-amber-700">
          [PREENCHER: comarca/foro de eleição, este documento segue a legislação brasileira, mas o foro
          específico deve ser definido com apoio jurídico.]
        </p>
      </Secao>

      <div className="mt-10 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Nota de implementação:</strong> este é um modelo funcional, escrito para refletir o que o
        produto realmente faz hoje, não é aconselhamento jurídico nem substitui revisão por um advogado
        antes da operação comercial real.
      </div>
    </LegalShell>
  );
}
