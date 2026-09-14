# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 1 — Fundamentos de Dados, SGBDs e Arquitetura de Software

> **Nota de padronização**: este manual usa linguagem agnóstica de linguagem de programação. Os exemplos práticos de integração (Módulos 7 e 9) usarão C com libpq. Neste módulo teórico, comparações com C aparecerão apenas em notas pontuais, quando houver alinhamento técnico realmente relevante (ex.: tipos primitivos e structs).

---

### 1.1 O que são Dados, Informação e SGBD

> "**Programs must be written for people to read, and only incidentally for machines to execute.**" — _Harold Abelson_
>
> Um banco de dados é, antes de tudo, um programa.

**Dado** é um valor bruto, sem contexto: `35`, `"Maria"`, `2026-09-11`. **Informação** é o dado interpretado dentro de um contexto que gera significado: "Maria tem 35 anos e se cadastrou em 11/09/2026". Um **Sistema Gerenciador de Banco de Dados (SGBD)** é o software responsável por armazenar, organizar, proteger e recuperar dados de forma confiável, eficiente e concorrente para múltiplos usuários e aplicações.

#### Persistência

Persistência é a capacidade de um dado sobreviver ao encerramento do processo que o criou. Um vetor em memória RAM é volátil: ao final da execução do programa, ele desaparece. Um SGBD garante que o dado sobreviva a:

- Encerramento normal da aplicação;
- Quedas de energia;
- Falhas de hardware (parcialmente, via replicação/backup);
- Reinicializações do sistema operacional.

**O que é persistência primitiva?** É a técnica de salvar manualmente o estado de um programa em um arquivo, como um texto, CSV ou binário, para que os dados possam ser lidos novamente depois que o processo terminar. Ela garante apenas a sobrevivência básica dos bytes gravados; não oferece, por si só, transações, controle de concorrência, busca eficiente, validação de relacionamentos, recuperação automática após falhas ou permissões granulares.

**Nota técnica (C)**: um `struct` em C, mesmo com dados relacionais implícitos (ex.: um `struct Pedido` contendo um `int id_cliente` que referencia outro struct), existe apenas no heap/stack do processo. Se você `fwrite()` esse struct em um arquivo binário, você tem persistência _primitiva_, mas nenhuma das garantias abaixo (ACID, controle de concorrência, integridade referencial automática). Um SGBD como o PostgreSQL formaliza e automatiza tudo o que, em C, você teria que reimplementar manualmente e com alto risco de bugs.

#### ACID

ACID é o conjunto de quatro garantias que um SGBD transacional (como o PostgreSQL) oferece para que transações sejam confiáveis mesmo diante de falhas ou concorrência:

| Propriedade      | Significado                                                                                            | Exemplo prático                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| **A**tomicidade  | Uma transação é tudo-ou-nada. Se qualquer parte falhar, tudo é desfeito.                               | Transferência bancária: debitar de A e creditar em B ocorrem juntos, ou nenhum ocorre. |
| **C**onsistência | A transação leva o banco de um estado válido para outro estado válido, respeitando regras/constraints. | Um saldo não pode ficar negativo se há um `CHECK (saldo >= 0)`.                        |
| **I**solamento   | Transações concorrentes não devem interferir umas nas outras de forma indevida.                        | Duas pessoas comprando o último item em estoque não podem ambas "ganhar" a compra.     |
| **D**urabilidade | Uma vez confirmada (`COMMIT`), a transação persiste mesmo que o sistema caia logo em seguida.          | Após o `COMMIT`, os dados já estão gravados no _Write-Ahead Log (WAL)_ em disco.       |

**Diagrama ASCII — Ciclo ACID de uma transação:**

```
        BEGIN
          |
          v
   +------------------+
   |   OPERAÇÕES SQL   |   <-- múltiplos INSERT/UPDATE/DELETE
   |  (estado em buffer)|       ainda não visíveis para outras sessões
   +------------------+
          |
     +----+----+
     |         |
   COMMIT   ROLLBACK
     |         |
     v         v
+---------+  +------------------+
| Gravado |  | Tudo desfeito     |
| no WAL  |  | (Atomicidade)     |
| (Durável)| | estado anterior   |
+---------+  | preservado        |
             | (Consistência)    |
             +------------------+
```

