# Manual Definitivo do PostgreSQL: Do Zero ao Avançado

## Módulo 7 — Performance, Indexação e Manutenção

> Este módulo trata do PostgreSQL "por dentro": como os dados são fisicamente localizados através de índices, como interpretar o que o otimizador de consultas realmente faz, e como o mecanismo de concorrência do PostgreSQL (MVCC) exige manutenção contínua para não degradar com o tempo.

---

### 7.1 Indexação

Um índice é uma estrutura de dados auxiliar que permite ao PostgreSQL localizar linhas **sem varrer a tabela inteira** — de forma análoga ao índice remissivo de um livro, que evita ler todas as páginas para encontrar um termo.

```
   SEM ÍNDICE (Sequential Scan)         COM ÍNDICE (Index Scan)
+----------------------------+       +----------------------------+
| Percorre TODAS as N linhas |       | Navega pela estrutura do    |
| da tabela, uma a uma, até  |       | índice (ex.: árvore B-Tree) |
| encontrar as que casam com |       | e vai DIRETO às linhas que  |
| o filtro                   |       | casam com o filtro          |
| Custo: O(N)                |       | Custo: O(log N) ou melhor   |
+----------------------------+       +----------------------------+
```

#### B-Tree — o índice padrão

```sql
-- Índice B-Tree é o padrão implícito ao usar CREATE INDEX
CREATE INDEX idx_pedidos_cliente_id ON pedidos (cliente_id);
```

**Quando usar**: a estrutura balanceada da B-Tree é eficiente para igualdade (`=`), faixas (`<`, `>`, `BETWEEN`) e ordenação (`ORDER BY`) — cobre a grande maioria dos casos de indexação do dia a dia. É a escolha padrão sempre que não houver um motivo específico para outro tipo.

#### Hash

```sql
CREATE INDEX idx_clientes_email_hash ON clientes USING HASH (email);
```

**Quando usar**: exclusivamente para comparações de **igualdade exata** (`=`) — não suporta faixas nem ordenação. Historicamente evitado por não ser "WAL-logged" (seguro para replicação/recuperação) em versões antigas do PostgreSQL; desde a versão 10, índices Hash são totalmente seguros para uso em produção, mas ainda oferecem pouca vantagem prática sobre B-Tree para igualdade simples, sendo usados apenas em nichos muito específicos de otimização.

#### GIN (Generalized Inverted Index)

```sql
-- Já apresentado no Módulo 5, para colunas JSONB
CREATE INDEX idx_produtos_atributos ON produtos USING GIN (atributos);

-- Também amplamente usado para busca textual completa (Full-Text Search)
CREATE INDEX idx_produtos_busca ON produtos USING GIN (to_tsvector('portuguese', nome));

-- E para arrays
CREATE INDEX idx_produtos_tags ON produtos USING GIN ((atributos -> 'tags'));
```

**Quando usar**: quando uma única coluna pode conter **múltiplos valores buscáveis** — JSONB, arrays, ou vetores de busca textual (`tsvector`). O índice mapeia cada valor individual componente de volta às linhas que o contêm (daí "invertido", análogo a um índice remissivo real).

#### GiST (Generalized Search Tree)

```sql
-- Índice para dados geométricos/geoespaciais (com a extensão PostGIS)
CREATE INDEX idx_locais_geom ON locais USING GIST (geom);

-- Também usado para faixas (ranges) e busca por similaridade textual
CREATE INDEX idx_reservas_periodo ON reservas USING GIST (periodo);
```

**Quando usar**: dados que não têm uma ordem linear simples — geometrias, ranges (`tsrange`, `int4range`), ou buscas de "vizinho mais próximo". GiST é uma estrutura mais genérica e extensível que B-Tree, permitindo consultas como "encontre todas as reservas cujo período se sobrepõe a este intervalo", algo que uma B-Tree simplesmente não sabe responder eficientemente.

#### Custos de escrita

Todo índice tem um custo: a cada `INSERT`/`UPDATE`/`DELETE`, **cada índice** da tabela também precisa ser atualizado, o que:

