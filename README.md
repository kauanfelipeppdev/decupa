# Decupa

Plugin **gratuito e open source** para Adobe Premiere Pro que faz a decupagem automática: detecta e remove os silêncios da sequência ativa, direto num painel dentro do Premiere.

> Status: **v0.1, protótipo.** A detecção de silêncio está testada. A parte que edita a timeline segue a API oficial da Adobe, mas ainda precisa ser validada dentro do Premiere.

## Como funciona

1. **Selecione o clipe** que quer decupar na timeline (por exemplo, o clipe principal com câmera + voz). O painel detecta a seleção sozinho e mostra o nome e o trecho do clipe. Sem nada selecionado, o botão fica desativado.
2. Clique em **Decupar clipe selecionado**. O plugin:
   - exporta só o áudio desse clipe como WAV, usando o próprio Premiere (as outras trilhas de áudio ficam mutadas durante a exportação e voltam ao estado original depois, então música e efeitos não atrapalham);
   - analisa o áudio em JavaScript puro: nível em dB a cada 10 ms, regiões abaixo do limiar, margens e filtro de ruídos curtos. Com **Automático** marcado, o limiar é calculado a partir do próprio clipe;
   - corta vídeo e áudio juntos no início e no fim de cada silêncio, só dentro do trecho do clipe, e então:
     - **Remover (ripple):** apaga os trechos e fecha os buracos.
     - **Desativar:** desativa os trechos sem mover nada.
     - **Só marcar:** adiciona marcadores nas regiões, sem cortar.
3. No fim, o painel mostra quantos cortes foram feitos e quanto tempo saiu.

Por padrão, o plugin trabalha numa **cópia da sequência**, então a original fica intacta.

> **Limitação conhecida:** a API de corte do Premiere corta **todas as trilhas** no mesmo instante. Se houver outra coisa no mesmo trecho do clipe (uma música numa trilha de baixo, por exemplo), ela também será cortada nesses pontos. Para o caso de um clipe principal sozinho na timeline, isso não faz diferença.

## Requisitos

- Premiere Pro **25.6+** para o painel e o modo "Só marcar".
- Premiere Pro **27.1+** para cortar ou remover (API de razor). Em versões anteriores (ex.: 26.2) o painel avisa e usa o modo "Só marcar".
- [UXP Developer Tool (UDT)](https://developer.adobe.com/premiere-pro/uxp/introduction/), instalado pelo Creative Cloud, para carregar o plugin em desenvolvimento.

## Instalação (usuário final)

Baixe o arquivo `Decupa.ccx` na página de [**Releases**](https://github.com/kauanfelipeppdev/decupa/releases/latest) do GitHub.

### Com o ZXP/UXP Installer (recomendado)

O [ZXP/UXP Installer](https://aescripts.com/learn/zxp-installer/) da aescripts é gratuito, funciona no Windows e no macOS e instala arquivos `.ccx` de qualquer desenvolvedor.

1. Baixe e instale o programa pelo link: <https://aescripts.com/learn/zxp-installer/>.
2. Abra o Premiere Pro ao menos uma vez e **feche-o** antes de instalar.
3. Abra o ZXP/UXP Installer e **arraste o `Decupa.ccx`** para a janela do programa (ou use *File > Open* e escolha o arquivo).
   - No Windows, não arraste direto de dentro de um `.zip`: extraia antes (por exemplo, na Área de Trabalho).
4. Se aparecer o aviso "no compatible applications were found", clique em **Install** mesmo assim.
5. Abra o Premiere e procure o painel em *Janela > Plug-ins UXP > Decupa*.

Se o instalador travar ou falhar, atualize o app Creative Cloud: o ZXP/UXP Installer usa o instalador de plugins da Adobe (UPIA) por baixo. Mais ajuda no [FAQ oficial](https://aescripts.com/knowledgebase/index/view/faq/zxp-installer-faq).

### Com o app Creative Cloud

Dê dois cliques no `.ccx` e confirme em **Instalar**. O painel aparece em *Janela > Plug-ins UXP > Decupa*.

### Sem o app Creative Cloud (linha de comando)

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

Depois, abra o Premiere e procure o painel em *Janela > Plug-ins UXP > Decupa*.

Se a pasta do UPIA não existir na sua máquina, o jeito é usar o app Creative Cloud ou o UXP Developer Tool (veja abaixo).

Documentação oficial: [Install plugins using UPIA](https://helpx.adobe.com/creative-cloud/apps/integration-with-other-apps/manage-plugins/install-plugins-using-upia-tool.html).

## Instalação (desenvolvimento)

1. Abra o Premiere Pro.
2. Abra o **UXP Developer Tool**, clique em **Add Plugin** e selecione `plugin/manifest.json`.
3. Clique em **Load**. O painel aparece em *Janela > Plug-ins UXP > Decupa*.
4. Depois de editar o código, use **Reload** no UDT.

## Preset de áudio WAV (uma vez só)

O plugin precisa de um preset de exportação que gere WAV:

1. No Premiere, abra *Arquivo > Exportar > Mídia*.
2. Em **Formato**, escolha **Waveform Audio**.
3. Em Áudio, use **Mono**, **16000 Hz** (ou a menor taxa disponível) e **16 bits**. Isso deixa o arquivo pequeno e a análise rápida.
4. Salve o preset (ícone de salvar ao lado de "Predefinição") e exporte o `.epr` para uma pasta fácil de achar.
5. No painel, clique em **Escolher…** e selecione esse `.epr`. O caminho fica salvo para as próximas vezes.

## Estrutura

```
plugin/                 ← o que o UDT carrega
  manifest.json
  index.html, styles.css
  main.js               ← interface do painel
  lib/silence.js        ← detecção (JS puro, sem Premiere)
  lib/premiere.js       ← exportação de áudio e edição da timeline
  icons/
test/                   ← testes com Node (node --test)
```

## Testes

```bash
npm test
```

`silence.test.js` testa a detecção com WAVs sintéticos. `premiere.mock.test.js` testa a lógica de corte contra uma timeline simulada.

## Checklist de validação no Premiere

- [ ] O painel abre, o tema fica legível e dá para rolar; o botão "Decupar" fica sempre visível.
- [ ] Selecionar um clipe atualiza o painel na hora; tirar a seleção desativa o botão.
- [ ] Durante a exportação só a trilha do clipe fica audível, e o mute das trilhas volta ao normal depois.
- [ ] A exportação WAV com o preset funciona e o arquivo é lido.
- [ ] "Só marcar" cria marcadores nos lugares certos.
- [ ] "Desativar" corta e desativa os trechos certos em vídeo e áudio.
- [ ] "Remover" faz o ripple sem dessincronizar as trilhas.
- [ ] A duplicação da sequência abre a cópia como ativa.
- [ ] O desempenho com mais de 200 cortes é aceitável.

## Roadmap

- [ ] Undo em um passo só (agrupar transações).
- [x] Analisar só o clipe selecionado, em vez da mixagem.
- [ ] Cortar só as trilhas do clipe selecionado (hoje o razor corta todas).
- [ ] Respeitar in/out da sequência.
- [x] Empacotar `.ccx` e publicar nos Releases.
- [ ] Publicar no Adobe Marketplace.

## Licença

MIT. Veja [LICENSE](LICENSE).
