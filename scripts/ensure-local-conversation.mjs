/* global process, console */
import { createRepository } from "../packages/database/dist/index.js";

const phone = process.argv[2];
if (!/^55\d{10,11}$/.test(phone ?? "")) throw new Error("Informe o telefone normalizado.");
const repository = createRepository({ mock: true, supabaseUrl: undefined, serviceRoleKey: undefined, mockFilePath: ".runtime/mock-db.json" });
const leads = await repository.leads({ page: 1, pageSize: 100, search: phone });
const lead = leads.rows.find((item) => item.phone === phone);
if (!lead?.id) throw new Error("Lead não encontrado.");
const conversations = await repository.page("conversations", { page: 1, pageSize: 100 });
const conversation = conversations.rows.find((item) => item.leadId === lead.id) ?? await repository.createResource("conversations", { leadId: lead.id, status: "active", stage: lead.stage ?? "contacted", humanActive: false, unreadCount: 0, summary: "Primeiro contato enviado pelo Francisco.", lastMessageAt: lead.lastContactAt ?? new Date().toISOString() });
const messages = await repository.messages({ page: 1, pageSize: 200 });
for (const message of messages.rows.filter((item) => item.leadId === lead.id)) await repository.recordMessage({ ...message, conversationId: conversation.id, idempotencyKey: message.idempotencyKey });
console.log(JSON.stringify({ leadId: lead.id, conversationId: conversation.id, linkedMessages: messages.rows.filter((item) => item.leadId === lead.id).length }, null, 2));
