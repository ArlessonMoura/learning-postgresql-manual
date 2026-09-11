# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 5 — Recursos Avançados do PostgreSQL

> Este módulo apresenta os recursos que diferenciam o PostgreSQL de um SGBD relacional "genérico": Window Functions para análises sofisticadas, JSONB para flexibilidade semiestruturada, Views para abstração, e o controle fino de concorrência via níveis de isolamento transacional.

---

### 5.1 Window Functions

Window Functions calculam um valor para cada linha **considerando um conjunto ("janela") de linhas relacionadas**, sem colapsar o resultado em uma única linha por grupo — diferente de `GROUP BY`, que reduz N linhas a 1 linha por grupo, uma Window Function preserva todas as N linhas originais, apenas anexando uma coluna calculada.

```
   GROUP BY (colapsa linhas)         WINDOW FUNCTION (preserva linhas)
+----+--------+-------+           +----+--------+-------+------------+
| id | grupo  | valor |           | id | grupo  | valor | rank_grupo |
+----+--------+-------+           +----+--------+-------+------------+
                                   | 1  |   A    |  100  |     1      |
     GROUP BY grupo                | 2  |   A    |   80  |     2      |
     resulta em:                   | 3  |   B    |  200  |     1      |
+--------+-----------+             | 4  |   B    |  150  |     2      |
| grupo  | soma_valor|             +----+--------+-------+------------+
+--------+-----------+             (4 linhas de entrada -> 4 de saída,
|   A    |    180    |              cada uma "ciente" do seu grupo)
|   B    |    350    |
+--------+-----------+
```

#### `OVER (PARTITION BY ...)`

A cláusula `OVER` define a "janela" sobre a qual a função opera; `PARTITION BY` divide essa janela em subgrupos (análogo ao `GROUP BY`, mas sem colapsar linhas).

```sql
-- Numera os pedidos de cada cliente, do mais recente ao mais antigo
SELECT
    id,
    cliente_id,
    valor_total,
    criado_em,
    ROW_NUMBER() OVER (PARTITION BY cliente_id ORDER BY criado_em DESC) AS numero_pedido
FROM pedidos;
```

#### `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`

```sql
SELECT
    cliente_id,
    valor_total,
    ROW_NUMBER() OVER (ORDER BY valor_total DESC) AS row_num,
    RANK()       OVER (ORDER BY valor_total DESC) AS rank_,
    DENSE_RANK() OVER (ORDER BY valor_total DESC) AS dense_rank_
FROM pedidos;
```

| Função         | Comportamento com valores empatados                                                                                                               |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROW_NUMBER()` | Sempre atribui números sequenciais distintos, mesmo em empate (a ordem entre empatados é arbitrária, a menos que o `ORDER BY` seja desambiguado). |
| `RANK()`       | Valores empatados recebem o mesmo rank, mas o próximo rank **pula** posições (ex.: 1, 2, 2, 4).                                                   |
| `DENSE_RANK()` | Valores empatados recebem o mesmo rank, e o próximo rank **não pula** posições (ex.: 1, 2, 2, 3).                                                 |

#### `LEAD()` e `LAG()`

Permitem acessar valores de linhas **seguintes** (`LEAD`) ou **anteriores** (`LAG`) dentro da mesma janela, sem precisar de um self-join:

```sql
-- Compara o valor do pedido atual com o pedido anterior do mesmo cliente
SELECT
    cliente_id,
    criado_em,
    valor_total,
    LAG(valor_total)  OVER (PARTITION BY cliente_id ORDER BY criado_em) AS valor_pedido_anterior,
    LEAD(valor_total) OVER (PARTITION BY cliente_id ORDER BY criado_em) AS valor_proximo_pedido
