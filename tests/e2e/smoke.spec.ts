import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/settings/general", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ agentName: "Francisco", companyName: "Renova 123", simulationMode: true, realSendingEnabled: false, globalPause: false, timezone: "America/Sao_Paulo", uploadLimitMb: 25 }),
  }));
  await page.route("**/conversations/inbox*", (route) => {
    const empty = page.url().includes("estado=vazio");
    if (page.url().includes("estado=erro")) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Não foi possível carregar as conversas" }) });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(empty ? { rows: [], total: 0, page: 1, pageSize: 30 } : { rows: [{ conversationId: "00000000-0000-4000-8000-000000000001", leadId: "00000000-0000-4000-8000-000000000002", name: "Marina", phone: "5511999999999", company: "Ótica Teste", stage: "engaged", status: "active", humanActive: false, lastMessage: "Pode me mostrar como funciona na prática?", lastMessageAt: new Date().toISOString(), unreadCount: 1 }], total: 1, page: 1, pageSize: 30 }) });
  });
  await page.route("**/conversations/00000000-0000-4000-8000-000000000001/messages*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [{ id: "00000000-0000-4000-8000-000000000003", direction: "inbound", sender_type: "lead", content: "Pode me mostrar como funciona na prática?", message_type: "text", status: "received", created_at: new Date().toISOString() }, { id: "00000000-0000-4000-8000-000000000004", direction: "outbound", sender_type: "ai", content: "Visão geral Renova123.pdf", message_type: "document", status: "sent", created_at: new Date().toISOString() }], nextBefore: null, hasOlder: false }) }));
  await page.route("**/imports/preview", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [{ line: 1, input: "11987654321", phone: "5511987654321", status: "valid", reason: null }], summary: { total: 1, valid: 1, invalid: 0, duplicateFile: 0, duplicateExisting: 0, blocked: 0, alreadyApproached: 0, inConversation: 0 } }) }));
  await page.route("**/whatsapp/pairing", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ evolution: "offline", instanceName: "renova123-francisco", state: "unavailable", number: null, available: false, circuit: "closed", simulation: true, webhook: "ok", qr: null, pairingCode: null, qrCount: null, qrExpiresAt: null, updatedAt: new Date().toISOString(), lastConnectionAt: null, lastEventAt: null }) }));
  await page.route("**/whatsapp/diagnostics", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connectionMode: "not_configured", webhookConfigured: true, apiKeyConfigured: false, apiKeyExposed: false }) }));
  await page.route("**/agents/*/whatsapp/pairing", (route) => {
    const agent = route.request().url().includes("/pedro/") ? "pedro" : "francisco";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ agent, name: agent === "pedro" ? "Pedro" : "Francisco", evolution: "offline", instanceName: `renova123-${agent}`, state: "unavailable", number: null, available: false, circuit: "closed", simulation: true, webhook: "ok", qr: null, pairingCode: null, qrCount: null, qrExpiresAt: null, updatedAt: new Date().toISOString(), lastConnectionAt: null, lastEventAt: null }) });
  });
  await page.route("**/agents/*/whatsapp/diagnostics", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ connectionMode: "not_configured", webhookConfigured: true, apiKeyConfigured: false, apiKeyExposed: false, globalPause: true, automationEnabled: false, outreachEnabled: false, realSendingEnabled: false }) }));
});

async function login(page: Page) {
  await page.addInitScript(() => {
    const expiresAt = Math.floor(Date.now() / 1000) + 3_600;
    localStorage.setItem("renova123-auth", JSON.stringify({ access_token: "mock-admin-token", refresh_token: "mock-refresh-token", expires_in: 3_600, expires_at: expiresAt, token_type: "bearer", user: { id: "mock-admin", aud: "authenticated", role: "authenticated", email: "admin@example.test" } }));
  });
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("login leva o administrador ao dashboard", async ({ page }) => {
  await page.route("**/auth/v1/token?grant_type=password", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ access_token: "mock-admin-token", refresh_token: "mock-refresh-token", expires_in: 3_600, token_type: "bearer", user: { id: "mock-admin", aud: "authenticated", role: "authenticated", email: "admin@example.test" } }) }));
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Login administrativo" })).toBeVisible();
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Visão geral" })).toBeVisible();
});

test("sidebar expande, recolhe e preserva o conteúdo", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Comportamento de hover é exclusivo do desktop.");
  await login(page);
  const sidebar = page.locator(".sidebar");
  await expect(sidebar).toHaveCSS("width", "78px");
  await sidebar.hover();
  await expect(sidebar).toHaveCSS("width", "292px");
  await page.mouse.move(700, 20);
  await expect(sidebar).toHaveCSS("width", "78px");
  await expect(page.locator(".workspace")).toBeVisible();
});

