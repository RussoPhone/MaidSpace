# Arquitetura alvo do S.R.C

## Decisao

O S.R.C deve usar:

- **Rust** para o motor de processamento de arquivos, dados, grafo e decisoes do A.D.D.
- **Tauri + WebView** para a interface local no PC.
- **HTML/CSS/JavaScript** para a camada visual, mantendo a UI rapida de iterar.

## Por que Rust no A.D.D

O A.D.D precisa varrer muitos arquivos, ler metadados, classificar risco, montar grafos e nunca travar a interface. Rust e o melhor encaixe porque entrega desempenho sem garbage collector, uso de memoria previsivel e seguranca de memoria/thread por padrao.

Isso importa porque o A.D.D nao pode ser so "rapido"; ele precisa ser confiavel. Um erro no motor pode recomendar apagar ou mover algo errado.

## Por que Tauri na interface

Electron seria simples, mas pesado. Para o S.R.C, que e um sistema local de armazenamento, a interface nao deve carregar um navegador inteiro. Tauri usa o WebView do sistema e deixa a logica sensivel no processo Rust.

## O que fica fora por enquanto

- C++/Qt: muito rapido, mas aumenta complexidade e risco de memoria.
- Python: otimo para prototipo, fraco para varredura pesada e app final.
- Node/Electron: bom para MVP, pesado como produto local de disco.
- C#/WPF: bom no Windows, mas menos portavel para o plano geral do S.R.C.
- Go: bom para backend e CLI, mas menos forte em UI local refinada.

## Plano de migracao

1. Manter o app atual em Node como fallback funcional.
2. Criar `src-core/add-core`, um CLI Rust que gera JSON do A.D.D.
3. Portar gradualmente as regras maduras do JS para Rust.
4. Criar shell Tauri em `src-tauri`.
5. Fazer a UI chamar comandos Rust em vez da API Node.
6. Remover o servidor Node quando o Tauri estiver completo.

## Contrato do A.D.D

O motor deve responder para cada arquivo:

- Afeta o sistema?
- Afeta o usuario?
- Afeta dependencias relevantes?
- Esta sem uso recente?
- Pode apagar?
- E inutil provavel?
- Deve ser averiguado?
- Nao deve apagar?

O A.D.D nunca apaga nem move. Ele apenas entrega a decisao para o A.R.E.