#### Arquivo comum vs. SGBD Enterprise

| Característica        | Arquivo comum / struct em disco                                  | SGBD Enterprise (PostgreSQL)                                    |
| --------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| Concorrência          | Corrupção provável com múltiplos escritores simultâneos          | Controle de concorrência via MVCC                               |
| Integridade           | Responsabilidade 100% do programador                             | Constraints declarativas (PK, FK, CHECK)                        |
| Consultas             | Necessário escrever lógica de busca manualmente (loops, parsing) | Linguagem declarativa (SQL) com otimizador de consultas         |
| Recuperação de falhas | Geralmente inexistente ou manual                                 | WAL, pontos de recuperação, replicação                          |
| Escalabilidade        | Limitada e artesanal                                             | Índices, particionamento, réplicas                              |
| Segurança             | Controle de acesso a nível de sistema operacional apenas         | Roles, permissões granulares (GRANT/REVOKE), Row-Level Security |

---

### 1.2 A Camada de Dados no Software

O banco de dados é uma das camadas mais críticas de qualquer arquitetura de software, pois é onde o estado do sistema realmente vive.

#### Em diferentes estilos arquiteturais

- **Monolito**: uma única aplicação, tipicamente um único banco de dados compartilhado por todos os módulos internos. Simplicidade operacional, mas acoplamento alto entre módulos via schema compartilhado.
- **N-Tier (camadas)**: separação lógica entre apresentação, regras de negócio e dados, mas ainda pode ser um único processo/deploy. O banco fica isolado na camada de persistência.
- **Microserviços**: cada serviço idealmente possui seu próprio banco de dados (padrão _Database per Service_), evitando acoplamento direto no nível de schema entre times/serviços diferentes. A comunicação entre serviços ocorre via API ou mensageria, nunca via JOIN direto entre bancos de serviços distintos.

```
   MONOLITO                    MICROSERVIÇOS
+----------------+       +-----------+  +-----------+
|   Aplicação    |       | Serviço A |  | Serviço B |
|  (todos os     |       +-----------+  +-----------+
|   módulos)     |             |              |
+----------------+             v              v
        |                +-----------+  +-----------+
        v                | Banco A   |  | Banco B   |
+----------------+       +-----------+  +-----------+
| Banco único    |
| (schema        |
|  compartilhado)|
+----------------+
```

#### Regras de negócio: na aplicação ou no banco?

Este é um debate arquitetural real, sem resposta absoluta:

- **Regras na aplicação**: mais portável entre bancos, mais fácil de testar unitariamente, mais fácil de versionar junto com o código.
- **Regras no banco** (constraints, triggers, stored procedures): garantem integridade _independentemente_ de qual aplicação (ou script ad-hoc) esteja escrevendo no banco — inclusive protegendo contra bugs futuros na aplicação. Em contrapartida, aumentam o acoplamento ao SGBD específico e podem dificultar testes e versionamento.

Boa prática amplamente adotada na indústria: **validações de negócio "leves" (formato, obrigatoriedade)** costumam ficar na aplicação; **garantias de integridade "duras" (unicidade, integridade referencial, invariantes financeiras)** costumam ficar no banco, como uma última linha de defesa.

---

### 1.3 Taxonomia de Bancos de Dados

