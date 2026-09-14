# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 9 — Projeto Prático Guiado e Arquitetura Real

> Módulo final e mais extenso do manual: aqui, cada conceito dos Módulos 1 a 8 é aplicado na construção completa de um banco de dados para um **Sistema de E-commerce Multi-tenant**, do zero até um módulo funcional em C integrado via `libpq`.

---

### 8.1 Contexto e Decisões de Arquitetura

**Multi-tenant** significa que uma única instância do sistema atende a múltiplas lojas (tenants/inquilinos) independentes, cada uma com seus próprios clientes, produtos e pedidos, mas compartilhando a mesma infraestrutura de banco de dados.

#### Estratégia de isolamento escolhida: coluna `tenant_id` (isolamento lógico compartilhado)

```
   Estratégias possíveis de multi-tenancy:

+---------------------------+-----------------------------------------+
| 1. Database por tenant     | Isolamento máximo, mas custo operacional |
|                            | alto (N databases para gerenciar)        |
+---------------------------+-----------------------------------------+
| 2. Schema por tenant       | Isolamento médio, complexidade de        |
|                            | gerenciar N schemas dentro de 1 database |
+---------------------------+-----------------------------------------+
| 3. Coluna tenant_id        | Isolamento lógico via aplicação/RLS,     |
|    (ESCOLHIDA NESTE        | simples de operar, escala bem para       |
|    PROJETO)                | muitos tenants pequenos/médios           |
+---------------------------+-----------------------------------------+
```

Optamos pela estratégia de coluna `tenant_id` por ser a mais didática para ilustrar índices compostos, `Row-Level Security` e filtros obrigatórios — e por ser, na prática, a estratégia mais comum para SaaS com um grande número de tenants de porte pequeno a médio (reservando "database por tenant" para clientes enterprise com requisitos regulatórios específicos, uma decisão que cada projeto real deve avaliar conforme seu contexto).

---

### 8.2 Modelagem E-R

```
+---------------+       +----------------+       +---------------+
|    tenants    |       |    clientes    |       |   categorias   |
+---------------+       +----------------+       +---------------+
| id (PK)       |<--+   | id (PK)        |   +-->| id (PK)        |
| nome_loja     |   |   | tenant_id (FK) |   |   | tenant_id (FK) |
| criado_em     |   |   | nome           |   |   | nome           |
+---------------+   |   | email          |   |   +---------------+
                     |   +----------------+   |
                     |          |             |
                     |          | 1:N          |
                     |          v             |
                     |   +----------------+   |
                     |   |    pedidos     |   |
                     |   +----------------+   |
                     |   | id (PK)        |   |
                     +---| tenant_id (FK) |   |
                         | cliente_id (FK)|   |
                         | status         |   |
                         | criado_em      |   |
                         +----------------+   |
                                | 1:N          |
                                v             |
                         +----------------+   |
                         | itens_pedido   |   |
                         +----------------+   |
                         | id (PK)        |   |
                         | pedido_id (FK) |   |
                         | produto_id (FK)|---+
                         | quantidade     |
                         | preco_unitario |
                         +----------------+
                                ^
                                | N:1
                         +----------------+
                         |   produtos     |
                         +----------------+
                         | id (PK)        |
                         | tenant_id (FK) |
                         | categoria_id(FK)|
                         | nome           |
                         | preco          |
                         | estoque        |
                         | atributos(JSONB)|
                         +----------------+
```

---

### 8.3 Script DDL Completo — Tabelas Normalizadas