FROM pedidos;
```

Um caso de uso analítico clássico (retomado no projeto do Módulo 8): calcular o **top N por grupo** — por exemplo, os 3 produtos mais vendidos de cada categoria — algo que seria muito mais verboso sem Window Functions:

```sql
WITH ranking_vendas AS (
    SELECT
        categoria_id,
        produto_id,
        SUM(quantidade) AS total_vendido,
        DENSE_RANK() OVER (
            PARTITION BY categoria_id
            ORDER BY SUM(quantidade) DESC
        ) AS posicao
    FROM itens_pedido
    GROUP BY categoria_id, produto_id
)
SELECT * FROM ranking_vendas WHERE posicao <= 3;
```

---

### 5.2 Dados Semiestruturados: JSON e JSONB

O PostgreSQL oferece dois tipos para armazenar JSON:

| Tipo    | Armazenamento                                  | Indexação                                    | Quando usar                                                                                |
| ------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `JSON`  | Texto puro, preserva formatação/ordem original | Não indexável diretamente de forma eficiente | Quando é necessário preservar o JSON exatamente como recebido (ex.: log de payload bruto). |
| `JSONB` | Formato binário decomposto                     | Suporta índices `GIN` de alta performance    | Praticamente todos os outros casos — é o padrão recomendado na indústria.                  |

```sql
CREATE TABLE produtos (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome         VARCHAR(200) NOT NULL,
    atributos    JSONB NOT NULL DEFAULT '{}'::jsonb
);

INSERT INTO produtos (nome, atributos) VALUES
('Camiseta Básica', '{"cor": "azul", "tamanho": "M", "tags": ["algodao", "unissex"]}'),
('Tênis Runner',     '{"cor": "preto", "tamanho": 42, "tags": ["corrida", "leve"]}');
```

#### Operadores principais

```sql
-- -> retorna o valor como JSONB (mantém a estrutura JSON)
SELECT atributos -> 'cor' FROM produtos;             -- "azul" (com aspas, é JSONB)

-- ->> retorna o valor como TEXTO puro
SELECT atributos ->> 'cor' FROM produtos;            -- azul (sem aspas, é TEXT)

-- @> verifica se o JSONB da esquerda "contém" o JSONB da direita
SELECT nome FROM produtos
WHERE atributos @> '{"cor": "azul"}'::jsonb;

-- Acessando elementos de um array dentro do JSONB
SELECT nome FROM produtos
WHERE atributos -> 'tags' @> '["corrida"]'::jsonb;
```

#### Indexação eficiente com GIN

```sql
-- Índice GIN permite buscas por operador @> em alta performance,
-- mesmo com milhões de linhas -- sem ele, cada consulta faria
-- uma varredura completa (sequential scan) na tabela.
CREATE INDEX idx_produtos_atributos ON produtos USING GIN (atributos);
```

Isso demonstra, na prática, o conceito discutido no Módulo 1: dados semiestruturados (variação livre de atributos por produto) convivem, na mesma tabela relacional, com colunas estritamente tipadas (`id`, `nome`), sem exigir a adoção de um banco NoSQL dedicado.

---

### 5.3 Views e Materialized Views

#### Views (visões)

Uma **View** é uma consulta salva, que se comporta como uma tabela virtual — ela **não armazena dados**, apenas encapsula uma consulta que é reexecutada a cada acesso.

```sql
CREATE VIEW vw_pedidos_pagos AS
SELECT p.id, c.nome AS cliente, p.valor_total, p.criado_em
FROM pedidos p
JOIN clientes c ON c.id = p.cliente_id
WHERE p.status = 'pago';

-- Uso: consultada como se fosse uma tabela normal
SELECT * FROM vw_pedidos_pagos WHERE valor_total > 200;
```

Vantagens: simplifica consultas complexas recorrentes, permite expor um subconjunto controlado de colunas/linhas para determinados roles (uma técnica de segurança por si só), e centraliza a lógica de negócio de leitura em um único lugar.

#### Materialized Views

Uma **Materialized View** executa a consulta **uma vez** e **armazena fisicamente o resultado em disco**, como uma tabela real — leituras subsequentes são extremamente rápidas, pois não recalculam a consulta original, ao custo de os dados poderem ficar desatualizados até a próxima atualização manual.

```sql
CREATE MATERIALIZED VIEW mv_vendas_por_categoria AS
SELECT
    categoria_id,
    SUM(quantidade)      AS total_unidades,
    SUM(valor_total)     AS total_faturado
FROM itens_pedido
GROUP BY categoria_id;

