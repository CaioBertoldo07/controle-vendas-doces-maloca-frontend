import { usePWA } from '../hooks/usePWA';
import './PWABanner.css';

function PWABanner() {
  const { isOnline, swUpdate, updateApp } = usePWA();

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
    </>
  );
}

export default PWABanner;
