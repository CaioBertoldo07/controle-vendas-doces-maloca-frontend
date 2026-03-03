import { useState, useEffect } from 'react';
import { custosAPI } from '../services/api';

const CATEGORIAS = ['Matéria Prima', 'Embalagem', 'Equipamento', 'Outros'];
const UNIDADES   = ['kg', 'g', 'L', 'ml', 'un', 'cx', 'pct', 'saco'];
const CAT_ICONS  = { 'Matéria Prima': '🥥', 'Embalagem': '📦', 'Equipamento': '🔧', 'Outros': '📋' };

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

function formatarMoeda(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

const mesAtual = new Date().getMonth() + 1;
const anoAtual = new Date().getFullYear();

export default function Custos() {
  const [custos, setCustos] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [filtros, setFiltros] = useState({ mes: mesAtual, ano: anoAtual, categoria: '' });
  const [form, setForm] = useState({ nome:'', categoria:'Matéria Prima', quantidade:'', unidade:'kg', valorTotal:'', data: hojeFormatado(), observacao:'' });
  const [msg, setMsg] = useState({ text:'', type:'' });

  useEffect(() => { carregar(); }, [filtros]);

  const carregar = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filtros.mes) params.mes = filtros.mes;
      if (filtros.ano) params.ano = filtros.ano;
      if (filtros.categoria) params.categoria = filtros.categoria;

      const [custosRes, resumoRes] = await Promise.all([
        custosAPI.listar(params),
        custosAPI.resumo({ mes: filtros.mes, ano: filtros.ano }),
      ]);
      setCustos(custosRes.data);
      setResumo(resumoRes.data);
    } catch (e) {
      showMsg('Erro ao carregar custos', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text, type='success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text:'', type:'' }), 3500);
  };

  const abrirModal = (custo=null) => {
    if (custo) {
      setEditando(custo.id);
      const isoStr = typeof custo.data === 'string' ? custo.data : new Date(custo.data).toISOString();
      const [datePart] = isoStr.split('T');
      const [ano, mes, dia] = datePart.split('-');
      setForm({
        nome: custo.nome,
        categoria: custo.categoria,
        quantidade: custo.quantidade,
        unidade: custo.unidade,
        valorTotal: parseFloat(custo.valorTotal).toFixed(2),
        data: `${dia}/${mes}/${ano}`,
        observacao: custo.observacao || '',
      });
    } else {
      setEditando(null);
      setForm({ nome:'', categoria:'Matéria Prima', quantidade:'', unidade:'kg', valorTotal:'', data: hojeFormatado(), observacao:'' });
    }
    setShowModal(true);
  };

  const handleDataChange = (e) => {
    let v = e.target.value.replace(/\D/g,'');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    if (v.length > 10) v = v.slice(0,10);
    setForm({ ...form, data: v });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const dataIso = brParaIso(form.data);
    if (!dataIso) { showMsg('Data inválida', 'error'); return; }

    try {
      const payload = { ...form, data: dataIso, quantidade: parseFloat(form.quantidade), valorTotal: parseFloat(form.valorTotal) };
      if (editando) {
        await custosAPI.atualizar(editando, payload);
        showMsg('✅ Custo atualizado!');
      } else {
        await custosAPI.criar(payload);
        showMsg('✅ Custo registrado!');
      }
      setShowModal(false);
      carregar();
    } catch (err) {
      showMsg('❌ ' + (err.response?.data?.error || 'Erro ao salvar'), 'error');
    }
  };

  const handleDeletar = async (id) => {
    if (!confirm('Deseja deletar este custo?')) return;
    try {
      await custosAPI.deletar(id);
      showMsg('✅ Custo deletado!');
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
        }}>
          {msg.text}
        </div>
      )}

      {/* Cards de resumo */}
      {resumo && (
        <div className="dashboard" style={{ marginBottom:'1.5rem' }}>
          <div className="stat-card">
            <h3>💸 Total do Mês</h3>
            <div className="value" style={{ fontSize:'2rem' }}>{formatarMoeda(resumo.totalGeral)}</div>
            <div className="subtitle">{resumo.totalItens} registros</div>
          </div>
          {Object.entries(resumo.porCategoria || {}).map(([cat, val]) => (
            <div key={cat} className="stat-card">
              <h3>{CAT_ICONS[cat] || '📋'} {cat}</h3>
              <div className="value" style={{ fontSize:'2rem' }}>{formatarMoeda(val)}</div>
              <div className="subtitle">{((val / resumo.totalGeral)*100).toFixed(1)}% do total</div>
            </div>
          ))}
        </div>
      )}

      {/* Filtros + ações */}
      <div className="card">
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'1.5rem', flexWrap:'wrap', gap:'1rem' }}>
          <h2>💸 Controle de Custos</h2>
          <button className="btn-primary" onClick={() => abrirModal()} style={{ width:'auto', padding:'0.8rem 1.5rem' }}>
            ➕ Novo Custo
          </button>
        </div>

        <div className="filters">
          <div className="form-group" style={{ margin:0 }}>
            <label>Mês</label>
            <select value={filtros.mes} onChange={(e) => setFiltros({...filtros, mes: e.target.value})}>
              <option value="">Todos</option>
              {meses.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label>Ano</label>
            <select value={filtros.ano} onChange={(e) => setFiltros({...filtros, ano: e.target.value})}>
              <option value="2026">2026</option>
              <option value="2025">2025</option>
            </select>
          </div>
          <div className="form-group" style={{ margin:0 }}>
            <label>Categoria</label>
            <select value={filtros.categoria} onChange={(e) => setFiltros({...filtros, categoria: e.target.value})}>
              <option value="">Todas</option>
              {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading">Carregando</div>
        ) : custos.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">💸</div>
            <h3>Nenhum custo registrado</h3>
            <p>Clique em "Novo Custo" para começar</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Nome</th>
                  <th>Categoria</th>
                  <th>Quantidade</th>
                  <th>Valor Total</th>
                  <th style={{ textAlign:'center' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {custos.map(c => (
                  <tr key={c.id}>
                    <td>{formatarData(c.data)}</td>
                    <td style={{ fontWeight:500 }}>{c.nome}</td>
                    <td><span className="badge" style={{ background:'var(--bg-primary)', color:'var(--text-secondary)', border:'1px solid var(--border-color)' }}>{CAT_ICONS[c.categoria]} {c.categoria}</span></td>
                    <td>{c.quantidade} {c.unidade}</td>
                    <td style={{ color:'#f59e0b', fontWeight:'bold' }}>{formatarMoeda(parseFloat(c.valorTotal))}</td>
                    <td>
                      <div style={{ display:'flex', gap:'0.5rem', justifyContent:'center' }}>
                        <button onClick={() => abrirModal(c)} style={{ background:'var(--laranja-maloca)', color:'#fff', border:'none', padding:'0.5rem 0.8rem', borderRadius:'6px', cursor:'pointer' }}>✏️</button>
                        <button onClick={() => handleDeletar(c.id)} style={{ background:'var(--vermelho-erro)', color:'var(--vermelho-texto)', border:'1px solid var(--vermelho-texto)', padding:'0.5rem 0.8rem', borderRadius:'6px', cursor:'pointer' }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth:520 }} onClick={e => e.stopPropagation()}>
            <h3>{editando ? '✏️ Editar Custo' : '💸 Novo Custo'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome *</label>
                <input type="text" value={form.nome} onChange={e => setForm({...form, nome:e.target.value})} placeholder="Ex: Açúcar, Coco ralado, Leite condensado..." required autoFocus />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem' }}>
                <div className="form-group">
                  <label>Categoria</label>
                  <select value={form.categoria} onChange={e => setForm({...form, categoria:e.target.value})}>
                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Data *</label>
                  <input type="text" value={form.data} onChange={handleDataChange} placeholder="DD/MM/AAAA" maxLength={10} required />
                </div>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'1rem' }}>
                <div className="form-group">
                  <label>Quantidade *</label>
                  <input type="number" step="0.001" min="0.001" value={form.quantidade} onChange={e => setForm({...form, quantidade:e.target.value})} placeholder="0" required />
                </div>
                <div className="form-group">
                  <label>Unidade *</label>
                  <select value={form.unidade} onChange={e => setForm({...form, unidade:e.target.value})}>
                    {UNIDADES.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Valor Total (R$) *</label>
                  <input type="number" step="0.01" min="0.01" value={form.valorTotal} onChange={e => setForm({...form, valorTotal:e.target.value})} placeholder="0.00" required />
                </div>
              </div>
              <div className="form-group">
                <label>Observação</label>
                <input type="text" value={form.observacao} onChange={e => setForm({...form, observacao:e.target.value})} placeholder="Opcional..." />
              </div>
              <div style={{ display:'flex', gap:'1rem' }}>
                <button type="submit" className="btn-primary">{editando ? '💾 Atualizar' : '✨ Registrar'}</button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary" style={{ flex:1 }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}