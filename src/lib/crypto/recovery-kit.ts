/**
 * Kit de recuperação do Cofre — o ARTEFATO: serializar, ler de volta e provar
 * que o par (arquivo, código) realmente abre o cofre.
 *
 * ============================================================================
 * O DEFEITO QUE ESTE ARQUIVO EXISTE PARA FECHAR
 * ============================================================================
 * `exportRecoveryKit()` sempre devolveu DUAS metades: um código de alta entropia
 * e o `kit` — a chave de dados reembrulhada sob esse código, com o sal, o IV e
 * os parâmetros do Argon2id. A tela antiga exibia o código, descartava o kit e
 * chamava aquilo de "kit de recuperação".
 *
 * Um código sozinho não decifra nada. Ele é só a SENHA de um cofrinho que era
 * jogado fora no mesmo instante em que nascia. O resultado não era "recuperação
 * fraca": era perda de dados garantida com uma promessa na tela, porque alguém
 * confiaria no papel com o código e trataria a senha mestra como descartável.
 *
 * ============================================================================
 * O DESENHO: DUAS METADES, DOIS LUGARES
 * ============================================================================
 * O artefato é um arquivo `.json` que o navegador baixa. O código NÃO vai
 * dentro dele — de propósito. Se fosse, o arquivo sozinho abriria o cofre, e um
 * backup automático da pasta Downloads (OneDrive, Google Drive, Time Machine)
 * passaria a ser uma cópia completa do cofre em texto útil para quem tiver
 * acesso àquela nuvem. Separando, o arquivo pode viver na nuvem e o código no
 * papel/gerenciador de senhas, e nenhum dos dois vazamentos isolados basta.
 *
 * O preço é explícito e precisa estar na tela: PERDER QUALQUER UMA DAS DUAS
 * METADES INUTILIZA O KIT.
 *
 * ============================================================================
 * POR QUE O ARQUIVO É VERSIONADO
 * ============================================================================
 * Este arquivo é lido por uma versão FUTURA do aplicativo — é a única situação
 * em que ele serve para alguma coisa. Entre a gravação e a leitura pode ter
 * passado um ano e várias mudanças de parâmetro do Argon2id.
 *
 * Por isso o material carrega os próprios parâmetros de derivação (é o que
 * `unlockVault` já consome) e o envelope carrega um `formatVersion`. Uma versão
 * MAIOR que a suportada tem que falhar dizendo "atualize o aplicativo", nunca
 * tentar interpretar campos que não entende — um parser otimista aqui produz
 * uma chave errada e um erro de GCM genérico, e a pessoa conclui que perdeu o
 * cofre quando na verdade só precisava de outra versão do programa.
 */

import {
  base64ToBytes,
  formatRecoveryCode,
  unlockVault,
  type KdfParameters,
  type VaultMasterKeyMaterial,
} from "./vault";

export const RECOVERY_KIT_FORMAT = "segundo-cerebro/vault-recovery-kit";

/** Versão do ENVELOPE, não da criptografia (essa é `material.cryptoVersion`). */
export const RECOVERY_KIT_FORMAT_VERSION = 1;

export interface RecoveryKitArtifact {
  format: typeof RECOVERY_KIT_FORMAT;
  formatVersion: number;
  createdAt: string;
  /**
   * Exatamente o que `unlockVault` consome. Fica aninhado em vez de espalhado na
   * raiz para que a leitura seja `unlockVault(codigo, artefato.material)` sem
   * remontagem — todo campo que precisasse ser reconstruído na leitura seria uma
   * chance de reconstruir errado.
   */
  material: VaultMasterKeyMaterial;
}

/**
 * Falha de LEITURA do artefato, com mensagem que já serve de texto de tela.
 *
 * Existe separada de um `Error` cru porque as causas são acionáveis e
 * diferentes entre si: arquivo errado, arquivo corrompido e aplicativo velho
 * demais pedem três reações distintas do usuário. Um `catch` genérico com
 * "arquivo inválido" apagaria essa diferença justamente no momento em que a
 * pessoa está tentando recuperar dados e não tem uma segunda chance.
 */
