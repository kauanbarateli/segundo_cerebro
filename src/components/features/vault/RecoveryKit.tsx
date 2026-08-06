"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icons";
import { exportRecoveryKit, rewrapDataKey } from "@/lib/crypto/vault";
import {
  parseRecoveryKit,
  recoveryKitFilename,
  restoreDataKeyFromKit,
  serializeRecoveryKit,
  verifyRecoveryKitArtifact,
} from "@/lib/crypto/recovery-kit";
import { CLASSE_DO_CAMPO, CLASSE_DO_CAMPO_MULTILINHA } from "@/components/ui/estilos";
import { cn } from "@/lib/utils";
import { replaceVaultMasterKey } from "@/app/(app)/cofre/actions";

/**
 * Kit de recuperação — as duas telas.
 *
 * `GerarKit` produz o artefato e SÓ declara que existe recuperação depois de
 * provar, ali mesmo, que o arquivo baixado abre o cofre. `RestaurarComKit`
 * consome o artefato quando a senha mestra se perdeu.
 *
 * A CHAVE DE DADOS NUNCA SAI DAQUI. Ela chega por prop, é usada para embrulhar e
 * some com o componente. Nada de `window`, nada de estado global — foi
 * exatamente esse o buraco do `window.__sbEnter`.
 */

/* ---------------------------------------------------------------- utilitário */

/**
 * Dispara o download do artefato.
 *
 * O `revokeObjectURL` sai num `setTimeout` e não na linha seguinte ao `click()`:
 * o clique só ENFILEIRA o download, e revogar a URL no mesmo tick cancela a
 * transferência em parte dos navegadores — resultado seria um "arquivo salvo"
 * que nunca chega ao disco, justamente no recurso cujo defeito era prometer um
 * artefato que não existia.
 */
