# Comece aqui

1. Copie `.env.example` para `.env`.
2. Preencha as variáveis do Supabase.
3. Preencha a chave da Groq.
4. Execute `powershell -ExecutionPolicy Bypass -File .\setup.ps1`.
5. Execute as migrations de `supabase/migrations` (CLI: `supabase db push`).
6. Execute `powershell -ExecutionPolicy Bypass -File .\start.ps1`.
7. Abra `http://127.0.0.1:5173` e entre no painel.
8. Abra **WhatsApp**, conecte a instância pelo QR Code e configure o webhook.
9. Cadastre identidade, produto, regras e limites em **Mente da IA**.
10. Cadastre e autorize os materiais em **Materiais**.
11. Mantenha a simulação ativa e execute o plano de teste.
12. Importe somente contatos autorizados.
13. Defina limite diário, horários, dias e intervalos.
14. Desative a simulação somente após validar Supabase, Groq, Evolution e o número de teste informado explicitamente.
15. Ative a captação real e acompanhe **Saúde**, **Fila**, **Notificações** e **Logs**.

Sem credenciais, mantenha `MOCK_MODE=true`, `MOCK_GROQ=true`, `MOCK_EVOLUTION=true`, `SIMULATION_MODE=true` e `REAL_SENDING_ENABLED=false`. O painel local abre diretamente, sem tela de login.

Nunca escolha um número aleatório para teste real. O teste de WhatsApp só deve ocorrer depois da confirmação explícita do usuário e com o número informado por ele.