export class RecoveryKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryKitError";
  }
}

/* -------------------------------------------------------------- serializar */

export function serializeRecoveryKit(
  material: VaultMasterKeyMaterial,
  createdAt: Date,
): string {
  const artifact: RecoveryKitArtifact = {
    format: RECOVERY_KIT_FORMAT,
    formatVersion: RECOVERY_KIT_FORMAT_VERSION,
    createdAt: createdAt.toISOString(),
    material,
  };
  // Indentado de propósito: este arquivo pode acabar aberto num bloco de notas
  // por alguém tentando entender o que guardou. JSON numa linha só parece lixo
  // binário e convida a ser apagado.
  return `${JSON.stringify(artifact, null, 2)}\n`;
}

/** `cofre-kit-de-recuperacao-2026-08-02.json` — ordenável e óbvio na pasta. */
export function recoveryKitFilename(createdAt: Date): string {
  const iso = createdAt.toISOString().slice(0, 10);
  return `cofre-kit-de-recuperacao-${iso}.json`;
}

/* ------------------------------------------------------------------- ler */

function exigirBase64(valor: unknown, campo: string): string {
  if (typeof valor !== "string" || valor.length === 0) {
    throw new RecoveryKitError(`O arquivo do kit está incompleto (falta "${campo}").`);
  }
  // Validar AGORA e não no `atob` lá dentro: um base64 quebrado detectado
  // durante o unwrap chega como falha de descriptografia, indistinguível de
  // código errado. Aqui ainda dá para dizer qual campo está corrompido.
  try {
    base64ToBytes(valor);
  } catch {
    throw new RecoveryKitError(`O arquivo do kit está corrompido (campo "${campo}").`);
  }
  return valor;
}

function exigirParametrosKdf(valor: unknown): KdfParameters {
  const p = valor as Partial<KdfParameters> | null | undefined;
  const numeros: (keyof KdfParameters)[] = [
    "parallelism",
    "iterations",
    "memorySizeKb",
    "hashLengthBytes",
  ];
  for (const campo of numeros) {
    const n = p?.[campo];
    if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) {
      throw new RecoveryKitError(
        `O arquivo do kit está corrompido (parâmetro "${campo}" inválido).`,
      );
    }
  }
  return p as KdfParameters;
}

/**
 * Lê o texto do arquivo e devolve o material pronto para `unlockVault`.
 *
 * Valida campo a campo em vez de confiar no formato: o arquivo vem do disco do
 * usuário, pode ter sido editado, truncado por sincronização interrompida ou
 * simplesmente ser o arquivo errado. Cada `throw` daqui é uma frase que a
 * pessoa consegue agir em cima.
 */
export function parseRecoveryKit(text: string): VaultMasterKeyMaterial {
  let bruto: unknown;
  try {
    bruto = JSON.parse(text);
  } catch {
    throw new RecoveryKitError("Este arquivo não é um kit de recuperação (não é JSON válido).");
  }

  const envelope = bruto as Partial<RecoveryKitArtifact> | null;
  if (!envelope || typeof envelope !== "object") {
    throw new RecoveryKitError("Este arquivo não é um kit de recuperação.");
  }
  if (envelope.format !== RECOVERY_KIT_FORMAT) {
    throw new RecoveryKitError(
      "Este arquivo não é um kit de recuperação do Cofre. Verifique se selecionou o arquivo certo.",
    );
  }

  const versao = envelope.formatVersion;
  if (typeof versao !== "number" || !Number.isInteger(versao) || versao < 1) {
    throw new RecoveryKitError("O arquivo do kit está corrompido (versão do formato inválida).");
  }
  if (versao > RECOVERY_KIT_FORMAT_VERSION) {
    // NÃO tenta ler assim mesmo. Ver o cabeçalho do arquivo.
    throw new RecoveryKitError(
      `Este kit foi gerado por uma versão mais nova do aplicativo (formato ${versao}). ` +
        "Atualize o Segundo Cérebro e tente de novo.",
    );
  }

  const material = envelope.material as Partial<VaultMasterKeyMaterial> | undefined;
  if (!material || typeof material !== "object") {
    throw new RecoveryKitError("O arquivo do kit está incompleto (falta o bloco de material).");
  }
  if (material.kdfAlgorithm !== "argon2id") {
    throw new RecoveryKitError(
      `O kit usa um algoritmo de derivação desconhecido ("${String(material.kdfAlgorithm)}").`,
    );
  }

  return {
    wrappedDataKeyB64: exigirBase64(material.wrappedDataKeyB64, "wrappedDataKeyB64"),
    wrapIvB64: exigirBase64(material.wrapIvB64, "wrapIvB64"),
    kdfSaltB64: exigirBase64(material.kdfSaltB64, "kdfSaltB64"),
    kdfAlgorithm: "argon2id",
    kdfParameters: exigirParametrosKdf(material.kdfParameters),
    cryptoVersion:
      typeof material.cryptoVersion === "number" ? material.cryptoVersion : 1,
  };
}