```sql
-- ============================================================
-- SISTEMA DE E-COMMERCE MULTI-TENANT
-- Script de criação do schema completo, normalizado até 3FN
-- ============================================================

CREATE TABLE tenants (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome_loja   VARCHAR(150) NOT NULL,
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE clientes (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    nome        VARCHAR(150) NOT NULL,
    email       VARCHAR(255) NOT NULL,
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW(),
    -- Um mesmo e-mail pode existir em tenants diferentes (lojas diferentes),
    -- mas deve ser único DENTRO de cada tenant -- por isso a constraint
    -- de unicidade é composta, não apenas na coluna email isoladamente.
    CONSTRAINT uq_clientes_tenant_email UNIQUE (tenant_id, email)
);

CREATE TABLE categorias (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    nome        VARCHAR(100) NOT NULL,
    CONSTRAINT uq_categorias_tenant_nome UNIQUE (tenant_id, nome)
);

CREATE TABLE produtos (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id       BIGINT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    categoria_id    BIGINT NOT NULL REFERENCES categorias(id) ON DELETE RESTRICT,
    nome            VARCHAR(200) NOT NULL,
    preco           NUMERIC(10,2) NOT NULL CHECK (preco >= 0),
    estoque         INT NOT NULL DEFAULT 0 CHECK (estoque >= 0),
    atributos       JSONB NOT NULL DEFAULT '{}'::jsonb,
    criado_em       TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE pedidos (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id   BIGINT NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
    cliente_id  BIGINT NOT NULL REFERENCES clientes(id) ON DELETE RESTRICT,
    status      VARCHAR(20) NOT NULL DEFAULT 'pendente'
                CHECK (status IN ('pendente', 'pago', 'enviado', 'cancelado')),
    criado_em   TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE itens_pedido (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pedido_id       BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    produto_id      BIGINT NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
    quantidade      INT NOT NULL CHECK (quantidade > 0),
    -- Preço é DUPLICADO aqui intencionalmente (denormalização estratégica,
    -- Módulo 1): registra o preço no MOMENTO da compra, preservando o
    -- histórico fiscal mesmo que o preço do produto mude depois.
    preco_unitario  NUMERIC(10,2) NOT NULL CHECK (preco_unitario >= 0)
);

-- Tabela de auditoria de estoque (usada pela trigger da seção 8.4)
CREATE TABLE log_auditoria_estoque (
    id                  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    produto_id          BIGINT NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
    estoque_antes       INT NOT NULL,
    estoque_depois      INT NOT NULL,
    alterado_em         TIMESTAMP NOT NULL DEFAULT NOW(),
    alterado_por        VARCHAR(100) NOT NULL DEFAULT CURRENT_USER
);
```

> **Nota sobre `itens_pedido.preco_unitario`**: este é o exemplo mais concreto de denormalização estratégica OLTP (Módulo 1) em todo o projeto. Se `preco_unitario` não existisse aqui e a consulta buscasse sempre `produtos.preco`, um reajuste de preço no catálogo alteraria retroativamente o valor de pedidos já fechados — um erro de integridade histórica grave em qualquer sistema com implicações fiscais.

---

### 8.4 Índices Estratégicos

```sql
-- Índices B-Tree em toda FK usada com frequência em filtros/joins
-- (o PostgreSQL NÃO cria índice automaticamente em colunas de FK,
-- diferente da PK, que já vem indexada implicitamente)
CREATE INDEX idx_clientes_tenant_id  ON clientes (tenant_id);
CREATE INDEX idx_produtos_tenant_id ON produtos (tenant_id);
CREATE INDEX idx_pedidos_tenant_id  ON pedidos (tenant_id);
CREATE INDEX idx_pedidos_cliente_id ON pedidos (cliente_id);
CREATE INDEX idx_itens_pedido_pedido_id  ON itens_pedido (pedido_id);
CREATE INDEX idx_itens_pedido_produto_id ON itens_pedido (produto_id);

-- Índice composto: consultas típicas filtram por tenant E por status
-- SIMULTANEAMENTE (ex.: "pedidos pagos da loja X") -- um índice composto
-- na ordem correta (coluna mais seletiva/mais usada em igualdade primeiro)
-- atende essa consulta de forma muito mais eficiente que dois índices
-- separados combinados pelo otimizador.
CREATE INDEX idx_pedidos_tenant_status ON pedidos (tenant_id, status);

-- Índice GIN para consultas por atributos JSONB de produtos (Módulo 6)
CREATE INDEX idx_produtos_atributos ON produtos USING GIN (atributos);

-- Índice parcial: otimiza especificamente a consulta mais frequente do
-- negócio -- "produtos ativos com estoque disponível" -- sem pagar o
-- custo de indexar produtos zerados/esgotados, que raramente são buscados
CREATE INDEX idx_produtos_disponiveis ON produtos (tenant_id, categoria_id)
    WHERE estoque > 0;
```

