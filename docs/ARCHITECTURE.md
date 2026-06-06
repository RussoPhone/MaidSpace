# Arquitetura alvo do MaidSpace

## Decisao

MaidSpace e um aplicativo local de armazenamento.

- **Rust** roda o inventario, classificacao, estimativa de limpeza e futuras leituras NTFS/MFT/USN.
- **Tauri** entrega uma janela desktop leve e empacotavel.
- **HTML/CSS/JavaScript** ficam como camada visual para preservar o grafo e iterar rapido.
- **Node/server** fica apenas como fallback de desenvolvimento.

## Por que local

Limpeza constante precisa rodar perto do sistema de arquivos, observar mudancas enquanto o usuario trabalha e evitar custos de serializar milhoes de arquivos para uma API web. O motor precisa contar tudo, mas detalhar apenas os candidatos relevantes.

## Contrato de varredura

O motor deve separar:

- inventario completo: arquivos, diretorios, bytes e estimativa por nivel;
- detalhes compactados: principais candidatos, amostras e grafo navegavel;
- plano por meta: menor nivel A.R.E que consegue liberar a quantidade desejada;
- bloqueios: sistema, uso constante, ciclos e dependencias essenciais.

## Caminho de performance

1. Rust walk local como baseline.
2. Retencao compacta de candidatos por score.
3. Cache A.L.C para scans incrementais.
4. Windows: trocar o baseline por leitura NTFS/MFT/USN quando houver permissao adequada.
5. Execucao assistida e auditavel para limpeza constante.

## Interface

A tela principal deve ser curta e limpa:

- raiz;
- meta de GB;
- resumo baixo/medio/alto;
- plano para bater a meta;
- botao para abrir detalhes;
- grafo mantido como visualizacao avancada.
