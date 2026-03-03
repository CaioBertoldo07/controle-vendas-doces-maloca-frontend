import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import RegistrarVenda from '../components/RegistrarVenda';
import Relatorios from '../components/Relatorios';
import DashboardHome from '../components/Dashboard';
import GerenciarClientes from '../components/GerenciarClientes';
import AnaliseSabores from '../components/AnaliseSabores';
import GerenciarSabores from '../components/GerenciarSabores';
import Custos from '../components/Custos';
import Producao from '../components/Producao';
import ThemeToggle from '../components/ThemeToggle';

function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { usuario, logout } = useAuth();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab) {
      setActiveTab(tab);
      window.history.replaceState({}, '', '/');
    }
  }, []);

  const tabs = [
    { id: 'dashboard',      label: '📊 Dashboard' },
    { id: 'registrar',      label: '➕ Registrar Venda' },
    { id: 'relatorios',     label: '📄 Relatórios' },
    { id: 'producao',       label: '🏭 Produção' },
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
        {activeTab === 'relatorios'     && <Relatorios />}
        {activeTab === 'producao'       && <Producao />}
        {activeTab === 'custos'         && <Custos />}
        {activeTab === 'sabores'        && <AnaliseSabores />}
        {activeTab === 'clientes'       && <GerenciarClientes />}
        {activeTab === 'config-sabores' && <GerenciarSabores />}
      </div>
    </div>
  );
}

export default Dashboard;