- Aumenta o tempo de escrita proporcional ao número de índices existentes;
- Aumenta o espaço em disco ocupado (índices ocupam espaço próprio, à parte da tabela);
- Aumenta o trabalho do `VACUUM` (seção 7.3), que também precisa limpar entradas obsoletas nos índices.

```
   Trade-off fundamental de indexação:

   Mais índices  -->  Leituras mais rápidas  -->  Escritas mais lentas
   Menos índices -->  Leituras mais lentas   -->  Escritas mais rápidas
```

> **Boa prática**: indexar com propósito — cada índice deve corresponder a um padrão de consulta real e frequente (validável via `EXPLAIN ANALYZE`, seção seguinte), nunca "por precaução" em toda coluna da tabela.

---

### 7.2 Análise de Performance: `EXPLAIN ANALYZE`

`EXPLAIN` mostra o **plano de execução** que o otimizador do PostgreSQL escolheu para uma consulta, sem executá-la de fato. `EXPLAIN ANALYZE` vai além: **executa** a consulta de verdade e mostra tempos reais medidos, além do plano estimado.

```sql
EXPLAIN ANALYZE
SELECT c.nome, p.valor_total
FROM clientes c
JOIN pedidos p ON p.cliente_id = c.id
WHERE p.status = 'pago'
ORDER BY p.valor_total DESC
LIMIT 10;
```

Saída ilustrativa (formato real do PostgreSQL):

```
Limit  (cost=245.32..245.34 rows=10 width=42) (actual time=3.201..3.204 rows=10 loops=1)
  ->  Sort  (cost=245.32..248.75 rows=1372 width=42) (actual time=3.199..3.201 rows=10 loops=1)
        Sort Key: p.valor_total DESC
        Sort Method: top-N heapsort  Memory: 26kB
        ->  Hash Join  (cost=32.50..210.14 rows=1372 width=42) (actual time=0.412..2.850 rows=1372 loops=1)
              Hash Cond: (p.cliente_id = c.id)
              ->  Seq Scan on pedidos p  (cost=0.00..150.00 rows=1372 width=16) (actual time=0.020..1.500 rows=1372 loops=1)
                    Filter: (status = 'pago'::text)
              ->  Hash  (cost=20.00..20.00 rows=1000 width=34) (actual time=0.350..0.351 rows=1000 loops=1)
                    ->  Seq Scan on clientes c  (cost=0.00..20.00 rows=1000 width=34) (actual time=0.005..0.150 rows=1000 loops=1)
Planning Time: 0.412 ms
Execution Time: 3.298 ms
```

#### Como ler o plano

- **Leitura de baixo para cima**: as operações mais internas (mais próximas dos dados brutos) aparecem embaixo; o resultado final aparece no topo.
- **`cost=X..Y`**: estimativa relativa de custo (não é tempo real) — `X` é o custo até a primeira linha, `Y` é o custo total estimado.
- **`actual time=X..Y`**: tempo **real** medido em milissegundos (só aparece com `ANALYZE`), igualmente de "primeira linha" até "total".
- **`rows=N`**: número de linhas estimado (na parte `cost`) ou realmente retornado (na parte `actual`) — uma grande divergência entre estimado e real é um sinal de estatísticas desatualizadas (ver `ANALYZE`, seção 7.3).
- **`Seq Scan`**: varredura sequencial completa da tabela — pode indicar ausência de índice útil, mas também pode ser a escolha correta quando a tabela é pequena ou o filtro tem baixa seletividade.
- **`Index Scan` / `Index Only Scan`**: uso de um índice — geralmente desejável para filtros seletivos em tabelas grandes.

```sql
-- Comparando antes e depois de um índice
EXPLAIN ANALYZE SELECT * FROM pedidos WHERE cliente_id = 42;
-- Sem índice: Seq Scan on pedidos (custo alto em tabelas grandes)

CREATE INDEX idx_pedidos_cliente_id ON pedidos (cliente_id);

EXPLAIN ANALYZE SELECT * FROM pedidos WHERE cliente_id = 42;
-- Com índice: Index Scan using idx_pedidos_cliente_id (custo muito menor)
```