---

### 8.5 Trigger de Auditoria de Estoque

```sql
CREATE OR REPLACE FUNCTION fn_auditoria_estoque()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO log_auditoria_estoque (produto_id, estoque_antes, estoque_depois)
    VALUES (OLD.id, OLD.estoque, NEW.estoque);
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auditoria_estoque
AFTER UPDATE OF estoque ON produtos
FOR EACH ROW
WHEN (OLD.estoque IS DISTINCT FROM NEW.estoque)
EXECUTE FUNCTION fn_auditoria_estoque();
```

```sql
-- Função utilitária que processa a baixa de estoque de forma ATÔMICA
-- e segura contra condições de corrida (retomando o Módulo 6),
-- usada pelo módulo de aplicação em C na seção 8.7.
CREATE OR REPLACE FUNCTION fn_registrar_venda(
    p_pedido_id BIGINT,
    p_produto_id BIGINT,
    p_quantidade INT,
    p_preco_unitario NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_estoque_atual INT;
BEGIN
    -- SELECT ... FOR UPDATE bloqueia a linha até o COMMIT/ROLLBACK,
    -- evitando que duas vendas concorrentes leiam o mesmo estoque
    -- "disponível" e ambas prossigam indevidamente.
    SELECT estoque INTO v_estoque_atual
    FROM produtos
    WHERE id = p_produto_id
    FOR UPDATE;

    IF v_estoque_atual < p_quantidade THEN
        RAISE EXCEPTION 'Estoque insuficiente para o produto % (disponível: %, solicitado: %)',
            p_produto_id, v_estoque_atual, p_quantidade;
    END IF;

    UPDATE produtos SET estoque = estoque - p_quantidade WHERE id = p_produto_id;

    INSERT INTO itens_pedido (pedido_id, produto_id, quantidade, preco_unitario)
    VALUES (p_pedido_id, p_produto_id, p_quantidade, p_preco_unitario);
END;
$$;
```

---

### 8.6 Consulta Analítica Complexa com Window Functions

**Requisito de negócio**: para cada tenant, listar o **top 3 produtos mais vendidos por categoria**, juntamente com o percentual que cada produto representa do faturamento total daquela categoria.

```sql
WITH vendas_por_produto AS (
    SELECT
        pr.tenant_id,
        pr.categoria_id,
        c.nome                              AS nome_categoria,
        pr.id                                AS produto_id,
        pr.nome                              AS nome_produto,
        SUM(ip.quantidade)                   AS unidades_vendidas,
        SUM(ip.quantidade * ip.preco_unitario) AS faturamento_produto
    FROM itens_pedido ip
    JOIN produtos pr   ON pr.id = ip.produto_id
    JOIN categorias c  ON c.id = pr.categoria_id
    JOIN pedidos p     ON p.id = ip.pedido_id
    WHERE p.status IN ('pago', 'enviado')
    GROUP BY pr.tenant_id, pr.categoria_id, c.nome, pr.id, pr.nome
),
faturamento_categoria AS (
    SELECT
        tenant_id,
        categoria_id,
        SUM(faturamento_produto) AS faturamento_total_categoria
    FROM vendas_por_produto
    GROUP BY tenant_id, categoria_id
),
ranking AS (
    SELECT
        v.tenant_id,
        v.nome_categoria,
        v.nome_produto,
        v.unidades_vendidas,
        v.faturamento_produto,
        ROUND(
            100.0 * v.faturamento_produto / f.faturamento_total_categoria, 2
        ) AS percentual_da_categoria,
        DENSE_RANK() OVER (
            PARTITION BY v.tenant_id, v.categoria_id
            ORDER BY v.faturamento_produto DESC
        ) AS posicao_no_ranking
    FROM vendas_por_produto v
    JOIN faturamento_categoria f
        ON f.tenant_id = v.tenant_id AND f.categoria_id = v.categoria_id
)
SELECT
    tenant_id,
    nome_categoria,
    posicao_no_ranking,
    nome_produto,
    unidades_vendidas,
    faturamento_produto,
    percentual_da_categoria
FROM ranking
WHERE posicao_no_ranking <= 3
ORDER BY tenant_id, nome_categoria, posicao_no_ranking;
```

