import { useState, useEffect, useRef } from 'react';
import { estoqueAPI, saboresAPI } from '../services/api';
import { useConfirm } from '../hooks/useConfirm';

const MOTIVOS = {
  DIVERGENCIA_CONTAGEM: 'Divergência de contagem',
  PERDA_AVARIA: 'Perda/avaria',
  ERRO_LANCAMENTO: 'Erro de lançamento',
  OUTRO: 'Outro',
};

const FORM_VAZIO = { saborId: '', contagem: '', motivo: '', justificativa: '' };

const novaChave = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const comSinal = (n) => (n > 0 ? `+${n}` : `${n}`);

function Estoque() {
  const [confirmar, dialogoConfirmacao] = useConfirm();
  const [estoque, setEstoque] = useState(null);
  const [sabores, setSabores] = useState([]);
  const [ajustes, setAjustes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [showAjuste, setShowAjuste] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [enviando, setEnviando] = useState(false);
  const [erroAjuste, setErroAjuste] = useState('');
  const [msg, setMsg] = useState('');
  // Operação ainda sem resposta definitiva do servidor: { assinatura, chave }.
  // A mesma operação repetida (ex.: após falha de conexão) reutiliza a chave.
  const pendente = useRef(null);

  useEffect(() => { carregar(); }, []);

  const carregar = async () => {
    setLoading(true);
    setErro('');
    try {
      const [res, resSabores, resAjustes] = await Promise.all([
        estoqueAPI.listar(),
        saboresAPI.listar(),
        estoqueAPI.listarAjustes({ limit: 50 }),
      ]);
      setEstoque(res.data);
      setSabores(resSabores.data);
      setAjustes(resAjustes.data);
    } catch {
      setErro('Erro ao carregar estoque');
    } finally {
      setLoading(false);
    }
  };

  const recarregarSaldos = async () => {
    const [res, resAjustes] = await Promise.all([
      estoqueAPI.listar(),
      estoqueAPI.listarAjustes({ limit: 50 }),
    ]);
    setEstoque(res.data);
    setAjustes(resAjustes.data);
  };

  if (loading) return <div className="loading">Carregando estoque</div>;
  if (erro) return <div style={{ color: 'var(--vermelho-texto)', padding: '2rem' }}>{erro}</div>;

  const { itens = [], totalProduzido = 0, totalVendido = 0, totalAjustado = 0, totalSaldo = 0 } = estoque || {};

  // Sabores ativos e também os inativos que ainda têm movimentação (saldo a corrigir)
  const opcoesSabor = [...sabores.map((s) => ({ id: s.id, nome: s.nome })),
    ...itens.filter((i) => !sabores.some((s) => s.id === i.id)).map((i) => ({ id: i.id, nome: `${i.nome} (inativo)` }))]
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const saborSelecionado = opcoesSabor.find((s) => s.id === Number(form.saborId));
  const saldoAtual = form.saborId ? (itens.find((i) => i.id === Number(form.saborId))?.saldo ?? 0) : null;
  const contagemValida = /^\d+$/.test(String(form.contagem).trim());
  const contagem = contagemValida ? Number(form.contagem) : null;
  const diferenca = saldoAtual !== null && contagem !== null ? contagem - saldoAtual : null;

  const abrirAjuste = () => {
    setForm(FORM_VAZIO);
    setErroAjuste('');
    setShowAjuste(true);
  };

  const fecharAjuste = () => {
    if (enviando) return;
    setShowAjuste(false);
  };

  const mostrarMsg = (texto) => {
    setMsg(texto);
    setTimeout(() => setMsg(''), 3500);
  };

  const handleAjuste = async (e) => {
    e.preventDefault();
    setErroAjuste('');
    if (!saborSelecionado) return setErroAjuste('Selecione o sabor.');
    if (!contagemValida) return setErroAjuste('Informe a quantidade contada (número inteiro, zero ou maior).');
    if (!form.motivo) return setErroAjuste('Selecione o motivo do ajuste.');
    if (form.motivo === 'OUTRO' && !form.justificativa.trim()) {
      return setErroAjuste('Descreva a justificativa para o motivo "Outro".');
    }
    if (diferenca === 0) return;

    if (!await confirmar({
      titulo: '⚖️ Confirmar ajuste de estoque',
      mensagem: `${saborSelecionado.nome}: saldo ${saldoAtual} → ${contagem} (${comSinal(diferenca)})`,
      detalhe: `Motivo: ${MOTIVOS[form.motivo]}${form.motivo === 'OUTRO' ? ` — ${form.justificativa.trim()}` : ''}. O ajuste fica registrado no histórico e não pode ser editado.`,
      textoConfirmar: '⚖️ Confirmar ajuste',
    })) return;

    const operacao = {
      saborId: Number(form.saborId),
      quantidadeContada: contagem,
      saldoEsperado: saldoAtual,
      motivo: form.motivo,
      justificativa: form.motivo === 'OUTRO' ? form.justificativa.trim() : '',
    };
    const assinatura = JSON.stringify(operacao);
    if (pendente.current?.assinatura !== assinatura) {
      pendente.current = { assinatura, chave: novaChave() };
    }

    setEnviando(true);
    try {
      const res = await estoqueAPI.ajustar({ ...operacao, idempotencyKey: pendente.current.chave });
      pendente.current = null;
      setShowAjuste(false);
      mostrarMsg(res.data.semAlteracao
        ? 'ℹ️ Contagem igual ao saldo: nenhum ajuste registrado'
        : '✅ Ajuste de estoque registrado!');
      await recarregarSaldos();
    } catch (err) {
      if (!err.response || err.response.status >= 500) {
        // Sem resposta definitiva: a chave é mantida para repetir com segurança.
        setErroAjuste('Falha de comunicação com o servidor. O ajuste pode não ter sido registrado: confirme novamente para repetir com segurança (não haverá duplicidade).');
        return;
      }
      // Recusa definitiva: nada foi gravado. A chave só muda se os dados mudarem
      // (ex.: saldo recarregado após SALDO_ALTERADO).
      setErroAjuste(err.response.data?.error || 'Erro ao registrar ajuste');
      if (err.response.data?.codigo === 'SALDO_ALTERADO') {
        await recarregarSaldos().catch(() => {});
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div>
      {msg && (
        <div style={{
          position: 'fixed', top: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '0.9rem 1.8rem', borderRadius: '12px', fontWeight: 600,
          background: '#1a4d2e', color: '#4ade80', border: '1px solid #4ade80',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
        }}>
          {msg}
        </div>
      )}

      {/* Cards de totais */}
      <div className="dashboard" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <h3>📦 Total Produzido</h3>
          <div className="value" style={{ fontSize: '2rem' }}>{totalProduzido}</div>
          <div className="subtitle">unidades acumuladas</div>
        </div>
        <div className="stat-card">
          <h3>🛒 Total Vendido</h3>
          <div className="value" style={{ fontSize: '2rem' }}>{totalVendido}</div>
          <div className="subtitle">unidades acumuladas</div>
        </div>
        <div className="stat-card">
          <h3>🏪 Saldo em Estoque</h3>
          <div className="value" style={{ fontSize: '2rem', color: totalSaldo < 0 ? 'var(--vermelho-texto)' : totalSaldo < 10 ? '#f59e0b' : 'var(--laranja-maloca)' }}>
            {totalSaldo}
          </div>
          <div className="subtitle">unidades disponíveis</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2>📦 Estoque de Produto Acabado</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn-primary" onClick={abrirAjuste} style={{ width: 'auto', padding: '0.5rem 1rem' }}>
              ⚖️ Ajustar estoque
            </button>
            <button onClick={carregar} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>
              🔄 Atualizar
            </button>
          </div>
        </div>

        {itens.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📦</div>
            <h3>Nenhum dado de estoque</h3>
            <p>Registre produções e vendas para visualizar o saldo</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Sabor</th>
                  <th style={{ textAlign: 'right' }}>Produzido</th>
                  <th style={{ textAlign: 'right' }}>Vendido</th>
                  <th style={{ textAlign: 'right' }}>Ajustes</th>
                  <th style={{ textAlign: 'right' }}>Saldo</th>
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((item) => {
                  const pct = item.produzido > 0 ? Math.min(100, (item.vendido / item.produzido) * 100) : 0;
                  const cor = item.saldo < 0 ? 'var(--vermelho-texto)' : item.saldo < 5 ? '#f59e0b' : '#4ade80';
                  return (
                    <tr key={item.id}>
                      <td style={{ fontWeight: 500 }}>🍬 {item.nome}</td>
                      <td style={{ textAlign: 'right' }}>{item.produzido}</td>
                      <td style={{ textAlign: 'right' }}>{item.vendido}</td>
                      <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{item.ajustado ? comSinal(item.ajustado) : '—'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: cor }}>{item.saldo}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{ flex: 1, height: '8px', background: 'var(--bg-secondary)', borderRadius: '4px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: pct >= 100 ? 'var(--vermelho-texto)' : 'var(--laranja-maloca)', borderRadius: '4px', transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', minWidth: '40px' }}>{pct.toFixed(0)}%</span>
                        </div>
                        {item.saldo < 0 && <span style={{ fontSize: '0.75rem', color: 'var(--vermelho-texto)' }}>⚠️ Negativo</span>}
                        {item.saldo === 0 && item.produzido > 0 && <span style={{ fontSize: '0.75rem', color: '#f59e0b' }}>Zerado</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--border-color)', fontWeight: 'bold' }}>
                  <td>Total</td>
                  <td style={{ textAlign: 'right' }}>{totalProduzido}</td>
                  <td style={{ textAlign: 'right' }}>{totalVendido}</td>
                  <td style={{ textAlign: 'right' }}>{totalAjustado ? comSinal(totalAjustado) : '—'}</td>
                  <td style={{ textAlign: 'right', color: totalSaldo < 0 ? 'var(--vermelho-texto)' : 'var(--laranja-maloca)' }}>{totalSaldo}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Histórico de ajustes */}
      <div className="card">
        <h2 style={{ marginBottom: '1.5rem' }}>⚖️ Histórico de Ajustes</h2>
        {ajustes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">⚖️</div>
            <h3>Nenhum ajuste registrado</h3>
            <p>Use "Ajustar estoque" após uma contagem física</p>
          </div>
        ) : (
          <>
            <div className="table-container table-container--wide">
              <table>
                <thead>
                  <tr>
                    <th>Data/hora</th>
                    <th>Sabor</th>
                    <th style={{ textAlign: 'right' }}>Saldo anterior</th>
                    <th style={{ textAlign: 'right' }}>Saldo novo</th>
                    <th style={{ textAlign: 'right' }}>Diferença</th>
                    <th>Motivo</th>
                    <th>Responsável</th>
                  </tr>
                </thead>
                <tbody>
                  {ajustes.map((a) => (
                    <tr key={a.id}>
                      <td>{new Date(a.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                      <td style={{ fontWeight: 500 }}>{a.sabor.nome}</td>
                      <td style={{ textAlign: 'right' }}>{a.saldoAnterior}</td>
                      <td style={{ textAlign: 'right' }}>{a.saldoNovo}</td>
                      <td style={{ textAlign: 'right', fontWeight: 'bold', color: a.diferenca < 0 ? 'var(--vermelho-texto)' : '#4ade80' }}>{comSinal(a.diferenca)}</td>
                      <td>
                        {MOTIVOS[a.motivo] || a.motivo}
                        {a.justificativa && <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{a.justificativa}</div>}
                      </td>
                      <td>{a.usuario.nome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="table-scroll-hint">← deslize para ver todas as colunas →</div>
          </>
        )}
      </div>

      {/* Modal de ajuste */}
      {showAjuste && (
        <div className="modal-overlay" onClick={fecharAjuste}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
            <h3>⚖️ Ajustar Estoque</h3>
            <form onSubmit={handleAjuste}>
              <div className="form-group">
                <label>Sabor *</label>
                <select value={form.saborId} onChange={(e) => setForm({ ...form, saborId: e.target.value })} required autoFocus>
                  <option value="">Selecione...</option>
                  {opcoesSabor.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Quantidade contada *</label>
                <input type="number" min="0" step="1" inputMode="numeric" value={form.contagem} onChange={(e) => setForm({ ...form, contagem: e.target.value })} placeholder="Unidades encontradas na contagem física" required />
              </div>

              {saldoAtual !== null && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem', marginBottom: '1.2rem', textAlign: 'center' }}>
                  {[
                    ['Saldo atual', saldoAtual, saldoAtual < 0 ? 'var(--vermelho-texto)' : 'var(--text-primary)'],
                    ['Diferença', diferenca === null ? '—' : comSinal(diferenca), diferenca < 0 ? 'var(--vermelho-texto)' : diferenca > 0 ? '#4ade80' : 'var(--text-primary)'],
                    ['Saldo resultante', contagem === null ? '—' : contagem, 'var(--laranja-maloca)'],
                  ].map(([rotulo, valor, cor]) => (
                    <div key={rotulo} style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.6rem' }}>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{rotulo}</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 'bold', color: cor }}>{valor}</div>
                    </div>
                  ))}
                </div>
              )}
              {diferenca === 0 && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '-0.6rem', marginBottom: '1rem' }}>
                  A contagem é igual ao saldo atual: não há ajuste a registrar.
                </p>
              )}

              <div className="form-group">
                <label>Motivo *</label>
                <select value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })} required>
                  <option value="">Selecione...</option>
                  {Object.entries(MOTIVOS).map(([valor, rotulo]) => <option key={valor} value={valor}>{rotulo}</option>)}
                </select>
              </div>
              {form.motivo === 'OUTRO' && (
                <div className="form-group">
                  <label>Justificativa *</label>
                  <textarea rows={2} maxLength={255} value={form.justificativa} onChange={(e) => setForm({ ...form, justificativa: e.target.value })} placeholder="Descreva o motivo do ajuste" required />
                </div>
              )}

              {erroAjuste && (
                <p style={{ color: 'var(--vermelho-texto)', fontSize: '0.9rem', marginBottom: '1rem' }}>{erroAjuste}</p>
              )}

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn-primary" disabled={enviando || diferenca === 0}>
                  {enviando ? 'Registrando...' : '⚖️ Registrar ajuste'}
                </button>
                <button type="button" onClick={fecharAjuste} className="btn-secondary" style={{ flex: 1 }} disabled={enviando}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {dialogoConfirmacao}
    </div>
  );
}

export default Estoque;
