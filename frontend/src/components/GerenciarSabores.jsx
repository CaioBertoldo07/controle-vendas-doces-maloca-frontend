import { useState, useEffect } from 'react';
import { saboresAPI, materiasPrimasAPI } from '../services/api';
import './GerenciarSabores.css';

const SABOR_ICONS = {
  'Tradicional': '🥥',
  'Doce de Leite': '🍮',
  'Maracujá': '💛',
  'Prestígio': '🍫',
  'Castanha': '🌰',
  'Cupuaçu': '🍈',
};

function getIcon(nome) {
  return SABOR_ICONS[nome] || '🍬';
}

function GerenciarSabores() {
  const [sabores, setSabores] = useState([]);
  const [materiasPrimas, setMateriasPrimas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showReceitaModal, setShowReceitaModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [saborReceita, setSaborReceita] = useState(null);
  const [form, setForm] = useState({ nome: '', precoUnitario: '' });
  const [receitaForm, setReceitaForm] = useState({ rendimentoBase: '', itens: [] });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [mostrarInativos, setMostrarInativos] = useState(false);

  useEffect(() => {
    carregarSabores();
    carregarMateriasPrimas();
  }, [mostrarInativos]);

  const carregarSabores = async () => {
    try {
      const response = await saboresAPI.listar(mostrarInativos);
      setSabores(response.data);
    } catch (error) {
      showMessage('Erro ao carregar sabores', error.response?.data?.error ? 'error' : 'success');
    } finally {
      setLoading(false);
    }
  };

  const carregarMateriasPrimas = async () => {
    try {
      const response = await materiasPrimasAPI.listar();
      setMateriasPrimas(response.data);
    } catch {
      // silencioso
    }
  };

  const showMessage = (text, type = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 3500);
  };

  const abrirModal = (sabor = null) => {
    if (sabor) {
      setEditando(sabor.id);
      setForm({
        nome: sabor.nome,
        precoUnitario: parseFloat(sabor.precoUnitario).toFixed(2),
      });
    } else {
      setEditando(null);
      setForm({ nome: '', precoUnitario: '5.50' });
    }
    setShowModal(true);
  };

  const fecharModal = () => {
    setShowModal(false);
    setEditando(null);
    setForm({ nome: '', precoUnitario: '' });
  };

  const abrirReceitaModal = async (sabor) => {
    setSaborReceita(sabor);
    try {
      const res = await saboresAPI.listarReceita(sabor.id);
      setReceitaForm({
        rendimentoBase: res.data.rendimentoBase || '',
        itens: res.data.itens.map(i => ({
          materiaPrimaId: String(i.materiaPrimaId),
          quantidadeBase: String(i.quantidadeBase),
          nome: i.materiaPrima.nome,
          unidadeBase: i.materiaPrima.unidadeBase,
        })),
      });
    } catch {
      setReceitaForm({ rendimentoBase: '', itens: [] });
    }
    setShowReceitaModal(true);
  };

  const fecharReceitaModal = () => {
    setShowReceitaModal(false);
    setSaborReceita(null);
    setReceitaForm({ rendimentoBase: '', itens: [] });
  };

  const adicionarItemReceita = () => {
    setReceitaForm(prev => ({
      ...prev,
      itens: [...prev.itens, { materiaPrimaId: '', quantidadeBase: '' }],
    }));
  };

  const removerItemReceita = (idx) => {
    setReceitaForm(prev => ({
      ...prev,
      itens: prev.itens.filter((_, i) => i !== idx),
    }));
  };

  const atualizarItemReceita = (idx, campo, valor) => {
    setReceitaForm(prev => {
      const novos = [...prev.itens];
      novos[idx] = { ...novos[idx], [campo]: valor };
      if (campo === 'materiaPrimaId') {
        const mp = materiasPrimas.find(m => String(m.id) === valor);
        if (mp) novos[idx].unidadeBase = mp.unidadeBase;
      }
      return { ...prev, itens: novos };
    });
  };

  const handleSubmitReceita = async (e) => {
    e.preventDefault();
    if (!receitaForm.rendimentoBase || parseInt(receitaForm.rendimentoBase) <= 0) {
      showMessage('Rendimento base deve ser maior que zero', 'error');
      return;
    }
    for (const item of receitaForm.itens) {
      if (!item.materiaPrimaId || !item.quantidadeBase || parseFloat(item.quantidadeBase) <= 0) {
        showMessage('Preencha todos os ingredientes corretamente', 'error');
        return;
      }
    }

    try {
      await saboresAPI.salvarReceita(saborReceita.id, {
        rendimentoBase: parseInt(receitaForm.rendimentoBase),
        itens: receitaForm.itens.map(i => ({
          materiaPrimaId: parseInt(i.materiaPrimaId),
          quantidadeBase: parseFloat(i.quantidadeBase),
        })),
      });
      showMessage('✅ Receita salva com sucesso!');
      fecharReceitaModal();
    } catch (err) {
      showMessage('❌ ' + (err.response?.data?.error || 'Erro ao salvar receita'), 'error');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.nome.trim()) {
      showMessage('Nome do sabor é obrigatório', 'error');
      return;
    }
    if (!form.precoUnitario || parseFloat(form.precoUnitario) <= 0) {
      showMessage('Preço deve ser maior que zero', 'error');
      return;
    }

    try {
      if (editando) {
        await saboresAPI.atualizar(editando, {
          nome: form.nome.trim(),
          precoUnitario: parseFloat(form.precoUnitario),
        });
        showMessage('✅ Sabor atualizado com sucesso!');
      } else {
        await saboresAPI.criar(form.nome.trim(), parseFloat(form.precoUnitario));
        showMessage('✅ Sabor criado com sucesso!');
      }
      fecharModal();
      carregarSabores();
    } catch (error) {
      const msg = error.response?.data?.error || 'Erro ao salvar sabor';
      showMessage('❌ ' + msg, 'error');
    }
  };

  const handleToggleAtivo = async (sabor) => {
    try {
      await saboresAPI.atualizar(sabor.id, { ativo: !sabor.ativo });
      showMessage(
        sabor.ativo ? '⚠️ Sabor desativado' : '✅ Sabor reativado',
        sabor.ativo ? 'warn' : 'success'
      );
      carregarSabores();
    } catch (error) {
      showMessage('❌ Erro ao alterar status', error.response?.data?.error ? 'error' : 'success');
    }
  };

  const handleDeletar = async (sabor) => {
    if (!confirm(`Deseja remover o sabor "${sabor.nome}"?`)) return;
    try {
      const response = await saboresAPI.deletar(sabor.id);
      if (response.data.desativado) {
        showMessage('⚠️ Sabor desativado pois possui vendas vinculadas', 'warn');
      } else {
        showMessage('✅ Sabor removido com sucesso!');
      }
      carregarSabores();
    } catch (error) {
      showMessage('❌ ' + (error.response?.data?.error || 'Erro ao remover'), 'error');
    }
  };

  const saboresAtivos = sabores.filter(s => s.ativo);
  const saboresInativos = sabores.filter(s => !s.ativo);

  if (loading) return <div className="loading">Carregando sabores</div>;

  return (
    <div>
      {message.text && (
        <div className={`pwa-msg pwa-msg--${message.type}`}>{message.text}</div>
      )}

      <div className="card">
        <div className="sabores-header">
          <h2>🍬 Gerenciar Sabores</h2>
          <div className="sabores-header-actions">
            <label className="toggle-inativos">
              <input
                type="checkbox"
                checked={mostrarInativos}
                onChange={(e) => setMostrarInativos(e.target.checked)}
              />
              <span>Mostrar inativos</span>
            </label>
            <button
              className="btn-primary"
              onClick={() => abrirModal()}
              style={{ width: 'auto', padding: '0.8rem 1.5rem' }}
            >
              ➕ Novo Sabor
            </button>
          </div>
        </div>

        <div className="sabores-stats">
          <div className="sabor-stat">
            <span className="sabor-stat-value">{saboresAtivos.length}</span>
            <span className="sabor-stat-label">Sabores ativos</span>
          </div>
          {saboresInativos.length > 0 && (
            <div className="sabor-stat sabor-stat--inactive">
              <span className="sabor-stat-value">{saboresInativos.length}</span>
              <span className="sabor-stat-label">Inativos</span>
            </div>
          )}
        </div>

        {sabores.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🍬</div>
            <h3>Nenhum sabor cadastrado</h3>
            <p>Clique em "Novo Sabor" para começar</p>
          </div>
        ) : (
          <div className="sabores-grid-gerenciar">
            {sabores.map((sabor) => (
              <div
                key={sabor.id}
                className={`sabor-card-gerenciar ${!sabor.ativo ? 'sabor-card--inativo' : ''}`}
              >
                {sabor._count?.vendaSabores > 0 && (
                  <div className="sabor-vendas-badge">{sabor._count.vendaSabores} vendas</div>
                )}
                {!sabor.ativo && <div className="sabor-inativo-badge">Inativo</div>}

                <div className="sabor-card-icon">{getIcon(sabor.nome)}</div>
                <div className="sabor-card-nome">{sabor.nome}</div>
                <div className="sabor-card-preco">
                  R$ {parseFloat(sabor.precoUnitario).toFixed(2)}
                  <span className="sabor-card-unidade">/un</span>
                </div>
                {sabor.rendimentoBase && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    Rende {sabor.rendimentoBase} un
                  </div>
                )}

                <div className="sabor-card-actions">
                  <button className="sabor-btn sabor-btn--edit" onClick={() => abrirModal(sabor)} title="Editar">✏️</button>
                  <button
                    className="sabor-btn"
                    style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                    onClick={() => abrirReceitaModal(sabor)}
                    title="Configurar receita"
                  >
                    📋
                  </button>
                  <button
                    className={`sabor-btn ${sabor.ativo ? 'sabor-btn--toggle' : 'sabor-btn--reativar'}`}
                    onClick={() => handleToggleAtivo(sabor)}
                    title={sabor.ativo ? 'Desativar' : 'Reativar'}
                  >
                    {sabor.ativo ? '🔕' : '✅'}
                  </button>
                  <button className="sabor-btn sabor-btn--delete" onClick={() => handleDeletar(sabor)} title="Remover">🗑️</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal sabor */}
      {showModal && (
        <div className="modal-overlay" onClick={fecharModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{editando ? '✏️ Editar Sabor' : '🍬 Novo Sabor'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome do Sabor *</label>
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) => setForm({ ...form, nome: e.target.value })}
                  placeholder="Ex: Tradicional, Cupuaçu, Maracujá..."
                  required
                  autoFocus
                  maxLength={50}
                />
              </div>
              <div className="form-group">
                <label>Preço Unitário (R$) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={form.precoUnitario}
                  onChange={(e) => setForm({ ...form, precoUnitario: e.target.value })}
                  placeholder="0.00"
                  required
                />
              </div>
              {form.nome && (
                <div className="sabor-preview">
                  <span>{getIcon(form.nome)}</span>
                  <span>{form.nome}</span>
                  {form.precoUnitario && (
                    <span style={{ color: 'var(--laranja-maloca)' }}>
                      R$ {parseFloat(form.precoUnitario || 0).toFixed(2)}
                    </span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                <button type="submit" className="btn-primary">
                  {editando ? '💾 Atualizar' : '✨ Criar Sabor'}
                </button>
                <button type="button" onClick={fecharModal} className="btn-secondary" style={{ flex: 1 }}>
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal receita */}
      {showReceitaModal && saborReceita && (
        <div className="modal-overlay" onClick={fecharReceitaModal}>
          <div className="modal-content" style={{ maxWidth: 580 }} onClick={e => e.stopPropagation()}>
            <h3>📋 Receita — {saborReceita.nome}</h3>
            <form onSubmit={handleSubmitReceita}>
              <div className="form-group">
                <label>Rendimento base (unidades produzidas por receita) *</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={receitaForm.rendimentoBase}
                  onChange={e => setReceitaForm({ ...receitaForm, rendimentoBase: e.target.value })}
                  placeholder="Ex: 22 (cocadas por receita)"
                  required
                  autoFocus
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label style={{ fontWeight: 600 }}>Ingredientes</label>
                  <button type="button" onClick={adicionarItemReceita} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.4rem 0.8rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
                    ➕ Adicionar
                  </button>
                </div>

                {receitaForm.itens.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Nenhum ingrediente. Clique em "Adicionar" para começar.</p>
                ) : (
                  receitaForm.itens.map((item, idx) => (
                    <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'end' }}>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>Matéria-Prima</label>
                        <select
                          value={item.materiaPrimaId}
                          onChange={e => atualizarItemReceita(idx, 'materiaPrimaId', e.target.value)}
                          required
                        >
                          <option value="">Selecione...</option>
                          {materiasPrimas.map(mp => (
                            <option key={mp.id} value={mp.id}>{mp.nome} ({mp.unidadeBase})</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ margin: 0 }}>
                        <label style={{ fontSize: '0.8rem' }}>
                          Qtd {item.unidadeBase ? `(${item.unidadeBase})` : ''}
                        </label>
                        <input
                          type="number"
                          step="0.001"
                          min="0.001"
                          value={item.quantidadeBase}
                          onChange={e => atualizarItemReceita(idx, 'quantidadeBase', e.target.value)}
                          placeholder={item.unidadeBase === 'g' ? 'Ex: 1000' : item.unidadeBase === 'ml' ? 'Ex: 395' : '0'}
                          required
                        />
                      </div>
                      <button type="button" onClick={() => removerItemReceita(idx)} style={{ background: 'var(--vermelho-erro)', color: 'var(--vermelho-texto)', border: '1px solid var(--vermelho-texto)', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', marginBottom: '2px' }}>
                        🗑️
                      </button>
                    </div>
                  ))
                )}
              </div>

              {receitaForm.itens.length > 0 && receitaForm.rendimentoBase && (
                <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  <strong>Resumo:</strong> Para produzir {receitaForm.rendimentoBase} {saborReceita.nome}:
                  {receitaForm.itens.filter(i => i.materiaPrimaId && i.quantidadeBase).map((item, idx) => {
                    const mp = materiasPrimas.find(m => String(m.id) === String(item.materiaPrimaId));
                    const qtd = parseFloat(item.quantidadeBase) || 0;
                    const label = mp ? mp.nome : '?';
                    const unit = mp ? mp.unidadeBase : '';
                    return <span key={idx}> {qtd}{unit} de {label},</span>;
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn-primary">💾 Salvar Receita</button>
                <button type="button" onClick={fecharReceitaModal} className="btn-secondary" style={{ flex: 1 }}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default GerenciarSabores;