-- Criar um índice único é pré-requisito para o REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_mv_vendas_categoria ON mv_vendas_por_categoria (categoria_id);
```

#### Estratégias de `REFRESH`

```sql
-- Refresh padrão: bloqueia leituras concorrentes na view durante a
-- atualização (a view fica indisponível por um instante)
REFRESH MATERIALIZED VIEW mv_vendas_por_categoria;

-- Refresh concorrente: permite leituras durante a atualização,
-- mas EXIGE um índice único previamente criado na view
REFRESH MATERIALIZED VIEW CONCURRENTLY mv_vendas_por_categoria;
```

`REFRESH MATERIALIZED VIEW CONCURRENTLY` exige um índice `UNIQUE` adequado (sem predicado `WHERE`) e não pode ser executado dentro de um bloco de transação explícito.

A escolha entre View e Materialized View é, essencialmente, um trade-off entre **atualidade do dado** (View: sempre atual) e **velocidade de leitura** (Materialized View: instantânea, porém potencialmente desatualizada) — típico de cenários analíticos (dashboards, relatórios) onde uma pequena defasagem (ex.: atualizar a cada hora via job agendado) é aceitável em troca de performance.

---

### 5.4 Transações e Isolamento

#### `BEGIN`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`

```sql
BEGIN;

UPDATE contas SET saldo = saldo - 100 WHERE id = 1;
UPDATE contas SET saldo = saldo + 100 WHERE id = 2;

-- Se ambas as operações forem bem-sucedidas:
COMMIT;

-- Se algo der errado no meio do caminho:
-- ROLLBACK;
```

`SAVEPOINT` permite desfazer **parcialmente** uma transação, sem abortar tudo:

```sql
BEGIN;

INSERT INTO pedidos (cliente_id, valor_total) VALUES (1, 250.00);

SAVEPOINT antes_do_desconto;

UPDATE pedidos SET valor_total = valor_total * 0.5 WHERE cliente_id = 1;

-- Percebemos que o desconto foi aplicado incorretamente:
ROLLBACK TO SAVEPOINT antes_do_desconto;

-- A transação continua ativa, com o INSERT ainda válido,
-- mas o UPDATE do desconto foi desfeito.
COMMIT;
```

#### Níveis de Isolamento

O padrão SQL define quatro níveis de isolamento, que controlam o quanto uma transação pode "enxergar" de mudanças feitas por outras transações concorrentes ainda não finalizadas:

```
   Menos isolamento                                    Mais isolamento
   (mais performance,                                (mais garantias,
    mais anomalias)                                   menos concorrência)
   <-----------------------------------------------------------------
   Read Uncommitted -- Read Committed -- Repeatable Read -- Serializable
```

> **Nota específica do PostgreSQL**: o PostgreSQL não implementa `Read Uncommitted` de fato — mesmo solicitando esse nível, o comportamento observado é equivalente a `Read Committed`, pois o MVCC do PostgreSQL (aprofundado no Módulo 7) nunca expõe dados de transações não confirmadas a outras sessões.

| Nível                       | Anomalia evitada                                                         | Comportamento no PostgreSQL                                                                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read Committed** (padrão) | Dirty Read                                                               | Cada instrução `SELECT` dentro da transação enxerga o estado dos dados **confirmado no momento daquela instrução específica** — instruções diferentes na mesma transação podem ver dados diferentes se houver commits concorrentes entre elas.                                                                |
| **Repeatable Read**         | Dirty Read + Non-Repeatable Read                                         | Toda a transação enxerga uma "fotografia" (snapshot) única, estabelecida na primeira instrução relevante da transação — múltiplos `SELECT`s da mesma linha sempre retornam o mesmo resultado dentro da transação, mesmo que outras transações façam commits nesse meio-tempo.                                 |
| **Serializable**            | Todas as anomalias, incluindo _Phantom Read_ e anomalias de serialização | Garante que o resultado de transações concorrentes seja equivalente a alguma execução serial (uma de cada vez) das mesmas transações — implementado via detecção de conflitos (SSI - Serializable Snapshot Isolation), podendo abortar uma transação com erro de serialização, exigindo retry pela aplicação. |

