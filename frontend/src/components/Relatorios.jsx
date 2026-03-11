import { useState, useEffect } from 'react';
import { vendasAPI, clientesAPI, custosAPI } from '../services/api';

function Relatorios() {
  const [vendas, setVendas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [resumoCustos, setResumoCustos] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState({
    mes: new Date().getMonth() + 1,
    ano: new Date().getFullYear(),
    clienteId: ''
  });

  // Modal de edição
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [saboresDisponiveis, setSaboresDisponiveis] = useState([]);
  const [formEdit, setFormEdit] = useState({
    clienteId: '',
    data: '',
    valor: '',
    desconto: '',
    sabores: {}
  });
  const [msg, setMsg] = useState({ text: '', type: '' });

  useEffect(() => { carregarClientes(); }, []);
  useEffect(() => { carregarVendas(); }, [filtros]);

  const carregarClientes = async () => {
    try {
      const response = await clientesAPI.listar();
      setClientes(response.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
    }
  };

  const carregarVendas = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filtros.mes) params.mes = filtros.mes;
      if (filtros.ano) params.ano = filtros.ano;
      if (filtros.clienteId) params.clienteId = filtros.clienteId;

      const [vendasRes, custosRes] = await Promise.all([
        vendasAPI.listar(params),
        custosAPI.resumo({ mes: filtros.mes, ano: filtros.ano })
      ]);

      setVendas(vendasRes.data);
      setResumoCustos(custosRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3500);
  };

  // ===== DELETAR VENDA =====
  const handleDeletar = async (venda) => {
    if (!confirm(`Deseja realmente excluir a venda de "${venda.cliente.nome}" (${venda.quantidade} unidades)?`)) return;
    try {
      await vendasAPI.deletar(venda.id);
      showMsg('✅ Venda excluída com sucesso!');
      carregarVendas();
    } catch (error) {
      showMsg('❌ Erro ao excluir venda', 'error');
    }
  };

  // ===== EDITAR VENDA =====
  const abrirEdicao = async (venda) => {
    // Carregar sabores disponíveis se ainda não carregou
    if (saboresDisponiveis.length === 0) {
      try {
        const { default: axios } = await import('axios');
        const token = localStorage.getItem('token');
        const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const res = await axios.get(`${baseURL}/sabores`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSaboresDisponiveis(res.data);
      } catch (e) {
        console.error('Erro ao carregar sabores:', e);
      }
    }

    // Montar sabores já selecionados
    const saboresForm = {};
    venda.sabores?.forEach(vs => {
      saboresForm[vs.saborId] = vs.quantidade;
    });

    // Converter data ISO para DD/MM/AAAA
    const isoStr = typeof venda.data === 'string' ? venda.data : new Date(venda.data).toISOString();
    const [datePart] = isoStr.split('T');
    const [ano, mes, dia] = datePart.split('-');

    setEditando(venda);
    setFormEdit({
      clienteId: String(venda.clienteId),
      data: `${dia}/${mes}/${ano}`,
      valor: parseFloat(venda.valor).toFixed(2),
      desconto: parseFloat(venda.desconto || 0).toFixed(2),
      sabores: saboresForm
    });
    setShowModal(true);
  };

  const handleDataEditChange = (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5);
    if (v.length > 10) v = v.slice(0, 10);
    setFormEdit({ ...formEdit, data: v });
  };

  const handleQtdSabor = (saborId, qtd) => {
    const q = parseInt(qtd) || 0;
    const novo = { ...formEdit.sabores };
    if (q <= 0) delete novo[saborId];
    else novo[saborId] = q;
    setFormEdit({ ...formEdit, sabores: novo });
  };

  const handleSalvarEdicao = async (e) => {
    e.preventDefault();
    const [dia, mes, ano] = formEdit.data.split('/');
    if (!dia || !mes || !ano) { showMsg('❌ Data inválida', 'error'); return; }
    const dataIso = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;

    const saboresArray = Object.entries(formEdit.sabores).map(([saborId, quantidade]) => ({
      saborId: parseInt(saborId), quantidade
    }));
    const quantidadeTotal = saboresArray.reduce((s, i) => s + i.quantidade, 0);

    try {
      await vendasAPI.atualizar(editando.id, {
        clienteId: parseInt(formEdit.clienteId),
        quantidade: quantidadeTotal,
        valor: parseFloat(formEdit.valor),
        desconto: parseFloat(formEdit.desconto) || 0,
        data: dataIso,
        sabores: saboresArray
      });
      showMsg('✅ Venda atualizada com sucesso!');
      setShowModal(false);
      carregarVendas();
    } catch (error) {
      showMsg('❌ ' + (error.response?.data?.error || 'Erro ao atualizar'), 'error');
    }
  };

  // ===== HELPERS =====
  const formatarData = (data) => {
    const isoStr = typeof data === 'string' ? data : new Date(data).toISOString();
    const [datePart] = isoStr.split('T');
    const [ano, mes, dia] = datePart.split('-');
    return `${dia}/${mes}/${ano}`;
  };

  const formatarMoeda = (valor) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

  const exportarCSV = () => {
    const headers = ['Data', 'Cliente', 'Quantidade', 'Valor', 'Desconto'];
    const rows = vendas.map(v => [
      formatarData(v.data),
      v.cliente.nome,
      v.quantidade,
      parseFloat(v.valor).toFixed(2),
      parseFloat(v.desconto || 0).toFixed(2)
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendas_${filtros.mes}_${filtros.ano}.csv`;
    a.click();
  };

  // ===== CÁLCULOS =====
  const totalGeral = vendas.reduce((sum, v) => sum + v.quantidade, 0);
  const faturamento = vendas.reduce((sum, v) => sum + parseFloat(v.valor), 0);
  const totalCustos = resumoCustos ? parseFloat(resumoCustos.totalGeral) : 0;
  const lucro = faturamento - totalCustos;
  const margemLucro = faturamento > 0 ? ((lucro / faturamento) * 100).toFixed(1) : 0;

  const meses = [
    { value: 1, label: 'Janeiro' }, { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' }, { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' }, { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' }, { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' }, { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' }, { value: 12, label: 'Dezembro' }
  ];

  return (
    <div>
      {/* Toast de mensagem */}
      {msg.text && (
        <div style={{
          position: 'fixed', top: '1.5rem', left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999, padding: '0.9rem 1.8rem', borderRadius: '12px', fontWeight: 600,
          background: msg.type === 'error' ? 'var(--vermelho-erro)' : '#1a4d2e',
          color: msg.type === 'error' ? 'var(--vermelho-texto)' : '#4ade80',
          border: `1px solid ${msg.type === 'error' ? 'var(--vermelho-texto)' : '#4ade80'}`,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)'
        }}>
          {msg.text}
        </div>
      )}

      {/* Filtros */}
      <div className="card">
        <h2>🔍 Filtros</h2>
        <div className="filters">
          <div className="form-group" style={{ margin: 0 }}>
            <label>Mês</label>
            <select value={filtros.mes} onChange={(e) => setFiltros({ ...filtros, mes: e.target.value })}>
              <option value="">Todos</option>
              {meses.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Ano</label>
            <select value={filtros.ano} onChange={(e) => setFiltros({ ...filtros, ano: e.target.value })}>
              <option value="">Todos</option>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Cliente</label>
            <select value={filtros.clienteId} onChange={(e) => setFiltros({ ...filtros, clienteId: e.target.value })}>
              <option value="">Todos</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn-secondary" onClick={exportarCSV} disabled={vendas.length === 0} style={{ width: '100%' }}>
              📥 Exportar CSV
            </button>
          </div>
        </div>

        {/* Cards financeiros */}
        <div style={{
          marginTop: '1.5rem',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '1rem'
        }}>
          {/* Vendas */}
          <div style={cardStyle('#FF7A00')}>
            <div style={cardLabel}>Total de Vendas</div>
            <div style={cardValue('#FF7A00')}>{vendas.length}</div>
            <div style={cardSub}>{totalGeral} unidades</div>
          </div>

          {/* Faturamento */}
          <div style={cardStyle('#4ADE80')}>
            <div style={cardLabel}>💰 Faturamento</div>
            <div style={cardValue('#4ADE80')}>{formatarMoeda(faturamento)}</div>
            <div style={cardSub}>receita bruta</div>
          </div>

          {/* Custos */}
          <div style={cardStyle('#f59e0b')}>
            <div style={cardLabel}>💸 Custos</div>
            <div style={cardValue('#f59e0b')}>{formatarMoeda(totalCustos)}</div>
            <div style={cardSub}>{resumoCustos?.totalItens || 0} lançamentos</div>
          </div>

          {/* Lucro */}
          <div style={cardStyle(lucro >= 0 ? '#4ADE80' : '#ff6b6b')}>
            <div style={cardLabel}>📈 Lucro Estimado</div>
            <div style={cardValue(lucro >= 0 ? '#4ADE80' : '#ff6b6b')}>{formatarMoeda(lucro)}</div>
            <div style={{ ...cardSub, color: lucro >= 0 ? '#4ADE80' : '#ff6b6b' }}>
              margem: {margemLucro}%
            </div>
          </div>
        </div>

        {/* Breakdown de custos por categoria */}
        {resumoCustos && Object.keys(resumoCustos.porCategoria || {}).length > 0 && (
          <div style={{
            marginTop: '1rem', padding: '1rem 1.2rem',
            background: 'var(--bg-primary)', borderRadius: '12px',
            border: '1px solid var(--border-color)'
          }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.8rem', fontWeight: 600 }}>
              Custos por categoria:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem' }}>
              {Object.entries(resumoCustos.porCategoria).map(([cat, val]) => (
                <span key={cat} style={{
                  background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                  borderRadius: '8px', padding: '0.3rem 0.8rem', fontSize: '0.85rem'
                }}>
                  {cat}: <strong style={{ color: '#f59e0b' }}>{formatarMoeda(val)}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tabela de vendas */}
      <div className="card">
        <h2>📋 Histórico de Vendas</h2>

        {loading ? (
          <div className="loading">Carregando vendas</div>
        ) : vendas.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <h3>Nenhuma venda encontrada</h3>
            <p>Ajuste os filtros ou registre uma nova venda</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th>Qtd</th>
                  <th>Valor</th>
                  <th>Desconto</th>
                  <th style={{ textAlign: 'center' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>
                    <td>{formatarData(venda.data)}</td>
                    <td>{venda.cliente.nome}</td>
                    <td style={{ color: 'var(--laranja-maloca)', fontWeight: 'bold', fontSize: '1.1rem' }}>
                      {venda.quantidade}
                    </td>
                    <td style={{ color: '#4ADE80', fontWeight: 'bold' }}>
                      {formatarMoeda(parseFloat(venda.valor))}
                    </td>
                    <td style={{ color: parseFloat(venda.desconto) > 0 ? '#f59e0b' : 'var(--text-secondary)', fontWeight: parseFloat(venda.desconto) > 0 ? 'bold' : 'normal' }}>
                      {parseFloat(venda.desconto || 0) > 0 ? `- ${formatarMoeda(parseFloat(venda.desconto))}` : '-'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        <button
                          onClick={() => abrirEdicao(venda)}
                          style={{ background: 'var(--laranja-maloca)', color: '#fff', border: 'none', padding: '0.5rem 0.8rem', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--laranja-hover)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'var(--laranja-maloca)'}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => handleDeletar(venda)}
                          style={{ background: 'var(--vermelho-erro)', color: 'var(--vermelho-texto)', border: '1px solid var(--vermelho-texto)', padding: '0.5rem 0.8rem', borderRadius: '6px', cursor: 'pointer', transition: 'all 0.2s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'var(--vermelho-texto)'; e.currentTarget.style.color = '#fff'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'var(--vermelho-erro)'; e.currentTarget.style.color = 'var(--vermelho-texto)'; }}
                        >
                          🗑️ Excluir
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de edição */}
      {showModal && editando && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <h3>✏️ Editar Venda</h3>
            <form onSubmit={handleSalvarEdicao}>
              <div className="form-group">
                <label>Cliente *</label>
                <select
                  value={formEdit.clienteId}
                  onChange={e => setFormEdit({ ...formEdit, clienteId: e.target.value })}
                  required
                >
                  <option value="">Selecione</option>
                  {clientes.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Data *</label>
                <input
                  type="text"
                  value={formEdit.data}
                  onChange={handleDataEditChange}
                  placeholder="DD/MM/AAAA"
                  maxLength={10}
                  required
                />
              </div>

              {saboresDisponiveis.length > 0 && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.8rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                    🍬 Sabores
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                    {saboresDisponiveis.map(sabor => (
                      <div key={sabor.id} style={{
                        background: 'var(--bg-primary)', border: `2px solid ${formEdit.sabores[sabor.id] ? 'var(--laranja-maloca)' : 'var(--border-color)'}`,
                        borderRadius: '8px', padding: '0.8rem', transition: 'all 0.2s'
                      }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{sabor.nome}</div>
                        <input
                          type="number" min="0"
                          value={formEdit.sabores[sabor.id] || ''}
                          onChange={e => handleQtdSabor(sabor.id, e.target.value)}
                          placeholder="Qtd"
                          style={{
                            width: '100%', padding: '0.5rem', textAlign: 'center',
                            background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                            borderRadius: '6px', color: 'var(--text-primary)', fontSize: '0.95rem'
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label>Desconto (R$)</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={formEdit.desconto}
                    onChange={e => setFormEdit({ ...formEdit, desconto: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div className="form-group">
                  <label>Valor Final (R$) *</label>
                  <input
                    type="number" step="0.01" min="0"
                    value={formEdit.valor}
                    onChange={e => setFormEdit({ ...formEdit, valor: e.target.value })}
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn-primary">💾 Salvar</button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

// Estilos inline reutilizáveis para os cards financeiros
const cardStyle = (cor) => ({
  textAlign: 'center', padding: '1rem',
  background: 'var(--bg-card)', borderRadius: '10px',
  border: `2px solid ${cor}`
});
const cardLabel = { color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' };
const cardValue = (cor) => ({ color: cor, fontSize: '1.6rem', fontWeight: 'bold', fontFamily: 'Poppins', lineHeight: 1.2 });
const cardSub = { color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.3rem' };

export default Relatorios;