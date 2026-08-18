/* global process, fetch, console */
const phone = process.argv[2];
if (!/^55\d{10,11}$/.test(phone ?? "")) throw new Error("Informe o telefone normalizado: 55 + DDD + número.");
const response = await fetch("http://127.0.0.1:3333/imports/commit", {
  method: "POST",
  headers: { authorization: "Bearer mock-admin-token", "content-type": "application/json" },
  body: JSON.stringify({
    batch: {
      name: `Teste Francisco - ${phone.slice(-11)}`,
      source: "Teste autorizado pelo administrador",
      context: "Teste controlado com um único lead",
      initialStrategy: "Oi! Aqui é o Francisco, da Renova123. Tenho conversado com algumas óticas sobre uma coisa bem específica.\n\nQuando alguém pede orçamento de lente ou armação pelo WhatsApp e diz que vai pensar, vocês conseguem retomar esse contato depois ou ele costuma se perder?",
      authorized: true,
      priority: 10,
      startDate: new Date().toISOString(),
      dailyLimit: 1,
    },
    phones: [phone],
  }),
});
if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
console.log(JSON.stringify(await response.json(), null, 2));
