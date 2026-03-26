# WebApp Oficina (Node.js)

MVP com:
- Login por `username` + `password` (multiplas contas)
- Pagina principal com obras pendentes
- Aba de obras com todas as obras
- Aba de clientes para listar e adicionar clientes
- Backend e frontend separados (Node.js + API + frontend estatico)

## Estrutura

```txt
backend/
  db.js
  server.js
  middleware/auth.js
frontend/
  login.html
  app.html
  styles.css
  login.js
  app.js
```

## Requisitos

- Node.js 20+ (inclui npm)
- MySQL com as tabelas `clientes`, `estados`, `obras`, `funcionarios`, `materiais`

## Como correr

1. Instalar dependencias:
```bash
npm install
```

2. Criar `.env`:
```bash
copy .env.example .env
```

3. Arrancar:
```bash
npm run dev
```

4. Abrir:
```txt
http://localhost:3000
```

## Preparado para producao

Esta versao ja inclui:
- `helmet` para headers de seguranca
- rate limit global da API e rate limit de login
- CORS restrito por `ALLOWED_ORIGINS` em producao
- validacao de `JWT_SECRET` forte em producao
- login sem fallback inseguro (contas antigas em plain text sao migradas para hash no primeiro login)
- endpoint de utilizadores sem exposicao de password real

### Checklist antes de hospedar

1. Definir `NODE_ENV=production`
2. Definir `JWT_SECRET` com 32+ caracteres
3. Definir `ALLOWED_ORIGINS` com o teu dominio real (ex.: `https://teu-dominio.com`)
4. Garantir MySQL com backups e acesso restrito
5. Servir por HTTPS (proxy/reverse proxy)
6. Correr `npm install` para instalar novas dependencias

## Modelo de base de dados atual (MySQL)

- O backend usa as tabelas: `clientes`, `estados`, `obras`, `funcionarios`, `materiais`.
- Estados esperados na tabela `estados`:
  - `Pendente`
  - `Em execução`
  - `Concluída`
  - `Suspensa`

## Ideias para evoluir a base de dados

1. Tabela `vehicles`:
- `client_id`, `license_plate`, `brand`, `model`, `year`, `vin`

2. Tabela `work_updates` (historico):
- `work_id`, `status`, `comment`, `changed_by`, `changed_at`

3. Tabela `appointments`:
- agendamentos com data/hora e tipo de servico

4. Tabela `invoices` + `invoice_items`:
- faturacao detalhada por obra

5. Permissoes por role:
- tabela `roles` e `role_permissions` para controlar acessos finos

## Notas

- JWT expira em 8 horas.
- Troca `JWT_SECRET` antes de usar em producao.
