import { useState, useEffect } from 'react';
import { clientesAPI } from '../services/api';
import './AnaliseSabores.css';

function AnaliseSabores() {
  const [ranking, setRanking] = useState([]);
  const [clienteSelecionado, setClienteSelecionado] = useState(null);
  const [detalhesSabores, setDetalhesSabores] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    carregarRanking();
  }, []);

  const carregarRanking = async () => {
    try {
      const response = await clientesAPI.rankingSabores();
      setRanking(response.data);
    } catch (error) {
      console.error('Erro ao carregar ranking:', error);
    } finally {
      setLoading(false);
    }
  };

  const verDetalhes = async (cliente) => {
    try {
      setClienteSelecionado(cliente);
      setShowModal(true);
      
      // Buscar detalhes do cliente específico
      const clienteData = ranking.find(c => c.cliente === cliente);
      setDetalhesSabores(clienteData);
    } catch (error) {
      console.error('Erro ao carregar detalhes:', error);
    }
  };

  const getSaborIcon = (sabor) => {
    const icons = {
      'Tradicional': '🥥',
      'Doce de Leite': '🍮',
      'Maracujá': '💛',
      'Prestígio': '🍫',
      'Castanha': '🌰',
      'Cupuaçu': '🍈'
    };
    return icons[sabor] || '🍬';
  };

  if (loading) return <div className="loading">Carregando análise</div>;

  return (
    <div>
      <div className="card">
        <h2>📊 Análise de Preferências por Cliente</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Veja quais sabores cada cliente prefere e em que quantidade
        </p>

        {ranking.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📭</div>
            <h3>Nenhum dado disponível</h3>
            <p>Registre algumas vendas para ver as preferências</p>
          </div>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Total Comprado</th>
                  <th>Sabor Favorito</th>
                  <th>Quantidade</th>
                  <th style={{ textAlign: 'center' }}>Ação</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((item, index) => (
                  <tr key={index}>
                    <td style={{ fontWeight: '600' }}>{item.cliente}</td>
                    <td>
                      <span className="badge">{item.totalComprado} unidades</span>
                    </td>
                    <td>
                      <span style={{ fontSize: '1.1rem' }}>
                        {getSaborIcon(item.saborFavorito)} {item.saborFavorito}
                      </span>
                    </td>
                    <td style={{ color: 'var(--laranja-maloca)', fontWeight: 'bold' }}>
                      {item.quantidadeFavorito}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <button
                        onClick={() => verDetalhes(item.cliente)}
                        style={{
                          background: 'var(--laranja-maloca)',
                          color: '#FFF',
                          border: 'none',
                          padding: '0.5rem 1rem',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontWeight: '500',
                          transition: 'all 0.3s ease'
                        }}
                        onMouseEnter={(e) => e.target.style.background = 'var(--laranja-hover)'}
                        onMouseLeave={(e) => e.target.style.background = 'var(--laranja-maloca)'}
                      >
                        📈 Ver Detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal de Detalhes */}
      {showModal && detalhesSabores && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content modal-sabores" onClick={(e) => e.stopPropagation()}>
            <h3>📊 Detalhes de Sabores - {clienteSelecionado}</h3>
            
            <div className="modal-stats">
              <div className="stat-item">
                <span className="stat-label">Total Comprado</span>
                <span className="stat-value">{detalhesSabores.totalComprado}</span>
              </div>
              <div className="stat-item">
                <span className="stat-label">Sabores Diferentes</span>
                <span className="stat-value">{detalhesSabores.sabores.length}</span>
              </div>
            </div>

            <div className="sabores-detalhes">
              {detalhesSabores.sabores.map((sabor, index) => (
                <div key={index} className="sabor-detalhe-item">
                  <div className="sabor-detalhe-header">
                    <span className="sabor-icon">{getSaborIcon(sabor.nome)}</span>
                    <span className="sabor-detalhe-nome">{sabor.nome}</span>
                  </div>
                  
                  <div className="sabor-detalhe-stats">
                    <div className="quantidade-box">
                      <span className="quantidade">{sabor.quantidade}</span>
                      <span className="unidades">unidades</span>
                    </div>
                    
                    <div className="progress-container">
                      <div 
                        className="progress-bar" 
                        style={{ width: `${sabor.porcentagem}%` }}
                      >
                        <span className="progress-text">{sabor.porcentagem}%</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="btn-secondary"
              style={{ marginTop: '1.5rem', width: '100%' }}
            >
              ✖ Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AnaliseSabores;