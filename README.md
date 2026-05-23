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
