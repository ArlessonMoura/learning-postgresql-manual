# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 2 — Instalação Guiada, Configuração e Boas Práticas

> Este módulo é deliberadamente mais "mão na massa" que o Módulo 1. O objetivo é sair de uma máquina sem PostgreSQL para uma instância instalada, segura e pronta para uso em qualquer um dos três principais sistemas operacionais.

---

### 2.1 Instalação Passo a Passo e Hardening

#### Linux (Debian / Ubuntu) — via repositório APT oficial

As distribuições Debian/Ubuntu costumam trazer versões desatualizadas do PostgreSQL em seus repositórios padrão. A prática recomendada pela própria comunidade PostgreSQL é adicionar o repositório oficial **PGDG (PostgreSQL Global Development Group)**, garantindo acesso às versões mais recentes e a patches de segurança tempestivos.

```bash
# 1. Instalar dependências para adicionar repositórios via HTTPS
sudo apt update
sudo apt install -y curl ca-certificates gnupg lsb-release

# 2. Adicionar a chave GPG oficial do repositório PGDG
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc

# 3. Adicionar o repositório à lista de fontes do APT
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" | \
  sudo tee /etc/apt/sources.list.d/pgdg.list

# 4. Atualizar e instalar a versão desejada (exemplo: PostgreSQL 17)
sudo apt update
sudo apt install -y postgresql-17 postgresql-client-17

# 5. Verificar se o serviço está ativo
sudo systemctl status postgresql
```

**O que acontece nos bastidores da instalação:**

- É criado automaticamente um **usuário do sistema operacional** chamado `postgres`, dono dos processos e dos arquivos de dados.
- É criado um **superusuário do banco de dados**, também chamado `postgres`, com autenticação inicial via `peer` (ou seja, só quem estiver logado como usuário SO `postgres` consegue conectar sem senha).
- Os arquivos de configuração ficam tipicamente em `/etc/postgresql/17/main/` (Debian/Ubuntu isolam configuração de dados, diferente de outras distros).

**Criação de usuários do sistema e ajuste de arquivos-chave:**

```bash
# Acessar o console como o usuário do sistema "postgres"
sudo -i -u postgres
psql
```

Dentro do `psql`, defina uma senha forte para o superusuário do banco:

```sql
ALTER USER postgres WITH PASSWORD 'uma_senha_forte_e_unica';
```

**Ajuste do `postgresql.conf`** (geralmente em `/etc/postgresql/17/main/postgresql.conf`):

```conf
# Define em quais interfaces de rede o PostgreSQL escuta conexões.
# '*' escuta em todas as interfaces -- use com cautela e sempre
# combinado com firewall e pg_hba.conf bem configurados.
listen_addresses = 'localhost'   # padrão seguro: só conexões locais

# Porta padrão (pode ser alterada por segurança via obscuridade,
# mas isso não substitui controles de acesso reais)
port = 5432
```

**Ajuste do `pg_hba.conf`** (Host-Based Authentication — controla _quem_ pode conectar, _de onde_ e _como_):

```conf
# TYPE  DATABASE  USER      ADDRESS          METHOD
local   all       postgres                    peer
local   all       all                         scram-sha-256
host    all       all       127.0.0.1/32      scram-sha-256
host    all       all       ::1/128           scram-sha-256
# Regra para uma aplicação específica vindo de uma rede interna:
host    app_db    app_user  10.0.0.0/24       scram-sha-256
```

> **Boa prática de segurança**: nunca use o método `trust` (que dispensa senha) fora de ambientes de desenvolvimento totalmente isolados. Prefira sempre `scram-sha-256`, o método de hash de senha mais moderno e seguro suportado nativamente pelo PostgreSQL, em substituição ao antigo e mais fraco `md5`.

Após qualquer alteração em `pg_hba.conf` ou `postgresql.conf`:

```bash
sudo systemctl restart postgresql
```

---

#### macOS — via Homebrew ou Postgres.app

**Opção A: Homebrew** (recomendada para desenvolvedores que já usam a linha de comando):

```bash
# Instalar o PostgreSQL mais recente
brew install postgresql@17

# Adicionar o binário ao PATH (necessário pois o Homebrew
# não sobrescreve o psql do sistema por padrão)
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc

# Iniciar o serviço agora e configurá-lo para iniciar no login
brew services start postgresql@17

# Parar o serviço, se necessário
brew services stop postgresql@17
```

