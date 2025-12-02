import { useState, useEffect } from 'react';
import { clientesAPI } from '../services/api';

function GerenciarClientes() {
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState(null);
  const [nomeCliente, setNomeCliente] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    carregarClientes();
  }, []);

  const carregarClientes = async () => {
    try {
      const response = await clientesAPI.listar();
      setClientes(response.data);
    } catch (error) {
      console.error('Erro ao carregar clientes:', error);
      setMessage('❌ Erro ao carregar clientes');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage('');

    if (nomeCliente.trim().length < 3) {
      setMessage('❌ Nome deve ter pelo menos 3 caracteres');
      return;
    }

    try {
      if (editando) {
        await clientesAPI.atualizar(editando, nomeCliente.trim());
        setMessage('✅ Cliente atualizado com sucesso!');
      } else {
        await clientesAPI.criar(nomeCliente.trim());
        setMessage('✅ Cliente criado com sucesso!');
      }
      
      setShowModal(false);
      setNomeCliente('');
      setEditando(null);
      carregarClientes();
      
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      console.error('Erro ao salvar cliente:', error);
      const errorMsg = error.response?.data?.error || 'Erro ao salvar cliente';
      setMessage('❌ ' + errorMsg);
    }
  };

  const handleEditar = (cliente) => {
    setEditando(cliente.id);
    setNomeCliente(cliente.nome);
    setShowModal(true);
  };

  const handleDeletar = async (id, nome) => {
    if (!confirm(`Deseja realmente deletar o cliente "${nome}"?`)) return;

    try {
      await clientesAPI.deletar(id);
      setMessage('✅ Cliente deletado com sucesso!');
      carregarClientes();
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      const errorMsg = error.response?.data?.error || 'Erro ao deletar cliente';
      setMessage('❌ ' + errorMsg);
    }
  };

  const abrirModal = () => {
    setEditando(null);
    setNomeCliente('');
    setMessage('');
    setShowModal(true);
  };

  const fecharModal = () => {
    setShowModal(false);
    setNomeCliente('');
    setEditando(null);
    setMessage('');
  };

  if (loading) return <div className="loading">Carregando</div>;

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
          <h2>👥 Gerenciar Clientes</h2>
          <button className="btn-primary" onClick={abrirModal} style={{ width: 'auto', padding: '0.8rem 1.5rem' }}>
            ➕ Novo Cliente
          </button>
        </div>

        {message && (
          <div className={message.includes('✅') ? 'success-message' : 'error-message'}>
            {message}
          </div>
        )}

        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Total de Vendas</th>
                <th style={{ textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {clientes.length === 0 ? (
                <tr>
                  <td colSpan="3" style={{ textAlign: 'center', padding: '3rem', color: 'var(--cinza-claro)' }}>
                    <div className="empty-state">
                      <div className="empty-state-icon">👥</div>
                      <h3>Nenhum cliente cadastrado</h3>
                      <p>Clique em "Novo Cliente" para começar</p>
                    </div>
                  </td>
                </tr>
              ) : (
                clientes.map((cliente) => (
                  <tr key={cliente.id}>
                    <td style={{ fontWeight: '500' }}>{cliente.nome}</td>
                    <td>
                      <span className="badge" style={{ background: cliente._count?.vendas > 0 ? 'var(--laranja-maloca)' : 'var(--cinza-escuro)' }}>
                        {cliente._count?.vendas || 0} vendas
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                        <button
                          onClick={() => handleEditar(cliente)}
                          style={{
                            background: 'var(--laranja-maloca)',
                            color: '#FFF',
                            border: 'none',
                            padding: '0.6rem 1rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500',
                            transition: 'all 0.3s ease'
                          }}
                          onMouseEnter={(e) => e.target.style.background = 'var(--laranja-hover)'}
                          onMouseLeave={(e) => e.target.style.background = 'var(--laranja-maloca)'}
                        >
                          ✏️ Editar
                        </button>
                        <button
                          onClick={() => handleDeletar(cliente.id, cliente.nome)}
                          style={{
                            background: 'var(--vermelho-erro)',
                            color: 'var(--vermelho-texto)',
                            border: '1px solid var(--vermelho-texto)',
                            padding: '0.6rem 1rem',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500',
                            transition: 'all 0.3s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = 'var(--vermelho-texto)';
                            e.target.style.color = '#FFF';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = 'var(--vermelho-erro)';
                            e.target.style.color = 'var(--vermelho-texto)';
                          }}
                        >
                          🗑️ Deletar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={fecharModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>{editando ? '✏️ Editar Cliente' : '➕ Novo Cliente'}</h3>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nome do Cliente</label>
                <input
                  type="text"
                  value={nomeCliente}
                  onChange={(e) => setNomeCliente(e.target.value)}
                  required
                  minLength={3}
                  maxLength={100}
                  placeholder="Digite o nome do cliente"
                  autoFocus
                />
              </div>
              <div style={{ display: 'flex', gap: '1rem' }}>
                <button type="submit" className="btn-primary">
                  {editando ? '💾 Atualizar' : '✨ Criar'}
                </button>
                <button
                  type="button"
                  onClick={fecharModal}
                  className="btn-secondary"
                  style={{ flex: 1 }}
                >
                  ❌ Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default GerenciarClientes;