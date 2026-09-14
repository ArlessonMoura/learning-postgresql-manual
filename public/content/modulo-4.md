# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 5 — DQL: Consultas e Segurança em Primeiro Lugar

> Este é o módulo mais crítico do manual em termos de segurança. Todo o conhecimento de consultas apresentado aqui deve ser lido em conjunto com a seção final sobre SQL Injection — a forma de montar uma consulta é tão importante quanto a consulta em si.

---

### 4.1 Consultas e Agregações

#### `SELECT`, `WHERE`, `ORDER BY`

```sql
-- Consulta básica com filtro e ordenação
SELECT id, nome, email
FROM clientes
WHERE ativo = TRUE
ORDER BY nome ASC;

-- Múltiplas condições, com operadores lógicos e de comparação
SELECT id, nome, valor_total
FROM pedidos
WHERE status = 'pago'
  AND valor_total > 100.00
  AND criado_em >= '2026-01-01'
ORDER BY valor_total DESC;
```

#### `GROUP BY` e `HAVING`

`GROUP BY` agrupa linhas que compartilham um valor em comum, permitindo aplicar funções de agregação (`COUNT`, `SUM`, `AVG`, `MAX`, `MIN`) por grupo. `HAVING` filtra **grupos já agregados** — diferente de `WHERE`, que filtra linhas **antes** da agregação.

```sql
-- Total gasto por cliente, apenas para clientes que gastaram
-- mais de R$ 500 no total (filtro aplicado APÓS o agrupamento)
SELECT
    cliente_id,
    COUNT(*)         AS total_pedidos,
    SUM(valor_total) AS total_gasto
FROM pedidos
WHERE status = 'pago'
GROUP BY cliente_id
HAVING SUM(valor_total) > 500.00
ORDER BY total_gasto DESC;
```

```
   Ordem lógica de execução de uma query com GROUP BY/HAVING:

   FROM  -->  WHERE  -->  GROUP BY  -->  HAVING  -->  SELECT  -->  ORDER BY  -->  LIMIT
   (linhas)   (filtra    (agrupa)      (filtra       (projeta   (ordena)      (corta)
              linhas)                   grupos)       colunas)
```

> Entender essa ordem lógica de execução é o que explica por que `WHERE` não pode referenciar um alias de `SELECT` que dependa de agregação, enquanto `HAVING` pode — o `WHERE` é avaliado antes de o `SELECT`/`GROUP BY` sequer existirem no plano de execução.

#### `LIMIT` e `OFFSET`

```sql
-- Paginação: página 3, com 20 registros por página
SELECT id, nome
FROM clientes
ORDER BY id
LIMIT 20 OFFSET 40;  -- pula as 40 primeiras linhas (páginas 1 e 2)
```

> **Nota de performance**: `OFFSET` em valores muito altos (ex.: `OFFSET 100000`) obriga o PostgreSQL a _calcular e descartar_ todas as linhas anteriores antes de retornar o resultado, degradando performance em tabelas grandes. Para paginação eficiente em grandes volumes, a técnica de **keyset pagination** (filtrar `WHERE id > ultimo_id_visto LIMIT 20`) é preferível na indústria.

---

### 4.2 Joins e Operadores de Conjunto

#### Joins

```
   INNER JOIN                    LEFT JOIN
  (interseção)                (tudo de A + interseção)
+-------+-------+           +-------+-------+
|   A   |   B   |           |   A   |   B   |
|    +--+--+    |           |  +----+--+    |
|    |  |  |    |           |  |    |  |    |
|    +--+--+    |           |  +----+--+    |
+-------+-------+           +-------+-------+

   RIGHT JOIN                   FULL OUTER JOIN
(interseção + tudo de B)          (tudo de A e B)
+-------+-------+           +-------+-------+
|   A   |   B   |           |   A   |   B   |
|    +--+----+  |           |  +----+----+  |
|    |  |    |  |           |  |    |    |  |
|    +--+----+  |           |  +----+----+  |
+-------+-------+           +-------+-------+
```

