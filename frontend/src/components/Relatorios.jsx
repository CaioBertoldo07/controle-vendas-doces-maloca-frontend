import { useState, useEffect } from 'react';
import { vendasAPI, clientesAPI } from '../services/api';

function Relatorios() {
  const [vendas, setVendas] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filtros, setFiltros] = useState({
    mes: new Date().getMonth() + 1,
    ano: new Date().getFullYear(),
    clienteId: ''
  });

  useEffect(() => {
    carregarClientes();
  }, []);

  useEffect(() => {
    carregarVendas();
  }, [filtros]);

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

      const response = await vendasAPI.listar(params);
      setVendas(response.data);
    } catch (error) {
      console.error('Erro ao carregar vendas:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatarData = (data) => {
    // Pega só a parte da data (YYYY-MM-DD) ignorando timezone
    const isoStr = typeof data === 'string' ? data : new Date(data).toISOString();
    const [datePart] = isoStr.split('T');
    const [ano, mes, dia] = datePart.split('-');
    return `${dia}/${mes}/${ano}`;
};

  const formatarMoeda = (valor) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    }).format(valor);
  };

  const exportarCSV = () => {
    const headers = ['Data', 'Cliente', 'Quantidade', 'Valor'];
    const rows = vendas.map(v => [
      formatarData(v.data),
      v.cliente.nome,
      v.quantidade,
      parseFloat(v.valor).toFixed(2)
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vendas_${filtros.mes}_${filtros.ano}.csv`;
    a.click();
  };

  const totalGeral = vendas.reduce((sum, v) => sum + v.quantidade, 0);
  const valorTotal = vendas.reduce((sum, v) => sum + parseFloat(v.valor), 0);

  const meses = [
    { value: 1, label: 'Janeiro' },
    { value: 2, label: 'Fevereiro' },
    { value: 3, label: 'Março' },
    { value: 4, label: 'Abril' },
    { value: 5, label: 'Maio' },
    { value: 6, label: 'Junho' },
    { value: 7, label: 'Julho' },
    { value: 8, label: 'Agosto' },
    { value: 9, label: 'Setembro' },
    { value: 10, label: 'Outubro' },
    { value: 11, label: 'Novembro' },
    { value: 12, label: 'Dezembro' }
  ];

  return (
    <div>
      {/* Filtros */}
      <div className="card">
        <h2>🔍 Filtros</h2>
        <div className="filters">
          <div className="form-group" style={{ margin: 0 }}>
            <label>Mês</label>
            <select
              value={filtros.mes}
              onChange={(e) => setFiltros({ ...filtros, mes: e.target.value })}
            >
              <option value="">Todos</option>
              {meses.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Ano</label>
            <select
              value={filtros.ano}
              onChange={(e) => setFiltros({ ...filtros, ano: e.target.value })}
            >
              <option value="">Todos</option>
              <option value="2025">2025</option>
              <option value="2024">2024</option>
              <option value="2023">2023</option>
            </select>
          </div>

          <div className="form-group" style={{ margin: 0 }}>
            <label>Cliente</label>
            <select
              value={filtros.clienteId}
              onChange={(e) => setFiltros({ ...filtros, clienteId: e.target.value })}
            >
              <option value="">Todos</option>
              {clientes.map(c => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button 
              className="btn-secondary" 
              onClick={exportarCSV}
              disabled={vendas.length === 0}
              style={{ width: '100%' }}
            >
              📥 Exportar CSV
            </button>
          </div>
        </div>

        {/* Resumo - ATUALIZADO COM 3 CARDS */}
        <div style={{ 
          marginTop: '1.5rem', 
          padding: '1.5rem', 
          background: 'var(--bg-primary)', 
          borderRadius: '12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1rem'
        }}>
          <div style={{ 
            textAlign: 'center',
            padding: '1rem',
            background: 'var(--bg-card)',
            borderRadius: '10px',
            border: '2px solid var(--laranja-maloca)'
          }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              Total de Vendas
            </div>
            <div style={{ color: 'var(--laranja-maloca)', fontSize: '2rem', fontWeight: 'bold', fontFamily: 'Poppins' }}>
              {vendas.length}
            </div>
          </div>

          <div style={{ 
            textAlign: 'center',
            padding: '1rem',
            background: 'var(--bg-card)',
            borderRadius: '10px',
            border: '2px solid var(--laranja-maloca)'
          }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              Quantidade Total
            </div>
            <div style={{ color: 'var(--laranja-maloca)', fontSize: '2rem', fontWeight: 'bold', fontFamily: 'Poppins' }}>
              {totalGeral}
            </div>
          </div>

          <div style={{ 
            textAlign: 'center',
            padding: '1rem',
            background: 'var(--bg-card)',
            borderRadius: '10px',
            border: '2px solid #4ADE80'
          }}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              💰 Valor Total
            </div>
            <div style={{ color: '#4ADE80', fontSize: '2rem', fontWeight: 'bold', fontFamily: 'Poppins' }}>
              {formatarMoeda(valorTotal)}
            </div>
          </div>
        </div>
      </div>

      {/* Tabela */}
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
                  <th>Quantidade</th>
                      <th>Valor</th>
                      <th>Desconto</th>
                </tr>
              </thead>
              <tbody>
                {vendas.map((venda) => (
                  <tr key={venda.id}>
                    <td>{formatarData(venda.data)}</td>
                    <td>{venda.cliente.nome}</td>
                    <td style={{ 
                      color: 'var(--laranja-maloca)', 
                      fontWeight: 'bold',
                      fontSize: '1.1rem'
                    }}>
                      {venda.quantidade}
                    </td>
                    <td style={{ 
                      color: '#4ADE80', 
                      fontWeight: 'bold',
                      fontSize: '1.1rem'
                    }}>
                      {formatarMoeda(parseFloat(venda.valor))}
                    </td>
                    <td style={{ color: venda.desconto > 0 ? '#f59e0b' : 'var(--text-secondary)', fontWeight: venda.desconto > 0 ? 'bold' : 'normal' }}>
                      {parseFloat(venda.desconto || 0) > 0 ? `- ${formatarMoeda(parseFloat(venda.desconto))}` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default Relatorios;