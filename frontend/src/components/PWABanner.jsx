import { usePWA } from "../hooks/usePWA";
import './PWABanner.css'

function PWABanner() {
    const { isInstallable, isOnline, swUpdate, promptInstall, updateApp } = usePWA()
    
    return (
        <>
            {/* Banner offline */}
            {!isOnline && (
                <div className="pwa-offline-bar">
                    <span>📡</span>
                    <span>Você está offline - alguns dados podem estar desatualizados</span>
                </div>
            )}
            {/* Banner de atualização disponível */}
            {swUpdate && (
                <div className="pwa-update-bar">
                    <span>🔄 Nova versão disponível!</span>
                    <button className="pwa-update-btn" onClick={updateApp}>
                        Atualizar agora
                    </button>
                </div>
            )}

            {/* Banner de intalação */}
            <div className="pwa-install-bar">
                <div className="pwa-install-content">
                    <span className="pwa-install-icon">🍬</span>
                    <div className="pwa-install-text">
                        <strong>Instalar o app</strong>
                        <span>Acesso rápido direto da tela inicial</span>
                    </div>
                </div>
                <button className="pwa-install-btn" onClick={promptInstall}>
                    Instalar
                </button>
            </div>
        </>
    )
}

export default PWABanner