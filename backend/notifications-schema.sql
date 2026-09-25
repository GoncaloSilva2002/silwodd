CREATE TABLE IF NOT EXISTS app_notifications (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL,
  title TEXT NOT NULL,
  conversation_id BIGINT,
  work_id BIGINT,
  seen BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- statement-break
CREATE INDEX IF NOT EXISTS app_notifications_user ON app_notifications(user_id, id DESC);
-- statement-break
ALTER TABLE app_notifications ENABLE ROW LEVEL SECURITY;
-- statement-break
CREATE OR REPLACE FUNCTION notify_chat_recipient() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO app_notifications (user_id, kind, title, conversation_id)
  SELECT CASE WHEN c.user_a = NEW.sender_id THEN c.user_b ELSE c.user_a END,
    'message', 'Nova mensagem de ' || NEW.sender_name, c.id
  FROM chat_conversations c
  WHERE c.id = NEW.conversation_id
    AND NEW.sender_id IN (c.user_a, c.user_b)
    AND c.user_a IS NOT NULL AND c.user_b IS NOT NULL;
  RETURN NEW;
END;
$$;
-- statement-break
CREATE OR REPLACE FUNCTION notify_work_priority() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.prioridade IS DISTINCT FROM NEW.prioridade THEN
    INSERT INTO app_notifications (user_id, kind, title, work_id)
    SELECT id, 'priority', 'Prioridade de ' || NEW.nome_obra || ': ' ||
      CASE OLD.prioridade WHEN 'high' THEN 'Alta' WHEN 'low' THEN 'Baixa' ELSE 'Média' END || ' → ' ||
      CASE NEW.prioridade WHEN 'high' THEN 'Alta' WHEN 'low' THEN 'Baixa' ELSE 'Média' END, NEW.id
    FROM funcionarios;
  END IF;
  RETURN NEW;
END;
$$;
-- statement-break
CREATE OR REPLACE TRIGGER chat_message_notification AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION notify_chat_recipient();
-- statement-break
CREATE OR REPLACE TRIGGER work_priority_notification AFTER UPDATE OF prioridade ON obras
FOR EACH ROW EXECUTE FUNCTION notify_work_priority();
