# Decupa

Plugin **gratuito e open source** para Adobe Premiere Pro que faz a decupagem automática: detecta e remove os silêncios da sequência ativa, direto num painel dentro do Premiere.

> Status: **v0.1, protótipo.** A detecção de silêncio está testada. A parte que edita a timeline segue a API oficial da Adobe, mas ainda precisa ser validada dentro do Premiere.

## Como funciona

1. O painel exporta o áudio da sequência ativa como WAV, usando o próprio Premiere. Trilhas mutadas ficam de fora, então você pode mutar a música de fundo antes de analisar.
2. O áudio é analisado em JavaScript puro: nível em dB a cada 10 ms, regiões abaixo do limiar, margens e filtro de ruídos curtos.
3. Os ajustes atualizam a pré-visualização em tempo real, sem exportar de novo.
4. Ao aplicar, o plugin corta todas as trilhas no início e no fim de cada silêncio e então:
   - **Remover (ripple):** apaga os trechos e fecha os buracos.
   - **Desativar:** desativa os trechos sem mover nada.
   - **Só marcar:** adiciona marcadores nas regiões, sem cortar.

Por padrão, o plugin trabalha numa **cópia da sequência**, então a original fica intacta.

## Requisitos

- Premiere Pro **25.6+** para o painel e o modo "Só marcar".
- Premiere Pro **27.1+** para cortar ou remover (API de razor).
- [UXP Developer Tool (UDT)](https://developer.adobe.com/premiere-pro/uxp/introduction/), instalado pelo Creative Cloud, para carregar o plugin em desenvolvimento.

## Instalação (usuário final)

Baixe o arquivo `Decupa.ccx` na página de **Releases** do GitHub.

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

- [ ] O painel abre e o tema fica legível.
- [ ] A exportação WAV com o preset funciona e o arquivo é lido.
- [ ] Os sliders atualizam a barra de pré-visualização.
- [ ] "Só marcar" cria marcadores nos lugares certos.
- [ ] "Desativar" corta e desativa os trechos certos em vídeo e áudio.
- [ ] "Remover" faz o ripple sem dessincronizar as trilhas.
- [ ] A duplicação da sequência abre a cópia como ativa.
- [ ] O desempenho com mais de 200 cortes é aceitável.

## Roadmap

- [ ] Undo em um passo só (agrupar transações).
- [ ] Analisar só a trilha de áudio escolhida, em vez da mixagem.
- [ ] Respeitar in/out da sequência.
- [ ] Empacotar `.ccx` e publicar nos Releases e no Adobe Marketplace.

## Licença

MIT. Veja [LICENSE](LICENSE).
