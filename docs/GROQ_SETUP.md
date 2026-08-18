# GroqCloud

1. Crie uma API key no console da Groq.
2. Defina `GROQ_API_KEY` apenas no `.env` raiz.
3. Selecione `GROQ_MODEL` ou altere o modelo na página GroqCloud.
4. Reinicie API e worker.

O código usa o SDK oficial TypeScript `groq-sdk` e solicita JSON. Toda resposta é validada pelo schema Zod. HTTP 429 recebe retry exponencial; falhas repetidas vão para dead-letter e podem provocar transferência humana.

Nenhum fallback externo é implementado. Sem a chave, o modo de simulação continua disponível.
