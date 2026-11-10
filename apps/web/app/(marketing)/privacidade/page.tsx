import type { Metadata } from 'next';
import { LegalShell, Secao } from '@/components/marketing/legal/LegalShell';

export const metadata: Metadata = { title: 'Política de Privacidade · KHUB' };

export default function PrivacidadePage() {
  return (
    <LegalShell titulo="Política de Privacidade" atualizadoEm="[PREENCHER: data da última revisão]">
      <Secao titulo="1. Escopo e papéis sob a LGPD">
        <p>
          Esta política explica como o KHUB (&ldquo;KHUB&rdquo;), desenvolvido e operado pela KHUB ai, trata dados pessoais, nos termos
          da Lei Geral de Proteção de Dados (Lei 13.709/2018 · LGPD). Distinguimos dois papéis:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Controlador</strong>, quando tratamos os dados da sua própria conta (nome, e-mail, uso da plataforma, cobrança).</li>
          <li><strong>Operador</strong>, quando processamos, em seu nome, os dados dos leads/contatos/clientes que você cadastra no CRM. Nesse caso, <strong>você é o controlador desses dados</strong> e é responsável por ter base legal para coletá-los.</li>
        </ul>
      </Secao>

      <Secao titulo="2. Dados que coletamos">
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Da sua conta:</strong> nome, e-mail, senha (com hash, nunca em texto puro), identidade da empresa, histórico de login.</li>
          <li><strong>Dos seus contatos/leads (como operador):</strong> nome, telefone, e-mail, empresa, conteúdo de conversas de WhatsApp/outros canais conectados, histórico de interações, dados vindos de anúncios (Meta Lead Ads).</li>
          <li><strong>De uso e cobrança:</strong> logs de auditoria de ações na plataforma, dados de pagamento processados pela Stripe (não armazenamos número de cartão).</li>
          <li><strong>Da NICO (IA):</strong> mensagens trocadas com a assistente de IA, para fornecer a funcionalidade e, de forma agregada/anonimizada, melhorar a qualidade das respostas.</li>
        </ul>
      </Secao>

      <Secao titulo="3. Bases legais">
        <p>
          Tratamos dados da sua conta com base na <strong>execução de contrato</strong> (prestação do
          serviço) e <strong>cumprimento de obrigação legal</strong> (fiscal/contábil). Para os dados dos
          seus contatos, a plataforma permite registrar a base legal por contato (consentimento, execução
          de contrato, legítimo interesse, obrigação legal ou proteção ao crédito), a responsabilidade por
          essa escolha é de quem opera a conta, como controlador desses dados.
        </p>
      </Secao>

      <Secao titulo="4. Com quem compartilhamos">
        <p>Dados podem ser processados pelos seguintes operadores/subprocessadores, estritamente para operar o serviço:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Anthropic</strong>, processa mensagens enviadas à NICO (IA conversacional).</li>
          <li><strong>Voyage AI</strong>, gera vetores de busca semântica da base de conhecimento (RAG), quando habilitado.</li>
          <li><strong>Meta (Facebook/Instagram)</strong>, integração de anúncios e Lead Ads, quando você conecta uma conta.</li>
          <li><strong>Provedor de WhatsApp</strong> (Evolution self-hosted ou similar), entrega de mensagens no canal conectado.</li>
          <li><strong>Stripe</strong>, processamento de pagamentos e assinaturas.</li>
          <li><strong>Provedor de infraestrutura</strong> (hospedagem do banco de dados e aplicação).</li>
        </ul>
        <p className="text-sm text-amber-700">[PREENCHER: nome do provedor de hospedagem/infra e se há transferência internacional de dados a declarar.]</p>
      </Secao>

      <Secao titulo="5. Isolamento entre contas (multi-tenant)">
        <p>
          Cada conta (&ldquo;tenant&rdquo;) tem seus dados tecnicamente isolados por controle de acesso em nível
          de linha no banco de dados (Row-Level Security), uma conta nunca consegue ler dados de outra pela
          aplicação. Testes automatizados de isolamento rodam a cada mudança de schema.
        </p>
      </Secao>

      <Secao titulo="6. Seus direitos (e os dos seus contatos)">
        <p>Como titular de dados, seja você, usuário da plataforma, ou um contato cadastrado por um cliente nosso, você tem direito a:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Acesso e portabilidade</strong>, exportar os dados que temos sobre você.</li>
          <li><strong>Correção</strong>, atualizar dados incompletos ou desatualizados.</li>
          <li><strong>Eliminação</strong>, solicitar a exclusão, salvo obrigações legais de retenção (ex.: registros fiscais).</li>
          <li><strong>Revogação de consentimento</strong>, quando o tratamento for baseado em consentimento.</li>
        </ul>
        <p>
          Se você é um contato/lead cadastrado por um cliente do KHUB (não um usuário direto da
          plataforma), o pedido deve ser direcionado à empresa que coletou seus dados, ela é a
          controladora. Usuários diretos da plataforma podem solicitar exportação/exclusão de um contato
          pela própria interface do CRM, ou pelo contato abaixo.
        </p>
      </Secao>

      <Secao titulo="7. Retenção e eliminação">
        <p>
          Dados de contatos excluídos são removidos do banco; negócios/receita vinculados a eles são
          mantidos de forma desvinculada (sem os dados pessoais), para preservar histórico financeiro e
          cumprir obrigações contábeis. Dados de conta são retidos enquanto a assinatura estiver ativa e
          por período adicional exigido por lei após o encerramento.
        </p>
      </Secao>

      <Secao titulo="8. Segurança">
        <p>
          Senhas são armazenadas com hash (argon2id, nunca texto puro); credenciais de integrações de
          terceiros são cifradas em repouso (AES-256-GCM); conexões usam TLS; acesso interno é limitado por
          papéis e toda ação sensível é registrada em log de auditoria imutável.
        </p>
      </Secao>

      <Secao titulo="9. Encarregado de Proteção de Dados (DPO) e contato">
        <p className="text-sm text-amber-700">
          [PREENCHER: nome/e-mail do Encarregado de Dados (DPO) exigido pela LGPD, e e-mail de contato para
          exercício de direitos de titulares.]
        </p>
      </Secao>

      <div className="mt-10 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>Nota de implementação:</strong> este documento foi escrito para refletir com precisão os
        dados que o produto efetivamente coleta e os provedores que efetivamente integra hoje, não é
        aconselhamento jurídico. Os campos marcados [PREENCHER] e a nomeação formal de um Encarregado de
        Dados são obrigatórios antes da operação comercial real.
      </div>
    </LegalShell>
  );
}