```sql
-- Definindo o nível de isolamento explicitamente para uma transação
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
    SELECT saldo FROM contas WHERE id = 1;
    -- ... outras operações que dependem desse snapshot consistente ...
COMMIT;
```

**Cenário prático de concorrência**: em `Read Committed`, duas transações concorrentes tentando decrementar o mesmo estoque podem, em teoria, ambas lerem "10 unidades disponíveis" e ambas decidirem prosseguir com a venda, gerando uma condição de corrida caso a lógica de verificação e decremento não esteja atomizada corretamente (ex.: via `UPDATE ... WHERE quantidade >= X` em uma única instrução, que é atômica por natureza no PostgreSQL, ou via `SELECT ... FOR UPDATE` para bloquear a linha explicitamente até o fim da transação).

```sql
-- Lock explícito de linha, evitando que outra transação concorrente
-- leia (para fins de decisão) a mesma linha até este COMMIT/ROLLBACK
BEGIN;
SELECT quantidade FROM estoque WHERE produto_id = 5 FOR UPDATE;
-- ... lógica de decisão da aplicação ...
UPDATE estoque SET quantidade = quantidade - 1 WHERE produto_id = 5;
COMMIT;
```

`FOR UPDATE` bloqueia operações concorrentes de atualização ou de locking da mesma linha até o fim da transação; um `SELECT` comum ainda pode ler uma versão visível pelo MVCC.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Usar `GROUP BY` quando o objetivo real é uma Window Function, perdendo o acesso às linhas individuais desnecessariamente.
2. Escolher o tipo `JSON` em vez de `JSONB` por hábito ou desconhecimento, perdendo a possibilidade de indexação eficiente via `GIN`.
3. Abusar de colunas `JSONB` para modelar dados que são, na verdade, claramente relacionais e estáveis — reintroduzindo, sem necessidade, os mesmos problemas que a normalização resolve.
4. Tratar uma Materialized View como se fosse sempre atual, sem um mecanismo de `REFRESH` agendado, apresentando dados obsoletos a usuários finais sem aviso.
5. Rodar `REFRESH MATERIALIZED VIEW` (sem `CONCURRENTLY`) em produção durante horário de pico, bloqueando leituras da view por segundos ou minutos.
6. Ignorar condições de corrida em lógica de "verificar depois agir" (ex.: checar estoque e só depois decrementar em instruções separadas), especialmente sob `Read Committed`.
7. Assumir, incorretamente, que `Serializable` é sempre a escolha "mais segura e correta" sem considerar o custo de performance e a necessidade de lógica de retry na aplicação para lidar com abortos de serialização.

**Boas práticas:**

1. Preferir Window Functions a soluções baseadas em self-joins ou subconsultas correlacionadas para cálculos de ranking, comparação com linha anterior/seguinte, e agregações "por grupo, mas linha a linha".
2. Adotar `JSONB` como padrão para dados semiestruturados, reservando `JSON` puro apenas para casos que exijam preservar o payload textual original exatamente como recebido.
3. Criar índices `GIN` em colunas `JSONB` sempre que houver filtros frequentes com `@>` ou operadores de contenção.
4. Definir explicitamente e documentar a política de atualização de cada Materialized View (frequência do `REFRESH`, se é `CONCURRENTLY`, se está atrelada a um job agendado).
5. Envolver operações financeiras/de estoque sensíveis em transações explícitas, usando `SELECT ... FOR UPDATE` ou instruções atômicas (`UPDATE ... WHERE condição`) para evitar condições de corrida.
6. Escolher o nível de isolamento com base na anomalia real que precisa ser evitada no caso de uso específico, em vez de aplicar `Serializable` genericamente "por segurança", e implementar lógica de retry na aplicação quando usar `Serializable`.
7. Usar `SAVEPOINT` para lógica transacional complexa com múltiplas etapas que podem falhar independentemente, evitando descartar uma transação inteira por causa de uma única etapa recuperável.

---

_Fim do Módulo 5. Aguardando confirmação para prosseguir ao Módulo 6 — Programação no Banco e Integração com C._
