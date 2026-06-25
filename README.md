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

### Opção A — Render.com (mais simples, com banco persistente)

1. Suba este repositório no GitHub.
2. No Render, crie um serviço a partir do repositório — o arquivo `render.yaml` já define tudo
   (build, start, disco persistente em `/var/data` e `JWT_SECRET` gerado automaticamente).
3. Após o deploy, acesse a URL e entre com `admin` / `rafa1411`.

### Opção B — Docker / Docker Compose

```bash
# defina um segredo e suba
JWT_SECRET=$(openssl rand -hex 32) docker compose up -d --build
```
Os dados ficam no volume `parstock-data`. A aplicação fica em `http://localhost:3000`.

### Opção C — VPS (PM2)

```bash
npm install && npm run build
JWT_SECRET=... DATABASE_PATH=/var/lib/parstock/parstock.db pm2 start npm --name par-stock -- start
```
Coloque um Nginx na frente com HTTPS (Let's Encrypt).

> **Persistência:** os dados ficam no arquivo apontado por `DATABASE_PATH`. Em plataformas com
> sistema de arquivos efêmero, garanta um **disco/volume persistente** (Render Disk, Railway Volume,
> Fly Volume, ou um diretório do VPS). Faça backups periódicos do arquivo `.db` (ou use a exportação
> por PDV dentro do sistema).

---

## Banco de dados

Usa **SQLite** por padrão (arquivo único, ACID, sem servidor externo). A aplicação tenta usar
`better-sqlite3` (recomendado) e, caso ele não esteja disponível no ambiente, recorre ao
SQLite embutido no Node (`node:sqlite`, Node 22.5+) — neste caso rode com
`node --experimental-sqlite server/index.js`.

Estrutura: `users`, `hotels`, `pdvs`, `products` (1 linha por PDV) e `days` (1 linha por PDV/data,
com status de validação). As tabelas são criadas automaticamente no primeiro start.

---

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
