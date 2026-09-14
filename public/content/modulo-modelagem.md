# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 3 — Modelagem Relacional, DER e Planejamento de Bancos SQL

> Antes de escrever `CREATE TABLE`, é preciso decidir o que o sistema precisa guardar, como os fatos se relacionam e quais regras não podem ser violadas. Este módulo transforma requisitos de negócio em um modelo relacional consistente e prepara o terreno para o DDL do próximo módulo.

---

### 3.1 Do requisito ao modelo de dados

Modelar é construir uma representação precisa do domínio antes de escolher nomes de tabelas ou tipos de dados. Um bom processo começa com perguntas observáveis:

1. Quais objetos o sistema precisa acompanhar? Eles costumam virar **entidades**.
2. Quais características de cada objeto precisam ser registradas? Elas viram **atributos**.
3. Que fatos ligam esses objetos? Eles viram **relacionamentos**.
4. Quais regras devem ser sempre verdadeiras? Elas serão expressas por chaves, `NOT NULL`, `UNIQUE`, `CHECK` e `FOREIGN KEY`.
5. Quais consultas e alterações serão frequentes? Elas influenciam a escolha das chaves, índices e, mais tarde, a performance.

Não confunda entidade com tela ou ação. “Pedido” é uma entidade; “finalizar pedido” é uma operação que altera entidades. “Relatório mensal” é uma consulta, não necessariamente uma tabela.

#### Modelo conceitual, lógico e físico

| Nível          | Pergunta principal                                    | Exemplo                                          |
| -------------- | ----------------------------------------------------- | ------------------------------------------------ |
| **Conceitual** | Quais conceitos existem no domínio?                   | Cliente faz Pedido                               |
| **Lógico**     | Como entidades, atributos e relações são organizados? | `cliente 1:N pedido`, com identificadores        |
| **Físico**     | Como o PostgreSQL implementará o modelo?              | `BIGINT`, constraints, índices e particionamento |

A separação evita que uma decisão acidental de implementação esconda uma regra de negócio. O modelo conceitual pode ser discutido com pessoas não técnicas; o físico pode mudar conforme volume e padrão de acesso.

---

### 3.2 Entidades, atributos e identificadores

Uma **entidade** representa algo sobre o qual o sistema precisa manter fatos. Um **atributo** descreve uma entidade. Um **identificador** distingue uma ocorrência das demais.

Considere um e-commerce:

- `Cliente`: pessoa que compra; atributos: nome, e-mail e data de cadastro.
- `Pedido`: compra realizada; atributos: status e data de criação.
- `Produto`: item oferecido; atributos: nome, preço e estoque.
- `ItemPedido`: associação que registra um produto dentro de um pedido; atributos: quantidade e preço praticado.

Cada tabela deve representar um conceito coeso. Uma coluna não deve misturar significados diferentes, e listas separadas por vírgula em uma célula são um sinal de que existe outra entidade ou relacionamento escondido.

#### Chaves

- **Chave candidata**: qualquer conjunto mínimo de atributos que identifica uma linha.
- **Chave primária (PK)**: a chave candidata escolhida como identificador principal; deve ser estável e não nula.
- **Chave alternativa**: candidata que não foi escolhida como PK e normalmente recebe `UNIQUE`, como e-mail.
- **Chave estrangeira (FK)**: coluna que aponta para uma chave de outra tabela e mantém a integridade referencial.
- **Chave composta**: formada por mais de uma coluna; é comum em tabelas associativas.

A PK identifica a linha; ela não substitui as regras de negócio. Por exemplo, `cliente.id` identifica um cliente, enquanto `UNIQUE (tenant_id, email)` pode garantir que o e-mail seja único apenas dentro de uma loja.

---

### 3.3 Relacionamentos e cardinalidade

A **cardinalidade** descreve quantas ocorrências de uma entidade podem ou devem participar de um relacionamento. Sempre registre os dois lados usando mínimo e máximo:

- `0..1`: opcional, no máximo uma ocorrência.
- `1..1`: obrigatório, exatamente uma ocorrência.
- `0..N`: opcional, muitas ocorrências.
- `1..N`: obrigatório, pelo menos uma ocorrência.

Na linguagem comum, isso aparece como:

| Relacionamento | Leitura                                                                  | Implementação típica                                                  |
| -------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **1:1**        | Uma pessoa possui no máximo um perfil, e um perfil pertence a uma pessoa | FK com `UNIQUE` no lado dependente                                    |
| **1:N**        | Um cliente pode fazer vários pedidos; cada pedido pertence a um cliente  | FK no lado N (`pedidos.cliente_id`)                                   |
| **N:M**        | Um pedido contém vários produtos, e um produto aparece em vários pedidos | Tabela associativa (`itens_pedido`)                                   |
| **0..N**       | Um cliente pode ainda não ter pedidos                                    | FK permite que a entidade pai exista sem filhos                       |
| **1..N**       | Um pedido precisa ter ao menos um item                                   | FK sozinha não basta; exige validação transacional ou regra adicional |

A FK implementa a referência, mas não expressa toda cardinalidade. `NOT NULL` comunica participação obrigatória no lado filho; `UNIQUE` limita o máximo a um. Já o mínimo do lado pai, como “todo pedido deve possuir ao menos um item”, normalmente depende de transação, trigger ou validação na aplicação.

#### Exemplo de leitura

> Um `Cliente` pode realizar zero ou muitos `Pedidos`; cada `Pedido` deve pertencer a exatamente um `Cliente`.

```text
CLIENTE (0..N) ─────────────── (1..1) PEDIDO

clientes                         pedidos
id (PK)       <───────────────  cliente_id (FK NOT NULL)
```

O lado `0..N` explica por que um cliente recém-cadastrado é válido sem pedido. O lado `1..1` explica por que `pedidos.cliente_id` é obrigatório e não deve aceitar referência inexistente.

---

### 3.4 DER: como desenhar e revisar

O **Diagrama Entidade-Relacionamento (DER)** é uma representação visual do modelo. A notação pode variar, mas o diagrama precisa deixar claros entidades, atributos relevantes, identificadores, relacionamentos e cardinalidades.

Um DER inicial para o e-commerce deste manual:

```text
                         (1..1)
                    +-------------+
                    |   CLIENTE   |
                    | id PK       |
                    | nome        |
                    | email       |
                    +-------------+
                          |
                        (0..N)
                          |
                    +-------------+
                    |   PEDIDO    |
                    | id PK       |
                    | cliente_id FK|
                    | status      |
                    +-------------+
                          |
                        (1..N)
                          |
                    +-------------+
                    | ITEM_PEDIDO |
                    | pedido_id FK|
                    | produto_id FK|
                    | quantidade  |
                    +-------------+
                          |
                        (0..N)
                          |
                    +-------------+
                    |  PRODUTO    |
                    | id PK       |
                    | nome        |
                    | preco       |
                    +-------------+
```

`ITEM_PEDIDO` resolve o relacionamento N:M entre `PEDIDO` e `PRODUTO`. Ele não é um detalhe de consulta: a quantidade e o preço praticado são fatos do relacionamento e precisam ser armazenados. O preço atual do catálogo não pode reescrever o histórico de uma compra.

#### Checklist visual do DER

- Toda entidade tem um identificador definido?
- Cada relacionamento tem nome e cardinalidade nos dois lados?
- Os atributos pertencem à entidade correta?
- Há uma entidade escondida em alguma relação N:M?
- Existem atributos derivados que não precisam ser armazenados?
- Regras de obrigatoriedade estão marcadas para virar `NOT NULL` ou validação?
- O diagrama continua legível quando o domínio cresce? Separe subdomínios se necessário.

Ferramentas de diagramação são úteis, mas a ferramenta não corrige um modelo ambíguo. O DER deve ser revisado com exemplos concretos: “um cliente sem pedidos é válido?”, “um pedido pode repetir o mesmo produto?”, “o preço histórico pertence ao produto ou ao item comprado?”.