function baixarArquivo(texto: string, nomeArquivo: string): void {
  const blob = new Blob([texto], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  // Anexar ao documento: parte dos navegadores ignora `click()` em âncora solta.
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function mensagemDeErro(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "Não foi possível concluir.";
}

/* ------------------------------------------------------------------- gerar */

type EtapaGeracao = "inicio" | "gerado" | "verificado";

export function GerarKit({
  dataKey,
  onConcluir,
  onPular,
  rotuloPular = "Agora não",
}: {
  dataKey: CryptoKey;
  onConcluir: () => void;
  onPular?: () => void;
  rotuloPular?: string;
}) {
  const [etapa, setEtapa] = useState<EtapaGeracao>("inicio");
  const [codigo, setCodigo] = useState("");
  const [nomeArquivo, setNomeArquivo] = useState("");
  const [baixado, setBaixado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // O texto do artefato fica em ref, não em estado: ele não é renderizado e
  // guardá-lo em `useState` só acrescentaria re-renders carregando material
  // sensível pela árvore de componentes.
  const artefatoRef = useRef<string>("");

  async function gerar() {
    setOcupado(true);
    setErro(null);
    try {
      const { recoveryCode, kit } = await exportRecoveryKit(dataKey);
      const agora = new Date();
      artefatoRef.current = serializeRecoveryKit(kit, agora);
      setCodigo(recoveryCode);
      setNomeArquivo(recoveryKitFilename(agora));
      setEtapa("gerado");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (etapa === "inicio") {
    return (
      <div className="space-y-4">
        <BlocoExplicativo />
        {erro && <Alerta>{erro}</Alerta>}
        <div className="flex flex-wrap justify-end gap-2">
          {onPular && (
            <Button variant="ghost" size="sm" onClick={onPular} disabled={ocupado}>
              {rotuloPular}
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => void gerar()} disabled={ocupado}>
            {ocupado ? "Gerando…" : "Gerar kit de recuperação"}
          </Button>
        </div>
      </div>
    );
  }

  if (etapa === "verificado") {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
          <p className="flex items-center gap-2 text-corpo font-medium text-ink">
            <Icon.Check width={15} height={15} /> Recuperação verificada neste navegador
          </p>
          <p className="mt-1 text-legenda text-ink-subtle">
            O arquivo <span className="font-medium text-ink-muted">{nomeArquivo}</span> foi lido de
            volta do disco e, com o código, abriu esta mesma chave. Guarde as duas metades em
            lugares diferentes: quem tiver as duas abre o cofre sem a senha mestra.
          </p>
        </div>
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={onConcluir}>
            Continuar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BlocoExplicativo />

      {/* Metade 1 — o código */}
      <div>
        <p className="mb-1.5 text-corpo font-medium text-ink">1. Código de recuperação</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-md border border-line-strong bg-surface-muted px-3 py-2 text-legenda text-ink">
            {codigo}
          </code>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void navigator.clipboard.writeText(codigo)}
          >
            <Icon.Copy width={14} height={14} /> Copiar
          </Button>
        </div>
        <p className="mt-1 text-legenda text-ink-subtle">
          Ele não aparece de novo e não está dentro do arquivo. Guarde num gerenciador de senhas ou
          no papel.
        </p>
      </div>

      {/* Metade 2 — o arquivo */}
      <div>
        <p className="mb-1.5 text-corpo font-medium text-ink">2. Arquivo do kit</p>
        <Button
          variant={baixado ? "secondary" : "primary"}
          size="sm"
          onClick={() => {
            baixarArquivo(artefatoRef.current, nomeArquivo);
            setBaixado(true);
          }}
        >
          <Icon.Download width={14} height={14} />
          {baixado ? "Baixar de novo" : "Baixar kit (.json)"}
        </Button>
      </div>

      {/* A prova */}
      {baixado && (
        <FormularioVerificacao
          nomeArquivo={nomeArquivo}
          dataKey={dataKey}
          onVerificado={() => setEtapa("verificado")}
        />
      )}

      {erro && <Alerta>{erro}</Alerta>}

      {/* Sempre visível, inclusive depois do download: a saída não pode depender
          de concluir a verificação. Quem sai daqui sem verificar não recebe
          promessa nenhuma — que é o comportamento correto —, mas tem que
          conseguir sair. */}
      {onPular && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onPular}>
            {rotuloPular}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * O passo que transforma promessa em fato.
 *
 * O arquivo tem que ser REENVIADO pelo seletor, não reaproveitado da memória: é
 * a leitura do disco que prova que o download chegou inteiro. Ler `artefatoRef`
 * aqui testaria a serialização contra ela mesma e passaria mesmo se o navegador
 * tivesse cancelado a transferência.
 *
 * O que este passo NÃO prova, e vale saber: o código continua visível na tela
 * acima, então digitá-lo de volta não demonstra que ele foi guardado em outro
 * lugar. O que fica demonstrado é o caminho do artefato — serializar, gravar,
 * ler, desembrulhar, bater byte a byte com a chave viva —, que era a metade
 * quebrada.
 */
function FormularioVerificacao({
  nomeArquivo,
  dataKey,
  onVerificado,
}: {
  nomeArquivo: string;
  dataKey: CryptoKey;
  onVerificado: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [codigo, setCodigo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function verificar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      await verifyRecoveryKitArtifact({
        artifactText: await arquivo.text(),
        recoveryCode: codigo,
        dataKey,
      });
      onVerificado();
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="rounded-md border border-line-strong bg-surface-muted p-4">
      <p className="text-corpo font-medium text-ink">3. Confirme que o kit funciona</p>
      <p className="mt-1 text-legenda text-ink-subtle">
        Selecione o <span className="font-medium text-ink-muted">{nomeArquivo}</span> que acabou de
        baixar e digite o código. Enquanto isso não passar, o Cofre continua dizendo que a senha
        mestra é o único caminho — porque, sem a prova, é.
      </p>

      <div className="mt-3 space-y-3">
        <SeletorDeKit onSelecionar={setArquivo} arquivo={arquivo} />
        <CampoCodigo value={codigo} onChange={setCodigo} />
        {erro && <Alerta>{erro}</Alerta>}
        <div className="flex justify-end">
          <Button
            variant="primary"
            size="sm"
            disabled={ocupado || !arquivo || !codigo.trim()}
            onClick={() => void verificar()}
          >
            {ocupado ? "Verificando…" : "Verificar kit"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- restaurar */

/**
 * Recuperação de verdade: o cofre existe, a senha mestra se perdeu.
 *
 * Duas etapas separadas de propósito. A primeira só desembrulha a chave e não
 * escreve nada — se o kit estiver errado, o cofre fica exatamente como estava. A
 * segunda grava o novo embrulho. Fundir as duas num formulário só faria a pessoa
 * escolher uma senha nova antes de saber se o kit sequer abre.
 */
export function RestaurarComKit({
  onRestaurado,
  onCancelar,
}: {
  onRestaurado: (dataKey: CryptoKey) => Promise<void> | void;
  onCancelar: () => void;
}) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [codigo, setCodigo] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Chave desembrulhada aguardando a nova senha. Em ref pelo mesmo motivo do
  // resto do Cofre: material de chave não circula por estado de renderização.
  const chaveRef = useRef<CryptoKey | null>(null);
  const [kitAberto, setKitAberto] = useState(false);

  async function abrirKit() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      const material = parseRecoveryKit(await arquivo.text());
      chaveRef.current = await restoreDataKeyFromKit(codigo, material);
      setKitAberto(true);
      setCodigo("");
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  async function definirNovaSenha() {
    const chave = chaveRef.current;
    if (!chave) return;
    if (senha.length < 8) return setErro("Use ao menos 8 caracteres.");
    if (senha !== confirmacao) return setErro("As senhas não coincidem.");

    setOcupado(true);
    setErro(null);
    try {
      const material = await rewrapDataKey(senha, chave);
      const res = await replaceVaultMasterKey({
        ...material,
        kdfParameters: material.kdfParameters as unknown as Record<string, unknown>,
      });
      if (!res.ok) {
        setErro(res.error ?? "Não foi possível salvar a nova senha mestra.");
        return;
      }
      // Consome a chave e zera o ref no mesmo passo.
      chaveRef.current = null;
      setSenha("");
      setConfirmacao("");
      await onRestaurado(chave);
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setOcupado(false);
    }
  }

  if (kitAberto) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
          <p className="flex items-center gap-2 text-corpo font-medium text-ink">
            <Icon.Check width={15} height={15} /> Kit válido
          </p>
          <p className="mt-1 text-legenda text-ink-subtle">
            A chave do cofre foi recuperada. Defina uma senha mestra nova — os itens continuam
            cifrados com a mesma chave, então nada precisa ser reescrito. Este kit continua valendo
            depois da troca.
          </p>
        </div>

        <CampoSenha
          id="nova-mestra"
          label="Nova senha mestra"
          value={senha}
          onChange={setSenha}
          autoComplete="new-password"
        />
        <CampoSenha
          id="nova-mestra-confirma"
          label="Confirmar nova senha mestra"
          value={confirmacao}
          onChange={setConfirmacao}
          autoComplete="new-password"
        />

        {erro && <Alerta>{erro}</Alerta>}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancelar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={ocupado || !senha || !confirmacao}
            onClick={() => void definirNovaSenha()}
          >
            {ocupado ? "Salvando…" : "Definir senha e abrir cofre"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-corpo text-ink-muted">
        A recuperação precisa das <span className="font-medium text-ink">duas metades</span> do kit:
        o arquivo <code className="text-legenda">.json</code> que você baixou e o código de
        recuperação. Uma metade sozinha não abre nada.
      </p>

      <SeletorDeKit onSelecionar={setArquivo} arquivo={arquivo} />
      <CampoCodigo value={codigo} onChange={setCodigo} />

      {erro && <Alerta>{erro}</Alerta>}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancelar} disabled={ocupado}>
          Voltar
        </Button>
        <Button
          variant="primary"
          size="sm"
          disabled={ocupado || !arquivo || !codigo.trim()}
          onClick={() => void abrirKit()}
        >
          {ocupado ? "Abrindo…" : "Abrir kit"}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ peças */

function BlocoExplicativo() {
  return (
    <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
      <p className="text-corpo font-medium text-ink">O kit tem duas metades</p>
      <p className="mt-1 text-legenda text-ink-subtle">
        Um <span className="font-medium text-ink-muted">arquivo .json</span> e um{" "}
        <span className="font-medium text-ink-muted">código de recuperação</span>. Juntos, abrem o
        cofre sem a senha mestra. Separados, não abrem nada — por isso o código não vai dentro do
        arquivo: assim o arquivo pode ficar na nuvem sem que o backup dela vire uma cópia do cofre.
        Perder qualquer uma das duas metades inutiliza o kit.
      </p>
    </div>
  );
}

function SeletorDeKit({
  arquivo,
  onSelecionar,
}: {
  arquivo: File | null;
  onSelecionar: (f: File | null) => void;
}) {
  return (
    <div>
      <label htmlFor="kit-arquivo" className="mb-1.5 block text-corpo font-medium text-ink">
        Arquivo do kit
      </label>
      <input
        id="kit-arquivo"
        type="file"
        accept=".json,application/json"
        onChange={(e) => {
          // Copia a referência ANTES de qualquer await — mesmo motivo do Drive:
          // `e.target.files` é uma lista viva do input.
          onSelecionar(e.target.files?.[0] ?? null);
        }}
        className={cn(CLASSE_DO_CAMPO_MULTILINHA, "w-full file:mr-3 file:rounded-sm file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-corpo file:text-ink")}
      />
      {arquivo && <p className="mt-1 text-legenda text-ink-subtle">{arquivo.name}</p>}
    </div>
  );
}

function CampoCodigo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor="kit-codigo" className="mb-1.5 block text-corpo font-medium text-ink">
        Código de recuperação
      </label>
      <input
        id="kit-codigo"
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // `autoCapitalize`/`autoCorrect` desligados: o código diferencia
        // maiúscula de minúscula (o alfabeto é base64) e o teclado do celular
        // capitaliza a primeira letra por conta própria — o que produziria um
        // "código errado" impossível de enxergar na tela.
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        placeholder="aB3d-Kk9Z-…"
        className={cn(CLASSE_DO_CAMPO, "w-full font-mono")}
      />
      <p className="mt-1 text-legenda text-ink-subtle">
        Hífens e espaços são opcionais. Maiúsculas e minúsculas importam.
      </p>
    </div>
  );
}

function CampoSenha({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-corpo font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(CLASSE_DO_CAMPO, "w-full")}
      />
    </div>
  );
}

function Alerta({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 text-corpo text-danger-ink">
      <Icon.Alert width={15} height={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
