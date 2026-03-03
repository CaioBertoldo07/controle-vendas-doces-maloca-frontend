import { useState, useEffect } from 'react';
import { clientesAPI, vendasAPI, saboresAPI } from '../services/api';
import './RegistrarVenda.css';

function brParaIso(dataBr) {
  const [dia, mes, ano] = dataBr.split('/');
  if (!dia || !mes || !ano) return '';
  return `${ano}-${mes.padStart(2,'0')}-${dia.padStart(2,'0')}`;
}

function hojeFormatado() {
  const hoje = new Date();
  const dia = String(hoje.getDate()).padStart(2,'0');
  const mes = String(hoje.getMonth()+1).padStart(2,'0');
  return `${dia}/${mes}/${hoje.getFullYear()}`;
}

function RegistrarVenda() {
  const [clientes, setClientes] = useState([]);
  const [saboresDisponiveis, setSaboresDisponiveis] = useState([]);
  const [formData, setFormData] = useState({
    clienteId: '',
    data: hojeFormatado(),
    desconto: ''
  });
  const [saboresSelecionados, setSaboresSelecionados] = useState({});
  const [valorBruto, setValorBruto] = useState(0);
  const [valorTotal, setValorTotal] = useState('0.00');
  const [valorEditavel, setValorEditavel] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { carregarDados(); }, []);
  useEffect(() => { calcularValores(); }, [saboresSelecionados, formData.desconto]);

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

  const calcularValores = () => {
    if (valorEditavel) return;
    const bruto = Object.entries(saboresSelecionados).reduce((sum, [saborId, qtd]) => {
      const sabor = saboresDisponiveis.find(s => s.id === parseInt(saborId));
      return sum + (qtd * parseFloat(sabor?.precoUnitario || 0));
    }, 0);
    setValorBruto(bruto);
    const desconto = parseFloat(formData.desconto) || 0;
    const liquido = Math.max(0, bruto - desconto);
    setValorTotal(liquido.toFixed(2));
  };

  const handleQuantidadeSabor = (saborId, quantidade) => {
    const qtd = parseInt(quantidade) || 0;
    if (qtd === 0) {
      const ns = { ...saboresSelecionados };
      delete ns[saborId];
      setSaboresSelecionados(ns);
    } else {
      setSaboresSelecionados({ ...saboresSelecionados, [saborId]: qtd });
    }
  };

  const handleDataChange = (e) => {
    let v = e.target.value.replace(/\D/g,'');
    if (v.length > 2) v = v.slice(0,2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0,5) + '/' + v.slice(5);
    if (v.length > 10) v = v.slice(0,10);
    setFormData({ ...formData, data: v });
  };

  const quantidadeTotal = Object.values(saboresSelecionados).reduce((s,q) => s+q, 0);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    if (quantidadeTotal === 0) {
      setMessage('❌ Selecione pelo menos um sabor');
      setLoading(false);
      return;
    }

    const dataIso = brParaIso(formData.data);
    if (!dataIso) {
      setMessage('❌ Data inválida. Use DD/MM/AAAA');
      setLoading(false);
      return;
    }

    try {
      const saboresArray = Object.entries(saboresSelecionados).map(([saborId, quantidade]) => ({
        saborId: parseInt(saborId), quantidade
      }));

      await vendasAPI.criar({
        clienteId: formData.clienteId,
        quantidade: quantidadeTotal,
        valor: parseFloat(valorTotal),
        desconto: parseFloat(formData.desconto) || 0,
        data: dataIso,
        sabores: saboresArray
      });

      setMessage('✅ Venda registrada com sucesso!');
      setFormData({ clienteId: '', data: hojeFormatado(), desconto: '' });
      setSaboresSelecionados({});
      setValorTotal('0.00');
      setValorBruto(0);
      setValorEditavel(false);
      setTimeout(() => setMessage(''), 3000);
    } catch (error) {
      setMessage(error.response?.data?.error || '❌ Erro ao registrar venda');
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
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Data *</label>
            <input
              type="text"
              value={formData.data}
              onChange={handleDataChange}
              placeholder="DD/MM/AAAA"
              maxLength={10}
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

          {/* Campo desconto */}
          <div className="resumo-item">
            <span>💸 Desconto (R$):</span>
            <div className="valor-input-group">
              <span className="currency">R$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max={valorBruto}
                value={formData.desconto}
                onChange={(e) => setFormData({ ...formData, desconto: e.target.value })}
                placeholder="0.00"
                className="valor-input"
                style={{ borderColor: formData.desconto > 0 ? '#f59e0b' : undefined }}
              />
            </div>
          </div>

          {formData.desconto > 0 && (
            <div className="resumo-item" style={{ fontSize: '0.9rem', opacity: 0.7 }}>
              <span>Subtotal bruto:</span>
              <span style={{ color: 'var(--text-secondary)' }}>
                R$ {valorBruto.toFixed(2)}
              </span>
            </div>
          )}

          <div className="resumo-item valor-total">
            <span>💰 Valor Final:</span>
            <div className="valor-input-group">
              <span className="currency">R$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={valorTotal}
                onChange={(e) => { setValorTotal(e.target.value); setValorEditavel(true); }}
                className="valor-input"
              />
              {valorEditavel && (
                <button
                  type="button"
                  className="btn-recalcular"
                  onClick={() => { setValorEditavel(false); calcularValores(); }}
                  title="Recalcular"
                >🔄</button>
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