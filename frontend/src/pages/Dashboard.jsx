import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import RegistrarVenda from '../components/RegistrarVenda';
import Relatorios from '../components/Relatorios';
import DashboardHome from '../components/Dashboard';
import GerenciarClientes from '../components/GerenciarClientes';
import AnaliseSabores from '../components/AnaliseSabores';
import ThemeToggle from '../components/ThemeToggle';

function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const { usuario, logout } = useAuth();

  // Suporte aos shortcuts do PWA via URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const tab = params.get('tab')
    if (tab) {
      setActiveTab(tab)
      // Limpar o param da URL sem recarregar
      window.history.replaceState({}, '', '/')
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>
            <img src="icon.png" alt="ícone" style={{ width: '100px', height: '100px' }} /> Doces e Sabores da Maloca
          </h1>
          <div className="user-info">
            <ThemeToggle />
            <span className="user-name">👤 {usuario?.nome}</span>
            <button className="btn-logout" onClick={logout}>
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        <nav className="nav">
          <button
            className={`nav-button ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            📊 Dashboard
          </button>
          <button
            className={`nav-button ${activeTab === 'registrar' ? 'active' : ''}`}
            onClick={() => setActiveTab('registrar')}
          >
            ➕ Registrar Venda
          </button>
          <button
            className={`nav-button ${activeTab === 'relatorios' ? 'active' : ''}`}
            onClick={() => setActiveTab('relatorios')}
          >
            📄 Relatórios
          </button>
          <button
            className={`nav-button ${activeTab === 'sabores' ? 'active' : ''}`}
            onClick={() => setActiveTab('sabores')}
          >
            🍬 Análise de Sabores
          </button>
          <button
            className={`nav-button ${activeTab === 'clientes' ? 'active' : ''}`}
            onClick={() => setActiveTab('clientes')}
          >
            👥 Clientes
          </button>
        </nav>

        {activeTab === 'dashboard' && <DashboardHome />}
        {activeTab === 'registrar' && <RegistrarVenda />}
        {activeTab === 'relatorios' && <Relatorios />}
        {activeTab === 'sabores' && <AnaliseSabores />}
        {activeTab === 'clientes' && <GerenciarClientes />}
      </div>
    </div>
  );
}

export default Dashboard;