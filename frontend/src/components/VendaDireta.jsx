import { useState, useEffect } from 'react';
import { saboresAPI, vendasAPI, clientesAPI } from '../services/api';

function hojeFormatado() {
  const hoje = new Date();
  const dia = String(hoje.getDate()).padStart(2, '0');
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  return `${dia}/${mes}/${hoje.getFullYear()}`;
}

function VendaDireta() {
  const [saboresDisponiveis, setSaboresDisponiveis] = useState([]);
  const [clienteVendaDireta, setClienteVendaDireta] = useState(null);
  const [itens, setItens] = useState({}); // { saborId: { quantidade, preco } }
  const [identificacao, setIdentificacao] = useState('');
  const [data, setData] = useState(hojeFormatado());
  const [observacao, setObservacao] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingDados, setLoadingDados] = useState(true);
  const [msg, setMsg] = useState({ text: '', type: '' });

  useEffect(() => {
    carregarDados();
  }, []);

  const carregarDados = async () => {
    try {
      const [saboresRes, clientesRes] = await Promise.all([
        saboresAPI.listar(),
        clientesAPI.listar()
      ]);
      setSaboresDisponiveis(saboresRes.data);

      // Busca o cliente "Venda Direta Para Clientes"
      const clienteDireto = clientesRes.data.find(c =>
        c.nome.toLowerCase().includes('venda direta') ||
        c.nome.toLowerCase().includes('direto')
      );
      setClienteVendaDireta(clienteDireto || null);
    } catch (error) {
      showMsg('❌ Erro ao carregar dados', 'error');
    } finally {
      setLoadingDados(false);
    }
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3500);
  };

  const handleDataChange = (e) => {
    let v = e.target.value.replace(/\D/g, '');
    if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2);
    if (v.length > 5) v = v.slice(0, 5) + '/' + v.slice(5);
    if (v.length > 10) v = v.slice(0, 10);
    setData(v);
  };

  const handleItem = (saborId, campo, valor) => {
    const atual = itens[saborId] || { quantidade: '', preco: '' };
    const atualizado = { ...atual, [campo]: valor };

    // Se ambos vazios, remove o item
    if (!atualizado.quantidade && !atualizado.preco) {
      const novo = { ...itens };
      delete novo[saborId];
      setItens(novo);
    } else {
      setItens({ ...itens, [saborId]: atualizado });
    }
  };

  // Cálculos do resumo
  const itensValidos = Object.entries(itens).filter(
    ([, item]) => parseInt(item.quantidade) > 0 && parseFloat(item.preco) > 0
  );
  const quantidadeTotal = itensValidos.reduce((s, [, i]) => s + parseInt(i.quantidade), 0);
  const valorTotal = itensValidos.reduce(
    (s, [, i]) => s + parseInt(i.quantidade) * parseFloat(i.preco), 0
  );

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!clienteVendaDireta) {
      showMsg('❌ Cliente "Venda Direta Para Clientes" não encontrado no sistema', 'error');
      return;
    }
    if (itensValidos.length === 0) {
      showMsg('❌ Adicione pelo menos um sabor com quantidade e preço', 'error');
      return;
    }

    const [dia, mes, ano] = data.split('/');
    if (!dia || !mes || !ano) {
      showMsg('❌ Data inválida', 'error');
      return;
    }
    const dataIso = `${ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`;

    setLoading(true);
    try {
      const saboresArray = itensValidos.map(([saborId, item]) => ({
        saborId: parseInt(saborId),
        quantidade: parseInt(item.quantidade)
      }));

      // Monta observação com identificação + obs
      const obsCompleta = [
        identificacao.trim() ? `👤 ${identificacao.trim()}` : null,
        observacao.trim() || null
      ].filter(Boolean).join(' | ');

      await vendasAPI.criar({
        clienteId: clienteVendaDireta.id,
        quantidade: quantidadeTotal,
        valor: valorTotal,
        desconto: 0,
        data: dataIso,
        sabores: saboresArray,
        ...(obsCompleta && { observacao: obsCompleta })
      });

      showMsg('✅ Venda direta registrada com sucesso!');

      // Limpar form
      setItens({});
      setIdentificacao('');
      setObservacao('');
      setData(hojeFormatado());
    } catch (error) {
      showMsg('❌ ' + (error.response?.data?.error || 'Erro ao registrar'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const SABOR_ICONS = {
    'Tradicional': '🥥', 'Doce de Leite': '🍮', 'Maracujá': '💛',
    'Prestígio': '🍫', 'Castanha': '🌰', 'Cupuaçu': '🍈'
  };
  const getIcon = (nome) => SABOR_ICONS[nome] || '🍬';

  if (loadingDados) return <div className="loading">Carregando</div>;

  return (
    <div>
      {/* Toast */}
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

      <div className="card">
        <h2>🛒 Venda Direta</h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Para vendas a amigos, família ou clientes avulsos — defina o preço de cada sabor na hora.
        </p>

        {!clienteVendaDireta && (
          <div className="error-message" style={{ marginBottom: '1.5rem' }}>
            ⚠️ Cliente "Venda Direta Para Clientes" não encontrado. Cadastre-o na aba Clientes.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Identificação + Data */}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Identificação (opcional)</label>
              <input
                type="text"
                value={identificacao}
                onChange={e => setIdentificacao(e.target.value)}
                placeholder="Ex: Tia Maria, Vizinho João, Festa da Ana..."
                maxLength={80}
              />
            </div>
            <div className="form-group" style={{ margin: 0 }}>
              <label>Data *</label>
              <input
                type="text"
                value={data}
                onChange={handleDataChange}
                placeholder="DD/MM/AAAA"
                maxLength={10}
                required
              />
            </div>
          </div>

          {/* Sabores */}
          <div style={{
            background: 'var(--bg-primary)', borderRadius: '12px',
            padding: '1.5rem', border: '1px solid var(--border-color)', marginBottom: '1.5rem'
          }}>
            <h3 style={{ color: 'var(--laranja-maloca)', marginBottom: '1.2rem', fontSize: '1.1rem' }}>
              🍬 Sabores — Quantidade e Preço por Unidade
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem' }}>
              {saboresDisponiveis.map(sabor => {
                const item = itens[sabor.id] || { quantidade: '', preco: '' };
                const ativo = parseInt(item.quantidade) > 0 && parseFloat(item.preco) > 0;
                const subtotal = ativo
                  ? (parseInt(item.quantidade) * parseFloat(item.preco)).toFixed(2)
                  : null;

                return (
                  <div key={sabor.id} style={{
                    background: 'var(--bg-secondary)',
                    border: `2px solid ${ativo ? 'var(--laranja-maloca)' : 'var(--border-color)'}`,
                    borderRadius: '12px', padding: '1rem',
                    transition: 'all 0.3s ease',
                    boxShadow: ativo ? '0 4px 12px rgba(255,122,0,0.15)' : 'none'
                  }}>
                    {/* Header do sabor */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
                      <span style={{ fontSize: '1.5rem' }}>{getIcon(sabor.nome)}</span>
                      <div>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{sabor.nome}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Padrão: R$ {parseFloat(sabor.precoUnitario).toFixed(2)}/un
                        </div>
                      </div>
                    </div>

                    {/* Inputs */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                      <div>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                          Quantidade
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={item.quantidade}
                          onChange={e => handleItem(sabor.id, 'quantidade', e.target.value)}
                          placeholder="0"
                          style={{
                            width: '100%', padding: '0.6rem', textAlign: 'center',
                            background: 'var(--bg-primary)', border: '2px solid var(--border-color)',
                            borderRadius: '8px', color: 'var(--text-primary)',
                            fontSize: '1rem', fontWeight: 600,
                            outline: 'none',
                            borderColor: item.quantidade ? 'var(--laranja-maloca)' : 'var(--border-color)'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.3rem' }}>
                          Preço/un (R$)
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.preco}
                          onChange={e => handleItem(sabor.id, 'preco', e.target.value)}
                          placeholder="0,00"
                          style={{
                            width: '100%', padding: '0.6rem', textAlign: 'center',
                            background: 'var(--bg-primary)', border: '2px solid var(--border-color)',
                            borderRadius: '8px', color: 'var(--text-primary)',
                            fontSize: '1rem', fontWeight: 600,
                            outline: 'none',
                            borderColor: item.preco ? 'var(--laranja-maloca)' : 'var(--border-color)'
                          }}
                        />
                      </div>
                    </div>

                    {/* Subtotal do sabor */}
                    {subtotal && (
                      <div style={{
                        marginTop: '0.6rem', textAlign: 'right',
                        color: 'var(--laranja-maloca)', fontWeight: 700, fontSize: '0.95rem'
                      }}>
                        Subtotal: R$ {subtotal}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Observação */}
          <div className="form-group">
            <label>Observação (opcional)</label>
            <input
              type="text"
              value={observacao}
              onChange={e => setObservacao(e.target.value)}
              placeholder="Ex: Pagamento via Pix, entrega em casa..."
              maxLength={150}
            />
          </div>

          {/* Resumo */}
          {itensValidos.length > 0 && (
            <div style={{
              background: 'var(--bg-primary)', border: '2px solid var(--laranja-maloca)',
              borderRadius: '12px', padding: '1.5rem', marginBottom: '1.5rem'
            }}>
              <h3 style={{ color: 'var(--laranja-maloca)', marginBottom: '1rem', fontSize: '1.1rem' }}>
                📋 Resumo da Venda
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {itensValidos.map(([saborId, item]) => {
                  const sabor = saboresDisponiveis.find(s => s.id === parseInt(saborId));
                  const sub = (parseInt(item.quantidade) * parseFloat(item.preco)).toFixed(2);
                  return (
                    <div key={saborId} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '0.5rem 0', borderBottom: '1px solid var(--border-color)',
                      fontSize: '0.95rem'
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {getIcon(sabor?.nome)} {sabor?.nome} × {item.quantidade} un
                        <span style={{ fontSize: '0.8rem', marginLeft: '0.5rem', opacity: 0.7 }}>
                          (R$ {parseFloat(item.preco).toFixed(2)}/un)
                        </span>
                      </span>
                      <span style={{ fontWeight: 600 }}>R$ {sub}</span>
                    </div>
                  );
                })}
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  marginTop: '0.5rem', paddingTop: '0.5rem'
                }}>
                  <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                    Total ({quantidadeTotal} unidades):
                  </span>
                  <span style={{ color: 'var(--laranja-maloca)', fontWeight: 700, fontSize: '1.4rem', fontFamily: 'Poppins' }}>
                    R$ {valorTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={loading || itensValidos.length === 0 || !clienteVendaDireta}
          >
            {loading ? '⏳ Registrando...' : '💾 Registrar Venda Direta'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default VendaDireta;