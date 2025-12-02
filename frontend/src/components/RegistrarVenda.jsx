import { useState, useEffect } from 'react';
import { clientesAPI, vendasAPI, saboresAPI } from '../services/api';
import './RegistrarVenda.css';

function RegistrarVenda() {
  const [clientes, setClientes] = useState([]);
  const [saboresDisponiveis, setSaboresDisponiveis] = useState([]);
  const [formData, setFormData] = useState({
    clienteId: '',
    data: new Date().toISOString().split('T')[0]
  });
  const [saboresSelecionados, setSaboresSelecionados] = useState({});
  const [valorTotal, setValorTotal] = useState('0.00');
  const [valorEditavel, setValorEditavel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    carregarDados();
  }, []);

  useEffect(() => {
    calcularValorTotal();
  }, [saboresSelecionados]);

  const carregarDados = async () => {
    try {
      const [clientesRes, saboresRes] = await Promise.all([
        clientesAPI.listar(),
        saboresAPI.listar()
      ]);
      
      setClientes(clientesRes.data);
      setSaboresDisponiveis(saboresRes.data);
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
  };

  const calcularValorTotal = () => {
    if (valorEditavel) return;

    const total = Object.entries(saboresSelecionados).reduce((sum, [saborId, qtd]) => {
      const sabor = saboresDisponiveis.find(s => s.id === parseInt(saborId));
      return sum + (qtd * parseFloat(sabor?.precoUnitario || 0));
    }, 0);

    setValorTotal(total.toFixed(2));
  };

  const handleQuantidadeSabor = (saborId, quantidade) => {
    const qtd = parseInt(quantidade) || 0;
    
    if (qtd === 0) {
      const newSabores = { ...saboresSelecionados };
      delete newSabores[saborId];
      setSaboresSelecionados(newSabores);
    } else {
      setSaboresSelecionados({
        ...saboresSelecionados,
        [saborId]: qtd
      });
    }
  };

  const quantidadeTotal = Object.values(saboresSelecionados).reduce((sum, qtd) => sum + qtd, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    if (quantidadeTotal === 0) {
      setMessage('❌ Selecione pelo menos um sabor');
      setLoading(false);
      return;
    }

    try {
      const saboresArray = Object.entries(saboresSelecionados).map(([saborId, quantidade]) => ({
        saborId: parseInt(saborId),
        quantidade
      }));

      await vendasAPI.criar({
        clienteId: formData.clienteId,
        quantidade: quantidadeTotal,
        valor: parseFloat(valorTotal),
        data: formData.data,
        sabores: saboresArray
      });

      setMessage('✅ Venda registrada com sucesso!');
      
      // Limpar formulário
      setFormData({
        clienteId: '',
        data: new Date().toISOString().split('T')[0]
      });
      setSaboresSelecionados({});
      setValorTotal('0.00');
      setValorEditavel(false);
      
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(error.response?.data?.error || '❌ Erro ao registrar venda');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2>➕ Registrar Nova Venda</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="form-row">
          <div className="form-group">
            <label>Cliente *</label>
            <select
              value={formData.clienteId}
              onChange={(e) => setFormData({ ...formData, clienteId: e.target.value })}
              required
            >
              <option value="">Selecione um cliente</option>
              {clientes.map((cliente) => (
                <option key={cliente.id} value={cliente.id}>
                  {cliente.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Data *</label>
            <input
              type="date"
              value={formData.data}
              onChange={(e) => setFormData({ ...formData, data: e.target.value })}
              required
            />
          </div>
        </div>

        <div className="sabores-section">
          <h3>🍬 Sabores</h3>
          <div className="sabores-grid">
            {saboresDisponiveis.map((sabor) => (
              <div key={sabor.id} className="sabor-item">
                <div className="sabor-info">
                  <span className="sabor-nome">{sabor.nome}</span>
                  <span className="sabor-preco">R$ {parseFloat(sabor.precoUnitario).toFixed(2)}</span>
                </div>
                <input
                  type="number"
                  min="0"
                  value={saboresSelecionados[sabor.id] || ''}
                  onChange={(e) => handleQuantidadeSabor(sabor.id, e.target.value)}
                  placeholder="Qtd"
                  className="sabor-input"
                />
              </div>
            ))}
          </div>
        </div>

        <div className="resumo-venda">
          <div className="resumo-item">
            <span>Quantidade Total:</span>
            <strong>{quantidadeTotal}</strong>
          </div>
          <div className="resumo-item valor-total">
            <span>Valor Total:</span>
            <div className="valor-input-group">
              <span className="currency">R$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={valorTotal}
                onChange={(e) => {
                  setValorTotal(e.target.value);
                  setValorEditavel(true);
                }}
                className="valor-input"
              />
              {valorEditavel && (
                <button
                  type="button"
                  className="btn-recalcular"
                  onClick={() => {
                    setValorEditavel(false);
                    calcularValorTotal();
                  }}
                  title="Recalcular automaticamente"
                >
                  🔄
                </button>
              )}
            </div>
          </div>
        </div>

        <button type="submit" className="btn-primary" disabled={loading || quantidadeTotal === 0}>
          {loading ? '⏳ Registrando...' : '💾 Registrar Venda'}
        </button>
      </form>

      {message && (
        <div className={message.includes('✅') ? 'success-message' : 'error-message'}>
          {message}
        </div>
      )}
    </div>
  );
}

export default RegistrarVenda;