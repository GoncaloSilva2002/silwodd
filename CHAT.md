# Chat entre utilizadores

É possível enviar um anexo por mensagem, com ou sem texto, até 10 MB. Imagens, documentos e outros ficheiros são descarregados através de uma rota autenticada com as mesmas permissões da conversa. Os conteúdos são guardados como BYTEA na tabela privada `chat_attachments` do PostgreSQL/Supabase, sem URLs públicas. Este armazenamento conta para o espaço da base de dados e dos backups. Reiniciar o backend cria a tabela automaticamente; em alternativa, executar o `backend/chat-schema.sql` atualizado no SQL Editor. Imagens são descarregadas como os restantes ficheiros, sem pré-visualização automática.

O separador Chat permite iniciar conversas privadas, enviar mensagens de texto e consultar o histórico. As mensagens não têm estado de leitura. Enquanto o separador estiver aberto e a página visível, as conversas e mensagens são atualizadas a cada 6 segundos. O histórico é carregado em páginas de 100 mensagens.

Os administradores podem consultar todas as conversas. Só os participantes podem enviar mensagens. A interface informa os utilizadores sobre o acesso dos administradores. A remoção de uma conta preserva o histórico e impede novos envios nessa conversa.

Ao reiniciar o backend (`npm start`), a inicialização executa `backend/chat-schema.sql` para criar as duas tabelas e o índice, caso ainda não existam. A ligação PostgreSQL do backend precisa de permissões para criar tabelas e gerir RLS. As tabelas têm RLS sem políticas públicas; o acesso é feito pela API Node autenticada, com a ligação de servidor usada pela app (proprietário das tabelas ou role com BYPASSRLS). Não é necessária uma chave Supabase no navegador.

Verificação: `node --test backend/chat.test.js`. Os testes usam HTTP real com uma base de dados simulada para verificar autenticação, permissões, validação e paginação. Para validar a integração completa, iniciar a app com PostgreSQL e testar com dois utilizadores e um administrador.
