import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { AnalyticsReal } from './AnalyticsReal';
import { crm } from '@/lib/crm';
import { analytics } from '@/lib/analytics';
vi.mock('@/lib/crm', () => ({ crm: { overview: vi.fn() } }));
vi.mock('@/lib/analytics', () => ({ analytics: { aiUsage: vi.fn(), automacoes: vi.fn() } }));
vi.mock('./Kpi', () => ({ KpiCard: ({label, value}: {label:string;value:string}) => <div>{label}<span>{value}</span></div> }));
const overview={kpis:{contatos:8,negocios:3,valorFunil:12000,ganho:0,conversao:50,conversaoBase:'etapa_final'},funil:[],receitaMensal:[],atividades:[],contatosRecentes:[]};
beforeEach(() => {
 vi.mocked(crm.overview).mockResolvedValue(overview as never);
 vi.mocked(analytics.aiUsage).mockResolvedValue({dias:30,custoUsd:1.2,tokens:200,execucoes:10,erros:1,porAgente:[],porModelo:[],porDia:[]});
 vi.mocked(analytics.automacoes).mockResolvedValue({dias:30,total:0,concluidos:0,falhas:0,naDlq:0,rodando:0,taxaSucesso:null,porStatus:{}});
});
afterEach(() => { cleanup();vi.clearAllMocks(); });
it('falha de IA preserva CRM e informa indisponibilidade, sem inventar custo zero', async () => {
 vi.mocked(analytics.aiUsage).mockRejectedValue(new Error('offline'));
 render(<AnalyticsReal />);
 await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Uso de IA'));
 expect(screen.getByText('Resultado comercial')).toBeTruthy();
 expect(screen.getByText('Custo de IA · USD').textContent).toContain('-');
});
it('etapa final não é apresentada como venda convertida', async () => {
 render(<AnalyticsReal />);
 await waitFor(() => expect(screen.getByText('Conversão de fechados').textContent).toContain('-'));
 expect(screen.queryByText('50%')).toBeNull();
});
it('filtro consulta fontes com período correto e apresenta custo em USD', async () => {
 render(<AnalyticsReal />);
 await waitFor(() => expect(screen.getByText('Custo de IA · USD').textContent).toContain('US$'));
 fireEvent.change(screen.getByRole('combobox'),{target:{value:'7'}});
 await waitFor(() => expect(analytics.aiUsage).toHaveBeenCalledWith(7));
 expect(analytics.automacoes).toHaveBeenCalledWith(7);
});
