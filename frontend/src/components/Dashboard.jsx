import { useState, useEffect } from 'react';
import { vendasAPI } from '../services/api';

const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

function Dashboard() {
  const [totais, setTotais] = useState(null);
  const [relatorioAnual, setRelatorioAnual] = useState(null);
  const [loading, setLoading] = useState(true);
  const hoje = new Date();
  const [mesSelecionado, setMesSelecionado] = useState(hoje.getMonth() + 1);
  const [anoSelecionado, setAnoSelecionado] = useState(hoje.getFullYear());

  useEffect(() => {
    carregarDados();
  }, [mesSelecionado, anoSelecionado]);

  const carregarDados = async () => {
    setLoading(true);
    try {
      const [totaisRes, relatorioRes] = await Promise.all([
        vendasAPI.totais({ mes: mesSelecionado, ano: anoSelecionado }),
        vendasAPI.relatorioMensal(anoSelecionado)
      ]);
      
      setTotais(totaisRes.data);
      setRelatorioAnual(relatorioRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    } finally {
      setLoading(false);
    }
  };

  const anosDisponiveis = Array.from(
    { length: hoje.getFullYear() - 2023 + 1 },
    (_, i) => 2024 + i
  );

  const mesNome = new Date(anoSelecionado, mesSelecionado - 1).toLocaleString('pt-BR', { month: 'long' });
  const totalAnual = relatorioAnual?.meses.reduce((sum, m) => sum + m.totalQuantidade, 0) || 0;

  return (
    <div>
      {/* Filtro de Mês/Ano */}
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold', color: 'var(--text-secondary)' }}>📅 Filtrar por período:</span>
          <select
            value={mesSelecionado}
            onChange={(e) => setMesSelecionado(Number(e.target.value))}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--card-bg)',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            {MESES.map((nome, i) => (
              <option key={i + 1} value={i + 1}>{nome}</option>
            ))}
          </select>
          <select
            value={anoSelecionado}
            onChange={(e) => setAnoSelecionado(Number(e.target.value))}
            style={{
              padding: '0.4rem 0.8rem',
              borderRadius: '8px',
              border: '1px solid var(--border-color)',
              background: 'var(--card-bg)',
              color: 'var(--text-primary)',
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            {anosDisponiveis.map((ano) => (
              <option key={ano} value={ano}>{ano}</option>
            ))}
          </select>
          {loading && <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Carregando...</span>}
        </div>
      </div>

      <div className="dashboard">
        <div className="stat-card">
          <h3>📦 Total de {mesNome}</h3>
          <div className="value">{totais?.totalGeral || 0}</div>
          <div className="subtitle">{totais?.totalVendas || 0} vendas realizadas</div>
        </div>

        <div className="stat-card">
          <h3>📈 Total do Ano</h3>
          <div className="value">{totalAnual}</div>
          <div className="subtitle">{anoSelecionado}</div>
        </div>

        <div className="stat-card">
          <h3>📊 Média por Venda</h3>
          <div className="value">{totais?.media?.toFixed(1) || 0}</div>
          <div className="subtitle">unidades por venda</div>
        </div>

        <div className="stat-card">
          <h3>👥 Clientes Ativos</h3>
          <div className="value">{Object.keys(totais?.porCliente || {}).length}</div>
          <div className="subtitle">{mesNome} de {anoSelecionado}</div>
        </div>
      </div>

      {/* Top Clientes */}
      <div className="card">
        <h2>🏆 Top Clientes do Mês</h2>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Posição</th>
                <th>Cliente</th>
                <th>Quantidade</th>
              </tr>
            </thead>
            <tbody>
              {totais?.porCliente && Object.entries(totais.porCliente)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([nome, qtd], index) => (
                  <tr key={nome}>
                    <td>
                      <span className="badge">{index + 1}º</span>
                    </td>
                    <td>{nome}</td>
                    <td style={{ color: 'var(--laranja-maloca)', fontWeight: 'bold' }}>{qtd}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Gráfico Mensal Simples */}
      <div className="card">
        <h2>📅 Vendas por Mês - {anoSelecionado}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '1rem', marginTop: '2rem' }}>
          {relatorioAnual?.meses.map((mes) => {
            const maxValue = Math.max(...relatorioAnual.meses.map(m => m.totalQuantidade));
            const height = maxValue > 0 ? (mes.totalQuantidade / maxValue) * 200 : 0;
            
            return (
              <div key={mes.mes} style={{ textAlign: 'center' }}>
                <div style={{ 
                  height: '200px', 
                  display: 'flex', 
                  alignItems: 'flex-end',
                  justifyContent: 'center'
                }}>
                  <div style={{
                    width: '100%',
                    maxWidth: '60px',
                    height: `${height}px`,
                    background: 'linear-gradient(to top, var(--laranja-maloca), var(--laranja-hover))',
                    borderRadius: '8px 8px 0 0',
                    transition: 'all 0.3s ease',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'center',
                    paddingTop: '0.5rem',
                    color: 'white',
                    fontSize: '0.85rem',
                    fontWeight: 'bold'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'scaleY(1.05)';
                    e.currentTarget.style.filter = 'brightness(1.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'scaleY(1)';
                    e.currentTarget.style.filter = 'brightness(1)';
                  }}
                  >
                    {mes.totalQuantidade > 0 ? mes.totalQuantidade : ''}
                  </div>
                </div>
                <div style={{ 
                  marginTop: '0.5rem', 
                  color: 'var(--cinza-claro)', 
                  fontSize: '0.85rem',
                  textTransform: 'capitalize'
                }}>
                  {mes.nomeMes.substring(0, 3)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;