# THE WOLF — Chrome extension

Extensão Manifest V3 com Side Panel para o fluxo local do THE WOLF.

## Fluxo operacional atual

1. Execute `npm run wolf:dev`.
2. Execute `pnpm wolf:extension:build`.
3. Em `chrome://extensions`, ative Developer mode e carregue `apps/wolf-extension/dist`.
4. Abra uma conversa no WhatsApp Web e clique no ícone THE WOLF.
5. No primeiro uso, libere o microfone.
6. Confirme o contato detectado e clique em `LIGAR THE WOLF`.

O clique no ícone inicia a captura da aba. O Side Panel detecta o contato atual automaticamente; CRM é opcional e contatos desconhecidos funcionam em modo standalone.

O tab stream é mantido pelo background/offscreen e permanece independente da sessão. `PAUSAR` preserva os streams; `ENCERRAR` finaliza sessão, microfone, tab capture, sockets e Qwen.

O Qwen é iniciado sob demanda pelo fluxo da sessão. O backend local usa `http://127.0.0.1:3333`; Whisper usa a porta 8765. O token de extensão é obtido por `/wolf/session/active` e não deve ser colocado em logs.

Para recarregar uma versão compilada, rode o build e use **Reload** na extensão carregada. A versão vem do `package.json` da extensão, é validada contra o manifest e registrada em `dist/build-info.json`.

O fallback desktop WASAPI não faz parte do fluxo da extensão e permanece separado.
