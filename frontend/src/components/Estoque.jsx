import { useState, useEffect } from 'react';
import { estoqueAPI } from '../services/api';

function Estoque() {
  const [estoque, setEstoque] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => { carregar(); }, []);

  const carregar = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await estoqueAPI.listar();
      setEstoque(res.data);
    } catch {
      setErro('Erro ao carregar estoque');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading">Carregando estoque</div>;
  if (erro) return <div style={{ color: 'var(--vermelho-texto)', padding: '2rem' }}>{erro}</div>;

  const { itens = [], totalProduzido = 0, totalVendido = 0, totalSaldo = 0 } = estoque || {};

  return (
    <div>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2>📦 Estoque de Produto Acabado</h2>
          <button onClick={carregar} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '0.5rem 1rem', borderRadius: '8px', cursor: 'pointer' }}>
            🔄 Atualizar
          </button>
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
                  <td style={{ textAlign: 'right', color: totalSaldo < 0 ? 'var(--vermelho-texto)' : 'var(--laranja-maloca)' }}>{totalSaldo}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Estoque;
