# Decupa

Plugin **gratuito e open source** para Adobe Premiere Pro que faz a decupagem automática: detecta e remove os silêncios do clipe selecionado, direto num painel dentro do Premiere.

> Status: **v0.3, protótipo.** A versão CEP foi validada no Premiere Pro 26.2 (Windows): marcar, desativar e remover com ripple funcionam. A versão UXP ainda não foi testada num Premiere 27.1+.

## Qual versão usar

O Decupa vem em duas versões, com a mesma interface e a mesma detecção de silêncio:

| Seu Premiere | Versão | Arquivo | Como corta |
| --- | --- | --- | --- |
| **Até 27.0** (ex.: 26.2) | **CEP** (pasta `cep/`) | `Decupa.zxp` | razor do QE DOM, via ExtendScript |
| **27.1 ou mais novo** | **UXP** (pasta `plugin/`) | `Decupa.ccx` | API oficial de razor do UXP |

Na dúvida, use a **versão CEP** (`.zxp`): ela também funciona nas versões mais novas enquanto a Adobe mantiver o CEP no Premiere. Para ver sua versão: *Ajuda > Sobre o Premiere Pro*.

## Como funciona

1. **Selecione o clipe** que quer decupar na timeline (por exemplo, o clipe principal com câmera + voz). O painel detecta a seleção sozinho e mostra o nome e o trecho do clipe. Sem nada selecionado, o botão pede para você selecionar um clipe.
2. Clique em **Decupar clipe selecionado**. O plugin:
   - exporta só o áudio desse clipe como WAV, usando o próprio Premiere (as outras trilhas de áudio ficam mutadas durante a exportação e voltam ao estado original depois, então música e efeitos não atrapalham);
   - analisa o áudio em JavaScript puro: nível em dB a cada 10 ms, regiões abaixo do limiar, margens e filtro de ruídos curtos. Com **Automático** marcado, o limiar é calculado a partir do próprio clipe;
   - corta vídeo e áudio juntos no início e no fim de cada silêncio, só dentro do trecho do clipe, e então:
     - **Remover (ripple):** apaga os trechos e fecha os buracos.
     - **Desativar:** desativa os trechos sem mover nada.
     - **Só marcar:** adiciona marcadores nas regiões, sem cortar.
3. No fim, o painel mostra quantos cortes foram feitos e quanto tempo saiu.

Por padrão, o plugin trabalha numa **cópia da sequência**, então a original fica intacta.

> **Limitação conhecida:** o corte é feito em **todas as trilhas** no mesmo instante. Se houver outra coisa no mesmo trecho do clipe (uma música numa trilha de baixo, por exemplo), ela também será cortada nesses pontos. Para o caso de um clipe principal sozinho na timeline, isso não faz diferença.

> **Trava de segurança (CEP):** depois de cada remoção, o plugin confere se a sequência encolheu. Se o Premiere não fechar o buraco, ele para na hora e avisa, em vez de seguir e dessincronizar a timeline.

## Instalação (usuário final)

