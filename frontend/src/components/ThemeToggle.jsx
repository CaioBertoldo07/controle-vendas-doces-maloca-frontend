import { useTheme } from '../context/ThemeContext';

const OPCOES = [
  { valor: 'light', icone: '☀️', label: 'Claro' },
  { valor: 'system', icone: '🖥️', label: 'Sistema' },
  { valor: 'dark', icone: '🌙', label: 'Escuro' },
];

function ThemeToggle({ className = '' }) {
  const { themePreference, setThemePreference } = useTheme();

  return (
    <div className={`theme-toggle ${className}`} role="radiogroup" aria-label="Tema">
      {OPCOES.map(({ valor, icone, label }) => (
        <button
          key={valor}
          type="button"
          role="radio"
          aria-checked={themePreference === valor}
          aria-label={label}
          title={label}
          className={`theme-option ${themePreference === valor ? 'active' : ''}`}
          onClick={() => setThemePreference(valor)}
        >
          {icone}
        </button>
      ))}
    </div>
  );
}

export default ThemeToggle;
