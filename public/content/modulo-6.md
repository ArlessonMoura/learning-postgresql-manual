# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 6 — Programação no Banco e Integração com C

> Este módulo tem duas metades complementares: primeiro, como escrever lógica _dentro_ do PostgreSQL usando PL/pgSQL e Triggers; depois, como uma aplicação externa em C se conecta e conversa com o banco através da `libpq`, encerrando o ciclo entre "lógica no banco" e "lógica na aplicação" discutido desde o Módulo 1.

---

### 6.1 PL/pgSQL — Programação Procedural no Banco

**PL/pgSQL** é a linguagem procedural nativa do PostgreSQL, uma extensão do SQL com estruturas de controle (`IF`, `LOOP`), variáveis, e tratamento de exceções — permitindo escrever lógica que seria difícil ou impossível de expressar em SQL puro.

#### Funções

```sql
-- Função que calcula o valor total de um pedido, aplicando desconto
-- percentual, e retorna o valor final.
CREATE OR REPLACE FUNCTION calcular_valor_com_desconto(
    p_valor_original NUMERIC,
    p_percentual_desconto NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
AS $$
DECLARE
    v_valor_final NUMERIC;
BEGIN
    IF p_percentual_desconto < 0 OR p_percentual_desconto > 100 THEN
        RAISE EXCEPTION 'Percentual de desconto inválido: %', p_percentual_desconto;
    END IF;

    v_valor_final := p_valor_original * (1 - p_percentual_desconto / 100);

    RETURN ROUND(v_valor_final, 2);
END;
$$;

-- Uso da função em uma consulta comum
SELECT calcular_valor_com_desconto(200.00, 15);  -- retorna 170.00
```

#### Stored Procedures

Diferente de funções, **Procedures** (introduzidas formalmente no PostgreSQL 11) podem conter controle transacional interno (`COMMIT`/`ROLLBACK` dentro do próprio corpo), desde que o `CALL` não esteja dentro de um bloco de transação explícito, e são invocadas via `CALL`, não `SELECT`:

```sql
CREATE OR REPLACE PROCEDURE processar_pagamento_pedido(
    p_pedido_id BIGINT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_valor NUMERIC;
BEGIN
    SELECT valor_total INTO v_valor
    FROM pedidos
    WHERE id = p_pedido_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pedido % não encontrado', p_pedido_id;
    END IF;

    UPDATE pedidos SET status = 'pago' WHERE id = p_pedido_id;

    INSERT INTO log_pagamentos (pedido_id, valor, processado_em)
    VALUES (p_pedido_id, v_valor, NOW());

    COMMIT;  -- válido dentro de uma PROCEDURE, não de uma FUNCTION
END;
$$;

CALL processar_pagamento_pedido(42);
```

#### Variáveis e Estruturas de Controle

```sql
CREATE OR REPLACE FUNCTION classificar_cliente(p_cliente_id BIGINT)
RETURNS VARCHAR
LANGUAGE plpgsql
AS $$
DECLARE
    v_total_gasto NUMERIC;
    v_classificacao VARCHAR(20);
BEGIN
    SELECT COALESCE(SUM(valor_total), 0) INTO v_total_gasto
    FROM pedidos
    WHERE cliente_id = p_cliente_id AND status = 'pago';

    -- Estrutura condicional
    IF v_total_gasto >= 5000 THEN
        v_classificacao := 'Diamante';
    ELSIF v_total_gasto >= 1000 THEN
        v_classificacao := 'Ouro';
    ELSIF v_total_gasto >= 200 THEN
        v_classificacao := 'Prata';
    ELSE
        v_classificacao := 'Bronze';
    END IF;

    RETURN v_classificacao;
END;
$$;
```

```sql
-- Estruturas de repetição (LOOP, WHILE, FOR)
CREATE OR REPLACE FUNCTION gerar_relatorio_mensal(p_ano INT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_mes INT;
BEGIN
    FOR v_mes IN 1..12 LOOP
        INSERT INTO relatorios_mensais (ano, mes, gerado_em)
        VALUES (p_ano, v_mes, NOW());
    END LOOP;
END;
$$;
```

#### Tratamento de Exceções

