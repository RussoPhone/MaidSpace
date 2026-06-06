# MaidSpace

MaidSpace e um aplicativo local para encontrar espaco que pode ser liberado no Windows.

Ele le o armazenamento, calcula o potencial de limpeza pelo A.R.E e deixa a decisao final para o usuario/A.L.C. O app evita pastas claramente criticas do sistema, mas nao trata `Program Files` ou `Program Files (x86)` como intocaveis so pelo nome.

## Uso Rapido

No Windows, de dois cliques:

1. `Setup-MaidSpace.cmd`
2. `MaidSpace.cmd`

Na tela do app:

1. escolha o disco ou pasta, por exemplo `C:\`;
2. informe quantos GB quer liberar;
3. clique em `Escanear MaidSpace`;
4. veja o potencial em `Ganho espacial A.R.E`;
5. confirme qualquer acao final apenas quando o A.L.C estiver pronto para executar com seguranca.

## Pelo Terminal

```powershell
npm run setup
npm run desktop
```

## Gerar Instalador

```powershell
npm run maidspace:build:local
```

Saidas geradas:

- `src-tauri\target\release\maidspace.exe`
- `src-tauri\target\release\bundle\nsis\MaidSpace_0.1.0_x64-setup.exe`
- `src-tauri\target\release\bundle\msi\MaidSpace_0.1.0_x64_en-US.msi`

## O Que Cada Modulo Faz

- **A.D.D** inventaria arquivos, dependencias, risco e grafo.
- **A.R.E** calcula quanto espaco pode ser liberado por nivel.
- **A.L.C** sera a camada de confirmacao/execucao continua para nao interferir no usuario.

## Testes

```powershell
npm test
cargo test --manifest-path src-core/add-core/Cargo.toml
```

## Regra

MaidSpace pode calcular com agressividade, mas nao deve apagar ou mover arquivos sem confirmacao auditavel.
