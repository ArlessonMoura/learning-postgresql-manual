# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 3 — DDL e DML: Manipulação Fundamental de Dados

> A partir deste módulo, o manual passa a apresentar código funcional. Todo SQL aqui é executável em uma instância PostgreSQL padrão (versão 13+). Notas técnicas em C aparecem destacadas, sem interromper o fluxo conceitual principal.

---

### 3.1 DDL — Data Definition Language

DDL é o subconjunto de comandos SQL responsável por definir e alterar a **estrutura** dos objetos do banco (tabelas, tipos, índices), e não os dados em si.

#### `CREATE` — criando estruturas

```sql
-- Criação de uma tabela simples, já com boas práticas de tipos e constraints
CREATE TABLE clientes (
    id            SERIAL PRIMARY KEY,
    nome          VARCHAR(150) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    data_cadastro TIMESTAMP NOT NULL DEFAULT NOW(),
    ativo         BOOLEAN NOT NULL DEFAULT TRUE
);
```

`SERIAL` é um "açúcar sintático" do PostgreSQL: cria automaticamente uma sequência (`SEQUENCE`) e vincula seu próximo valor como padrão da coluna, sendo historicamente o mecanismo de auto-incremento mais usado. Em versões modernas (10+), a alternativa recomendada pelo padrão SQL é:

```sql
CREATE TABLE clientes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- ... demais colunas
);
```

`GENERATED ALWAYS AS IDENTITY` é preferível em projetos novos por ser padrão ANSI SQL (portável entre bancos) e por impedir, por padrão, que a aplicação insira manualmente um valor conflitante na coluna.

#### `ALTER` — modificando estruturas existentes

```sql
-- Adicionar uma nova coluna
ALTER TABLE clientes ADD COLUMN telefone VARCHAR(20);

-- Alterar o tipo de uma coluna existente
ALTER TABLE clientes ALTER COLUMN nome TYPE VARCHAR(200);

-- Adicionar uma constraint a uma tabela já existente
ALTER TABLE clientes ADD CONSTRAINT chk_telefone_formato
    CHECK (telefone ~ '^\+?[0-9]{8,15}$');

-- Renomear uma coluna
ALTER TABLE clientes RENAME COLUMN telefone TO celular;

-- Remover uma coluna
ALTER TABLE clientes DROP COLUMN celular;
```

#### `DROP` — removendo estruturas

```sql
-- Remove a tabela e todos os seus dados permanentemente
DROP TABLE clientes;

-- Evita erro caso o objeto não exista (útil em scripts idempotentes)
DROP TABLE IF EXISTS clientes;

-- Remove a tabela e QUALQUER objeto dependente (views, FKs de outras tabelas)
DROP TABLE clientes CASCADE;
```

> **Atenção**: `DROP TABLE ... CASCADE` remove silenciosamente objetos dependentes (como views que consultam essa tabela, ou chaves estrangeiras de outras tabelas apontando para ela). Use com extrema cautela em produção, e nunca sem antes revisar as dependências com `\d+ nome_tabela` no `psql`.

#### `TRUNCATE` — esvaziando uma tabela rapidamente

```sql
-- Remove TODAS as linhas da tabela, mas mantém a estrutura
TRUNCATE TABLE pedidos;

-- Reinicia também os contadores de SERIAL/IDENTITY associados
TRUNCATE TABLE pedidos RESTART IDENTITY;
```

`TRUNCATE` difere de `DELETE FROM tabela` (sem `WHERE`) de forma importante: `TRUNCATE` não varre linha por linha (não dispara triggers `ROW`-level, por padrão) e desaloca as páginas de disco imediatamente, sendo ordens de magnitude mais rápido em tabelas grandes — mas, por outro lado, exige um lock exclusivo na tabela.

#### Mapeamento de tipos: PostgreSQL ↔ C

Esta tabela é a referência que será usada em todos os exemplos práticos de integração com `libpq` (Módulos 6 e 8):