```sql
CREATE OR REPLACE FUNCTION transferir_saldo(
    p_conta_origem BIGINT,
    p_conta_destino BIGINT,
    p_valor NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE contas SET saldo = saldo - p_valor WHERE id = p_conta_origem;
    UPDATE contas SET saldo = saldo + p_valor WHERE id = p_conta_destino;

EXCEPTION
    WHEN check_violation THEN
        -- Disparado, por exemplo, se um CHECK (saldo >= 0) for violado
        RAISE EXCEPTION 'Saldo insuficiente na conta %', p_conta_origem;
    WHEN OTHERS THEN
        -- Captura qualquer outra exceção não tratada explicitamente
        RAISE EXCEPTION 'Erro inesperado na transferência: %', SQLERRM;
END;
$$;
```

> Todo o corpo de uma função PL/pgSQL executa implicitamente dentro de uma transação — se uma exceção não for capturada, **todas** as alterações feitas até aquele ponto dentro da função são revertidas automaticamente, preservando a Atomicidade (Módulo 1) mesmo em lógica procedural complexa.

---

### 6.2 Triggers

Uma **Trigger** (gatilho) é uma função especial que o PostgreSQL executa **automaticamente** em resposta a um evento (`INSERT`, `UPDATE`, `DELETE`) em uma tabela específica — útil para automação de auditoria e validações complexas que não cabem confortavelmente em uma `CHECK` constraint simples.

```
   Evento na tabela              Trigger disparada         Ação automática
+-------------------+          +------------------+      +------------------+
| UPDATE estoque     | ------> | trg_auditoria_    | ---> | INSERT em         |
| SET quantidade=... |         | estoque            |      | log_auditoria      |
+-------------------+          +------------------+      +------------------+
```

#### Trigger de auditoria

```sql
-- 1. Tabela que armazenará o histórico de alterações
CREATE TABLE log_auditoria_estoque (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    produto_id      BIGINT NOT NULL,
    quantidade_antes INT NOT NULL,
    quantidade_depois INT NOT NULL,
    alterado_em     TIMESTAMP NOT NULL DEFAULT NOW(),
    alterado_por    VARCHAR(100) NOT NULL DEFAULT CURRENT_USER
);

-- 2. Função que será executada pela trigger
CREATE OR REPLACE FUNCTION fn_auditoria_estoque()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- OLD representa a linha ANTES da alteração;
    -- NEW representa a linha DEPOIS da alteração (apenas em UPDATE/INSERT)
    INSERT INTO log_auditoria_estoque (produto_id, quantidade_antes, quantidade_depois)
    VALUES (OLD.produto_id, OLD.quantidade, NEW.quantidade);

    RETURN NEW;  -- em triggers BEFORE, o valor retornado é o que será gravado
END;
$$;

-- 3. Vinculação da trigger à tabela e ao evento
CREATE TRIGGER trg_auditoria_estoque
AFTER UPDATE OF quantidade ON estoque
FOR EACH ROW
WHEN (OLD.quantidade IS DISTINCT FROM NEW.quantidade)
EXECUTE FUNCTION fn_auditoria_estoque();
```

#### Trigger de validação complexa

```sql
-- Impede reduzir o estoque abaixo de zero, com uma mensagem de erro
-- de negócio clara -- algo que um simples CHECK também poderia fazer,
-- mas aqui ilustrado como trigger para permitir lógica adicional
-- (ex.: notificar um serviço externo, registrar tentativa de venda).
CREATE OR REPLACE FUNCTION fn_valida_estoque_suficiente()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.quantidade < 0 THEN
        RAISE EXCEPTION 'Operação recusada: estoque do produto % ficaria negativo (%).',
            NEW.produto_id, NEW.quantidade;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_valida_estoque
BEFORE UPDATE OF quantidade ON estoque
FOR EACH ROW
EXECUTE FUNCTION fn_valida_estoque_suficiente();
```

`BEFORE` permite que a trigger **modifique ou rejeite** a operação antes que ela seja efetivada; `AFTER` é usada quando a operação já deve ter ocorrido e a trigger apenas reage a ela (como no exemplo de auditoria acima).

---

### 6.3 Integração C + PostgreSQL via libpq

A `libpq` é a biblioteca cliente oficial e nativa em C para comunicação com o PostgreSQL — todos os outros drivers (Python, Java, Node.js) eventualmente se apoiam em bibliotecas de mais baixo nível análogas, mas em C, `libpq` é usada diretamente.

#### Ciclo de vida de uma conexão