> **Nota de segurança operacional**: `EXPLAIN ANALYZE` **executa de fato** a consulta, incluindo `INSERT`/`UPDATE`/`DELETE` se for esse o comando analisado. Rodar `EXPLAIN ANALYZE DELETE FROM tabela_grande;` efetivamente apaga os dados — para analisar comandos de escrita sem efeitos colaterais, envolva a análise em uma transação com `ROLLBACK` ao final.

---

### 7.3 Manutenção: MVCC, VACUUM, ANALYZE e Bloat

#### MVCC (Multi-Version Concurrency Control)

O PostgreSQL não sobrescreve uma linha diretamente ao atualizá-la. Em vez disso, um `UPDATE` cria uma **nova versão física** da linha e marca a versão antiga como obsoleta (mas não a remove imediatamente) — esse é o mecanismo MVCC, que permite que leitores nunca bloqueiem escritores, e escritores nunca bloqueiem leitores.

```
   Antes do UPDATE:
   +----+--------+-------+
   | id | saldo  | xmin  |    xmin = id da transação que criou a versão
   +----+--------+-------+    xmax = id da transação que "obsoletou" a versão
   | 1  |  100   |  50   |    (0 = ainda válida)
   +----+--------+-------+

   UPDATE contas SET saldo = 80 WHERE id = 1;  (executado pela transação 51)

   Depois do UPDATE (MVCC mantém AMBAS as versões fisicamente):
   +----+--------+-------+-------+
   | id | saldo  | xmin  | xmax  |
   +----+--------+-------+-------+
   | 1  |  100   |  50   |  51   |   <- versão antiga, agora obsoleta
   | 1  |   80   |  51   |   0   |   <- versão nova e atual
   +----+--------+-------+-------+
```

Cada transação enxerga apenas as versões de linha que são "visíveis" para o seu snapshot (conforme o nível de isolamento, Módulo 5) — é assim que o PostgreSQL implementa isolamento sem exigir locks de leitura tradicionais na maioria dos casos.

#### `VACUUM`

A consequência direta do MVCC é que **linhas obsoletas se acumulam fisicamente** no arquivo de dados da tabela até serem explicitamente removidas — esse espaço morto é chamado de **bloat**. `VACUUM` é o processo que varre a tabela e marca esse espaço como reutilizável por futuras inserções.

```sql
-- Marca espaço morto como reutilizável (não devolve espaço ao SO)
VACUUM tabela_pedidos;

-- Além de VACUUM, recalcula estatísticas do otimizador (equivalente
-- a rodar VACUUM e ANALYZE em uma única instrução)
VACUUM ANALYZE tabela_pedidos;

-- VACUUM FULL: reescreve a tabela inteira do zero, compactando-a
-- fisicamente e DEVOLVENDO espaço ao sistema operacional -- porém,
-- exige um lock exclusivo (ACCESS EXCLUSIVE) durante toda a operação,
-- bloqueando leituras e escritas na tabela até terminar
VACUUM FULL tabela_pedidos;
```

**Autovacuum**: o PostgreSQL roda, por padrão, um processo em segundo plano chamado **autovacuum**, que executa `VACUUM`/`ANALYZE` automaticamente com base em limiares de linhas modificadas — na grande maioria dos casos, o autovacuum é suficiente, e `VACUUM` manual só é necessário em cenários específicos (ex.: antes de uma manutenção agendada, ou após uma operação de exclusão massiva).

```sql
-- Ajustando o comportamento do autovacuum para uma tabela específica
-- de altíssima taxa de escrita, tornando-o mais agressivo
ALTER TABLE pedidos SET (autovacuum_vacuum_scale_factor = 0.05);
```

#### `ANALYZE`

`ANALYZE` (separado de `VACUUM`, embora frequentemente executado junto) coleta **estatísticas** sobre a distribuição dos dados de cada coluna (quantos valores distintos existem, quão comuns são certos valores, etc.) — o otimizador de consultas usa essas estatísticas para decidir, por exemplo, se vale mais a pena usar um índice ou uma varredura sequencial.

```sql
ANALYZE tabela_pedidos;
```

