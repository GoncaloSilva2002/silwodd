# Notificações na app

O separador Notificações apresenta avisos persistentes e um contador por utilizador. A app verifica novidades a cada 15 segundos enquanto a página está visível, em qualquer separador, e volta a verificar quando regressas à página. Em telemóveis, o botão do menu também mostra um ponto quando há avisos por consultar. Não são notificações do sistema operativo: é necessário ter a app aberta.

- Mensagens e anexos novos: aviso apenas ao outro participante, nunca a administradores alheios à conversa.
- Prioridade das obras: aviso a todos os utilizadores quando o valor realmente muda, com a prioridade anterior e a nova. Guardar o mesmo valor não cria aviso.
- Abrir um aviso ou selecionar “Marcar como vista” atualiza apenas o estado pessoal da notificação. Não existe confirmação de leitura da mensagem para o remetente.
- O histórico tem páginas de 50 notificações. As notificações começam a ser geradas depois da instalação, sem importar eventos antigos.

Reiniciar o backend executa `backend/notifications-schema.sql` automaticamente, depois da criação das tabelas do chat e da coluna de prioridade. Em alternativa, executar esse ficheiro no SQL Editor do Supabase. As funções e triggers guardam os avisos na mesma transação da mensagem/alteração de prioridade. A tabela tem RLS e só é exposta pela API Node autenticada. A ligação do backend necessita das mesmas permissões de proprietário/BYPASSRLS já usadas pelo chat.

Testes HTTP com base de dados simulada: `node --test backend/chat.test.js backend/notifications.test.js`. A integração dos triggers deve ser validada com PostgreSQL: enviar texto e anexo, confirmar que só o destinatário recebe o aviso, alterar a prioridade e guardar novamente o mesmo valor para confirmar que não há duplicação.