```
  PQconnectdb()  -->  PQstatus() == CONNECTION_OK ?  -->  PQexecParams() (N vezes)  -->  PQfinish()
     (abre)              (verifica sucesso)                 (executa queries)           (fecha)
```

#### `PQconnectdb` — conectando ao banco

```c
#include <stdio.h>
#include <stdlib.h>
#include <libpq-fe.h>

PGconn *conectar_banco(void) {
    // String de conexão no formato "chave=valor" (conninfo string)
    const char *conninfo =
        "host=localhost port=5432 dbname=app_db "
        "user=app_user password=senha_forte_da_aplicacao";

    PGconn *conn = PQconnectdb(conninfo);

    // SEMPRE verificar o status da conexão antes de usá-la
    if (PQstatus(conn) != CONNECTION_OK) {
        fprintf(stderr, "Falha ao conectar: %s\n", PQerrorMessage(conn));
        PQfinish(conn);
        return NULL;
    }

    return conn;
}
```

> **Boa prática de segurança**: nunca hardcode a senha diretamente na string de conexão em código versionado. Em produção, a `conninfo` deve ser montada a partir de variáveis de ambiente ou de um gerenciador de segredos (ex.: `getenv("DB_PASSWORD")`), nunca de um literal no código-fonte.

#### `PQexecParams` — executando consultas parametrizadas

Retomando diretamente o Módulo 4: toda interação com dados vindos do "mundo exterior" (usuário, arquivo, rede) **deve** usar consultas parametrizadas, como `PQexecParams`, nunca concatenação manual de string. Para prepared statements nomeados e reutilizáveis, a `libpq` oferece `PQprepare` e `PQexecPrepared`.

```c
/*
 * Insere um novo cliente, retornando o ID gerado.
 * Totalmente protegido contra SQL Injection via parametrização.
 */
int inserir_cliente(PGconn *conn, const char *nome, const char *email) {
    const char *query =
        "INSERT INTO clientes (nome, email) VALUES ($1, $2) RETURNING id;";

    const char *valores[2] = { nome, email };

    PGresult *res = PQexecParams(
        conn,
        query,
        2,          // número de parâmetros ($1 e $2)
        NULL,       // tipos inferidos automaticamente pelo servidor
        valores,    // array de valores como strings de texto
        NULL,       // tamanhos (irrelevante em formato texto)
        NULL,       // formatos (NULL = todos em texto)
        0           // resultado também em formato texto
    );

    if (res == NULL || PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro ao inserir cliente: %s\n", PQerrorMessage(conn));
        PQclear(res);   // libera memória mesmo em caso de erro
        return -1;
    }

    int novo_id = atoi(PQgetvalue(res, 0, 0));  // conversão string -> int

    PQclear(res);  // OBRIGATÓRIO: libera a memória alocada pelo resultado
    return novo_id;
}
```

```c
/*
 * Consulta clientes por status ativo/inativo, iterando sobre
 * o conjunto de resultados retornado.
 */
void listar_clientes_por_status(PGconn *conn, int ativo) {
    const char *query =
        "SELECT id, nome, email FROM clientes WHERE ativo = $1;";

    // Mesmo um BOOLEAN é enviado como string em formato texto: "t" ou "f"
    const char *valor_ativo = ativo ? "t" : "f";
    const char *valores[1] = { valor_ativo };

    PGresult *res = PQexecParams(conn, query, 1, NULL, valores, NULL, NULL, 0);

    if (res == NULL || PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro na consulta: %s\n", PQerrorMessage(conn));
        PQclear(res);
        return;
    }

    int total_linhas = PQntuples(res);
    int total_colunas = PQnfields(res);

    for (int linha = 0; linha < total_linhas; linha++) {
        for (int coluna = 0; coluna < total_colunas; coluna++) {
            printf("%s: %s  ", PQfname(res, coluna), PQgetvalue(res, linha, coluna));
        }
        printf("\n");
    }

    PQclear(res);
}
```

#### `PQclear` — evitando memory leaks

Todo `PGresult *` retornado por `PQexec`/`PQexecParams` aloca memória dinamicamente, que **não é liberada automaticamente**. É responsabilidade explícita do programador chamar `PQclear()` em **todo** caminho de execução — incluindo os de erro, como demonstrado nos exemplos acima.

