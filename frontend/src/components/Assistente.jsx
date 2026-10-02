import { useEffect, useRef, useState } from 'react';
import { assistenteAPI } from '../services/api';
import { useConfirm } from '../hooks/useConfirm';
import './Assistente.css';

// Etapa 5: conversa do gestor com o SMA (Agente de Atendimento).
// O assistente só responde com dados dos agentes e só PROPÕE ações: aprovar ou
// rejeitar é um clique do gestor nos endpoints existentes, nunca do modelo.

const SUGESTOES = [
  'Como estão as vendas?',
  'Como está o estoque?',
  'Quais sabores estão em alta?',
  'Existem vendas pendentes?',
  'Quais clientes estão fora do padrão de recompra?',
  'Faça um diagnóstico geral.',
];

const CHAVE_CONVERSA = 'assistente.conversaId';
const lerConversa = () => { try { return Number(localStorage.getItem(CHAVE_CONVERSA)) || null; } catch { return null; } };
const gravarConversa = (id) => { try { id ? localStorage.setItem(CHAVE_CONVERSA, String(id)) : localStorage.removeItem(CHAVE_CONVERSA); } catch { /* sem armazenamento: segue sem lembrar */ } };

const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const ORIGEM = {
  LLM: 'Redigido pelo assistente; cada afirmação foi conferida com os dados dos agentes',
  TEMPLATE: 'Resposta automática montada com os dados dos agentes',
  SISTEMA: 'Mensagem do sistema',
};

const STATUS_ACAO = {
  PENDENTE: { rotulo: 'Aguardando aprovação', classe: 'pendente' },
  APROVADA: { rotulo: 'Aprovada', classe: 'ok' },
  EXECUTANDO: { rotulo: 'Executando', classe: 'ok' },
  EXECUTADA: { rotulo: 'Aprovada e executada', classe: 'ok' },
  REJEITADA: { rotulo: 'Rejeitada', classe: 'rejeitada' },
  FALHA: { rotulo: 'Falhou ao executar', classe: 'rejeitada' },
};

function CartaoAcao({ acao, onDecidir, ocupado }) {
  const status = STATUS_ACAO[acao.status] ?? { rotulo: acao.status, classe: '' };
  const { resumo = {} } = acao;
  return (
    <div className="assistente-acao">
      <div className="assistente-acao-topo">
        <strong>Ação proposta: {acao.titulo}</strong>
        <span className={`assistente-status ${status.classe}`}>{status.rotulo}</span>
      </div>
      {acao.tipoAcao === 'REGISTRAR_VENDA' ? (
        <dl>
          <dt>Cliente</dt><dd>{resumo.cliente?.nome}</dd>
          <dt>Itens</dt><dd>{(resumo.itens ?? []).map((i) => `${i.quantidade} × ${i.sabor}`).join(', ')}</dd>
          <dt>Valor informado</dt><dd>{brl(resumo.valorInformado)}</dd>
        </dl>
      ) : (
        <dl><dt>Venda</dt><dd>nº {resumo.vendaId}</dd></dl>
      )}
      {acao.status === 'PENDENTE' && (
        <div className="assistente-acao-botoes">
          <button className="btn-primary" disabled={ocupado} onClick={() => onDecidir(acao, 'aprovar')}>Aprovar</button>
          <button className="btn-secondary" disabled={ocupado} onClick={() => onDecidir(acao, 'rejeitar')}>Rejeitar</button>
        </div>
      )}
    </div>
  );
}

function Anexo({ anexo }) {
  if (anexo.tipo === 'RECEBIVEIS') {
    return (
      <table className="assistente-tabela">
        <caption>Vendas pendentes de pagamento (tempo em aberto, não atraso)</caption>
        <thead><tr><th>Venda</th><th>Cliente</th><th>Valor</th><th>Dias em aberto</th></tr></thead>
        <tbody>{anexo.itens.map((i) => (
          <tr key={i.vendaId}><td>nº {i.vendaId}</td><td>{i.cliente ?? `#${i.clienteId}`}</td><td>{brl(i.valor)}</td><td>{i.diasEmAberto}</td></tr>
        ))}</tbody>
      </table>
    );
  }
  if (anexo.tipo === 'CLIENTES_FORA_DO_PADRAO') {
    return (
      <table className="assistente-tabela">
        <caption>Clientes fora do próprio padrão de compra (desvio histórico, não previsão)</caption>
        <thead><tr><th>Cliente</th><th>Compras</th><th>Intervalo típico (dias)</th><th>Dias sem comprar</th></tr></thead>
        <tbody>{anexo.itens.map((i) => (
          <tr key={i.clienteId}><td>{i.cliente ?? `#${i.clienteId}`}</td><td>{i.compras}</td><td>{i.medianaIntervalo}</td><td>{i.diasDesdeUltimaCompra}</td></tr>
        ))}</tbody>
      </table>
    );
  }
  return null;
}

