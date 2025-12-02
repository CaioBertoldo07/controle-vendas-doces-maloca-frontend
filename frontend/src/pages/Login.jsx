import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import './Login.css';

function Login() {
  const [modo, setModo] = useState('login');
  const [formData, setFormData] = useState({
    nome: '',
    email: '',
    senha: ''
  });
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, registro, usuario } = useAuth();
  const { isDarkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();

  // Redirecionar se já estiver logado
  useEffect(() => {
    if (usuario) {
      console.log('✅ Usuário já logado, redirecionando...');
      navigate('/');
    }
  }, [usuario, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');
    setLoading(true);

    console.log('🔐 Tentando login...', { email: formData.email });

    try {
      if (modo === 'login') {
        await login(formData.email, formData.senha);
        console.log('✅ Login bem-sucedido, redirecionando...');
      } else {
        await registro(formData.nome, formData.email, formData.senha);
        console.log('✅ Registro bem-sucedido, redirecionando...');
      }
    } catch (error) {
      console.error('❌ Erro no login:', error);
      console.error('Resposta do servidor:', error.response?.data);
      
      const mensagemErro = error.response?.data?.error || 'Erro ao fazer login. Verifique suas credenciais.';
      setErro(mensagemErro);
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      {/* Toggle de Tema */}
      <div className="login-theme-toggle" onClick={toggleTheme}>
        <div className={`theme-toggle-switch ${isDarkMode ? 'active' : ''}`}>
          <div className={`theme-toggle-slider ${isDarkMode ? 'active' : ''}`}>
            {isDarkMode ? '🌙' : '☀️'}
          </div>
        </div>
      </div>

      <div className="login-box">
        <div className="login-header">
          <h1>🍬 Doces e Sabores da Maloca</h1>
          <p>Sistema de Controle de Vendas</p>
        </div>

        <div className="login-tabs">
          <button
            className={modo === 'login' ? 'active' : ''}
            onClick={() => {
              setModo('login');
              setErro('');
            }}
          >
            Login
          </button>
          <button
            className={modo === 'registro' ? 'active' : ''}
            onClick={() => {
              setModo('registro');
              setErro('');
            }}
          >
            Criar Conta
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {modo === 'registro' && (
            <div className="form-group">
              <label>Nome Completo</label>
              <input
                type="text"
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                required
                placeholder="Seu nome completo"
              />
            </div>
          )}

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              placeholder="seu@email.com"
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label>Senha</label>
            <input
              type="password"
              value={formData.senha}
              onChange={(e) => setFormData({ ...formData, senha: e.target.value })}
              required
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              autoComplete="current-password"
            />
          </div>

          {erro && (
            <div className="error-message">
              ⚠️ {erro}
            </div>
          )}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '⏳ Entrando...' : modo === 'login' ? '🔐 Entrar' : '✨ Criar Conta'}
          </button>
        </form>

        {modo === 'login' && (
          <div className="login-info">
            <p>👤 Credenciais de teste:</p>
            <p><strong>Email:</strong> admin@docesmaloca.com</p>
            <p><strong>Senha:</strong> 123456</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Login;