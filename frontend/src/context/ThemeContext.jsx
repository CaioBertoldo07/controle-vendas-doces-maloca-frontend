import { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext({});

const PREFERENCIAS = ['system', 'light', 'dark'];
const MEDIA_DARK = '(prefers-color-scheme: dark)';

const lerPreferenciaSalva = () => {
  try {
    const salva = localStorage.getItem('theme');
    return PREFERENCIAS.includes(salva) ? salva : 'system';
  } catch {
    return 'system';
  }
};

const sistemaEstaEscuro = () =>
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia(MEDIA_DARK).matches
    : true;

export const ThemeProvider = ({ children }) => {
  // Preferência do usuário: 'system' segue o dispositivo
  const [themePreference, setThemePreference] = useState(lerPreferenciaSalva);
  const [systemIsDark, setSystemIsDark] = useState(sistemaEstaEscuro);

  useEffect(() => {
    // Acompanhar mudanças do tema do dispositivo
    if (!window.matchMedia) return;
    const media = window.matchMedia(MEDIA_DARK);
    const onChange = (e) => setSystemIsDark(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const isDarkMode = themePreference === 'system' ? systemIsDark : themePreference === 'dark';

  useEffect(() => {
    // Aplicar tema no documento
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('theme', themePreference);
    } catch {
      // Sem storage disponível: mantém só na sessão
    }
  }, [themePreference]);

  return (
    <ThemeContext.Provider value={{ isDarkMode, themePreference, setThemePreference }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