function Mensagem({ m, onEscolher, onDecidir, ocupado }) {
  const assistente = m.papel === 'ASSISTENTE';
  return (
    <div className={`assistente-msg ${assistente ? 'assistente' : 'usuario'}`}>
      <div className="assistente-balao">
        {/* com cartão de ação, o cartão já mostra o mesmo conteúdo (o texto continua no histórico/API) */}
        {!(m.acoesPropostas?.length > 0) && <div className="assistente-texto">{m.conteudo}</div>}
        {assistente && m.pendencia?.opcoes?.length > 0 && (
          <div className="assistente-opcoes">
            {m.pendencia.opcoes.map((o, i) => (
              <button key={o.id} className="btn-secondary" disabled={ocupado} onClick={() => onEscolher(String(i + 1))}>{i + 1}. {o.nome}</button>
            ))}
          </div>
        )}
        {(m.acoesPropostas ?? []).map((a) => <CartaoAcao key={a.acaoId} acao={a} onDecidir={onDecidir} ocupado={ocupado} />)}
        {(m.anexos ?? []).map((a, i) => <Anexo key={i} anexo={a} />)}
        {assistente && m.limitacoes?.length > 0 && (
          <details className="assistente-limitacoes">
            <summary>⚠️ Limitações dos dados ({m.limitacoes.length})</summary>
            <ul>{m.limitacoes.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </details>
        )}
        {assistente && (m.origemTexto || m.degradado) && (
          <div className="assistente-rodape">
            {m.degradado && <span className="badge assistente-degradado">Resposta parcial: um agente não respondeu</span>}
            {m.origemTexto && <span>{ORIGEM[m.origemTexto] ?? m.origemTexto}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function Assistente() {
  const [conversaId, setConversaId] = useState(lerConversa);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [decidindo, setDecidindo] = useState(false);
  const [erro, setErro] = useState('');
  const fimRef = useRef(null);
  const [confirmar, dialogoConfirmacao] = useConfirm();

  useEffect(() => {
    if (!conversaId) return;
    assistenteAPI.conversa(conversaId)
      .then((res) => setMensagens(res.data.mensagens))
      .catch(() => { gravarConversa(null); setConversaId(null); });
    // carrega só na abertura da tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { fimRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensagens, enviando]);

  const enviar = async (conteudo) => {
    const mensagem = (conteudo ?? texto).trim();
    if (!mensagem || enviando) return;
    setErro('');
    setTexto('');
    setMensagens((atual) => [...atual, { id: `local-${Date.now()}`, papel: 'USUARIO', conteudo: mensagem }]);
    setEnviando(true);
    try {
      const res = await assistenteAPI.enviar(mensagem, conversaId);
      setConversaId(res.data.conversaId);
      gravarConversa(res.data.conversaId);
      setMensagens((atual) => [...atual, res.data.mensagem]);
    } catch (e) {
      setErro(e.response?.data?.error || 'Não foi possível falar com o assistente agora.');
    } finally {
      setEnviando(false);
    }
  };

  const decidir = async (acao, decisao) => {
    const aprovar = decisao === 'aprovar';
    const ok = await confirmar({
      titulo: aprovar ? 'Aprovar ação proposta' : 'Rejeitar ação proposta',
      mensagem: aprovar ? `Aprovar e executar "${acao.titulo}"? Isso grava no sistema.` : `Rejeitar "${acao.titulo}"? Ela não será executada.`,
      textoConfirmar: aprovar ? 'Aprovar' : 'Rejeitar',
      perigo: !aprovar,
    });
    if (!ok) return;
    setDecidindo(true);
    setErro('');
    try {
      const res = aprovar ? await assistenteAPI.aprovarAcao(acao.acaoId) : await assistenteAPI.rejeitarAcao(acao.acaoId, 'Rejeitada pelo gestor no assistente');
      const novoStatus = res.data.status;
      setMensagens((atual) => atual.map((m) => (m.acoesPropostas ? { ...m, acoesPropostas: m.acoesPropostas.map((a) => (a.acaoId === acao.acaoId ? { ...a, status: novoStatus } : a)) } : m)));
      if (novoStatus === 'FALHA') setErro(`A ação não pôde ser executada: ${res.data.erro ?? 'erro desconhecido'}`);
    } catch (e) {
      setErro(e.response?.data?.error || 'Não foi possível registrar a decisão.');
    } finally {
      setDecidindo(false);
    }
  };

  const novaConversa = () => {
    gravarConversa(null);
    setConversaId(null);
    setMensagens([]);
    setErro('');
  };

  return (
    <div className="card assistente">
      <div className="assistente-cabecalho">
        <h2>🤖 Assistente</h2>
        {mensagens.length > 0 && <button className="btn-secondary" onClick={novaConversa} disabled={enviando}>Nova conversa</button>}
      </div>
      <p className="assistente-aviso">
        Responde com os dados dos agentes do sistema. Nada é registrado sem a sua aprovação.
      </p>

      <div className="assistente-historico">
        {mensagens.length === 0 && (
          <div className="assistente-vazio">
            <p>Pergunte em linguagem natural. Alguns exemplos:</p>
            <div className="assistente-sugestoes">
              {SUGESTOES.map((s) => <button key={s} className="btn-secondary" onClick={() => enviar(s)} disabled={enviando}>{s}</button>)}
            </div>
          </div>
        )}
        {mensagens.map((m) => <Mensagem key={m.id} m={m} onEscolher={enviar} onDecidir={decidir} ocupado={enviando || decidindo} />)}
        {enviando && <div className="assistente-msg assistente"><div className="assistente-balao assistente-carregando">Consultando os agentes…</div></div>}
        <div ref={fimRef} />
      </div>

      {erro && <div className="assistente-erro">{erro}</div>}

      <form className="assistente-entrada" onSubmit={(e) => { e.preventDefault(); enviar(); }}>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } }}
          placeholder="Ex.: Como está a demanda do Tradicional?"
          maxLength={2000}
          rows={2}
          disabled={enviando}
          aria-label="Mensagem para o assistente"
        />
        <button type="submit" className="btn-primary" disabled={enviando || !texto.trim()}>Enviar</button>
      </form>
      {dialogoConfirmacao}
    </div>
  );
}

export default Assistente;
