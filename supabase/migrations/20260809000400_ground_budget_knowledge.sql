-- Atualiza somente o item relacionado a Orçamentos; os demais itens permanecem intactos.
begin;

update public.knowledge_items
set
  title = 'Vendas — Orçamentos confirmados',
  tags = array['vendas', 'orcamento', 'whatsapp', 'pdf', 'capability_confirmed']::text[],
  content = 'CAPACIDADE CONFIRMADA: o módulo de Orçamentos permite criar proposta para cliente cadastrado ou atendimento avulso; buscar por nome, WhatsApp ou CPF; adicionar itens de estoque ou personalizados com descrição, quantidade, valor unitário e desconto; aplicar descontos por item e no total; definir validade; registrar observações ou condições; revisar subtotal, desconto e total; salvar; visualizar ou baixar PDF; enviar pelo WhatsApp; e consultar o histórico recente. NÃO CONFIRMADO: follow-up automático, lembretes automáticos, ganho de 30% ou implantação em 5 minutos.',
  updated_at = now()
where title = 'Vendas — orçamento que esfria'
   or title = 'Vendas — Orçamentos confirmados';

commit;
