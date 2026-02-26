import { useState, useEffect } from 'react';
import { saboresAPI } from '../services/api';
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
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ nome: '', precoUnitario: '' });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [mostrarInativos, setMostrarInativos] = useState(false);

  useEffect(() => {
    carregarSabores();
  }, [mostrarInativos]);

  const carregarSabores = async () => {
    try {
      const response = await saboresAPI.listar(mostrarInativos);
      setSabores(response.data);
    } catch (error) {
      showMessage('Erro ao carregar sabores', 'error');
    } finally {
      setLoading(false);
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
      showMessage('❌ Erro ao alterar status', 'error');
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

                <div className="sabor-card-actions">
                  <button className="sabor-btn sabor-btn--edit" onClick={() => abrirModal(sabor)} title="Editar">✏️</button>
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
    </div>
  );
}

export default GerenciarSabores;