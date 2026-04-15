import { useState, useEffect } from 'react';
import { materiasPrimasAPI } from '../services/api';

const UNIDADES_BASE = [
  { value: 'g',  label: 'Gramas (g)' },
  { value: 'ml', label: 'Mililitros (ml)' },
  { value: 'un', label: 'Unidades (un)' },
];

function MateriaPrima() {
  const [resumo, setResumo] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nome: '', unidadeBase: 'g' });
  const [msg, setMsg] = useState({ text: '', type: '' });

  useEffect(() => { carregar(); }, []);

  const carregar = async () => {
    setLoading(true);
    try {
      const res = await materiasPrimasAPI.resumo();
      setResumo(res.data);
    } catch {
      showMsg('Erro ao carregar matérias-primas', 'error');
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3500);
  };

  const abrirModal = (mp = null) => {
    if (mp) {
      setEditando(mp.id);
      setForm({ nome: mp.nome, unidadeBase: mp.unidadeBase });
    } else {
      setEditando(null);
      setForm({ nome: '', unidadeBase: 'g' });
    }
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editando) {
        await materiasPrimasAPI.atualizar(editando, form);
        showMsg('✅ Matéria-prima atualizada!');
      } else {
        await materiasPrimasAPI.criar(form);
        showMsg('✅ Matéria-prima cadastrada!');
      }
      setShowModal(false);
      carregar();
    } catch (err) {
      showMsg('❌ ' + (err.response?.data?.error || 'Erro ao salvar'), 'error');
    }
  };

  const handleDeletar = async (id, nome) => {
    if (!confirm(`Desativar "${nome}"?`)) return;
    try {
      await materiasPrimasAPI.deletar(id);
      showMsg('✅ Matéria-prima desativada!');
      carregar();
    } catch {
      showMsg('❌ Erro ao desativar', 'error');
    }
  };

  const formatarSaldo = (saldo, unidade) => {
    if (unidade === 'g' && Math.abs(saldo) >= 1000) {
      return `${(saldo / 1000).toFixed(3).replace(/\.?0+$/, '')} kg`;
    }
    if (unidade === 'ml' && Math.abs(saldo) >= 1000) {
      return `${(saldo / 1000).toFixed(3).replace(/\.?0+$/, '')} L`;
    }
    return `${saldo.toFixed(1)} ${unidade}`;
  };

  if (loading) return <div className="loading">Carregando matérias-primas</div>;

  return (
    <div>
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

      {/* Cards de resumo */}
      <div className="dashboard" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <h3>🥥 Total de Insumos</h3>
          <div className="value" style={{ fontSize: '2rem' }}>{resumo.length}</div>
          <div className="subtitle">matérias-primas ativas</div>
        </div>
        <div className="stat-card">
          <h3>⚠️ Saldo Baixo</h3>
          <div className="value" style={{ fontSize: '2rem', color: '#f59e0b' }}>
            {resumo.filter(m => m.saldoBaixo).length}
          </div>
          <div className="subtitle">insumos com saldo reduzido</div>
        </div>
        <div className="stat-card">
          <h3>🔴 Saldo Negativo</h3>
          <div className="value" style={{ fontSize: '2rem', color: 'var(--vermelho-texto)' }}>
            {resumo.filter(m => m.saldoNegativo).length}
          </div>
          <div className="subtitle">insumos negativos</div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2>🥥 Matérias-Primas</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={carregar} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>
              🔄
            </button>
            <button className="btn-primary" onClick={() => abrirModal()} style={{ width: 'auto', padding: '0.8rem 1.5rem' }}>
              ➕ Nova Matéria-Prima
            </button>
          </div>
        </div>

        {resumo.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🥥</div>
            <h3>Nenhuma matéria-prima cadastrada</h3>
            <p>Cadastre insumos para controlar seu estoque</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Unidade Base</th>
                  <th style={{ textAlign: 'right' }}>Saldo Atual</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {resumo.map((mp) => (
                  <tr key={mp.id}>
                    <td style={{ fontWeight: 500 }}>{mp.nome}</td>
                    <td><span style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.85rem' }}>{mp.unidadeBase}</span></td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold', color: mp.saldoNegativo ? 'var(--vermelho-texto)' : mp.saldoBaixo ? '#f59e0b' : '#4ade80' }}>
                      {formatarSaldo(mp.saldo, mp.unidadeBase)}
                    </td>
                    <td>
                      {mp.saldoNegativo ? (
                        <span style={{ color: 'var(--vermelho-texto)', fontWeight: 600 }}>🔴 Negativo</span>
                      ) : mp.saldoBaixo ? (
                        <span style={{ color: '#f59e0b', fontWeight: 600 }}>⚠️ Baixo</span>
                      ) : (
                        <span style={{ color: '#4ade80' }}>✅ OK</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        <button onClick={() => abrirModal(mp)} style={{ background: 'var(--laranja-maloca)', color: '#fff', border: 'none', padding: '0.5rem 0.8rem', borderRadius: '6px', cursor: 'pointer' }}>✏️</button>
                        <button onClick={() => handleDeletar(mp.id, mp.nome)} style={{ background: 'var(--vermelho-erro)', color: 'var(--vermelho-texto)', border: '1px solid var(--vermelho-texto)', padding: '0.5rem 0.8rem', borderRadius: '6px', cursor: 'pointer' }}>🗑️</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <h3>{editando ? '✏️ Editar Matéria-Prima' : '🥥 Nova Matéria-Prima'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome *</label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={e => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Coco ralado, Açúcar, Leite condensado..."
                  required
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label>Unidade Base *</label>
                <select value={form.unidadeBase} onChange={e => setForm({ ...form, unidadeBase: e.target.value })}>
                  {UNIDADES_BASE.map(u => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                  ))}
                </select>
                <small style={{ color: 'var(--text-secondary)', marginTop: '0.3rem', display: 'block' }}>
                  Compras em kg/L serão convertidas automaticamente para g/ml.
                </small>
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn-primary">{editando ? '💾 Atualizar' : '✨ Cadastrar'}</button>
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default MateriaPrima;