```sql
-- INNER JOIN: apenas clientes que possuem ao menos um pedido
SELECT c.nome, p.id AS pedido_id, p.valor_total
FROM clientes c
INNER JOIN pedidos p ON p.cliente_id = c.id;

-- LEFT JOIN: TODOS os clientes, com dados de pedido quando existirem
-- (NULL nas colunas de pedido para quem nunca comprou)
SELECT c.nome, p.id AS pedido_id, p.valor_total
FROM clientes c
LEFT JOIN pedidos p ON p.cliente_id = c.id;

-- RIGHT JOIN: equivalente a um LEFT JOIN com as tabelas invertidas
-- (usado com menos frequência; a maioria reescreve como LEFT JOIN)
SELECT c.nome, p.id AS pedido_id
FROM pedidos p
RIGHT JOIN clientes c ON p.cliente_id = c.id;

-- FULL OUTER JOIN: todos os clientes e todos os pedidos, mesmo
-- os que não têm correspondência em nenhum dos dois lados
SELECT c.nome, p.id AS pedido_id
FROM clientes c
FULL OUTER JOIN pedidos p ON p.cliente_id = c.id;

-- CROSS JOIN: produto cartesiano -- cada linha de A combinada
-- com CADA linha de B (usar com extrema cautela: cresce N x M)
SELECT c.nome, prod.nome AS produto
FROM clientes c
CROSS JOIN produtos prod;
```

#### Operadores de Conjunto: `UNION`, `INTERSECT`, `EXCEPT`

Diferente de `JOIN` (que combina colunas lado a lado), os operadores de conjunto combinam **linhas** de duas consultas com o mesmo número e tipo de colunas.

```sql
-- UNION: combina os resultados, removendo duplicatas
SELECT email FROM clientes
UNION
SELECT email FROM fornecedores;

-- UNION ALL: combina os resultados SEM remover duplicatas
-- (mais rápido, pois evita a etapa de deduplicação)
SELECT email FROM clientes
UNION ALL
SELECT email FROM fornecedores;

-- INTERSECT: apenas as linhas que aparecem em AMBAS as consultas
SELECT cliente_id FROM pedidos WHERE status = 'pago'
INTERSECT
SELECT cliente_id FROM avaliacoes WHERE nota = 5;

-- EXCEPT: linhas da primeira consulta que NÃO aparecem na segunda
SELECT id FROM clientes
EXCEPT
SELECT cliente_id FROM pedidos;  -- clientes que nunca fizeram pedido
```

---

### 4.3 Subconsultas e CTEs (`WITH`)

#### Subconsultas (subqueries)

```sql
-- Subconsulta no WHERE: clientes com pedidos acima da média geral
SELECT nome
FROM clientes
WHERE id IN (
    SELECT cliente_id
    FROM pedidos
    WHERE valor_total > (SELECT AVG(valor_total) FROM pedidos)
);

-- Subconsulta correlacionada: reavaliada para cada linha externa
SELECT c.nome,
       (SELECT COUNT(*) FROM pedidos p WHERE p.cliente_id = c.id) AS qtd_pedidos
FROM clientes c;
```

#### CTEs (Common Table Expressions) — `WITH`

CTEs nomeiam uma subconsulta, tornando queries complexas mais legíveis e reutilizáveis dentro da mesma instrução:

```sql
WITH pedidos_pagos AS (
    SELECT cliente_id, SUM(valor_total) AS total_gasto
    FROM pedidos
    WHERE status = 'pago'
    GROUP BY cliente_id
),
clientes_vip AS (
    SELECT cliente_id
    FROM pedidos_pagos
    WHERE total_gasto > 1000.00
)
SELECT c.nome, pp.total_gasto
FROM clientes c
JOIN pedidos_pagos pp ON pp.cliente_id = c.id
JOIN clientes_vip cv ON cv.cliente_id = c.id
ORDER BY pp.total_gasto DESC;
```

CTEs também suportam recursividade (`WITH RECURSIVE`), útil para percorrer estruturas hierárquicas (ex.: árvores de categorias, organogramas) — tema que será retomado nos Recursos Avançados (Módulo 6).

---

### 4.4 Ameaça e Defesa contra SQL Injection

