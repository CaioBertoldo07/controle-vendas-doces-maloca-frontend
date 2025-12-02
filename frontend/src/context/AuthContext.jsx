import { createContext, useContext, useState, useEffect } from 'react';
import { authAPI } from '../services/api';

const AuthContext = createContext({});

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    verificarToken();
  }, []);

  const verificarToken = async () => {
    const token = localStorage.getItem('token');
    
    console.log('🔍 Verificando token:', token ? 'Token encontrado' : 'Sem token');
    
    if (!token) {
      setLoading(false);
      return;
    }

    try {
      const response = await authAPI.verificar();
      console.log('✅ Token válido, usuário:', response.data.usuario);
      setUsuario(response.data.usuario);
    } catch (error) {
      console.error('❌ Token inválido:', error);
      localStorage.removeItem('token');
      setUsuario(null);
    } finally {
      setLoading(false);
    }
  };

  const login = async (email, senha) => {
    console.log('🔐 Fazendo login com:', email);
    
    const response = await authAPI.login(email, senha);
    console.log('✅ Resposta do login:', response.data);
    
    const { token, usuario: usuarioData } = response.data;
    
    localStorage.setItem('token', token);
    setUsuario(usuarioData);
    
    console.log('✅ Estado atualizado - Usuário logado:', usuarioData);
    
    return response.data;
  };

  const registro = async (nome, email, senha) => {
    console.log('✨ Criando conta para:', email);
    
    const response = await authAPI.registro(nome, email, senha);
    console.log('✅ Resposta do registro:', response.data);
    
    const { token, usuario: usuarioData } = response.data;
    
    localStorage.setItem('token', token);
    setUsuario(usuarioData);
    
    console.log('✅ Estado atualizado - Usuário registrado:', usuarioData);
    
    return response.data;
  };

  const logout = () => {
    console.log('👋 Fazendo logout');
    localStorage.removeItem('token');
    setUsuario(null);
  };

  console.log('📊 AuthContext - Estado atual:', { usuario: usuario?.nome, loading });

  return (
    <AuthContext.Provider value={{ usuario, login, registro, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);