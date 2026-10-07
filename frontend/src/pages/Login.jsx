import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';
import './Login.css';

function Login() {
  const [formData, setFormData] = useState({
    email: '',
    senha: ''
  });
  const [erro, setErro] = useState('');
  const [loading, setLoading] = useState(false);

  const { login, usuario } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (usuario) {
      navigate('/');
    }
  }, [usuario, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErro('');
    setLoading(true);

    try {
      await login(formData.email, formData.senha);
    } catch (error) {
      const mensagemErro = error.response?.data?.error || 'Erro ao fazer login. Verifique suas credenciais.';
      setErro(mensagemErro);
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <ThemeToggle className="login-theme-toggle" />

      <div className="login-box">
        <div className="login-header">
          <h1>🍬 Doces e Sabores da Maloca</h1>
          <p>Sistema de Controle de Vendas</p>
        </div>

        <form onSubmit={handleSubmit}>
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
            {loading ? '⏳ Entrando...' : '🔐 Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default Login;