Esta consulta encadeia três CTEs (Módulo 5), agregação com `GROUP BY` (Módulo 5), e uma Window Function `DENSE_RANK() OVER (PARTITION BY ...)` (Módulo 6) — sintetizando, em uma única instrução legível e nomeada por etapas, uma análise que seria extremamente difícil de expressar como uma única consulta monolítica sem CTEs.

---

### 8.7 Integração Prática: Módulo em C com libpq

O módulo abaixo implementa duas operações centrais do e-commerce — inserir um novo pedido com seus itens, e consultar pedidos de um tenant — inteiramente protegidas contra SQL Injection via `PQexecParams`, com gerenciamento correto de memória via `PQclear`.

```c
/*
 * modulo_ecommerce.c
 * Módulo de integração C + PostgreSQL para o sistema de e-commerce
 * multi-tenant, usando exclusivamente Prepared Statements via libpq.
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdbool.h>
#include <libpq-fe.h>

/* ------------------------------------------------------------------ */
/* Conexão                                                              */
/* ------------------------------------------------------------------ */

PGconn *conectar_banco(void) {
    const char *host   = getenv("DB_HOST");
    const char *dbname = getenv("DB_NAME");
    const char *user   = getenv("DB_USER");
    const char *pass   = getenv("DB_PASSWORD");

    char conninfo[512];
    snprintf(conninfo, sizeof(conninfo),
             "host=%s dbname=%s user=%s password=%s",
             host ? host : "localhost",
             dbname ? dbname : "app_db",
             user ? user : "app_user",
             pass ? pass : "");

    PGconn *conn = PQconnectdb(conninfo);

    if (PQstatus(conn) != CONNECTION_OK) {
        fprintf(stderr, "Falha na conexão: %s\n", PQerrorMessage(conn));
        PQfinish(conn);
        return NULL;
    }
    return conn;
}

/* ------------------------------------------------------------------ */
/* Inserção: cria um pedido e registra a venda de um item             */
/* usando a função fn_registrar_venda (que já trata concorrência       */
/* de estoque no próprio banco, via SELECT ... FOR UPDATE)             */
/* ------------------------------------------------------------------ */

bool registrar_pedido_com_item(
    PGconn *conn,
    long tenant_id,
    long cliente_id,
    long produto_id,
    int quantidade,
    double preco_unitario
) {
    /* Todas as transformações numéricas -> string ocorrem ANTES da
     * query, e são enviadas como parâmetros -- nunca concatenadas. */
    char tenant_id_str[32], cliente_id_str[32];
    char produto_id_str[32], quantidade_str[16], preco_str[32];

    snprintf(tenant_id_str,  sizeof(tenant_id_str),  "%ld", tenant_id);
    snprintf(cliente_id_str, sizeof(cliente_id_str), "%ld", cliente_id);
    snprintf(produto_id_str, sizeof(produto_id_str), "%ld", produto_id);
    snprintf(quantidade_str, sizeof(quantidade_str), "%d",  quantidade);
    snprintf(preco_str,      sizeof(preco_str),      "%.2f", preco_unitario);

    /* Inicia uma transação explícita: criação do pedido + registro do
    * item devem ser atômicos (Módulo 6). */
    PGresult *res = PQexec(conn, "BEGIN");
    PQclear(res);

    /* 1. Cria o pedido (status 'pendente' por DEFAULT) */
    const char *query_pedido =
        "INSERT INTO pedidos (tenant_id, cliente_id) VALUES ($1, $2) RETURNING id;";
    const char *valores_pedido[2] = { tenant_id_str, cliente_id_str };

    res = PQexecParams(conn, query_pedido, 2, NULL, valores_pedido, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro ao criar pedido: %s\n", PQerrorMessage(conn));
        PQclear(res);
        PQclear(PQexec(conn, "ROLLBACK"));
        return false;
    }

    long novo_pedido_id = atol(PQgetvalue(res, 0, 0));
    PQclear(res);

    /* 2. Registra o item via função de banco fn_registrar_venda,
     *    que já valida estoque de forma segura contra concorrência. */
    char pedido_id_str[32];
    snprintf(pedido_id_str, sizeof(pedido_id_str), "%ld", novo_pedido_id);

    const char *query_venda = "SELECT fn_registrar_venda($1, $2, $3, $4);";
    const char *valores_venda[4] = {
        pedido_id_str, produto_id_str, quantidade_str, preco_str
    };

    res = PQexecParams(conn, query_venda, 4, NULL, valores_venda, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro ao registrar venda: %s\n", PQerrorMessage(conn));
        PQclear(res);
        PQclear(PQexec(conn, "ROLLBACK"));
        return false;
    }

    PQclear(res);
    PQclear(PQexec(conn, "COMMIT"));

    printf("Pedido #%ld registrado com sucesso.\n", novo_pedido_id);
    return true;
}

/* ------------------------------------------------------------------ */
/* Consulta: lista pedidos de um tenant, filtrando por status         */
/* ------------------------------------------------------------------ */

void listar_pedidos_do_tenant(PGconn *conn, long tenant_id, const char *status) {
    char tenant_id_str[32];
    snprintf(tenant_id_str, sizeof(tenant_id_str), "%ld", tenant_id);

    const char *query =
        "SELECT p.id, cl.nome, p.status, p.criado_em "
        "FROM pedidos p "
        "JOIN clientes cl ON cl.id = p.cliente_id "
        "WHERE p.tenant_id = $1 AND p.status = $2 "
        "ORDER BY p.criado_em DESC "
        "LIMIT 50;";

    const char *valores[2] = { tenant_id_str, status };

    PGresult *res = PQexecParams(conn, query, 2, NULL, valores, NULL, NULL, 0);

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro na consulta: %s\n", PQerrorMessage(conn));
        PQclear(res);
        return;
    }

    int total = PQntuples(res);
    printf("Pedidos encontrados: %d\n", total);
    for (int i = 0; i < total; i++) {
        printf("  #%s | Cliente: %-20s | Status: %-10s | Criado em: %s\n",
               PQgetvalue(res, i, 0),
               PQgetvalue(res, i, 1),
               PQgetvalue(res, i, 2),
               PQgetvalue(res, i, 3));
    }

    PQclear(res);
}

/* ------------------------------------------------------------------ */
/* Ponto de entrada de demonstração                                   */
/* ------------------------------------------------------------------ */

int main(void) {
    PGconn *conn = conectar_banco();
    if (conn == NULL) {
        return EXIT_FAILURE;
    }

    /* Exemplo de uso: registrar um pedido do cliente 1, tenant 1,
     * comprando 2 unidades do produto 10 a R$ 49.90 cada. */
    registrar_pedido_com_item(conn, 1, 1, 10, 2, 49.90);

    /* Exemplo de uso: listar os pedidos pagos do tenant 1 */
    listar_pedidos_do_tenant(conn, 1, "pago");

    PQfinish(conn);
    return EXIT_SUCCESS;
}
```