Baixe o arquivo da sua versão (veja a tabela acima) na página de [**Releases**](https://github.com/kauanfelipeppdev/decupa/releases/latest) do GitHub.

### Com o ZXP/UXP Installer (recomendado)

O [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/) da aescripts é gratuito, funciona no Windows e no macOS e instala tanto `.zxp` (CEP) quanto `.ccx` (UXP) de qualquer desenvolvedor.

1. Baixe e instale o programa pelo link: <https://aescripts.com/learn/zxp-installer/>.
2. Abra o Premiere Pro ao menos uma vez e **feche-o** antes de instalar.
3. Abra o ZXP/UXP Installer e **arraste o `Decupa.zxp`** (ou o `Decupa.ccx`) para a janela do programa (ou use *File > Open* e escolha o arquivo).
   - No Windows, não arraste direto de dentro de um `.zip`: extraia antes (por exemplo, na Área de Trabalho).
4. Se aparecer o aviso "no compatible applications were found", clique em **Install** mesmo assim.
5. Abra o Premiere e procure o painel:
   - **CEP (`.zxp`):** *Janela > Extensões > Decupa*.
   - **UXP (`.ccx`):** *Janela > Plug-ins UXP > Decupa*.

Se o instalador travar ou falhar, atualize o app Creative Cloud: o ZXP/UXP Installer usa o instalador de plugins da Adobe (UPIA) por baixo. Mais ajuda no [FAQ oficial](https://aescripts.com/knowledgebase/index/view/faq/zxp-installer-faq).

**Painel CEP em branco depois de instalar?** É um problema conhecido da Adobe com extensões assinadas fora do Marketplace ([detalhes](https://github.com/Adobe-CEP/CEP-Resources/blob/master/ZXPSignCMD/KnownIssue2024.md)). Ative o modo de depuração do CEP e reabra o Premiere. No Windows, rode no Prompt de Comando:

```bat
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
reg add HKCU\Software\Adobe\CSXS.12 /v PlayerDebugMode /t REG_SZ /d 1 /f
```

No macOS: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1` e `defaults write com.adobe.CSXS.12 PlayerDebugMode 1`.

### `.ccx` com o app Creative Cloud

Dê dois cliques no `.ccx` e confirme em **Instalar**. O painel aparece em *Janela > Plug-ins UXP > Decupa*.

### `.ccx` sem o app Creative Cloud (linha de comando)

A Adobe também oferece um instalador de linha de comando, o **UPIA** (Unified Plugin Installer Agent), que instala `.ccx` sem abrir o app Creative Cloud. Ele fica junto dos componentes do Creative Cloud, então precisa existir na máquina.

> Antes de instalar, abra o Premiere ao menos uma vez e depois feche-o.

**Windows:** abra o **Prompt de Comando como administrador** e rode:

```bat
cd "C:\Program Files\Common Files\Adobe\Adobe Desktop Common\RemoteComponents\UPI\UnifiedPluginInstallerAgent"
UnifiedPluginInstallerAgent.exe /install "C:\Users\SEU_USUARIO\Downloads\Decupa.ccx"
```

**macOS:** no **Terminal**, rode:

```bash
cd "/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/macOS"
sudo ./UnifiedPluginInstallerAgent --install ~/Downloads/Decupa.ccx
```

Outros comandos úteis (no macOS, troque `/` por `--`):

| Ação | Windows |
| --- | --- |
| Listar plugins instalados | `UnifiedPluginInstallerAgent.exe /list all` |
| Desinstalar | `UnifiedPluginInstallerAgent.exe /remove "Decupa"` |
| Ajuda | `UnifiedPluginInstallerAgent.exe /help` |

Documentação oficial: [Install plugins using UPIA](https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/install-plugins-using-upia-tool.html).

## Preset de áudio WAV (uma vez só)

As duas versões precisam de um preset de exportação que gere WAV:

1. No Premiere, abra *Arquivo > Exportar > Mídia*.
2. Em **Formato**, escolha **Waveform Audio**.
3. Em Áudio, use **Mono**, **16000 Hz** (ou a menor taxa disponível) e **16 bits**. Isso deixa o arquivo pequeno e a análise rápida.
4. Salve o preset (ícone de salvar ao lado de "Predefinição") e exporte o `.epr` para uma pasta fácil de achar.
5. No painel, clique em **Escolher…** e selecione esse `.epr`. O caminho fica salvo para as próximas vezes.

## Desenvolvimento

### Versão CEP

1. Ative o modo de depuração do CEP (comandos `reg add` / `defaults write` acima).
2. Crie um link da pasta `cep/` dentro da pasta de extensões do usuário. No Windows (Prompt de Comando):
   ```bat
   mklink /J "%APPDATA%\Adobe\CEP\extensions\decupa" "C:\caminho\para\decupa\cep"
   ```
   No macOS: `ln -s /caminho/para/decupa/cep ~/Library/Application\ Support/Adobe/CEP/extensions/decupa`.
3. Abra o Premiere: o painel aparece em *Janela > Extensões > Decupa*. Depois de editar o código, feche e reabra o painel.

Para gerar o `.zxp` assinado, baixe o [ZXPSignCmd](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD) da Adobe e rode:

```bash
ZXPSIGNCMD=/caminho/ZXPSignCmd npm run package:cep
```

O script cria um certificado autoassinado em `cert/` (fora do git) na primeira vez e gera `dist/Decupa.zxp`.

> **Suba a versão a cada novo `.zxp`** (`ExtensionBundleVersion` e `Version` em `cep/CSXS/manifest.xml`). O instalador da Adobe diz "Installation Successful" mas **não substitui** os arquivos se a versão for a mesma que já está instalada.

### Versão UXP

1. Abra o Premiere Pro.
2. Abra o [**UXP Developer Tool**](https://developer.adobe.com/premiere-pro/uxp/introduction/), clique em **Add Plugin** e selecione `plugin/manifest.json`.
3. Clique em **Load**. O painel aparece em *Janela > Plug-ins UXP > Decupa*.
4. Depois de editar o código, use **Reload** no UDT.

## Estrutura

```
cep/                    ← versão CEP (Premiere até 27.0)
  CSXS/manifest.xml
  index.html, styles.css
  main.js               ← interface do painel
  host/decupa.jsx       ← ExtendScript: seleção, exportação, razor do QE, ripple
  lib/silence.js        ← cópia de plugin/lib/silence.js
plugin/                 ← versão UXP (Premiere 27.1+)
  manifest.json
  index.html, styles.css
  main.js               ← interface do painel
  lib/silence.js        ← detecção (JS puro, sem Premiere)
  lib/premiere.js       ← exportação de áudio e edição da timeline
scripts/package-cep.js  ← gera o .zxp assinado
test/                   ← testes com Node (node --test)
```

`plugin/lib/silence.js` é a fonte da detecção. O `package:cep` copia ele para `cep/lib/` e um teste falha se as duas cópias ficarem diferentes.

## Testes

```bash
npm test
```

- `silence.test.js` testa a detecção com WAVs sintéticos.
- `premiere.mock.test.js` testa a versão UXP contra uma timeline simulada.
- `cep.host.test.js` roda o ExtendScript da versão CEP no Node, com um Premiere e um QE DOM simulados.

## Checklist de validação no Premiere

Marcado = validado na versão CEP, Premiere 26.2, Windows.


- [ ] O painel abre, o tema fica legível e dá para rolar; o botão "Decupar" fica sempre visível.
- [x] Selecionar um clipe atualiza o painel em até 1 segundo.
- [ ] Durante a exportação só a trilha do clipe fica audível, e o mute das trilhas volta ao normal depois.
- [x] A exportação WAV com o preset funciona e o arquivo é lido.
- [x] "Só marcar" cria marcadores nos lugares certos.
- [x] "Desativar" corta e desativa os trechos certos em vídeo e áudio.
- [x] "Remover" faz o ripple sem dessincronizar as trilhas.
- [ ] A duplicação da sequência abre a cópia como ativa.
- [ ] O desempenho com mais de 200 cortes é aceitável.

## Roadmap

- [ ] Undo em um passo só.
- [x] Analisar só o clipe selecionado, em vez da mixagem.
- [x] Versão CEP para cortar em Premiere anterior à 27.1.
- [ ] Cortar só as trilhas do clipe selecionado (hoje o corte pega todas).
- [ ] Respeitar in/out da sequência.
- [x] Empacotar `.ccx` / `.zxp` e publicar nos Releases.
- [ ] Publicar no Adobe Marketplace.

## Licença

MIT. Veja [LICENSE](LICENSE).