/* -------------------------------------------------------------- recuperar */

/**
 * Desembrulha a chave de dados a partir do par (arquivo, código).
 *
 * O código passa por `formatRecoveryCode` antes de virar entrada do Argon2id —
 * é o que faz "aB3dKk9Z…" digitado sem hífen, com espaços ou com quebra de linha
 * derivar a MESMA chave que "aB3d-Kk9Z-…". Sem essa normalização, digitar certo
 * de um jeito diferente é indistinguível de digitar errado.
 */
export async function restoreDataKeyFromKit(
  recoveryCode: string,
  material: VaultMasterKeyMaterial,
): Promise<CryptoKey> {
  const codigo = formatRecoveryCode(recoveryCode);
  if (codigo.length === 0) {
    throw new RecoveryKitError("Informe o código de recuperação.");
  }
  try {
    return await unlockVault(codigo, material);
  } catch {
    // O erro do WebCrypto aqui é sempre o mesmo (falha de autenticação do GCM) e
    // não distingue código errado de arquivo adulterado. Como o `parse` já
    // atestou a integridade estrutural do arquivo, o suspeito provável é o
    // código — e é isso que a mensagem diz, sem afirmar mais do que se sabe.
    throw new RecoveryKitError(
      "O código de recuperação não abre este kit. Confira se copiou o código inteiro e se o arquivo corresponde a este cofre.",
    );
  }
}

/**
 * PROVA que um artefato recém-gerado recupera a chave que está viva na aba.
 *
 * Este é o critério de pronto do kit, executado em vez de prometido. O fluxo de
 * criação obriga o usuário a reenviar o arquivo BAIXADO e a digitar o código
 * ANTES de a tela dizer que existe recuperação: o texto que entra aqui vem do
 * disco, não da memória, então o caminho exercitado é o mesmo caminho de um
 * desastre real — serializar, gravar, ler de volta, desembrulhar.
 *
 * A comparação é de BYTES da chave, não "o unwrap não explodiu". Um kit gerado a
 * partir de outro cofre desembrulharia com sucesso a chave errada, e o cofre
 * pareceria recuperável enquanto todos os itens falhariam ao decifrar.
 */
export async function verifyRecoveryKitArtifact(input: {
  artifactText: string;
  recoveryCode: string;
  dataKey: CryptoKey;
}): Promise<void> {
  const material = parseRecoveryKit(input.artifactText);
  const recuperada = await restoreDataKeyFromKit(input.recoveryCode, material);

  const subtle = globalThis.crypto.subtle;
  const [esperada, obtida] = await Promise.all([
    subtle.exportKey("raw", input.dataKey),
    subtle.exportKey("raw", recuperada),
  ]);

  const a = new Uint8Array(esperada);
  const b = new Uint8Array(obtida);
  const iguais = a.length === b.length && a.every((byte, i) => byte === b[i]);
  if (!iguais) {
    throw new RecoveryKitError(
      "Este kit abre um cofre diferente. Gere um kit novo a partir desta sessão.",
    );
  }
}
