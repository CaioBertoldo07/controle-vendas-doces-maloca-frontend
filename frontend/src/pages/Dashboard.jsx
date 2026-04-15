import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { usePWA } from '../hooks/usePWA';
import RegistrarVenda from '../components/RegistrarVenda';
import Relatorios from '../components/Relatorios';
import DashboardHome from '../components/Dashboard';
import GerenciarClientes from '../components/GerenciarClientes';
import AnaliseSabores from '../components/AnaliseSabores';
import GerenciarSabores from '../components/GerenciarSabores';
import Custos from '../components/Custos';
import Producao from '../components/Producao';
import VendaDireta from '../components/VendaDireta';
import Estoque from '../components/Estoque';
import MateriaPrima from '../components/MateriaPrima';
import ThemeToggle from '../components/ThemeToggle';

function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { usuario, logout } = useAuth();
  const { isInstallable, isInstalled, promptInstall } = usePWA();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab(tab);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const tabs = [
    { id: 'dashboard',      label: '📊 Dashboard' },
    { id: 'registrar',      label: '➕ Registrar Venda' },
    { id: 'venda-direta',   label: '🛒 Venda Direta' },
    { id: 'relatorios',     label: '📄 Relatórios' },
    { id: 'producao',       label: '🏭 Produção' },
    { id: 'estoque',        label: '📦 Estoque' },
    { id: 'materia-prima',  label: '🥥 Matéria-Prima' },
    { id: 'custos',         label: '💸 Custos' },
    { id: 'sabores',        label: '🍬 Análise de Sabores' },
    { id: 'clientes',       label: '👥 Clientes' },
    { id: 'config-sabores', label: '⚙️ Sabores' },
  ];

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>
            <img src="icon.png" alt="ícone" style={{ width:'100px', height:'100px' }} />
            Doces e Sabores da Maloca
          </h1>
          <div className="user-info">
            <ThemeToggle />
            {isInstallable && !isInstalled && (
              <button
                onClick={promptInstall}
                title="Instalar app"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-secondary)',
                  padding: '0.4rem 0.8rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
              >
                📲 Instalar app
              </button>
            )}
            <span className="user-name">👤 {usuario?.nome}</span>
            <button className="btn-logout" onClick={logout}>Sair</button>
          </div>
        </div>
      </header>

      <div className="container">
        <nav className="nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`nav-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {activeTab === 'dashboard'      && <DashboardHome />}
        {activeTab === 'registrar'      && <RegistrarVenda />}
        {activeTab === 'venda-direta'   && <VendaDireta />}
        {activeTab === 'relatorios'     && <Relatorios />}
        {activeTab === 'producao'       && <Producao />}
        {activeTab === 'estoque'        && <Estoque />}
        {activeTab === 'materia-prima'  && <MateriaPrima />}
        {activeTab === 'custos'         && <Custos />}
        {activeTab === 'sabores'        && <AnaliseSabores />}
        {activeTab === 'clientes'       && <GerenciarClientes />}
        {activeTab === 'config-sabores' && <GerenciarSabores />}
      </div>
    </div>
  );
}

export default Dashboard;