| Tipo PostgreSQL             | Tipo C equivalente (via libpq)                                     | Observação                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INTEGER` / `INT`           | `int` (32 bits)                                                    | Mapeamento direto de tamanho em praticamente todas as plataformas comuns.                                                                                                                                      |
| `BIGINT`                    | `long long` (64 bits)                                              | Necessário em plataformas onde `long` é apenas 32 bits (ex.: Windows).                                                                                                                                         |
| `SMALLINT`                  | `short` (16 bits)                                                  | Útil para enums numéricos pequenos, economizando espaço em disco.                                                                                                                                              |
| `VARCHAR(n)` / `TEXT`       | `char[]` / `char *`                                                | libpq sempre retorna resultados como **strings de texto** (a menos que se use o formato binário), exigindo `atoi`/`atof`/`strtol` para conversão manual.                                                       |
| `NUMERIC(p,s)`              | _nenhum tipo primitivo direto_ — `double`/`float` são aproximações | `NUMERIC` é de precisão arbitrária/exata (decimal), enquanto `float`/`double` em C são de ponto flutuante binário (IEEE 754) — usar `float`/`double` para valores monetários introduz erros de arredondamento. |
| `BOOLEAN`                   | `bool` (via `<stdbool.h>`) ou `int`                                | libpq retorna `"t"` ou `"f"` como string; a conversão para `bool` é manual.                                                                                                                                    |
| `UUID`                      | `char[37]` (36 caracteres + `\0`)                                  | Não existe tipo nativo de 128 bits diretamente mapeável sem bibliotecas extras; geralmente tratado como string formatada.                                                                                      |
| `TIMESTAMP` / `TIMESTAMPTZ` | `char[]` (formato ISO 8601) ou `struct tm` (após parsing)          | libpq retorna como texto; conversão para `struct tm` requer `strptime()`.                                                                                                                                      |

**Nota técnica (C)**: a diferença entre `NUMERIC` e `float`/`double` merece destaque especial. `NUMERIC` no PostgreSQL é armazenado internamente como uma sequência de dígitos decimais (não como potências de 2), garantindo que `0.1 + 0.2` resulte exatamente em `0.3` — o que **não** acontece com `float`/`double` em C, que representam frações decimais como aproximações binárias. Para qualquer valor monetário ou financeiro, `NUMERIC` no banco é a escolha correta, e, do lado C, a conversão correta é para uma biblioteca de precisão decimal (ou, no mínimo, para inteiros representando centavos), nunca diretamente para `float`/`double`.

---

### 3.2 DML — Data Manipulation Language

DML é o subconjunto de comandos responsável por manipular os **dados** dentro das estruturas já existentes.

#### `INSERT`

```sql
-- Inserção simples
INSERT INTO clientes (nome, email)
VALUES ('Maria Silva', 'maria.silva@email.com');

-- Inserção múltipla em uma única instrução (mais eficiente que
-- múltiplos INSERTs individuais, pois reduz o overhead de round-trips)
INSERT INTO clientes (nome, email) VALUES
    ('João Souza', 'joao.souza@email.com'),
    ('Ana Costa', 'ana.costa@email.com');

-- Inserção retornando a linha inserida (útil para obter o ID gerado
-- sem uma segunda consulta)
INSERT INTO clientes (nome, email)
VALUES ('Pedro Lima', 'pedro.lima@email.com')
RETURNING id, data_cadastro;
```

#### `UPDATE`

```sql
-- Atualização com filtro -- SEMPRE use WHERE, a menos que a
-- intenção seja realmente atualizar todas as linhas da tabela
UPDATE clientes
SET ativo = FALSE
WHERE id = 3;

-- Atualização de múltiplas colunas, com base em uma expressão
UPDATE clientes
SET nome = UPPER(nome),
    data_cadastro = NOW()
WHERE email = 'maria.silva@email.com';
```

#### `DELETE`

```sql
-- Remoção com filtro
DELETE FROM clientes WHERE ativo = FALSE;