```c
/*
 * ❌ PADRÃO COM MEMORY LEAK -- NÃO REPRODUZIR
 * Se PQresultStatus falhar, a função retorna sem nunca
 * chamar PQclear(), vazando memória a cada chamada.
 */
void exemplo_com_leak(PGconn *conn) {
    PGresult *res = PQexec(conn, "SELECT * FROM clientes;");
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro: %s\n", PQerrorMessage(conn));
        return;  // <-- PQclear(res) NUNCA é chamado neste caminho
    }
    PQclear(res);
}
```

```c
/*
 * ✅ PADRÃO CORRETO -- PQclear chamado em TODOS os caminhos
 */
void exemplo_sem_leak(PGconn *conn) {
    PGresult *res = PQexec(conn, "SELECT * FROM clientes;");
    if (PQresultStatus(res) != PGRES_TUPLES_OK) {
        fprintf(stderr, "Erro: %s\n", PQerrorMessage(conn));
        PQclear(res);   // liberado mesmo no caminho de erro
        return;
    }
    PQclear(res);
}
```

**Nota técnica (C)**: em aplicações C de longa duração (servidores que processam milhares de requisições), esquecer `PQclear()` em um caminho de erro pouco exercitado durante testes é uma das causas mais comuns e mais difíceis de diagnosticar de vazamento de memória gradual em produção — o processo cresce lentamente em uso de RAM até ser encerrado pelo sistema operacional (OOM killer em Linux), muitas vezes dias depois do deploy, dificultando a correlação com a mudança de código que introduziu o bug.

#### Encerrando a conexão

```c
void encerrar_conexao(PGconn *conn) {
    if (conn != NULL) {
        PQfinish(conn);  // fecha a conexão de rede e libera toda a estrutura PGconn
    }
}
```

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Colocar `COMMIT`/`ROLLBACK` dentro de uma `FUNCTION` (permitido apenas em `PROCEDURE`), gerando erro de execução.
2. Não usar `WHEN OTHERS` (ou tratar exceções de forma genérica demais), mascarando a causa raiz real de um erro em produção.
3. Criar triggers `BEFORE` que não retornam `NEW` corretamente, fazendo com que a operação original seja silenciosamente cancelada ou corrompida.
4. Adicionar lógica de negócio pesada e cara (ex.: chamadas de rede) dentro de triggers, tornando operações simples de `INSERT`/`UPDATE` inesperadamente lentas.
5. Esquecer `PQclear()` em caminhos de erro, introduzindo vazamentos de memória graduais e difíceis de depurar em aplicações C de longa duração.
6. Hardcodar credenciais de conexão (usuário/senha) diretamente na string `conninfo` do código-fonte versionado.
7. Não verificar `PQstatus()` logo após `PQconnectdb()`, assumindo que a conexão sempre é bem-sucedida e causando falhas obscuras em chamadas subsequentes.

**Boas práticas:**

1. Usar `FUNCTION` para lógica que retorna um valor e é usada dentro de consultas; usar `PROCEDURE` para lógica de orquestração com controle transacional próprio, invocada via `CALL`.
2. Capturar exceções específicas (`check_violation`, `unique_violation`, `foreign_key_violation`) sempre que a lógica de negócio precisar reagir de forma diferente a cada tipo de falha, reservando `WHEN OTHERS` como rede de segurança final.
3. Manter triggers enxutas e rápidas, delegando processamento pesado a filas assíncronas ou jobs externos sempre que possível.
4. Nomear triggers e funções de trigger de forma consistente (ex.: prefixo `trg_` para triggers, `fn_` para funções), facilitando auditoria do schema.
5. Centralizar a lógica de conexão e desconexão da `libpq` em funções utilitárias reutilizáveis, garantindo que `PQfinish()` e `PQclear()` sejam sempre chamados de forma consistente em toda a base de código.
6. Carregar credenciais de conexão exclusivamente de variáveis de ambiente ou de um gerenciador de segredos, nunca de literais no código-fonte.
7. Envolver toda a lógica de acesso a dados em C com verificação explícita de cada retorno de função da `libpq` (`PQstatus`, `PQresultStatus`), tratando falhas de forma previsível em vez de assumir o caminho feliz.

---

_Fim do Módulo 6. Aguardando confirmação para prosseguir ao Módulo 7 — Performance, Indexação e Manutenção._
