# Sistema de Relocacao Continua

MVP do **A.D.D - Algoritmo Determinacao Dependencia**.

O projeto escaneia um diretorio, detecta dependencias locais basicas, monta um grafo, classifica arquivos e simula uma separacao conservadora para preparar as proximas fases do S.R.C:

1. A.D.D: identifica dependencias e risco.
2. A.R.E: realoca espaco usando o relatorio do A.D.D.
3. A.L.C: limpa continuamente o que ja foi classificado como seguro.

## Como rodar

```powershell
npm start
```

Abra `http://localhost:4173`, informe o diretorio raiz e execute **Escanear**.

Para usar como aplicativo local no Windows, execute:

```powershell
npm run desktop
```

Ou de dois cliques em `S.R.C-ADD.cmd`.

## Como testar

```powershell
npm test
```

## O que o A.D.D detecta no MVP

- Imports JavaScript/TypeScript: `import`, `export from`, `require`, `import()`.
- Assets em HTML/CSS/Markdown: `src`, `href`, `url()`, links locais.
- Imports Python relativos e modulos locais simples.
- Includes C/C++ locais.
- Modulos Rust basicos.
- Imports Java/Kotlin/C# por pacote quando existe arquivo local correspondente.

## Classificacoes

- `isolado`: sem entrada, sem saida e sem pendencia nao resolvida.
- `dependente`: depende de outros arquivos.
- `provedor`: outros arquivos dependem dele.
- `dependente_provedor`: depende e tambem fornece dependencias.
- `critico_protegido`: arquivo de configuracao, lock, executavel, biblioteca ou caminho sensivel.

O algoritmo prefere falso positivo de risco a falso negativo. Em outras palavras: quando nao consegue provar seguranca, ele pede revisao.

## Grafo por zoom

- Mapa: diretorios e decisoes agregadas.
- Grupos: arquivos agrupados por decisao e pasta.
- Arquivos: grupos menores por decisao, pasta e extensao.

Clique em um grupo para expandir seus arquivos. As cores seguem o risco: verde para baixo, amarelo para medio e vermelho para alto.

## Banco local do A.D.D

`data/add-file-knowledge.json` guarda a base local de conhecimento do A.D.D:

- tipos essenciais do sistema;
- dependencias/configuracoes de projeto;
- conteudo comum do usuario;
- arquivos gerados/cache/log/temp;
- janela de uso recente dos ultimos 7 dias.

Essa base ajuda o A.D.D a nao tratar tudo como "nao apagar" e a diferenciar arquivo inutil provavel de arquivo importante.

## Decisoes do A.D.D

- `pode_apagar`: nao afeta o sistema, nao afeta dependencias relevantes e esta sem uso recente.
- `inutil_provavel`: baixo uso e baixo impacto; bom candidato para realocacao ou descarte assistido.
- `averiguar`: existe incerteza, uso moderado ou dependencia que pede confirmacao do usuario.
- `nao_apagar`: arquivo de sistema/protegido, uso recente ou impacto alto no grafo.

O A.D.D nao apaga nem move arquivos. Ele responde quais arquivos afetam o sistema, quais afetam o usuario, quais parecem inuteis, e gera o mapa de risco que o A.R.E deve respeitar.

## Arquitetura alvo

O caminho de produto do S.R.C e:

- Rust no motor do A.D.D/A.R.E/A.L.C.
- Tauri + WebView na interface local.
- HTML/CSS/JavaScript somente na camada visual.

O app Node atual continua como fallback funcional, mas a base Rust ja esta em `src-core/add-core` e o shell Tauri em `src-tauri`.

Quando o Rust estiver instalado:

```powershell
npm run core:check
npm run core:run -- C:\caminho\para\analisar
npm run tauri:dev
```

Detalhes em `docs/ARCHITECTURE.md`.