-- Remoção retornando as linhas removidas (útil para auditoria/log)
DELETE FROM clientes
WHERE data_cadastro < NOW() - INTERVAL '5 years'
RETURNING id, nome;
```

> **Boa prática crítica**: `UPDATE` e `DELETE` sem `WHERE` afetam **100% das linhas da tabela**. É extremamente recomendado, em ambientes de produção, sempre iniciar validando o filtro com um `SELECT` equivalente antes de rodar o `UPDATE`/`DELETE` real, e considerar rodar dentro de uma transação explícita (`BEGIN` ... `COMMIT`) para poder reverter em caso de erro (tema aprofundado no Módulo 5).

#### `UPSERT` — `INSERT ... ON CONFLICT`

O PostgreSQL não usa a sintaxe `MERGE`/`UPSERT` tradicional de outros bancos (embora tenha adicionado suporte a `MERGE` em versões recentes); seu idioma nativo e mais usado é `INSERT ... ON CONFLICT`:

```sql
-- Se o email já existir (conflito com a constraint UNIQUE),
-- atualiza o nome em vez de falhar com erro de duplicidade
INSERT INTO clientes (nome, email)
VALUES ('Maria Silva Santos', 'maria.silva@email.com')
ON CONFLICT (email)
DO UPDATE SET nome = EXCLUDED.nome;

-- Se o email já existir, simplesmente ignora a nova inserção
INSERT INTO clientes (nome, email)
VALUES ('Maria Silva', 'maria.silva@email.com')
ON CONFLICT (email) DO NOTHING;
```

O pseudo-registro `EXCLUDED` representa a linha que **tentou** ser inserida e entrou em conflito — permitindo referenciar seus valores na cláusula `DO UPDATE` de forma expressiva, sem repetir os literais originais do `INSERT`.

---

### 3.3 Constraints — Restrições de Integridade

Constraints são a forma do banco de dados **impor regras de negócio ao nível de dado**, funcionando como a última linha de defesa contra dados inválidos, independentemente de qual aplicação (ou bug de aplicação) esteja inserindo os dados.

```sql
CREATE TABLE pedidos (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id    BIGINT NOT NULL
                  REFERENCES clientes(id) ON DELETE CASCADE,
    valor_total   NUMERIC(10,2) NOT NULL CHECK (valor_total >= 0),
    status        VARCHAR(20) NOT NULL DEFAULT 'pendente'
                  CHECK (status IN ('pendente', 'pago', 'cancelado')),
    cupom_codigo  VARCHAR(30) UNIQUE,
    criado_em     TIMESTAMP NOT NULL DEFAULT NOW()
);
```

| Constraint                   | Função                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `NOT NULL`                   | Impede que a coluna receba valor nulo.                                                 |
| `UNIQUE`                     | Impede valores duplicados na coluna (ou conjunto de colunas).                          |
| `CHECK (expressão)`          | Impede que a linha seja inserida/atualizada se a expressão booleana resultar em falso. |
| `DEFAULT valor`              | Define um valor automático quando nenhum é fornecido explicitamente no `INSERT`.       |
| `FOREIGN KEY ... REFERENCES` | Garante integridade referencial: o valor deve existir na tabela/coluna referenciada.   |

#### Ações de `FOREIGN KEY`: `CASCADE`, `RESTRICT`, `SET NULL`

Essas cláusulas definem o que acontece com as linhas **filhas** quando a linha **pai** referenciada é excluída (`ON DELETE`) ou atualizada (`ON UPDATE`):

```
   Tabela "clientes" (pai)              Tabela "pedidos" (filha)
+----+---------+              +----+-------------+
| id |  nome   |              | id | cliente_id  |
+----+---------+              +----+-------------+
| 1  | Maria   |  <---------- | 10 |      1      |
+----+---------+   FK         | 11 |      1      |
                               +----+-------------+

Ao executar: DELETE FROM clientes WHERE id = 1;

+------------------+---------------------------------------------+
| ON DELETE CASCADE| Remove AUTOMATICAMENTE os pedidos 10 e 11    |
+------------------+---------------------------------------------+
| ON DELETE RESTRICT| IMPEDE a exclusão de "Maria" enquanto       |
| (padrão)          | existirem pedidos vinculados a ela          |
+------------------+---------------------------------------------+
| ON DELETE SET NULL| Remove "Maria", e cliente_id nos pedidos    |
|                   | 10 e 11 passa a ser NULL                    |
+------------------+---------------------------------------------+
```

```sql
-- CASCADE: ao apagar o cliente, seus pedidos são apagados junto
cliente_id BIGINT REFERENCES clientes(id) ON DELETE CASCADE