---

### 3.5 Normalização sem dogmatismo

A normalização reduz redundância e anomalias de inserção, atualização e exclusão. Ela é um método de raciocínio, não um ritual para dividir tabelas sem entender o domínio.

- **1FN**: cada célula contém um valor atômico; não há listas ou grupos repetidos.
- **2FN**: em uma chave composta, cada atributo não-chave depende da chave completa.
- **3FN**: atributos não-chave dependem da chave, da chave toda e de nada além dela.

Exemplo de problema:

```text
❌ pedido(id, cliente_nome, cliente_email, produto_1, produto_2, total)

✅ cliente(id, nome, email)
   pedido(id, cliente_id, criado_em)
   item_pedido(pedido_id, produto_id, quantidade, preco_unitario)
```

A 3FN é um ponto de partida forte para sistemas transacionais. Denormalizar pode ser correto quando há uma razão mensurável, como preservar o preço histórico ou reduzir custo de uma consulta crítica. Nesse caso, registre a decisão, a fonte do valor e como ele será mantido consistente.

---

### 3.6 Do DER para tabelas PostgreSQL

A transformação segue regras previsíveis:

1. Entidade vira tabela.
2. Atributo vira coluna com tipo adequado.
3. Identificador vira `PRIMARY KEY`.
4. Relacionamento 1:N vira FK no lado N.
5. Relacionamento 1:1 vira FK com `UNIQUE` no lado dependente.
6. Relacionamento N:M vira tabela associativa com duas FKs.
7. Obrigatoriedade vira `NOT NULL`, quando a regra puder ser garantida por coluna.
8. Domínios restritos viram `CHECK`, `ENUM` ou tabela de referência, conforme a necessidade de evolução.

```sql
CREATE TABLE clientes (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE
);

CREATE TABLE pedidos (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cliente_id BIGINT NOT NULL REFERENCES clientes(id),
    status VARCHAR(20) NOT NULL DEFAULT 'pendente'
        CHECK (status IN ('pendente', 'pago', 'cancelado')),
    criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE itens_pedido (
    pedido_id BIGINT NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
    produto_id BIGINT NOT NULL REFERENCES produtos(id),
    quantidade INTEGER NOT NULL CHECK (quantidade > 0),
    preco_unitario NUMERIC(12, 2) NOT NULL CHECK (preco_unitario >= 0),
    PRIMARY KEY (pedido_id, produto_id)
);
```

A escolha de `PRIMARY KEY (pedido_id, produto_id)` impede que o mesmo produto apareça duas vezes no mesmo pedido. Se o domínio permitir linhas distintas do mesmo produto, use uma chave substituta e uma regra diferente. O modelo deve refletir o negócio, não uma preferência sintática.

> O exemplo referencia `produtos`, que deve ser criado antes ou na mesma migração. A implementação completa das tabelas, constraints e índices começa no Módulo 4.

---

### 3.7 Planejamento de migrações e validação

Um modelo aprovado ainda precisa virar mudanças reproduzíveis. Planeje em pequenas migrações versionadas:

1. Crie tabelas principais e chaves.
2. Insira dados de referência, se necessário.
3. Adicione FKs e constraints quando os dados existentes já forem compatíveis.
4. Crie índices guiado por consultas reais, não por todas as colunas.
5. Teste rollback ou defina explicitamente por que a mudança é irreversível.
6. Registre decisões, premissas e impactos de carga.

Antes do DDL, faça uma revisão de cenários:

- inserir uma ocorrência válida;
- rejeitar uma FK inexistente;
- testar cada limite de cardinalidade;
- atualizar e excluir registros relacionados;
- verificar duplicidade nas chaves alternativas;
- consultar o caminho mais frequente do usuário;
- carregar volume representativo e medir antes de otimizar.

O resultado esperado deste módulo é um modelo que outra pessoa consiga implementar e contestar. Se o DER não permite responder “o que acontece quando...?”, ele ainda não está pronto para o SQL.

---

### 3.8 Ferramentas para desenhar e validar o modelo

