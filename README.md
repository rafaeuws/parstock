# Par Stock — Controle de Estoque e Vendas para PDV

Sistema web para controle de estoque e conciliação de vendas em pontos de venda (PDVs) de hotéis.
Cada dia inicia o estoque com o fechamento do dia anterior, gera a lista de reposição para voltar ao
estoque mínimo, calcula diferenças (perdas/sobras) em quantidade e em R$, e tem um fluxo de
**validação** das conciliações pelo gerente.

Front-end em **React + Vite**, back-end em **Node.js + Express**, dados em **banco SQLite**
(servido pela mesma aplicação). Autenticação com **JWT** e senhas com **hash bcrypt**.

---

## Perfis de acesso

| Perfil | Permissões |
| --- | --- |
| **Administrador** | Acesso total. Cria/edita/exclui usuários, define perfis e vincula a hotéis. Cria hotéis e PDVs. Edita qualquer dia. |
| **Gerente** | Acesso completo, edita dias retroativos e **valida** as conciliações dos supervisores. Cria PDVs. |
| **Supervisor de A&B** | Operação do dia a dia. **Não altera dias retroativos**. Ao salvar, a conciliação fica *aguardando validação* do gerente. |

- O sistema já cria automaticamente, no primeiro start, um administrador: **login `admin` / senha `rafa1411`** (altere após o primeiro acesso).
- Qualquer usuário criado pelo administrador precisa **trocar a senha no primeiro login**.

---

## Rodando localmente

Pré-requisitos: **Node.js 18+** (em alguns sistemas o módulo nativo do SQLite exige `python3`, `make` e `g++` instalados).

```bash
# 1. instalar dependências
npm install

# 2. configurar variáveis de ambiente
cp .env.example .env
#   edite o .env e defina um JWT_SECRET aleatório (ex.: openssl rand -hex 32)

# 3. compilar a interface
npm run build

# 4. iniciar o servidor (front + API na mesma porta)
npm start
```

Acesse `http://localhost:3000`.

### Desenvolvimento (hot reload)

```bash
npm run dev
```
Sobe a API (porta 3000) e o Vite (porta 5173, com proxy para `/api`). Acesse `http://localhost:5173`.

---

## Variáveis de ambiente

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta do servidor. |
| `JWT_SECRET` | *(aleatório)* | Segredo para assinar os tokens. **Defina em produção** para manter as sessões após reiniciar. |
| `DATABASE_PATH` | `./data/parstock.db` | Caminho do arquivo SQLite. Use um disco persistente em produção. |
| `SEED_ADMIN_LOGIN` | `admin` | Login do admin criado no primeiro start. |
| `SEED_ADMIN_PASSWORD` | `rafa1411` | Senha do admin criado no primeiro start. |
| `TOKEN_TTL` | `12h` | Validade do token de sessão. |
| `CORS_ORIGIN` | *(vazio)* | Domínios liberados para CORS, separados por vírgula (só necessário se front e API ficarem em domínios diferentes). |

---

## Deploy

> **Persistência (importante):** em provedores de nuvem, o sistema de arquivos do contêiner é
> **efêmero** — ele é apagado a cada deploy/reinício. Por isso, em produção use **PostgreSQL**
> (banco gerenciado que persiste os dados). Basta definir a variável `DATABASE_URL`. Sem ela,
> o sistema cai no SQLite local, adequado apenas para desenvolvimento.

### Opção A — Render.com com PostgreSQL (recomendado)

1. Suba este repositório no GitHub.
2. No Render: **New → Blueprint** e aponte para o repositório. O arquivo `render.yaml` já cria:
   - um banco **PostgreSQL** gerenciado (`par-stock-db`);
   - o **Web Service**, com `DATABASE_URL` ligado automaticamente ao banco e `JWT_SECRET` gerado.
3. Aguarde o deploy e acesse a URL. Entre com `admin` / `rafa1411` e troque a senha.

Se preferir criar manualmente (sem o Blueprint):
- Crie primeiro um **PostgreSQL** (New → PostgreSQL) e copie a *Internal Connection String*.
- Crie um **Web Service** a partir do repositório:
  - Build Command: `npm install && npm run build`
  - Start Command: `npm start`
  - Em **Environment**, adicione `DATABASE_URL` (cole a connection string), e um `JWT_SECRET` forte.

> Bancos como **Neon** (neon.tech) e **Supabase** também funcionam: crie o Postgres lá, copie a
> connection string e coloque em `DATABASE_URL`. O SSL é ativado automaticamente.

### Opção B — Docker / Docker Compose (Postgres incluso)

```bash
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```
O `docker-compose.yml` sobe a aplicação **e** um Postgres com volume persistente.

### Opção C — VPS (PM2 + Postgres)

```bash
npm install && npm run build
DATABASE_URL=postgresql://user:senha@localhost:5432/parstock JWT_SECRET=... pm2 start npm --name par-stock -- start
```
Coloque um Nginx na frente com HTTPS.

> **Por que meus dados sumiram no Render?** Se o serviço rodar com SQLite no disco do contêiner
> (sem `DATABASE_URL` e sem disco persistente), todo deploy/reinício recria um disco vazio e os
> dados se perdem — e no plano Free do Render discos persistentes não estão disponíveis. A solução
> é usar `DATABASE_URL` (PostgreSQL), como descrito acima. Defina também `JWT_SECRET` fixo para as
> sessões continuarem válidas após reiniciar.

## Banco de dados

- **Produção:** defina `DATABASE_URL` (PostgreSQL). As tabelas são criadas automaticamente no
  primeiro start e os dados persistem entre deploys/reinícios.
- **Local:** sem `DATABASE_URL`, usa **SQLite** (`better-sqlite3`, ou o SQLite embutido do Node —
  neste caso rode com `npm run start:builtin`).

Estrutura: `users`, `hotels`, `pdvs`, `products` (1 linha por PDV) e `days` (1 linha por PDV/data,
com status de validação). Todas as queries são compatíveis com Postgres e SQLite.

## Segurança

- Senhas nunca são armazenadas em texto puro — somente o **hash bcrypt**.
- Sessões via **JWT** assinado com `JWT_SECRET`. Defina um valor forte e único em produção.
- Autorização por perfil é validada **no servidor** em todas as rotas (não depende do front-end).
- `helmet`, `compression` e **rate limit** no endpoint de login já vêm configurados.
- Sirva sempre atrás de **HTTPS** em produção.

---

## Estrutura do projeto

```
server/
  index.js          # app Express, segurança e arquivos estáticos
  db.js             # conexão SQLite, schema e seed do admin
  auth.js           # JWT + bcrypt + middlewares de autorização
  helpers.js        # regras de papel e escopo por hotel/PDV
  routes/           # auth, users, catalog (hotéis/PDVs), days (conciliação/validação/backup)
  public/           # build do front-end (gerado por "npm run build")
client/
  index.html
  src/
    main.jsx
    App.jsx         # toda a interface (React)
    api.js          # cliente HTTP da API
```

---

## Suporte

Desenvolvido por **Rafael Almeida** — rafael.almeida@accor.com