Estatísticas desatualizadas (ex.: após uma carga massiva de dados) fazem o otimizador tomar decisões ruins — um sintoma clássico é justamente a divergência entre `rows` estimado e `rows` real no `EXPLAIN ANALYZE` mencionada na seção anterior.

#### Combatendo o Bloat

```
   Sintomas de bloat excessivo:
   - Tabela ocupa muito mais espaço em disco do que os dados
     "úteis" justificariam
   - Consultas ficam progressivamente mais lentas ao longo do tempo,
     mesmo sem crescimento real proporcional no volume de dados úteis
   - Índices também podem sofrer bloat próprio, exigindo diagnóstico e, quando indicado, `REINDEX`
```

```sql
-- Verificar o tamanho físico de uma tabela e comparar com uma
-- estimativa do "tamanho útil" é uma forma prática de detectar bloat
SELECT pg_size_pretty(pg_total_relation_size('pedidos'));

-- Reconstrói um índice do zero, eliminando bloat acumulado nele
REINDEX INDEX idx_pedidos_cliente_id;

-- Reconstrói todos os índices de uma tabela
REINDEX TABLE pedidos;
```

> Diferente de `VACUUM` comum, `VACUUM FULL` e `REINDEX` (na maioria das versões) exigem locks mais pesados — devem ser agendados em janelas de manutenção de baixo tráfego, e não executados livremente durante o horário de pico em produção.

---

### ⚠️ Erros Comuns e Boas Práticas da Indústria

**Erros comuns:**

1. Criar índices indiscriminadamente em todas as colunas "por precaução", degradando a performance de escrita sem ganho real de leitura.
2. Usar um índice Hash ou GiST onde um B-Tree simples já resolveria com a mesma eficiência, adicionando complexidade desnecessária.
3. Ignorar completamente `EXPLAIN ANALYZE` durante o desenvolvimento, descobrindo problemas de performance apenas quando já estão em produção com volume real de dados.
4. Rodar `EXPLAIN ANALYZE` em um `DELETE`/`UPDATE` de produção sem envolver em uma transação com `ROLLBACK`, causando uma alteração real de dados não intencional.
5. Desativar o autovacuum globalmente "para melhorar performance", sem entender que isso acumula bloat indefinidamente até degradar drasticamente o desempenho.
6. Rodar `VACUUM FULL` ou `REINDEX` em uma tabela grande durante horário de pico, causando indisponibilidade por lock exclusivo.
7. Confiar em estatísticas desatualizadas após uma carga massiva de dados (ex.: uma migração), sem rodar `ANALYZE` manualmente logo em seguida.

**Boas práticas:**

1. Criar índices com base em padrões de consulta reais e medidos, validando cada um com `EXPLAIN ANALYZE` antes e depois de criá-lo.
2. Escolher o tipo de índice (B-Tree, Hash, GIN, GiST) de acordo com o tipo de operador realmente usado nas consultas (igualdade, faixa, contenção, geoespacial).
3. Monitorar consultas lentas em produção (via `pg_stat_statements`, uma extensão amplamente adotada na indústria) para identificar candidatas reais a indexação.
4. Deixar o autovacuum ativo por padrão, ajustando seus parâmetros (`scale_factor`, `threshold`) por tabela apenas quando houver evidência concreta de necessidade, em vez de desativá-lo.
5. Agendar operações pesadas de manutenção (`VACUUM FULL`, `REINDEX`) em janelas de manutenção de baixo tráfego, e considerar `REINDEX CONCURRENTLY` quando disponível para minimizar o impacto de lock.
6. Rodar `ANALYZE` explicitamente após cargas massivas de dados (migrações, importações em lote), garantindo estatísticas atualizadas antes que consultas críticas dependam delas.
7. Revisar periodicamente o tamanho físico das tabelas e índices mais críticos, tratando bloat como uma métrica de saúde do banco a ser monitorada continuamente, não apenas investigada reativamente quando já causou lentidão perceptível.

---

_Fim do Módulo 7. Aguardando confirmação para prosseguir ao Módulo 8 — Projeto Prático Guiado e Arquitetura Real._