No Homebrew, diferente do Linux, o usuário do banco criado por padrão geralmente tem o mesmo nome do seu usuário de sistema operacional (sem senha inicial), pois o Homebrew não roda como o usuário dedicado `postgres`. É boa prática, imediatamente após instalar, definir uma senha:

```bash
psql postgres
```

```sql
ALTER USER seu_usuario WITH PASSWORD 'uma_senha_forte_e_unica';
```

**Opção B: Postgres.app** (recomendada para quem prefere uma interface gráfica de gerenciamento simples, sem lidar com `brew services`):

1. Baixar o aplicativo em `https://postgresapp.com`.
2. Arrastar para a pasta `Aplicativos` e abrir — um clique já inicializa um cluster padrão.
3. Adicionar os binários da CLI ao PATH (o próprio app sugere o comando na primeira execução), por exemplo:

```bash
sudo mkdir -p /etc/paths.d && \
echo /Applications/Postgres.app/Contents/Versions/latest/bin | \
sudo tee /etc/paths.d/postgresapp
```

Gerenciar o serviço no Postgres.app é feito literalmente pela interface: iniciar/parar clusters pela barra de menus, sem comandos de terminal para start/stop.

---

#### Windows — instalador oficial

1. Baixar o instalador oficial (mantido pela EDB — EnterpriseDB) em `https://www.postgresql.org/download/windows/`.
2. Executar o instalador gráfico, que solicitará:
   - Diretório de instalação;
   - Diretório de dados (_data directory_);
   - **Senha do superusuário `postgres`** — defina uma senha forte já nesta etapa;
   - Porta (padrão `5432`);
   - Locale (idioma/codificação padrão do cluster).
3. O instalador registra o PostgreSQL como um **serviço do Windows**, permitindo gerenciamento via `services.msc` (iniciar, parar, reiniciar, configurar início automático).

**Configuração de variáveis de ambiente** (para usar `psql` via `cmd`/PowerShell de qualquer diretório):

1. Painel de Controle → Sistema → Configurações Avançadas → Variáveis de Ambiente.
2. Editar a variável `Path` e adicionar o diretório `bin` da instalação, por exemplo:
   `C:\Program Files\PostgreSQL\17\bin`
3. Validar em um novo terminal:

```powershell
psql --version
```

**Gerenciando o serviço via PowerShell** (como Administrador):

```powershell
# Verificar status
Get-Service postgresql-x64-17

# Parar / iniciar
Stop-Service postgresql-x64-17
Start-Service postgresql-x64-17
```