| Tipo                   | Modelo de dados                                 | Casos de uso típicos                                             | Exemplos                                       |
| ---------------------- | ----------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| **Relacional (RDBMS)** | Tabelas com linhas/colunas, relações via chaves | Sistemas transacionais, dados estruturados com forte integridade | PostgreSQL, MySQL, Oracle                      |
| **Chave-Valor**        | Par chave → valor opaco                         | Cache, sessões, contadores de alta velocidade                    | Redis, DynamoDB                                |
| **Documentos**         | Documentos semiestruturados (JSON/BSON)         | Catálogos com esquema variável, prototipagem rápida              | MongoDB, Couchbase                             |
| **Grafos**             | Nós e arestas com propriedades                  | Redes sociais, recomendação, detecção de fraude                  | Neo4j, Amazon Neptune                          |
| **Colunares**          | Dados armazenados por coluna, não por linha     | Data warehousing, OLAP, agregações massivas                      | Apache Cassandra\*, ClickHouse, Redshift       |
| **Séries Temporais**   | Otimizado para dados indexados por tempo        | Métricas, IoT, monitoramento                                     | InfluxDB, TimescaleDB (extensão do PostgreSQL) |

*Cassandra é tecnicamente um banco *wide-column\*, próximo do modelo colunar, mas com particionamento distribuído tipo chave-valor.

---

### 1.4 O Universo SQL vs. NoSQL (Análise Profunda)

#### A origem do SQL

A linguagem SQL nasceu como **SEQUEL** (_Structured English Query Language_), desenvolvida na IBM nos anos 1970 por Donald Chamberlin e Raymond Boyce, para implementar o **modelo relacional** proposto por **Edgar F. Codd** em seu artigo seminal de 1970, _"A Relational Model of Data for Large Shared Data Banks"_. Codd propôs representar dados como relações matemáticas (tabelas), manipuláveis por álgebra relacional — uma ruptura em relação aos modelos hierárquicos e de rede da época. O nome foi posteriormente abreviado para SQL por questões de marca registrada.

#### Desmistificando o NoSQL: "Not Only SQL"

O termo **NoSQL** é frequentemente mal interpretado como "bancos que não são relacionais" ou "bancos que rejeitam o SQL". A interpretação mais precisa e amplamente aceita — inclusive discutida por **Martin Fowler** em _NoSQL Distilled_ (com Pramod Sadalage) — é que NoSQL significa **"Not Only SQL"**: um guarda-chuva de tecnologias que surgiram para resolver problemas específicos de escala e flexibilidade onde o modelo relacional tradicional, _na forma como era operado até então_, enfrentava dificuldades — sem que isso signifique que o modelo relacional esteja obsoleto ou que dados relacionais não possam viver em um banco NoSQL.

**O erro conceitual mais comum**: tratar a escolha SQL vs. NoSQL como uma questão de "a natureza dos meus dados é relacional ou não?". Na prática, quase todo domínio de negócio tem relações entre entidades (um pedido pertence a um cliente, um comentário pertence a um post). A escolha real gira em torno de:

1. **Padrões de acesso**: leituras/escritas simples por chave (favorece chave-valor/documento) vs. consultas complexas com múltiplos JOINs e agregações ad-hoc (favorece relacional).
2. **Escala horizontal**: necessidade de particionar dados entre muitas máquinas de forma nativa e transparente.
3. **Latência**: exigências de latência sub-milissegundo em larguíssima escala.
4. **Consistência eventual vs. forte**: tolerância a ler um dado momentaneamente desatualizado em troca de maior disponibilidade/performance.
5. **Custos operacionais**: complexidade de operar um cluster distribuído vs. uma instância relacional bem indexada.

#### Teorema CAP

Formulado por **Eric Brewer** (2000) e formalmente provado por Seth Gilbert e Nancy Lynch, o Teorema CAP afirma que um sistema distribuído não pode garantir simultaneamente, durante uma partição de rede, mais do que duas das três propriedades:

```
              Consistency (C)
                    /\
                   /  \
                  /    \
                 /      \
                /  CAP   \
               / Teorema  \
              /____________\
   Availability (A) ---- Partition
                          Tolerance (P)
```

- **C**onsistência: todos os nós veem os mesmos dados ao mesmo tempo.
- **A**vailability (Disponibilidade): todo request recebe uma resposta (sem garantia de que seja o dado mais recente).
- **P**artition Tolerance: o sistema continua operando mesmo que a rede entre nós falhe parcialmente.