**Compilação (Linux/macOS, assumindo `libpq-dev` instalado):**

```bash
gcc modulo_ecommerce.c -o modulo_ecommerce -lpq
export DB_HOST=localhost DB_NAME=app_db DB_USER=app_user DB_PASSWORD=senha_forte_da_aplicacao
./modulo_ecommerce
```

Este módulo final amarra, em um único artefato funcional, praticamente todo o conteúdo do manual: modelagem normalizada com denormalização estratégica pontual (Módulo 3), constraints e integridade referencial (Módulo 4), consultas e defesa absoluta contra SQL Injection (Módulo 5), transações e controle de concorrência com `FOR UPDATE` (Módulo 6), PL/pgSQL e triggers (Módulo 7), indexação estratégica (Módulo 8), e a integração completa em C via `libpq` com gerenciamento correto de memória.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Esquecer o filtro `tenant_id` em alguma consulta da aplicação multi-tenant, vazando dados de uma loja para outra — o erro mais grave e mais comum em arquiteturas multi-tenant por coluna.
2. Não indexar colunas de chave estrangeira, assumindo (incorretamente) que o PostgreSQL as indexa automaticamente como faz com a chave primária.
3. Armazenar apenas a referência ao preço atual do produto em `itens_pedido`, perdendo o histórico fiscal correto quando o preço do catálogo muda.
4. Implementar a baixa de estoque na aplicação (ler, decidir, escrever em passos separados) em vez de delegar ao banco via função atômica com `FOR UPDATE`, reabrindo a condição de corrida já resolvida no Módulo 6.
5. Não envolver a criação do pedido e o registro do item de venda na mesma transação, arriscando um pedido "órfão" sem itens em caso de falha parcial.
6. Ignorar índices parciais e compostos quando o padrão de consulta real do negócio (ex.: "produtos disponíveis por categoria") justificaria claramente seu uso.
7. Não validar variáveis de ambiente ausentes (`getenv` retornando `NULL`) antes de montar a string de conexão em C, causando comportamento indefinido ou falhas obscuras.