No Windows, os arquivos equivalentes ao `postgresql.conf` e `pg_hba.conf` ficam dentro do diretório de dados escolhido na instalação (ex.: `C:\Program Files\PostgreSQL\17\data\`), e as mesmas boas práticas de `listen_addresses` e `scram-sha-256` do Linux se aplicam integralmente.

---

### 2.2 Segurança Inicial

Independentemente do sistema operacional, a checklist de hardening inicial é a mesma:

```
+-----------------------------------------------------------+
|                CHECKLIST DE SEGURANÇA INICIAL              |
+-----------------------------------------------------------+
| [ ] 1. Trocar a senha padrão do superusuário 'postgres'    |
| [ ] 2. Nunca usar o superusuário na aplicação em produção  |
| [ ] 3. Criar roles de aplicação com privilégio mínimo      |
| [ ] 4. Restringir listen_addresses ao necessário            |
| [ ] 5. Configurar pg_hba.conf com scram-sha-256 apenas      |
| [ ] 6. Fechar a porta 5432 no firewall para a internet      |
|       pública, liberando apenas IPs/redes confiáveis        |
| [ ] 7. Manter o PostgreSQL atualizado (patches de segurança)|
+-----------------------------------------------------------+
```

#### Alteração da senha do superusuário

Já demonstrado acima via `ALTER USER postgres WITH PASSWORD '...';`. Vale reforçar: essa senha deve ser gerenciada como um segredo de infraestrutura (cofre de senhas, variável de ambiente segura, gerenciador de secrets), nunca hardcoded em scripts versionados.

#### Criação de Roles com Princípio do Menor Privilégio (Least Privilege)

No PostgreSQL, **Roles** unificam o conceito de "usuário" e "grupo" — um role pode logar (equivalente a usuário) e/ou agrupar permissões (equivalente a grupo).

```sql
-- Criar um role de aplicação, SEM privilégios de superusuário,
-- capaz apenas de logar e operar dentro de um banco específico.
CREATE ROLE app_user WITH LOGIN PASSWORD 'senha_forte_da_aplicacao';

-- Criar o banco de dados que essa aplicação usará
CREATE DATABASE app_db OWNER app_user;

-- Conceder apenas os privilégios estritamente necessários
-- em vez de usar ALL PRIVILEGES ou o superusuário.
GRANT CONNECT ON DATABASE app_db TO app_user;

\c app_db

-- Privilégios granulares por operação, dentro do schema public
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Garantir que tabelas CRIADAS NO FUTURO também herdem esses privilégios
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
```

`ALTER DEFAULT PRIVILEGES` afeta somente objetos criados posteriormente pelo role que executa o comando (a menos que `FOR ROLE` seja especificado); não altera automaticamente os privilégios de objetos criados por outros roles.

> **Por que isso importa**: se a aplicação for comprometida (ex.: via uma vulnerabilidade de SQL Injection, tema do Módulo 4), o dano potencial fica limitado ao que aquele role específico pode fazer. Um `app_user` sem permissão de `DROP TABLE` ou `CREATE ROLE` reduz drasticamente o "raio de explosão" de um ataque bem-sucedido — este é o Princípio do Menor Privilégio aplicado a bancos de dados.

#### Vinculação correta do IP (`listen_addresses`)

```conf
# Ambiente de desenvolvimento local: só o próprio host acessa
listen_addresses = 'localhost'

# Servidor de aplicação em rede interna, acessado por outras
# máquinas da mesma rede privada (nunca exponha diretamente
# à internet pública sem VPN/firewall/bastion host)
listen_addresses = '10.0.0.5'

# Escutar em todas as interfaces -- só faz sentido combinado
# com pg_hba.conf restritivo e firewall bem configurado
listen_addresses = '*'
```

`listen_addresses` define **em quais placas de rede** o processo escuta; o `pg_hba.conf` define **quem, de onde, e com qual método de autenticação** pode efetivamente se conectar. Os dois trabalham em conjunto — configurar apenas um dos dois é uma configuração de segurança incompleta.

---

### 2.3 Ferramentas de Acesso

#### `psql` (linha de comando)

O cliente oficial de linha de comando, instalado junto com o servidor. Principais comandos internos (chamados de _meta-comandos_, todos iniciados por `\`):

```
\l          -- lista todos os bancos de dados
\c nome_db  -- conecta a um banco de dados específico
\dt         -- lista as tabelas do schema atual
\d tabela   -- descreve a estrutura de uma tabela (colunas, tipos, índices)
\du         -- lista os roles existentes e seus privilégios
\x          -- alterna exibição de resultados para formato vertical
\timing     -- ativa/desativa a exibição do tempo de execução de queries
\q          -- sai do psql
```

O `psql` é indispensável para automação (scripts `.sql` executados via `psql -f arquivo.sql`), depuração rápida e para qualquer fluxo de trabalho onde uma interface gráfica seria excessiva.

#### Interfaces gráficas: DBeaver e pgAdmin

| Ferramenta  | Características                                                                                                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **pgAdmin** | Ferramenta open source de administração do PostgreSQL. Foco total em PostgreSQL: editor SQL, visualizador de planos de execução (`EXPLAIN`), gerenciamento visual de roles/schemas/tablespaces.                              |
| **DBeaver** | Cliente genérico multi-banco (suporta PostgreSQL, MySQL, Oracle etc.). Interface mais moderna, útil para quem trabalha com múltiplos SGBDs no dia a dia, com recursos de ER-diagram automático a partir do schema existente. |

Ambas as ferramentas se conectam usando os mesmos parâmetros de rede que o `psql` (host, porta, banco, usuário, senha), respeitando as mesmas regras definidas em `pg_hba.conf`.

---

### 2.4 Arquitetura de uma Instância

Entender a hierarquia de objetos do PostgreSQL é essencial antes de criar qualquer tabela.

```
+-------------------------------------------------------------+
|                    CLUSTER (uma instância)                   |
|          um único processo "postmaster" na porta 5432        |
|                                                               |
|   +-----------------+   +-----------------+   +-----------+ |
|   |  DATABASE: app_db |  |  DATABASE: crm  |  | postgres  | |
|   |                   |  |                 |  | (default) | |
|   |  +-------------+  |  |  +-----------+  |  +-----------+ |
|   |  | SCHEMA:     |  |  |  | SCHEMA:   |  |               |
|   |  |  public     |  |  |  |  public   |  |               |
|   |  |  vendas     |  |  |  |  crm_core |  |               |
|   |  |  auditoria  |  |  |  +-----------+  |               |
|   |  +-------------+  |  |                 |               |
|   +-----------------+   +-----------------+                |
|                                                               |
|   ROLES (compartilhados por TODO o cluster, não por banco):  |
|   postgres (superuser), app_user, readonly_user, ...          |
|                                                               |
|   TABLESPACES (localizações físicas em disco):               |
|   pg_default, pg_global, fast_ssd_tablespace, ...             |
+-------------------------------------------------------------+
```

- **Cluster**: o conjunto completo gerenciado por uma única execução do processo do servidor PostgreSQL (`postmaster`), associado a um único diretório de dados e uma única porta de rede. Um cluster pode conter **múltiplos databases**.
- **Database (banco de dados)**: um namespace isolado de dados — por padrão, uma conexão só "enxerga" um database por vez; não é possível fazer um `JOIN` direto entre tabelas de databases diferentes no mesmo cluster (diferente de schemas, que permitem isso livremente).
- **Schema**: um namespace **dentro** de um database, usado para organizar tabelas logicamente (ex.: separar `vendas` de `auditoria` dentro do mesmo banco `app_db`) e para isolar permissões de forma mais granular que um database inteiro.
- **Role**: a unidade de autenticação e autorização. Roles são compartilhados por **todo o cluster** (não pertencem a um único database) — por isso um mesmo usuário pode ter permissões diferentes em databases diferentes do mesmo cluster.
- **Tablespace**: define **onde no disco físico** os dados de um objeto (tabela, índice) são armazenados. Útil, por exemplo, para colocar tabelas de alta rotatividade em um disco SSD mais rápido, separado do disco onde ficam dados históricos raramente acessados.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Deixar o método `trust` ativo em `pg_hba.conf` em qualquer ambiente além de um sandbox local totalmente isolado.
2. Usar o superusuário `postgres` como usuário de conexão da aplicação em produção.
3. Configurar `listen_addresses = '*'` sem um `pg_hba.conf` restritivo e sem firewall — expondo o banco à internet.
4. Instalar a versão do PostgreSQL disponível no repositório padrão da distro Linux sem considerar o repositório oficial PGDG, ficando preso a versões antigas e sem patches recentes.
5. Ignorar a diferença entre `listen_addresses` (rede) e `pg_hba.conf` (autenticação/autorização), configurando apenas um dos dois e assumindo que está seguro.
6. Não versionar as políticas de `pg_hba.conf` e `postgresql.conf` customizadas em um repositório de infraestrutura, perdendo o histórico de mudanças de configuração.
7. Confundir Schema com Database, tentando fazer JOINs entre tabelas de databases diferentes no mesmo cluster.

**Boas práticas:**

1. Sempre definir uma senha forte para o superusuário imediatamente após a instalação, antes de qualquer outro passo.
2. Criar um role de aplicação dedicado, com privilégios explicitamente concedidos (nunca herdados de `ALL PRIVILEGES`) para cada sistema que se conecta ao banco.
3. Usar `scram-sha-256` como método de autenticação padrão em todo `pg_hba.conf`.
4. Automatizar a instalação e configuração inicial via scripts de provisionamento (Ansible, Terraform, shell scripts versionados) em vez de passos manuais não documentados.
5. Manter o PostgreSQL sempre em versões com suporte ativo, aplicando atualizações de segurança tempestivamente.
6. Utilizar schemas para organizar logicamente um banco de dados grande (ex.: separar dados operacionais de dados de auditoria), em vez de um único schema `public` com dezenas de tabelas sem organização.
7. Documentar a arquitetura de roles e permissões do cluster, especialmente em ambientes com múltiplos databases e múltiplas aplicações compartilhando a mesma instância.

---

_Fim do Módulo 2. Aguardando confirmação para prosseguir ao Módulo 3 — DDL e DML: Manipulação Fundamental de Dados._