-- RESTRICT: impede a exclusão explicitamente
-- do cliente enquanto houver pedidos vinculados
cliente_id BIGINT REFERENCES clientes(id) ON DELETE RESTRICT

-- SET NULL: ao apagar o cliente, os pedidos permanecem, mas
-- "perdem" a referência (exige que a coluna permita NULL)
cliente_id BIGINT REFERENCES clientes(id) ON DELETE SET NULL
```

Quando a cláusula `ON DELETE` é omitida, o comportamento padrão no PostgreSQL é `NO ACTION`; neste exemplo, `RESTRICT` foi declarado explicitamente.

A escolha correta depende inteiramente da regra de negócio: em um sistema de e-commerce (tema do projeto do Módulo 8), normalmente **não** se usa `CASCADE` para excluir pedidos junto com clientes (perderia-se histórico financeiro/fiscal); prefere-se, na prática, nem sequer excluir fisicamente o cliente, mas sim marcá-lo como inativo (soft delete) — um padrão comum na indústria justamente para evitar a perda irreversível de dados historicamente relevantes.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Rodar `UPDATE` ou `DELETE` sem `WHERE` em produção, afetando toda a tabela por engano.
2. Usar `DROP TABLE ... CASCADE` sem antes verificar quais objetos dependentes serão removidos junto.
3. Escolher `float`/`double` (ou seus equivalentes em C) para armazenar valores monetários, introduzindo erros de arredondamento silenciosos — o correto é `NUMERIC` no banco.
4. Confiar cegamente em `ON DELETE CASCADE` em relacionamentos financeiros/fiscais, apagando permanentemente histórico que deveria ser preservado.
5. Não usar `RETURNING` após um `INSERT`, fazendo uma segunda consulta desnecessária só para obter o ID recém-gerado.
6. Ignorar `TRUNCATE` como alternativa mais performática a `DELETE FROM tabela` (sem `WHERE`) quando o objetivo é realmente esvaziar a tabela inteira.
7. Deixar de validar, no lado da aplicação em C, que a string retornada pela `libpq` para uma coluna `BOOLEAN` (`"t"`/`"f"`) foi corretamente convertida antes de usá-la em uma condição — comparações incorretas de string podem levar a bugs lógicos silenciosos.

**Boas práticas:**

1. Sempre testar o filtro de um `UPDATE`/`DELETE` primeiro como um `SELECT` com o mesmo `WHERE`, conferindo visualmente as linhas afetadas antes de executar o comando destrutivo.
2. Executar operações destrutivas ou de larga escala dentro de uma transação explícita (`BEGIN`), permitindo `ROLLBACK` em caso de erro, antes do `COMMIT` final.
3. Modelar toda constraint de integridade (`NOT NULL`, `CHECK`, `FOREIGN KEY`) no momento da criação da tabela, não como um ajuste posterior "quando der tempo".
4. Preferir soft deletes (uma coluna `ativo`/`excluido_em`) a exclusões físicas em entidades com relevância histórica, financeira ou de auditoria.
5. Usar `INSERT ... ON CONFLICT` para operações de upsert em vez de padrões manuais de "verificar se existe, depois decidir entre INSERT ou UPDATE", que são mais lentos e propensos a condições de corrida (_race conditions_).
6. Documentar explicitamente, no schema ou em comentários (`COMMENT ON COLUMN`), a intenção de cada `CHECK` e `DEFAULT`, especialmente quando envolvem regras de negócio específicas do domínio.
7. Padronizar, na camada de integração em C, funções utilitárias centralizadas de conversão de tipos (string → `int`, string → `bool`, string → `NUMERIC`/decimal), evitando repetir lógica de parsing espalhada pelo código.

---

_Fim do Módulo 3. Aguardando confirmação para prosseguir ao Módulo 4 — DQL: Consultas e Segurança em Primeiro Lugar._
