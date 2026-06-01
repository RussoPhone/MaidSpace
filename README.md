# Sistema de Relocacao Continua

O **S.R.C** analisa uma pasta baguncada, mapeia dependencias internas, calcula risco e gera um plano seguro de organizacao. Ele nao apaga, move ou altera arquivos automaticamente.

## Modulos

1. **A.D.D - Analise/Determinacao de Dependencia**
   - Escaneia diretorios.
   - Detecta dependencias locais.
   - Constroi grafo direcionado: `arquivo -> dependencia`.
   - Classifica arquivos como `isolado`, `dicente`, `docente`, `misto` ou `critico_protegido`.
   - Detecta ciclos com DFS por cores: branco, cinza e preto.
   - Marca ciclos como `bloco_interdependente`.
   - Simula impacto de remocao/realocacao.

2. **A.R.E - Analise/Relocacao de Espaco**
   - Usa o relatorio do A.D.D.
   - Calcula ganho espacial realocavel em modo baixo, medio e alto.
   - Simula a realocacao por modo: espaco antes, espaco que sairia do diretorio principal, espaco restante e pacotes simulados.
   - Modo baixo: apenas arquivos antigos, isolados, risco baixo, sem acesso/modificacao recente e com perfil seguro de limpeza.
   - Modo medio: arquivos ou blocos antigos que podem ser movidos como pacote completo sem afetar sistema ou projetos recentes.
   - Modo alto: maior ganho possivel sem tocar sistema, estruturas protegidas, ciclos, uso recente ou dependencias essenciais.
   - Lista candidatos por modo com tamanho, pacote de dependencias, ultimo acesso e justificativa.
   - Lista arquivos bloqueados e o motivo do bloqueio.
   - Gera um relatorio de seguranca.
   - Gera um plano nao destrutivo de organizacao.
   - Sugere destinos como `/src`, `/assets`, `/docs`, `/tests`, `/isolados`, `/revisar` e `/lixeira_segura`.
   - Mantem docentes, mistos, criticos e ciclos protegidos.

3. **A.L.C - Analise/Limpeza Constante**
   - Salva estado da ultima varredura fora da pasta analisada.
   - Compara estado anterior e atual.
   - Detecta arquivos novos, removidos, modificados e mudancas de risco/dependencia.
   - Recomenda reanalise antes de qualquer plano de realocacao quando algo muda.

## Como rodar

```powershell
npm start
```

Abra `http://localhost:4173`, informe o diretorio raiz e execute **Escanear S.R.C**.

O A.D.D fica como tela principal. O A.R.E aparece em um modal proprio pelo botao **Abrir A.R.E**, com simulacao de realocacao, niveis baixo, medio, alto e lista de bloqueados. Se o ganho aparecer como `0 B`, o modal deve mostrar quais criterios bloquearam os arquivos.

Para usar como aplicativo local no Windows:

```powershell
npm run desktop
```

Ou de dois cliques em `S.R.C-ADD.cmd`.

## Como testar

```powershell
npm test
```

## Regras de seguranca

- Nunca apagar arquivos automaticamente.
- Nunca mover arquivos automaticamente sem confirmacao.
- Ignorar dependencias externas ao diretorio analisado.
- Priorizar seguranca sobre limpeza agressiva.
- Tratar ciclos como blocos interdependentes.
- Gerar relatorio antes de qualquer acao.

## Saida do sistema

A API `/api/scan` retorna um JSON com:

- `nodes`: arquivos e diretorios analisados.
- `edges`: dependencias internas resolvidas.
- `cycles`: ciclos detectados por DFS.
- `simulation`: decisao direta do A.D.D.
- `relocationPlan`: plano A.R.E com `spaceModes`, `candidatesByMode`, `blockedFiles` e `safetyReport`.
- `continuousState`: comparacao A.L.C.
- `report.text`: relatorio textual em Markdown.

## Banco local do A.D.D

`data/add-file-knowledge.json` guarda uma base local para diferenciar:

- tipos essenciais do sistema;
- dependencias/configuracoes de projeto;
- conteudo comum do usuario;
- arquivos gerados/cache/log/temp;
- janela de uso recente dos ultimos 7 dias.

## Arquitetura alvo

O caminho de produto do S.R.C continua sendo:

- Rust no motor do A.D.D/A.R.E/A.L.C.
- Tauri + WebView na interface local.
- HTML/CSS/JavaScript na camada visual.

O app Node atual e o fallback funcional. A base Rust esta em `src-core/add-core` e o shell Tauri em `src-tauri`.