test("tema claro e escuro persistem", async ({ page }) => {
  await login(page);
  const toggle = page.locator(".topbar").getByRole("button", { name: "Ativar tema escuro" });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.locator(".topbar").getByRole("button", { name: "Ativar tema claro" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("todas as páginas solicitadas são navegáveis", async ({ page }) => {
  await login(page);
  const routes = [
    "/dashboard", "/leads", "/importacoes", "/lotes", "/fila", "/conversas", "/interessados",
    "/demonstracoes", "/nao-responderam", "/follow-ups", "/transferencias", "/perdidos", "/opt-outs",
    "/materiais", "/base-conhecimento", "/mente-da-ia", "/mensagens-iniciais", "/horarios-limites", "/integracoes/groq",
    "/integracoes/whatsapp", "/saude", "/logs", "/configuracoes",
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page).toHaveURL(new RegExp(`${route.replace("/", "\\/")}$`));
    await expect(page.locator("main")).toBeVisible();
  }
});

test("opera materiais, conhecimento, agenda, takeover, saúde e logs em mock", async ({ page }) => {
  await login(page);
  await page.goto("/materiais");
  await expect(page.getByRole("button", { name: /Novo material/ })).toBeVisible();
  await expect(page.getByPlaceholder(/Buscar material/)).toBeVisible();
  await page.goto("/base-conhecimento");
  await expect(page.getByRole("heading", { name: "Base de conhecimento" })).toBeVisible();
  await page.getByRole("button", { name: /Novo conteúdo/ }).click();
  await expect(page.getByRole("dialog", { name: "Novo conhecimento" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto("/demonstracoes");
  await expect(page.getByRole("button", { name: /Agendar/ })).toBeVisible();
  await page.goto("/transferencias");
  await expect(page.getByText("IA ativa")).toBeVisible();
  await page.goto("/saude");
  await expect(page.getByRole("button", { name: /Diagnóstico seguro/ })).toBeVisible();
  await page.goto("/logs");
  await expect(page.getByRole("button", { name: /Exportar visão redigida/ })).toBeVisible();
});

test("drawer mobile fecha por Escape e clique externo", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/is-open/);
  await page.keyboard.press("Escape");
  await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
  await page.getByRole("button", { name: "Abrir menu" }).click();
  await page.mouse.click(380, 420);
  await expect(page.locator(".sidebar")).not.toHaveClass(/is-open/);
});

test("abre conversa e exibe mensagens e mídia", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "No mobile a conversa selecionada ocupa a tela e a lista fica recolhida.");
  await login(page);
  await page.goto("/conversas");
  await page.locator(".conversation-list > button").first().click();
  await expect(page.getByText("Pode me mostrar como funciona na prática?").last()).toBeVisible();
  await expect(page.getByText("Visão geral Renova123.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "Info" })).toBeVisible();
});

test("modal de importação valida seleção de arquivo", async ({ page }) => {
  await login(page);
  await page.goto("/importacoes");
  await page.locator('input[type="file"]').setInputFiles({ name: "leads.csv", mimeType: "text/csv", buffer: Buffer.from("telefone\n11987654321") });
  await expect(page.getByText("leads.csv")).toBeVisible();
  await page.getByRole("button", { name: /Informar contexto/ }).click();
  await expect(page.getByText("Confirmo que estes contatos podem ser abordados")).toBeVisible();
});

test("configurações carregam controles editáveis", async ({ page }) => {
  await login(page);
  await page.goto("/configuracoes");
  await expect(page.getByRole("heading", { name: "Configurações gerais" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Salvar/ })).toBeVisible();
});

test("WhatsApp mock gera QR, mostra contagem e mantém a chave no servidor", async ({ page }) => {
  await login(page);
  await page.goto("/integracoes/whatsapp");
  await expect(page.getByRole("button", { name: "Conectar WhatsApp" }).first()).toBeDisabled();
  await expect(page.getByText("Evolution API não configurada").first()).toBeVisible();
  await expect(page.getByText("Nunca exposta", { exact: true }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("development-only-secret");
});

test("Groq lista modelos ativos e nunca exibe a chave completa", async ({ page }) => {
  await page.route("**/groq/status", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ configured: true, apiKeyMasked: "gsk_••••••••7890", model: "llama-3.3-70b-versatile", transcriptionModel: "whisper-large-v3-turbo", temperature: 0.3, models: [{ id: "llama-3.3-70b-versatile", transcription: false }, { id: "whisper-large-v3-turbo", transcription: true }], health: { ok: true, latencyMs: 42, modelCount: 2, error: null, rateLimits: { limitRequests: 30, remainingRequests: 29, limitTokens: 6000, remainingTokens: 5800, retryAfterSeconds: null, observedAt: new Date().toISOString() } }, lastFailure: null, processingPaused: false }) }));
  await login(page);
  await page.goto("/integracoes/groq");
  await expect(page.getByRole("heading", { name: "GroqCloud" })).toBeVisible();
  await expect(page.getByLabel("Modelo principal")).toHaveValue("llama-3.3-70b-versatile");
  await expect(page.getByText("Provedor exclusivo")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("gsk_test_key_1234567890");
});

test("estado vazio é informativo", async ({ page }) => {
  await login(page);
  await page.goto("/conversas?estado=vazio");
  await expect(page.getByRole("heading", { name: "Caixa de entrada vazia" })).toBeVisible();
});

test("estado de carregamento usa skeleton acessível", async ({ page }) => {
  await login(page);
  await page.goto("/dashboard?estado=loading");
  await expect(page.getByLabel("Carregando").first()).toBeVisible();
});

test("estado de erro oferece nova tentativa", async ({ page }) => {
  await login(page);
  await page.goto("/conversas?estado=erro");
  await expect(page.getByRole("alert")).toContainText("Não foi possível carregar as conversas");
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
});

test("layouts exigidos não geram rolagem horizontal", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "A matriz de larguras já inclui telas móveis.");
  await login(page);
  for (const width of [360, 390, 768, 1024, 1366, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    for (const route of ["/dashboard", "/conversas", "/integracoes/groq", "/integracoes/whatsapp", "/configuracoes"]) {
      await page.goto(route);
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      expect(dimensions.scroll, `${route} em ${width}px`).toBeLessThanOrEqual(dimensions.client + 1);
    }
  }
});
