// Tela "Análises por analista": análises concluídas no período, totais por
// analista e por dia, lista com busca e ficha completa de cada análise.

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const intFmt = new Intl.NumberFormat('pt-BR');
const fmtNum = (n) => intFmt.format(n);
const fmtDia = (d) => {
  const [y, m, dd] = d.split('-');
  const weekday = new Date(+y, m - 1, +dd).toLocaleDateString('pt-BR', { weekday: 'short' });
  return `${dd}/${m}/${y} <span class="sub">${weekday}</span>`;
};
const SECTIONS = ['porAnalista', 'porDia', 'lista'];

async function api(path) {
  const res = await fetch(`/api/analises${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Falha na requisição (${res.status}).`);
  return body;
}

function showError(message) {
  $('error').textContent = message ?? '';
  $('error').hidden = !message;
}

// ---------- Período ----------

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function periodo(p) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const add = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  switch (p) {
    case 'hoje': return [hoje, hoje];
    case 'ontem': return [add(hoje, -1), add(hoje, -1)];
    case '7d': return [add(hoje, -6), hoje];
    case 'mes': return [new Date(hoje.getFullYear(), hoje.getMonth(), 1), hoje];
    case 'mesAnt': return [new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), new Date(hoje.getFullYear(), hoje.getMonth(), 0)];
    default: return null;
  }
}

function aplicarAtalho(p) {
  const [a, b] = periodo(p);
  $('inicio').value = iso(a);
  $('fim').value = iso(b);
  marcarAtalho(p);
}

function marcarAtalho(p) {
  document.querySelectorAll('#atalhos button').forEach((b) => b.classList.toggle('is-active', b.dataset.p === p));
}

// ---------- Consulta ----------

function params() {
  const p = new URLSearchParams({ inicio: $('inicio').value, fim: $('fim').value });
  if ($('analista').value) p.set('analista', $('analista').value);
  if ($('busca').value.trim()) p.set('busca', $('busca').value.trim());
  return p;
}

let consulta = 0;
async function carregar() {
  const p = params();
  const atual = ++consulta;
  history.replaceState(null, '', `?${p}`);
  showError(null);
  SECTIONS.forEach((id) => { $(id).innerHTML = '<div class="empty">Carregando…</div>'; });
  try {
    const [resumo, lista] = await Promise.all([api(`/resumo?${p}`), api(`?${p}`)]);
    if (atual !== consulta) return; // uma consulta mais nova já foi disparada
    renderResumo(resumo);
    renderLista(lista);
  } catch (e) {
    if (atual !== consulta) return;
    showError(e.message);
    SECTIONS.forEach((id) => { $(id).innerHTML = '<div class="empty">—</div>'; });
  }
}

function renderResumo({ porAnalista, porDia }) {
  const soma = (k) => porAnalista.reduce((s, r) => s + r[k], 0);
  $('kTotal').textContent = fmtNum(soma('total'));
  $('kDoc').textContent = fmtNum(soma('documento'));
  $('kVis').textContent = fmtNum(soma('vistoria'));
  $('kAnalistas').textContent = fmtNum(porAnalista.length);

  if (!porAnalista.length) {
    $('porAnalista').innerHTML = $('porDia').innerHTML = '<div class="empty">Nenhuma análise concluída no período.</div>';
    return;
  }
  const max = Math.max(...porAnalista.map((r) => r.total));
  $('porAnalista').innerHTML = `<table>
    <thead><tr><th>Analista</th><th class="num">Doc.</th><th class="num">Vist.</th><th class="num">Total</th><th style="width:30%"></th></tr></thead>
    <tbody>${porAnalista.map((r) => `<tr class="clickable${String(r.id) === $('analista').value ? ' is-selected' : ''}" data-id="${r.id}">
      <td>${esc(r.nome)}</td><td class="num">${fmtNum(r.documento)}</td><td class="num">${fmtNum(r.vistoria)}</td>
      <td class="num"><b>${fmtNum(r.total)}</b></td>
      <td><div class="bar" style="width:${(r.total / max) * 100}%"></div></td></tr>`).join('')}</tbody>
  </table>`;

  $('porDia').innerHTML = `<table>
    <thead><tr><th>Dia</th><th>Analista</th><th class="num">Doc.</th><th class="num">Vist.</th><th class="num">Total</th></tr></thead>
    <tbody>${porDia.map((r) => `<tr><td>${fmtDia(r.dia)}</td><td>${esc(r.nome)}</td>
      <td class="num">${fmtNum(r.documento)}</td><td class="num">${fmtNum(r.vistoria)}</td><td class="num"><b>${fmtNum(r.total)}</b></td></tr>`).join('')}</tbody>
  </table>`;
}

