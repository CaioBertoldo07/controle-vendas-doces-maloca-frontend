const CACHE_NAME = "doces-maloca-v1";
const STATIC_CACHE = "doces-maloca-static-v1";
const API_CACHE = "doces-maloca-api-v1";

// Arquivos que sempre vão para cache (shell do app)
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192x192.png",
  "/icons/icon-512x512.png",
];

// INSTALL
self.addEventListener("install", (event) => {
  console.log("[SW] Instalando Service Worker...");
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        console.log("[SW] Cacheando assets estáticos");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log("[SW] Instalação concluída");
        return self.skipWaiting();
      }),
  );
});

// ACTIVATE
self.addEventListener("activate", (event) => {
  console.log("[SW] Ativando Service Worker...");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== STATIC_CACHE && name !== API_CACHE)
            .map((name) => {
              console.log("[SW] Removendo cache antigo:", name);
              return caches.delete(name);
            }),
        );
      })
      .then(() => {
        console.log("[SW] Ativação concluída");
        return self.clients.claim();
      }),
  );
});

// FETCH
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignora extensões do Chrome e requisições HTTP
  if (!request.url.startsWith("http")) return;

  // Requisições para a API - Network First (tenta rede, cai no cache)
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Arquivos estáticos - Cache First (usa cache, atualiza em background)
  if (
    request.destination === "script" ||
    request.destination === "style" ||
    request.destination === "image" ||
    request.destination === "font"
  ) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Navegação (HTML) - Network First com fallback para index.html (SPA)
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match("/index.html");
      }),
    );
    return;
  }

  // Default - Network First
  event.respondWith(networkFirst(request));
});

// ESTRATÉGIAS

// CACHE FIRST: usa cache se disponível, senão busca na rede e armazena
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Recurso indisponível offline", { status: 503 });
  }
}

// Network First: tenta rede, usa cache como fallback
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok && request.method === "GET") {
      const cache = await caches.open(API_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      console.log("[SW] Servindo do cache (offline): ", request.url);
      return cached;
    }
    // Retorna resposta de erro amigável para a API
    return new Response(
      JSON.stringify({ error: "Sem conexão com a internet", offline: true }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// BACKGROUND SYNC (para vendas offline)
self.addEventListener("sync", (event) => {
  if (event.tag === "sync-vendas") {
    console.log("[SW] Sincronizando vendas pendentes...");
    event.waitUntil(sincronizarVendasPendentes());
  }
});

async function sincronizarVendasPendentes() {
  // Implementação futura: IndexedDB para armazenar vendas feitas offline
  console.log("[SW] Background sync executado");
}

// PUSH NOTIFICATIONS
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const data = event.data.json();
  const options = {
    body: data.body || "Nova notificação do Doces e Sabores da Maloca",
    icon: "/icons/icon-192x192.png",
    badge: "icons/icon-72x72.png",
    vibrate: [200, 100, 200],
    data: { url: data.url || "/" },
    actions: [
      { action: "open", title: "Abrir App" },
      { action: "close", title: "Fechar" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(
      data.title || "Doces e Sabores da Maloca",
      options,
    ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  if (event.action === "open" || !event.action) {
    event.waitUntil(clients.openWindow(event.notification.data?.url || "/"));
  }
});
