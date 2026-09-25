CREATE TABLE IF NOT EXISTS chat_conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_a BIGINT REFERENCES funcionarios(id) ON DELETE SET NULL,
  user_b BIGINT REFERENCES funcionarios(id) ON DELETE SET NULL,
  name_a VARCHAR(120) NOT NULL,
  name_b VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_a, user_b),
  CHECK (user_a < user_b)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES chat_conversations(id),
  sender_id BIGINT REFERENCES funcionarios(id) ON DELETE SET NULL,
  sender_name VARCHAR(120) NOT NULL,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_id ON chat_messages(conversation_id, id);
-- Access is mediated by the authenticated Node API, never the public Supabase API.
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
