import { useTheme } from '../context/ThemeContext';

function ThemeToggle() {
  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <div className="theme-toggle" onClick={toggleTheme}>
      <span className="theme-label">{isDarkMode ? '🌙' : '☀️'}</span>
      <div className={`theme-toggle-switch ${isDarkMode ? 'active' : ''}`}>
        <div className={`theme-toggle-slider ${isDarkMode ? 'active' : ''}`}>
          {isDarkMode ? '🌙' : '☀️'}
        </div>
      </div>
      <span className="theme-label">{isDarkMode ? 'Dark' : 'Light'}</span>
    </div>
  );
}

export default ThemeToggle;