Como partições de rede são inevitáveis em sistemas distribuídos reais, a escolha prática, na prática, é entre **CP** (consistente, mas pode recusar responder durante uma partição) e **AP** (sempre responde, mas pode retornar dado desatualizado).

#### Teorema PACELC

**Daniel Abadi** propôs uma extensão ao CAP chamada **PACELC**, apontando que o CAP só descreve o comportamento _durante uma partição (P)_, mas ignora o trade-off que existe _mesmo sem partição (Else, E)_: entre **Latência (L)** e **Consistência (C)**.

```
   Se houver Partição (P):        Se NÃO houver partição (Else, E):
        escolha entre                    escolha entre
     A (disponibilidade)              L (latência)
              ou                             ou
     C (consistência)                 C (consistência)
```

Ou seja: mesmo em condições normais de rede, replicar dados de forma fortemente consistente (esperar confirmação de todas as réplicas) custa latência. Sistemas como o PostgreSQL, quando configurados com réplicas síncronas, fazem exatamente essa escolha explícita: mais consistência, ao custo de mais latência de escrita.

#### PostgreSQL: o "melhor dos dois mundos"?

Um ponto central deste manual: o PostgreSQL, sendo um RDBMS maduro, também oferece recursos tipicamente associados a bancos NoSQL, permitindo, na prática, evitar a falsa dicotomia:

- **JSONB**: tipo de dado binário para armazenar documentos JSON com indexação eficiente (índices GIN) e operadores nativos de consulta (`->`, `->>`, `@>`), permitindo esquemas flexíveis dentro de uma tabela relacional.
- **hstore**: tipo chave-valor nativo.
- Extensões como **TimescaleDB** transformam o PostgreSQL em um banco de séries temporais competitivo.

Isso demonstra, na prática, que dados inerentemente relacionais podem conviver com campos semiestruturados (JSONB) na mesma tabela, e que a "natureza do dado" raramente exige, sozinha, abandonar o modelo relacional.

---

### 1.5 Normalização e Modelagem de Dados

#### Conceitos fundamentais

- **Entidade**: um objeto do mundo real ou conceitual sobre o qual armazenamos dados (ex.: Cliente, Pedido, Produto). Vira, tipicamente, uma tabela.
- **Atributo**: uma característica de uma entidade (ex.: nome, e-mail). Vira, tipicamente, uma coluna.
- **Relacionamento**: uma associação entre entidades (ex.: um Cliente _faz_ Pedidos), com cardinalidade 1:1, 1:N ou N:M.

#### Formas Normais

A normalização é o processo de organizar colunas e tabelas para minimizar redundância e evitar anomalias de inserção, atualização e exclusão.

**1ª Forma Normal (1FN)**: cada coluna deve conter apenas valores atômicos (indivisíveis), e cada linha deve ser única (geralmente garantida por uma chave primária). Não pode haver colunas repetidas ou listas dentro de uma célula.

```
❌ Viola 1FN:                      ✅ Em 1FN:
+----+----------------+          +----+---------+
| id | telefones      |          | id | telefone|
+----+----------------+          +----+---------+
| 1  | "111, 222, 333"|          | 1  | 111     |
+----+----------------+          | 1  | 222     |
                                  | 1  | 333     |
                                  +----+---------+
```

**2ª Forma Normal (2FN)**: deve estar em 1FN, e todo atributo não-chave deve depender da chave primária **completa** (relevante apenas quando a chave é composta). Elimina dependências parciais.

**3ª Forma Normal (3FN)**: deve estar em 2FN, e não pode haver dependências transitivas — um atributo não-chave não pode depender de outro atributo não-chave.

