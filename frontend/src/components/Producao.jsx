import { useState, useEffect } from 'react';
import { producaoAPI, saboresAPI } from '../services/api';

function brParaIso(dataBr) {
  const [dia, mes, ano] = dataBr.split('/');
  if (!dia || !mes || !ano) return '';
  return `${ano}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
}

function hojeFormatado() {
  const hoje = new Date();
  return `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`;
}

function formatarData(data) {
  const isoStr = typeof data === 'string' ? data : new Date(data).toISOString();
  const [datePart] = isoStr.split('T');
  const [ano, mes, dia] = datePart.split('-');
  return `${dia}/${mes}/${ano}`;
}

const mesAtual = new Date().getMonth() + 1;
const anoAtual = new Date().getFullYear();

const SABOR_CORES = ['#f59e0b','#10b981','#3b82f6','#ec4899','#8b5cf6','#ef4444'];

export default function Producao() {
  const [resumo, setResumo] = useState(null);
  const [saboresDisponiveis, setSaboresDisponiveis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [filtros, setFiltros] = useState({ mes: mesAtual, ano: anoAtual });
  const [form, setForm] = useState({ data: hojeFormatado(), observacao: '', sabores: {} });
  const [msg, setMsg] = useState({ text: '', type: '' });

  useEffect(() => { carregar(); }, [filtros]);
  useEffect(() => { carregarSabores(); }, []);

  const carregar = async () => {
    setLoading(true);
    try {
      const response = await producaoAPI.resumo({ mes: filtros.mes, ano: filtros.ano });
      setResumo(response.data);
    } catch {
      showMsg('Erro ao carregar produção', 'error');
    } finally {
      setLoading(false);
    }
  };

  const carregarSabores = async () => {
    try {
      const response = await saboresAPI.listar();
      setSaboresDisponiveis(response.data);
    } catch {}
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3500);
  };

  const handleQuantidade = (saborId, qtd) => {
    const q = parseInt(qtd) || 0;
    const novo = { ...form.sabores };
    if (q <= 0) delete novo[saborId];
    else novo[saborId] = q;
    setForm({ ...form, sabores: novo });
  };

  const totalSelecionado = Object.values(form.sabores).reduce((s, q) => s + q, 0);

  const abrirModal = (reg = null) => {
    if (reg) {
      setEditando(reg.id);
      const isoStr = typeof reg.data === 'string' ? reg.data : new Date(reg.data).toISOString();
      const [datePart] = isoStr.split('T');
      const [ano, mes, dia] = datePart.split('-');
      const saboresForm = {};
      reg.sabores.forEach(ps => { saboresForm[ps.saborId] = ps.quantidade; });
      setForm({ data: `${dia}/${mes}/${ano}`, observacao: reg.observacao || '', sabores: saboresForm });
    } else {
      setEditando(null);
      setForm({ data: hojeFormatado(), observacao: '', sabores: {} });
    }
    setShowModal(true);
  };

  const handleDataChange = (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    if (v.length > 10) v = v.slice(0,10);
    setForm({ ...form, data: v });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const dataIso = brParaIso(form.data);
    if (!dataIso) { showMsg('Data inválida', 'error'); return; }
    if (totalSelecionado === 0) { showMsg('Selecione ao menos um sabor', 'error'); return; }

    const saboresArray = Object.entries(form.sabores).map(([saborId, quantidade]) => ({
      saborId: parseInt(saborId), quantidade
    }));

    try {
      const payload = { data: dataIso, observacao: form.observacao, sabores: saboresArray };
      if (editando) {
        await producaoAPI.atualizar(editando, payload);
        showMsg('✅ Registro atualizado!');
      } else {
        await producaoAPI.criar(payload);
        showMsg('✅ Produção registrada!');
      }
      setShowModal(false);
      carregar();
    } catch (err) {
      showMsg('❌ ' + (err.response?.data?.error || 'Erro ao salvar'), 'error');
    }
  };

  const handleDeletar = async (id) => {
    if (!confirm('Deseja deletar este registro?')) return;
    try {
      await producaoAPI.deletar(id);
      showMsg('✅ Deletado!');
      carregar();
    } catch {
      showMsg('❌ Erro ao deletar', 'error');
    }
  };

  const meses = [
    {v:1,l:'Janeiro'},{v:2,l:'Fevereiro'},{v:3,l:'Março'},{v:4,l:'Abril'},
    {v:5,l:'Maio'},{v:6,l:'Junho'},{v:7,l:'Julho'},{v:8,l:'Agosto'},
    {v:9,l:'Setembro'},{v:10,l:'Outubro'},{v:11,l:'Novembro'},{v:12,l:'Dezembro'}
  ];

  const maxMes = resumo ? Math.max(...(resumo.meses?.map(m => m.total) || [1]), 1) : 1;
  const totalPorSabor = resumo?.porSabor || {};

  return (
    <div>
      {msg.text && (
        <div style={{
          position:'fixed', top:'1.5rem', left:'50%', transform:'translateX(-50%)',
          zIndex:9999, padding:'0.9rem 1.8rem', borderRadius:'12px', fontWeight:600,
          background: msg.type==='error' ? 'var(--vermelho-erro)' : '#1a4d2e',
          color: msg.type==='error' ? 'var(--vermelho-texto)' : '#4ade80',
          border: `1px solid ${msg.type==='error' ? 'var(--vermelho-texto)' : '#4ade80'}`,
          boxShadow:'0 8px 24px rgba(0,0,0,0.3)'
        }}>{msg.text}</div>
      )}

      {/* Cards de resumo */}
      {resumo && (
        <div className="dashboard" style={{ marginBottom:'1.5rem' }}>
          <div className="stat-card">
            <h3>📅 Hoje</h3>
            <div className="value">{resumo.totalHoje}</div>
            <div className="subtitle">cocadas produzidas</div>
          </div>
          <div className="stat-card">
            <h3>📆 Esta Semana</h3>
            <div className="value">{resumo.totalSemana}</div>
            <div className="subtitle">cocadas produzidas</div>
          </div>
          <div className="stat-card">
            <h3>🗓️ Este Mês</h3>
            <div className="value">{resumo.totalMes}</div>
            <div className="subtitle">cocadas produzidas</div>
          </div>
          <div className="stat-card" style={{ borderColor: resumo.saldoEstoque >= 0 ? '#4ade80' : '#ff6b6b' }}>
            <h3>📦 Saldo Estimado</h3>
            <div className="value" style={{ color: resumo.saldoEstoque >= 0 ? '#4ade80' : '#ff6b6b' }}>
              {resumo.saldoEstoque}
            </div>
            <div className="subtitle">produção − vendas do mês</div>
          </div>
        </div>
      )}

      {/* Por sabor */}
      {Object.keys(totalPorSabor).length > 0 && (
        <div className="card" style={{ marginBottom:'1.5rem' }}>
          <h2>🍬 Produção por Sabor — {meses.find(m => m.v == filtros.mes)?.l}</h2>
          <div className="sabores-grid" style={{ marginTop:'1rem' }}>
            {Object.entries(totalPorSabor).map(([nome, qtd], i) => (
              <div key={nome} className="sabor-item" style={{ flexDirection:'column', alignItems:'flex-start', gap:'0.5rem', padding:'1rem' }}>
                <div style={{ display:'flex', justifyContent:'space-between', width:'100%', alignItems:'center' }}>
                  <span style={{ fontWeight:600 }}>{nome}</span>
                  <span style={{ color: SABOR_CORES[i % SABOR_CORES.length], fontWeight:'bold', fontSize:'1.3rem' }}>{qtd}</span>
                </div>
                <div style={{ width:'100%', background:'var(--bg-primary)', borderRadius:'999px', height:'6px' }}>
                  <div style={{
                    height:'6px', borderRadius:'999px',
                    background: SABOR_CORES[i % SABOR_CORES.length],
                    width: `${(qtd / resumo.totalMes) * 100}%`,
                    transition:'width 0.6s ease'
                  }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filtros + lista */}
      <div className="card">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem', flexWrap:'wrap', gap:'1rem' }}>
          <h2>🏭 Registros de Produção</h2>
          <button className="btn-primary" onClick={() => abrirModal()} style={{ width:'auto', padding:'0.8rem 1.5rem' }}>
            ➕ Registrar Produção
          </button>
        </div>

        <div className="filters" style={{ marginBottom:'1.5rem' }}>
          <div className="form-group" style={{ margin:0 }}>
            <label>Mês</label>
            <select value={filtros.mes} onChange={e => setFiltros({...filtros, mes: e.target.value})}>
              {meses.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label>Ano</label>
            <select value={filtros.ano} onChange={e => setFiltros({...filtros, ano: e.target.value})}>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading">Carregando</div>
        ) : !resumo?.registros?.length ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏭</div>
            <h3>Nenhuma produção registrada</h3>
            <p>Clique em "Registrar Produção" para começar</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Sabores</th>
                  <th>Total</th>
                  <th>Observação</th>
                  <th style={{ textAlign:'center' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {resumo.registros.map(r => {
                  const total = r.sabores.reduce((s, ps) => s + ps.quantidade, 0);
                  return (
                    <tr key={r.id}>
                      <td>{formatarData(r.data)}</td>
                      <td>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:'0.4rem' }}>
                          {r.sabores.map(ps => (
                            <span key={ps.id} style={{
                              background:'var(--bg-primary)', border:'1px solid var(--border-color)',
                              borderRadius:'6px', padding:'0.2rem 0.6rem', fontSize:'0.85rem'
                            }}>
                              {ps.sabor.nome}: <strong>{ps.quantidade}</strong>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ color:'var(--laranja-maloca)', fontWeight:'bold', fontSize:'1.1rem' }}>{total}</td>
                      <td style={{ color:'var(--text-secondary)' }}>{r.observacao || '—'}</td>
                      <td>
                        <div style={{ display:'flex', gap:'0.5rem', justifyContent:'center' }}>
                          <button onClick={() => abrirModal(r)} style={{ background:'var(--laranja-maloca)', color:'#fff', border:'none', padding:'0.5rem 0.8rem', borderRadius:'6px', cursor:'pointer' }}>✏️</button>
                          <button onClick={() => handleDeletar(r.id)} style={{ background:'var(--vermelho-erro)', color:'var(--vermelho-texto)', border:'1px solid var(--vermelho-texto)', padding:'0.5rem 0.8rem', borderRadius:'6px', cursor:'pointer' }}>🗑️</button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Gráfico anual */}
      {resumo?.meses && (
        <div className="card">
          <h2>📊 Produção Anual — {filtros.ano}</h2>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(70px, 1fr))', gap:'1rem', marginTop:'2rem' }}>
            {resumo.meses.map(m => {
              const h = maxMes > 0 ? (m.total / maxMes) * 180 : 0;
              return (
                <div key={m.mes} style={{ textAlign:'center' }}>
                  <div style={{ height:'180px', display:'flex', alignItems:'flex-end', justifyContent:'center' }}>
                    <div style={{
                      width:'100%', maxWidth:'50px', height:`${Math.max(h, m.total > 0 ? 30 : 0)}px`,
                      background:'linear-gradient(to top, var(--laranja-maloca), var(--laranja-hover))',
                      borderRadius:'6px 6px 0 0', display:'flex', alignItems:'flex-start',
                      justifyContent:'center', paddingTop:'0.3rem',
                      color:'white', fontSize:'0.8rem', fontWeight:'bold',
                    }}>
                      {m.total > 0 ? m.total : ''}
                    </div>
                  </div>
                  <div style={{ marginTop:'0.4rem', color:'var(--text-secondary)', fontSize:'0.8rem' }}>
                    {m.nomeMes.substring(0,3)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth:500 }} onClick={e => e.stopPropagation()}>
            <h3>{editando ? '✏️ Editar Registro' : '🏭 Registrar Produção'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Data *</label>
                <input type="text" value={form.data} onChange={handleDataChange} placeholder="DD/MM/AAAA" maxLength={10} required autoFocus />
              </div>

              <div className="sabores-section">
                <h3>🍬 Quantidade por Sabor</h3>
                <div className="sabores-grid">
                  {saboresDisponiveis.map(sabor => (
                    <div key={sabor.id} className="sabor-item">
                      <div className="sabor-info">
                        <span className="sabor-nome">{sabor.nome}</span>
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={form.sabores[sabor.id] || ''}
                        onChange={e => handleQuantidade(sabor.id, e.target.value)}
                        placeholder="Qtd"
                        className="sabor-input"
                      />
                    </div>
                  ))}
                </div>
                {totalSelecionado > 0 && (
                  <div style={{ marginTop:'0.8rem', textAlign:'right', color:'var(--laranja-maloca)', fontWeight:'bold' }}>
                    Total: {totalSelecionado} cocadas
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Observação</label>
                <input type="text" value={form.observacao} onChange={e => setForm({...form, observacao:e.target.value})} placeholder="Ex: Lote especial, feriado..." />
              </div>

              <div style={{ display:'flex', gap:'1rem' }}>
                <button type="submit" className="btn-primary" disabled={totalSelecionado === 0}>
                  {editando ? '💾 Atualizar' : '✨ Registrar'}
                </button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary" style={{ flex:1 }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}