function renderLista(rows) {
  $('qtdLista').textContent = rows.length >= 1000 ? '(mostrando as 1000 mais recentes)' : `(${fmtNum(rows.length)})`;
  if (!rows.length) { $('lista').innerHTML = '<div class="empty">Nenhuma análise.</div>'; return; }
  $('lista').innerHTML = `<table>
    <thead><tr><th>Código</th><th>Associado</th><th>Veículo</th><th>Tipo</th><th>Analista</th><th>Concluída</th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="clickable" data-codigo="${esc(r.codigo)}">
      <td class="code">${esc(r.codigo)}<div class="sub">${esc(r.leadCodigo)}</div></td>
      <td>${esc(r.associado)}<div class="sub">${esc(fmtDoc(r.cpf))}</div></td>
      <td><b>${esc(fmtPlaca(r.placa)) || '<span class="sub">sem placa</span>'}</b>
        <div class="sub">${esc([r.marca, r.modelo, r.anoModelo].filter(Boolean).join(' · '))}</div></td>
      <td><span class="tag">${esc(r.tipoAnalise)}</span></td>
      <td>${esc(r.analista)}</td><td>${esc(r.concluidoEm)}</td></tr>`).join('')}</tbody>
  </table>`;
}

// ---------- Formatação ----------

const vazio = (v) => v === null || v === undefined || String(v).trim() === '';
function fmtDoc(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return v ?? '';
}
function fmtTel(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
  if (d.length === 10) return d.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
  return v ?? '';
}
const fmtPlaca = (v) => String(v ?? '').toUpperCase();
const fmtCep = (v) => String(v ?? '').replace(/^(\d{5})(\d{3})$/, '$1-$2');
const fmtData = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || '') ? v.slice(0, 10).split('-').reverse().join('/') : v);
const fmtMoeda = (v) => (vazio(v) ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fmtSimNao = (v) => (vazio(v) ? '' : (Number(v) ? 'Sim' : 'Não'));
function fmtDuracao(min) {
  if (vazio(min) || min < 0) return '';
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return [d && `${d}d`, h && `${h}h`, `${min % 60}min`].filter(Boolean).join(' ');
}

// ---------- Ficha da análise ----------

function secao(titulo, campos) {
  const itens = campos.filter(([, v]) => !vazio(v));
  if (!itens.length) return '';
  return `<div class="section"><h4>${esc(titulo)}</h4><div class="fields">
    ${itens.map(([l, v, cls]) => `<div class="field"><div class="l">${esc(l)}</div><div class="v ${cls || ''}">${esc(String(v).trim())}</div></div>`).join('')}
  </div></div>`;
}

async function abrirDetalhe(codigo) {
  $('dTitulo').textContent = 'Carregando…';
  $('dSub').textContent = '';
  $('dCorpo').innerHTML = '';
  $('detalhe').showModal();
  try {
    const a = await api(`/${encodeURIComponent(codigo)}`);
    const v = a.veiculo || {};
    const alerta = (x) => (Number(x) ? 'warn' : '');
    $('dTitulo').textContent = a.associado || '(sem nome)';
    $('dSub').textContent = [a.codigo, a.leadCodigo, fmtPlaca(a.placa || v.placa)].filter(Boolean).join(' · ');
    $('dCorpo').innerHTML =
      secao('Análise', [
        ['Código', a.codigo], ['Tipo', a.tipoAnalise], ['Status', a.status], ['Analista', a.analista],
        ['Criada em', a.criadoEm], ['Distribuída em', a.distribuidoEm], ['Concluída em', a.concluidoEm],
        ['Tempo de análise', fmtDuracao(a.minutosAnalise)],
      ])
      + secao('Associado', [
        [a.pj ? 'Razão social' : 'Nome', a.pj ? a.razaoSocial : a.nomeLead], ['Nome fantasia', a.nomeFantasia],
        ['Responsável', a.responsavelPj], [a.pj ? 'CNPJ' : 'CPF', fmtDoc(a.cpf)], ['RG', a.rg],
        ['Nascimento', fmtData(a.dataNascimento)], ['Telefone', fmtTel(a.telefone)], ['E-mail', a.email],
        ['CNH', a.cnh], ['Categoria CNH', a.categoriaCnh], ['Vencimento CNH', fmtData(a.dataVencimentoCnh)],
        ['Endereço', [a.endereco, a.numero, a.complemento].filter((x) => !vazio(x)).join(', ')], ['Bairro', a.bairro],
        ['Cidade', [a.cidade, a.uf].filter(Boolean).join(' / ')], ['CEP', fmtCep(a.cep)],
      ])
      + secao('Veículo', [
        ['Placa', fmtPlaca(v.placa || a.placa)], ['Tipo', a.tipoVeiculo], ['Marca', v.marca || a.marca], ['Modelo', v.modelo || a.modelo],
        ['Ano fab./modelo', [v.anoFabricacao || a.anoFabricacao, v.anoModelo || a.anoModelo].filter(Boolean).join(' / ')],
        ['Cor', v.cor || a.cor], ['Combustível', v.combustivel || a.combustivel], ['Categoria', v.categoria || a.categoria],
        ['Chassi', v.chassi || a.chassi], ['Renavam', v.renavam || a.renavam], ['Nº motor', a.numeroMotor],
        ['Código FIPE', v.codigoFipe], ['Valor FIPE', fmtMoeda(v.valorFipe)],
        ['Leilão', fmtSimNao(a.leilao), alerta(a.leilao)], ['Chassi remarcado', fmtSimNao(a.chassiRemarcado), alerta(a.chassiRemarcado)],
        ['GNV', fmtSimNao(a.gnv)], ['Blindado', fmtSimNao(a.veiculoBlindado)],
      ])
      + secao('Plano e valores', [
        ['Plano', v.plano || a.plano], ['Produto', v.produto], ['Valor protegido', fmtMoeda(v.valorProtegido || a.valorProtegido)],
        ['Adesão', fmtMoeda(v.valorAdesao ?? a.valorAdesao)], ['Mensalidade', fmtMoeda(a.mensalidade)],
        ['Mensalidade final', fmtMoeda(v.mensalidade || a.mensalidadeFinal)], ['Forma de pagamento', v.formaPagamento || a.formaPagamento],
        ['Dia de vencimento', v.diaVencimento || a.dataVencimento],
      ])
      + secao('Comercial', [
        ['Etapa do lead', a.etapa], ['Consultor', a.consultor], ['Cooperativa', v.cooperativa || a.cooperativa], ['Origem', a.origem],
      ])
      + secao('SGA', [
        ['Exportação', v.statusExportacao], ['Código SGA', v.codigoSga], ['Situação', v.statusSgaSituacao],
        ['Rastreador', vazio(v.instalacaoRastreador) ? '' : fmtSimNao(v.instalacaoRastreador)], ['Empresa rastreador', v.empresaRastreador],
      ]);
  } catch (e) {
    $('dTitulo').textContent = 'Erro';
    $('dCorpo').innerHTML = `<p class="error">${esc(e.message)}</p>`;
  }
}

// ---------- Início ----------

async function iniciar() {
  const analistas = await api('/analistas').catch((e) => { showError(e.message); return []; });
  for (const a of analistas) $('analista').add(new Option(`${a.nome}${a.ativo ? '' : ' (inativa)'}`, a.id));

  const q = new URLSearchParams(location.search);
  if (q.get('inicio') && q.get('fim')) {
    $('inicio').value = q.get('inicio');
    $('fim').value = q.get('fim');
    $('analista').value = q.get('analista') || '';
    $('busca').value = q.get('busca') || '';
  } else {
    aplicarAtalho('ontem');
  }

  $('atalhos').addEventListener('click', (e) => {
    const p = e.target.closest('button')?.dataset.p;
    if (!p) return;
    aplicarAtalho(p);
    carregar();
  });
  ['inicio', 'fim'].forEach((id) => $(id).addEventListener('change', () => marcarAtalho(null)));
  $('analista').addEventListener('change', carregar);
  let espera;
  $('busca').addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(carregar, 400); });
  $('form').addEventListener('submit', (e) => { e.preventDefault(); carregar(); });

  $('porAnalista').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    $('analista').value = $('analista').value === tr.dataset.id ? '' : tr.dataset.id;
    carregar();
  });
  $('lista').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-codigo]');
    if (tr) abrirDetalhe(tr.dataset.codigo);
  });
  $('dFechar').addEventListener('click', () => $('detalhe').close());
  $('detalhe').addEventListener('click', (e) => { if (e.target === $('detalhe')) $('detalhe').close(); });

  carregar();
}

iniciar();
