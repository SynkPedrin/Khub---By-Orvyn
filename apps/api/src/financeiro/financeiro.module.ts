import { Module } from '@nestjs/common';
import { FinanceiroService } from './financeiro.service';
import { FinanceiroController } from './financeiro.controller';
import { CaixaService } from './caixa.service';
import { ComissoesService } from './comissoes.service';
import { FinanceiroSenhaService } from './senha.service';
import { ProdutosService } from './produtos.service';

@Module({
  controllers: [FinanceiroController],
  providers: [FinanceiroService, CaixaService, ComissoesService, FinanceiroSenhaService, ProdutosService],
  // CaixaService exportado: a Agenda gera entrada + comissão ao concluir um
  // atendimento com valor, dentro da mesma transação do compromisso.
  exports: [FinanceiroService, CaixaService],
})
export class FinanceiroModule {}