Esta seção deve ser lida com atenção redobrada: **SQL Injection** figura consistentemente entre as vulnerabilidades mais críticas e mais exploradas em aplicações web (categorizada dentro de "Injection" no OWASP Top 10 historicamente, e hoje sob "A03:2021 – Injection").

#### O que é SQL Injection

SQL Injection ocorre quando uma aplicação constrói uma instrução SQL **concatenando diretamente entrada do usuário** na string da consulta, permitindo que um atacante insira fragmentos de SQL que alteram a lógica original da consulta.

```
   Fluxo normal esperado:
   Usuário digita email --> aplicação monta SQL --> banco executa

   Fluxo comprometido (SQL Injection):
+------------------+     +--------------------+     +-------------------+
| Entrada maliciosa|---->| Concatenação direta |---->| SQL executado é   |
| do "usuário"     |     | (sprintf/strcat)    |     | DIFERENTE do      |
| (não confiável)  |     |                     |     | pretendido         |
+------------------+     +--------------------+     +-------------------+
```

#### Exemplo de código **vulnerável** em C

O exemplo abaixo é **deliberadamente inseguro** — apresentado exclusivamente para fins didáticos, ilustrando exatamente o padrão que deve ser evitado:

```c
/*
 * ❌ CÓDIGO VULNERÁVEL — NÃO REPRODUZIR EM PRODUÇÃO
 * Constrói a query concatenando a entrada do usuário diretamente
 * na string SQL usando sprintf().
 */
#include <stdio.h>
#include <libpq-fe.h>

void buscar_cliente_INSEGURO(PGconn *conn, const char *email_informado) {
    char query[512];

    // PERIGO: o conteúdo de "email_informado" é inserido cru na string.
    sprintf(query, "SELECT id, nome FROM clientes WHERE email = '%s';",
            email_informado);

    PGresult *res = PQexec(conn, query);
    // ... processamento do resultado ...
    PQclear(res);
}
```

Se um atacante controlar o valor de `email_informado` e enviar, por exemplo, um valor contendo uma aspa simples seguida de uma condição sempre verdadeira e um comentário SQL, a string final montada por `sprintf` deixa de representar "buscar por um e-mail específico" e passa a representar uma condição estruturalmente diferente — por exemplo, uma que é avaliada como verdadeira para **todas** as linhas da tabela, ou que encadeia uma segunda instrução SQL arbitrária. O problema de raiz não está em nenhum caractere específico, mas no fato de que **dado do usuário e código SQL estão sendo montados na mesma string**, sem qualquer separação estrutural entre os dois.

#### Solução Definitiva: Prepared Statements

**Instruções Preparadas (Prepared Statements)** resolvem o problema na raiz: a estrutura da consulta SQL é enviada ao banco **separadamente** dos valores dos parâmetros. O banco compila o SQL primeiro (sem nenhum dado do usuário presente) e só depois recebe os valores, que são tratados estritamente como **dados**, nunca como código SQL — não importa o que o valor contenha.

```
   Prepared Statement (parametrização):

+------------------------------+      +------------------------+
| 1. SQL enviado (com $1)      | ---> | Banco compila o plano  |
| "SELECT ... WHERE email=$1"  |      | de execução SEM dados  |
+------------------------------+      +------------------------+
                                                 |
+------------------------------+                v
| 2. Parâmetro enviado à parte | ---> +------------------------+
| valor = "qualquer coisa'; --"|      | Banco trata o valor    |
+------------------------------+      | como STRING literal,   |
                                       | nunca como SQL         |
                                       +------------------------+
```

**Exemplo corrigido em C, usando `PQexecParams` da libpq:**

