"""Avec (CSVs extraídos) -> linhas dos importadores do KHUB (contatos, agenda, financeiro)."""
import csv, json, os, re, unicodedata
from collections import Counter, defaultdict
D = os.path.expanduser('~/Downloads/avec-export/2026-11-14')
OUT = os.path.join(D, 'khub'); os.makedirs(OUT, exist_ok=True)
ler = lambda nome: list(csv.DictReader(open(os.path.join(D, nome), encoding='utf-8-sig'), delimiter=';'))
def norm(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]', ' ', s)).strip()
def fone(s):
    d = re.sub(r'\D', '', str(s or ''))
    if len(d) in (10, 11): return d
    if len(d) in (12, 13) and d.startswith('55'): return d[2:]
    return ''

# ---------- contatos (0004) ----------
cli = ler('clientes-0004-lista-de-dados-de-todos-os-clientes.csv')
contatos, por_nome, por_codigo = [], defaultdict(set), {}
for c in cli:
    tel = fone(c.get('Celular')) or fone(c.get('Telefone'))
    nome = re.sub(r'\s+', ' ', c.get('Cliente', '')).strip()
    if not nome: continue
    obs = [f"Cliente Avec #{c.get('Código','').strip()}"] if c.get('Código', '').strip() else []
    if c.get('Aniversário', '').strip(): obs.append(f"Aniversário: {c['Aniversário'].strip()}")
    if c.get('Como Conheceu', '').strip(): obs.append(f"Como conheceu: {c['Como Conheceu'].strip()}")
    if not tel: continue
    contatos.append({k: v for k, v in {'nome': nome, 'telefone': tel, 'email': c.get('E-mail', '').strip(), 'cidade': c.get('Cidade', '').strip(), 'origem': 'Avec', 'tags': 'avec', 'observacao': ' · '.join(obs)}.items() if v})
    if tel:
        por_nome[norm(nome)].add(tel)
        if c.get('Código', '').strip(): por_codigo[c['Código'].strip()] = tel

# código do cliente pelo 0248 ("1234 - Nome")
codigo_por_nome = defaultdict(set)
for a in ler('agendamentos-0248-agendamentos-por-status.csv'):
    m = re.match(r'^\s*(\d+)\s*-\s*(?:\d+\s*-\s*)?(.+)$', a.get('Cliente', ''))
    if m:
        codigo_por_nome[norm(m.group(2))].add(m.group(1))
        t = fone(a.get('Telefone'))
        if t and m.group(1) not in por_codigo: por_codigo[m.group(1)] = t
def separar(cliente):
    m = re.match(r'^\s*(\d+)\s*-\s*(?:\d+\s*-\s*)?(.+)$', cliente or '')
    return (m.group(1), m.group(2).strip()) if m else (None, (cliente or '').strip())

# duração real por serviço (cadastro de serviços do Avec; servicos.mjs)
duracao = {}
sp = os.path.join(D, 'servicos-completo.json')
if os.path.exists(sp):
    for sv in json.load(open(sp)):
        if sv.get('duracao'): duracao[norm(sv['nome'])] = int(sv['duracao'])

# ---------- agenda (0155) ----------
STATUS = {'pago': 'concluido', 'finalizado': 'concluido', 'em atendimento': 'concluido', 'cancelado': 'cancelado', 'faltou': 'faltou', 'confirmado': 'confirmado', 'agendado': 'agendado', 'aguardando': 'agendado'}
agenda, ligados, sem_tel = [], 0, Counter()
for a in ler('agendamentos-0155-agendamentos-por-quem-os-agendou-e-data-de-cadastro.csv'):
    cod, nome_cli = separar(a['Cliente'])
    n = norm(nome_cli)
    tel = por_codigo.get(cod, '') if cod else ''
    if tel: pass
    elif len(por_nome.get(n, ())) == 1: tel = next(iter(por_nome[n]))
    else:
        cods = codigo_por_nome.get(n, set())
        tels = {por_codigo[c] for c in cods if c in por_codigo}
        if len(tels) == 1: tel = next(iter(tels))
    if tel: ligados += 1
    else: sem_tel[a['Cliente']] += 1
    # Mesmo atendimento listado com e sem o código ("4338 - Ana" e "Ana"): usa o código
    # sempre que o nome leva a um código único, senão a referência pelo nome.
    if not cod and len(codigo_por_nome.get(n, ())) == 1: cod = next(iter(codigo_por_nome[n]))
    ref = f'avec:{cod}' if cod else (f'avec-nome:{n}' if n else '')
    agenda.append({'data': a['Data Reserva'], 'hora': a['Hora'], 'servico': a['Serviço'].strip(), 'profissional': a['Profissional'].strip(), 'cliente': nome_cli, 'clienteRef': ref, 'duracaoMin': duracao.get(norm(a['Serviço'])),
                   'contatoTelefone': tel, 'status': STATUS.get(norm(a['Status']), 'agendado'), 'statusAvec': a['Status']})

# ---------- financeiro (0387, competência) ----------
def centavos(v):
    s = str(v).strip().replace('.', '').replace(',', '.')
    try: return round(float(s) * 100)
    except ValueError: return None
fin, vistos, zero = [], Counter(), 0
for f in ler('financeiro-0387-entradas-e-saidas-analitico.csv'):
    if f['Variante'] != 'competencia': continue
    c = centavos(f['Valor'])
    if not c: zero += 1; continue
    linha = {'tipo': 'saida' if c < 0 else 'entrada', 'descricao': (f['Título'].strip() or f['Categoria'].strip() or 'Lançamento Avec')[:200],
             'valor': f"{abs(c) / 100:.2f}".replace('.', ','), 'data': f['Pagamento'].strip() or f['Competência'].strip(),
             'categoria': (f['Categoria'].strip() or 'Outros')[:60], 'status': 'pago' if f['Pagamento'].strip() else 'pendente'}
    chave = json.dumps(sorted((k, norm(v)) for k, v in linha.items()))
    vistos[chave] += 1
    linha['ocorrencia'] = vistos[chave]
    fin.append(linha)

for nome, dados in [('contatos', contatos), ('agenda', agenda), ('financeiro', fin)]:
    json.dump(dados, open(os.path.join(OUT, f'{nome}.json'), 'w'), ensure_ascii=False)
ent = sum(int(x['valor'].replace(',', '')) for x in fin if x['tipo'] == 'entrada'); sai = sum(int(x['valor'].replace(',', '')) for x in fin if x['tipo'] == 'saida')
print(f'contatos: {len(contatos)} (com telefone: {sum(1 for c in contatos if c.get("telefone"))})')
print(f'agenda: {len(agenda)} | ligados a cliente por telefone: {ligados} ({ligados*100//len(agenda)}%) | status: {dict(Counter(x["status"] for x in agenda))}')
print('  sem telefone (top):', sem_tel.most_common(6))
print(f'financeiro: {len(fin)} lançamentos (ignorados valor zero: {zero}) | entradas R$ {ent/100:,.2f} | saídas R$ {sai/100:,.2f} | pendentes {sum(1 for x in fin if x["status"]=="pendente")}')
print(f"agenda com duração do serviço: {sum(1 for x in agenda if x.get('duracaoMin'))}/{len(agenda)}")
print('profissionais:', sorted(Counter(x['profissional'] for x in agenda)))