Ferramentas visuais aceleram o rascunho do DER, mas não substituem a análise de requisitos nem a revisão das cardinalidades. Use-as para tornar o modelo discutível, gerar uma primeira versão do DDL e comparar alternativas.

| Ferramenta                                | Melhor uso                                       | Destaques                                                                                                                                      |
| ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [drawDB](https://www.drawdb.app/)         | Desenhar visualmente e explorar o schema         | Editor visual, suporte a PostgreSQL, importação de DDL, exportação de SQL e opção open source/self-hosted.                                     |
| [database.build](https://database.build/) | Explorar uma ideia a partir de linguagem natural | Fluxo com chat e diagrama, útil para gerar um primeiro rascunho e iterar sobre tabelas e relações. Revise todo SQL sugerido antes de executar. |
| [dbdiagram.io](https://dbdiagram.io/home) | Documentar o schema como código                  | Diagramas a partir de DBML ou SQL, colaboração, importação e exportação; adequado para manter o modelo junto do repositório.                   |

#### Fluxo recomendado

1. Esboce entidades e relacionamentos em uma ferramenta visual ou em DBML.
2. Confira no diagrama as cardinalidades, as FKs, os atributos do relacionamento e os nomes das tabelas.
3. Gere ou exporte o DDL, mas trate-o como proposta: revise tipos, constraints, `ON DELETE`, nomes e índices.
4. Salve o modelo exportado junto das migrações e registre a ferramenta e a versão usadas.
5. Reimporte o DDL ou atualize o diagrama a partir do schema real para detectar divergências.

> Ferramentas com assistência de IA podem sugerir entidades e relacionamentos plausíveis, mas não conhecem automaticamente as regras do seu negócio. Valide cada sugestão com exemplos concretos e nunca execute SQL gerado sem revisão.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Começar pelo `CREATE TABLE` antes de esclarecer requisitos, entidades e regras do domínio.
2. Desenhar relacionamentos sem informar cardinalidade mínima e máxima, deixando dúvidas sobre o que é obrigatório ou opcional.
3. Implementar uma relação N:M diretamente em uma tabela, usando colunas repetidas ou listas de IDs em texto em vez de uma entidade associativa.
4. Usar o mesmo identificador natural como chave primária sem avaliar mudanças de negócio, escopo de unicidade e exposição de dados.
5. Confundir uma regra de referência com a cardinalidade completa: uma FK não garante sozinha que um pedido tenha ao menos um item.
6. Normalizar ou denormalizar por preferência pessoal, sem considerar o domínio, as consultas reais, a consistência e o custo de manutenção.
7. Criar o DER uma única vez e não revisá-lo quando os requisitos, as consultas ou as regras de negócio mudarem.

**Boas práticas:**

1. Validar o modelo com exemplos concretos e perguntas de negócio antes de escrever o DDL.
2. Registrar cardinalidade nos dois lados de cada relacionamento e traduzir a obrigatoriedade para `NOT NULL`, `UNIQUE`, constraints ou validações transacionais.
3. Transformar toda relação N:M em uma tabela associativa com FKs, identificador adequado e atributos próprios do relacionamento.
4. Preferir chaves substitutas estáveis quando apropriado, mantendo chaves naturais importantes protegidas por `UNIQUE`.
5. Usar a 3FN como padrão para sistemas transacionais e documentar qualquer denormalização com sua justificativa e estratégia de consistência.
6. Manter DER, decisões de modelagem e migrações versionadas junto ao projeto, para que o schema implantado possa ser reproduzido.
7. Revisar o modelo com desenvolvimento, produto e dados, além de testar cenários de inserção, alteração, exclusão e concorrência antes da produção.

---

### Resumo

Modelagem é uma atividade de descoberta e decisão. Entidades delimitam conceitos, atributos descrevem fatos, chaves identificam ocorrências, cardinalidades expressam regras e o DER torna essas decisões discutíveis. A normalização reduz inconsistências; o planejamento de migrações leva o modelo aprovado para o PostgreSQL com segurança.