```
❌ Viola 3FN (cidade_estado depende de cidade, não da PK):
+----+--------+---------------+
| id | cidade | cidade_estado |
+----+--------+---------------+
| 1  | Recife | Pernambuco    |
+----+--------+---------------+

✅ Em 3FN (tabela separada de cidades):
tabela pedidos          tabela cidades
+----+--------+         +--------+------------+
| id | cid_id |         | cid_id | estado     |
+----+--------+         +--------+------------+
| 1  |   10   |         |   10   | Pernambuco |
+----+--------+         +--------+------------+
```

**Forma Normal de Boyce-Codd (BCFN/FNBC)**: uma versão mais rigorosa da 3FN. Formalmente, para toda dependência funcional X → Y não trivial, X deve ser uma superchave. Resolve casos-limite (com dependências funcionais múltiplas e sobrepostas) que a 3FN não cobre.

#### Integridade Referencial, PKs e FKs

- **Chave Primária (PK)**: identifica unicamente cada linha de uma tabela; não pode ser nula nem duplicada.
- **Chave Estrangeira (FK)**: uma coluna (ou conjunto de colunas) que referencia a PK de outra tabela, garantindo que o valor referenciado exista de fato — essa garantia automática é a **integridade referencial**.

```
   tabela clientes                tabela pedidos
+----+---------+          +----+-------------+--------+
| PK |  nome   |          | PK | cliente_id  | valor  |
+----+---------+          +----+-------------+--------+
| 1  | Maria   |  <------ | 10 |      1      | 250.00 |
| 2  | João    |          | 11 |      1      |  80.00 |
+----+---------+          +----+-------------+--------+
                                    FK (cliente_id)
                            aponta obrigatoriamente
                            para um id existente
                            em "clientes"
```

#### Denormalização estratégica: OLTP vs. OLAP

- **OLTP (Online Transaction Processing)**: sistemas transacionais do dia a dia (e-commerce, ERPs). Priorizam normalização, pois otimizam para escritas frequentes, consistência e evitar redundância.
- **OLAP (Online Analytical Processing)**: sistemas analíticos (dashboards, relatórios, data warehouses). Frequentemente **denormalizam** dados de propósito — duplicando informação para reduzir a quantidade de JOINs em consultas de leitura pesada, priorizando velocidade de leitura em detrimento da economia de espaço/redundância.

A denormalização deve ser sempre uma **decisão consciente e documentada**, nunca um acidente decorrente de falta de modelagem.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Escolher "SQL ou NoSQL" com base apenas no hype do momento, sem analisar padrões reais de acesso e escala esperada.
2. Confundir NoSQL com "banco não-relacional" e descartar RDBMS por achar (erroneamente) que "meus dados não são tabulares".
3. Armazenar listas ou múltiplos valores em uma única coluna de texto (violação de 1FN), dificultando buscas e integridade.
4. Modelar sem chaves estrangeiras explícitas "para ganhar performance", abrindo mão da integridade referencial sem necessidade real.
5. Normalizar excessivamente um sistema analítico (OLAP) e sofrer com JOINs custosos em relatórios.
6. Denormalizar um sistema transacional (OLTP) sem necessidade, criando inconsistências entre cópias duplicadas de dados.
7. Tratar "regras de negócio no banco" e "regras de negócio na aplicação" como mutuamente exclusivas, ao invés de usar cada camada onde ela é mais forte.

**Boas práticas:**

1. Sempre modelar entidades e relacionamentos antes de criar tabelas — mesmo que informalmente, em um diagrama.
2. Aplicar normalização até a 3FN/BCFN por padrão em sistemas transacionais, denormalizando apenas com justificativa de performance medida (não hipotética).
3. Usar PKs e FKs explícitas desde o primeiro rascunho do schema — removê-las depois, se necessário, é mais seguro do que nunca tê-las tido.
4. Documentar toda decisão de denormalização com o motivo e o cenário de consulta que a justifica.
5. Ao considerar NoSQL, validar contra critérios concretos (volume esperado, throughput, latência-alvo, necessidade real de escala horizontal) e não apenas "achismo".
6. Aproveitar recursos híbridos do PostgreSQL (JSONB) para flexibilidade pontual sem abrir mão da integridade relacional do restante do schema.

---
