/**
 * Gera dist/Decupa.zxp (versão CEP) assinado com um certificado próprio.
 *
 * Uso:
 *   ZXPSIGNCMD=C:\caminho\ZXPSignCmd.exe npm run package:cep
 *
 * O ZXPSignCmd é a ferramenta oficial da Adobe:
 *   https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD
 *
 * Variáveis opcionais:
 *   DECUPA_CERT           caminho do certificado .p12 (padrão: cert/decupa.p12)
 *   DECUPA_CERT_PASSWORD  senha do certificado (padrão: decupa)
 *   DECUPA_TSA            URL de um servidor de carimbo de tempo (opcional)
 * Se o certificado não existir, ele é criado (autoassinado).
 */

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const signCmd = process.env.ZXPSIGNCMD;
if (!signCmd || !fs.existsSync(signCmd)) {
  console.error("Defina ZXPSIGNCMD com o caminho do ZXPSignCmd (veja o topo deste arquivo).");
  process.exit(1);
}

const cert = process.env.DECUPA_CERT || path.join(root, "cert", "decupa.p12");
const password = process.env.DECUPA_CERT_PASSWORD || "decupa";
const stage = path.join(root, "dist", "cep");
const out = path.join(root, "dist", "Decupa.zxp");

// A detecção é a mesma do plugin UXP: garante que a cópia está em dia.
fs.copyFileSync(path.join(root, "plugin", "lib", "silence.js"), path.join(root, "cep", "lib", "silence.js"));

// Copia a extensão para uma pasta limpa (sem symlinks nem lixo do sistema).
fs.rmSync(stage, { recursive: true, force: true });
fs.cpSync(path.join(root, "cep"), stage, {
  recursive: true,
  dereference: true,
  filter: (src) => !/(\.DS_Store|Thumbs\.db|__MACOSX)$/.test(src),
});

if (!fs.existsSync(cert)) {
  fs.mkdirSync(path.dirname(cert), { recursive: true });
  console.log(`Criando certificado autoassinado em ${cert}`);
  execFileSync(signCmd, ["-selfSignedCert", "BR", "SP", "Decupa", "Decupa", password, cert], { stdio: "inherit" });
}

// Carimbo de tempo é opcional: o ZXPSignCmd 4.1.103 trava com -tsa no
// Windows, então só é usado se DECUPA_TSA (URL do servidor) for definido.
const tsa = process.env.DECUPA_TSA ? ["-tsa", process.env.DECUPA_TSA] : [];
fs.rmSync(out, { force: true });
execFileSync(signCmd, ["-sign", stage, out, cert, password, ...tsa], { stdio: "inherit" });
execFileSync(signCmd, ["-verify", out], { stdio: "inherit" });
console.log(`Pronto: ${out}`);