**Boas práticas:**

1. Considerar, em sistemas multi-tenant reais, o uso de **Row-Level Security (RLS)** do próprio PostgreSQL como camada adicional de defesa contra vazamento entre tenants, além da disciplina de sempre filtrar por `tenant_id` na aplicação.
2. Criar índices em toda coluna de chave estrangeira usada com frequência em `JOIN`s ou filtros, validando com `EXPLAIN ANALYZE`.
3. Tratar decisões de denormalização (como o preço duplicado em `itens_pedido`) como decisões arquiteturais explícitas e documentadas, nunca acidentais.
4. Concentrar operações que envolvem verificação e modificação de estado concorrente (estoque, saldo) em funções de banco atômicas (`FOR UPDATE` + `UPDATE` na mesma transação), nunca replicando essa lógica de forma insegura na aplicação.
5. Sempre envolver múltiplas escritas relacionadas (pedido + item, por exemplo) em uma única transação explícita (`BEGIN`/`COMMIT`/`ROLLBACK`), garantindo atomicidade real de ponta a ponta.
6. Revisar periodicamente os índices existentes contra os padrões de consulta reais medidos em produção, removendo índices não utilizados (que só custam em escrita) e criando os que realmente fazem falta.
7. Validar rigorosamente toda configuração externa (variáveis de ambiente, arquivos de configuração) antes de utilizá-la para montar conexões ou consultas, falhando de forma explícita e informativa em vez de prosseguir com valores inválidos ou nulos.

---

## Conclusão do Manual

Este manual percorreu, em nove módulos progressivos, o caminho completo de PostgreSQL: dos fundamentos teóricos de dados e SGBDs, passando por instalação segura, modelagem relacional, DDL/DML, consultas com defesa rigorosa contra SQL Injection, recursos avançados (Window Functions, JSONB, Views, Transações), programação no banco e integração em C, performance e manutenção, até culminar em um projeto prático completo de e-commerce multi-tenant — do zero à implementação funcional.

O fio condutor deliberado em todos os módulos foi: **nenhuma decisão técnica deve ser tomada sem entender o trade-off que ela representa** — seja escolher entre SQL e NoSQL, entre normalizar e denormalizar, entre um índice B-Tree e um GIN, ou entre consistência e disponibilidade. Dominar PostgreSQL, em última análise, é dominar esses trade-offs com clareza suficiente para tomar a decisão certa em cada contexto específico.

### Próximos passos

O próximo estágio é transformar o conhecimento em um ciclo de projeto repetível:

1. Escolha um domínio próprio e escreva os requisitos antes de abrir o editor de diagramas.
2. Modele o DER, valide as cardinalidades e documente as decisões com uma ferramenta como [drawDB](https://www.drawdb.app/), [database.build](https://database.build/) ou [dbdiagram.io](https://dbdiagram.io/home).
3. Converta o modelo em migrações versionadas e teste o schema em uma base descartável.
4. Crie dados representativos, escreva consultas reais e use `EXPLAIN (ANALYZE, BUFFERS)` para medir antes de criar índices.
5. Estude transações, isolamento, backup, restauração, observabilidade e controle de acesso em ambientes próximos da produção.
6. Revise o modelo conforme o sistema evolui: um banco saudável é mantido, testado e documentado continuamente.

O objetivo não é memorizar comandos isolados, mas conseguir justificar cada tabela, relacionamento, constraint, índice e decisão operacional com base no domínio e em evidências.
