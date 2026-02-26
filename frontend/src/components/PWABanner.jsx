import { usePWA } from '../hooks/usePWA';
import './PWABanner.css';

function PWABanner() {
  const { isInstallable, isInstalled, isOnline, swUpdate, promptInstall, updateApp } = usePWA();

  return (
    <>
      {!isOnline && (
        <div className="pwa-offline-bar">
          <span>📡</span>
          <span>Você está offline — alguns dados podem estar desatualizados</span>
        </div>
      )}

      {swUpdate && (
        <div className="pwa-update-bar">
          <span>🔄 Nova versão disponível!</span>
          <button onClick={updateApp} className="pwa-update-btn">
            Atualizar agora
          </button>
        </div>
      )}

      {/* Só mostra se pode instalar E ainda não está instalado */}
      {isInstallable && !isInstalled && (
        <div className="pwa-install-bar">
          <div className="pwa-install-content">
            <span className="pwa-install-icon">🍬</span>
            <div className="pwa-install-text">
              <strong>Instalar o app</strong>
              <span>Acesso rápido direto da tela inicial</span>
            </div>
          </div>
          <button onClick={promptInstall} className="pwa-install-btn">
            Instalar
          </button>
        </div>
      )}
    </>
  );
}

export default PWABanner;