```c
/*
 * ✅ CÓDIGO SEGURO — parametrização via PQexecParams.
 * O valor do usuário nunca é concatenado na string SQL.
 */
#include <stdio.h>
#include <libpq-fe.h>

void buscar_cliente_SEGURO(PGconn *conn, const char *email_informado) {
    // A query contém um placeholder posicional ($1), sem NENHUM dado.
    const char *query = "SELECT id, nome FROM clientes WHERE email = $1;";

    // Os valores dos parâmetros são passados em um array separado.
    const char *valores_parametros[1] = { email_informado };

    PGresult *res = PQexecParams(
        conn,
        query,
        1,                    // número de parâmetros
        NULL,                 // tipos dos parâmetros (NULL = inferir)
        valores_parametros,   // valores dos parâmetros
        NULL,                 // tamanhos (NULL para texto)
        NULL,                 // formatos (NULL = todos em texto)
        0                     // 0 = resultado em formato texto
    );

    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro na consulta: %s\n", PQerrorMessage(conn));
        PQclear(res);
        return;
    }

    int linhas = PQntuples(res);
    for (int i = 0; i < linhas; i++) {
        printf("ID: %s | Nome: %s\n",
               PQgetvalue(res, i, 0),
               PQgetvalue(res, i, 1));
    }

    // OBRIGATÓRIO: liberar a memória do resultado para evitar memory leak.
    PQclear(res);
}
```

Independentemente da linguagem de programação usada na aplicação, o princípio é sempre o mesmo: **nunca construir SQL por concatenação de string com entrada externa**. Em outras linguagens, esse mesmo padrão aparece como _parameterized queries_ (Python/psycopg2, Node/pg, Java/JDBC `PreparedStatement`), sempre com a mesma garantia estrutural de separação entre código e dado.

> **Ponto de reforço conceitual**: prepared statements não são uma camada de "sanitização" ou "filtro de caracteres perigosos" — eles eliminam a própria possibilidade estrutural do ataque, pois o parser SQL do banco nunca reinterpreta o valor do parâmetro como parte da gramática SQL. Isso é fundamentalmente mais robusto do que qualquer tentativa manual de "escapar aspas" ou usar listas de bloqueio de caracteres.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Concatenar entrada de usuário diretamente em uma string SQL, via `sprintf`, `strcat`, f-strings, template literals ou qualquer mecanismo de montagem de string.
2. Confiar em "escapar aspas" manualmente como defesa contra SQL Injection, em vez de usar parametrização real.
3. Usar `OFFSET` para paginação em tabelas muito grandes sem considerar o impacto de performance, ao invés de keyset pagination.
4. Esquecer que `WHERE` filtra linhas antes da agregação e tentar (erroneamente) usar `WHERE` para filtrar o resultado de uma função agregada — o correto é `HAVING`.
5. Usar `CROSS JOIN` sem intenção explícita, resultando em explosão cartesiana de linhas por um `JOIN` mal escrito sem condição de junção.
6. Ignorar `PQclear()` (ou o equivalente de liberação de recursos em outras linguagens) após cada execução de query, causando vazamento de memória em aplicações de longa duração.
7. Validar apenas no lado do cliente (JavaScript/frontend) contra SQL Injection, sem nenhuma proteção correspondente no backend — a validação client-side pode sempre ser contornada.

**Boas práticas:**

1. Adotar Prepared Statements / consultas parametrizadas como **padrão absoluto e não-negociável** em toda a base de código, sem exceções "só desta vez".
2. Tratar qualquer entrada oriunda do usuário (formulários, parâmetros de URL, headers, arquivos) como não confiável por padrão, mesmo que pareça inofensiva.
3. Utilizar CTEs (`WITH`) para decompor consultas complexas em blocos nomeados e legíveis, facilitando manutenção e revisão de código.
4. Medir consultas com `EXPLAIN ANALYZE` (aprofundado no Módulo 8) antes de assumir que uma query com `JOIN`s múltiplos ou `OFFSET` alto terá boa performance em produção.
5. Preferir `UNION ALL` a `UNION` sempre que a deduplicação não for estritamente necessária, evitando o custo computacional extra da remoção de duplicatas.
6. Realizar revisões de código focadas especificamente em pontos de construção dinâmica de SQL, tratando qualquer concatenação de string com SQL como um alerta automático de segurança em code review.
7. Combinar defesa em profundidade: mesmo usando Prepared Statements, aplicar também o Princípio do Menor Privilégio nos roles do banco (Módulo 2), para limitar o dano de qualquer vulnerabilidade que, apesar de tudo, venha a existir.

---
