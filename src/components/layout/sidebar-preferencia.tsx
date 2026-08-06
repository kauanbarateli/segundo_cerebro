/**
 * =============================================================================
 * BARRA LATERAL RECOLHIDA — o que servidor e cliente precisam partilhar
 * =============================================================================
 *
 * ONDE O ESTADO MORA: localStorage, chave `sb-sidebar`.
 *
 * Recolher a barra é preferência de LAYOUT, e layout é razoavelmente por
 * DISPOSITIVO: faz todo sentido trabalhar com a barra recolhida no notebook de
 * 13" e expandida no monitor de 27", e essas duas telas são o mesmo usuário. Se
 * a preferência fosse ao banco (junto de `user_preferences`), abrir o monitor
 * grande passaria a herdar a escolha feita no notebook — e o usuário teria que
 * desfazer a decisão do outro aparelho toda vez. O projeto já tomou exatamente
 * essa decisão para o tema, em src/components/theme/ThemeToggle.tsx (`sb-theme`);
 * esta é a segunda ocorrência da mesma regra, com o mesmo prefixo de chave.
 *
 * -----------------------------------------------------------------------------
 * O PISCA-PISCA DA HIDRATAÇÃO, E POR QUE ESTE ARQUIVO NÃO TEM "use client"
 * -----------------------------------------------------------------------------
 * Ler o localStorage dentro de um `useEffect` é o caminho óbvio e está ERRADO
 * aqui: o efeito só roda DEPOIS da hidratação, então a barra nasceria com 16rem
 * (o padrão do servidor, que não tem localStorage nenhum) e pularia para 4rem no
 * primeiro quadro seguinte — arrastando toda a página junto, porque a largura do
 * conteúdo depende dela. É o mesmo defeito que o tema teria (página branca antes
 * de ficar escura) e que o projeto já resolveu do jeito certo: um script embutido
 * que roda ANTES da pintura e marca o `<html>`. A partir daí quem decide a
 * largura é CSS, não React — e CSS já está aplicado no primeiro quadro.
 *
 * `sidebarInitScript` é consumido por um Server Component — `(app)/layout.tsx`, o
 * equivalente ao que o layout raiz faz com `themeInitScript`. Por isso este
 * arquivo NÃO leva a diretiva "use client": um módulo de cliente importado por
 * um componente de servidor é substituído por uma REFERÊNCIA (um proxy que o
 * runtime resolve no navegador), e o servidor precisa do TEXTO da string, agora,
 * para escrever dentro da tag <script>. Constante partilhada entre os dois lados
 * fica em módulo sem diretiva, e é isso que este arquivo é.
 *
 * Extensão .tsx sem JSX dentro: é o que mantém o arquivo dentro de
 * `src/components/layout/*.tsx`, junto dos dois componentes que o usam.
 */

/** Chave do localStorage. Prefixo `sb-`, como `sb-theme`. */
export const CHAVE_SIDEBAR = "sb-sidebar";

/**
 * Atributo escrito no `<html>`. É o único canal entre o script de inicialização
 * e o CSS — o React não participa da decisão de largura (ver acima).
 */
export const ATRIBUTO_SIDEBAR = "data-sidebar";
export const VALOR_RECOLHIDA = "recolhida";
export const VALOR_EXPANDIDA = "expandida";

/**
 * Roda antes da pintura da barra. Copiado, na forma, do `themeInitScript`:
 * IIFE, uma linha, tudo dentro de try/catch.
 *
 * O try/catch não é decoração: `localStorage` LANÇA — não devolve null — quando
 * cookies de terceiros/armazenamento estão bloqueados. Sem ele, uma exceção aqui
 * interromperia o parser no meio do documento e a aplicação inteira sumiria por
 * causa de uma preferência de menu.
 *
 * O `else` que remove o atributo também é necessário: em navegação do lado do
 * cliente o `<html>` sobrevive entre páginas, e sem a remoção um estado antigo
 * ficaria grudado depois de o usuário expandir a barra em outra aba.
 */
export const sidebarInitScript = `(function(){try{var v=localStorage.getItem('${CHAVE_SIDEBAR}');var el=document.documentElement;if(v==='${VALOR_RECOLHIDA}'){el.setAttribute('${ATRIBUTO_SIDEBAR}','${VALOR_RECOLHIDA}');}else{el.removeAttribute('${ATRIBUTO_SIDEBAR}');}}catch(err){}})();`;

/**
 * Lê a preferência guardada. `null` (ou armazenamento bloqueado) = expandida,
 * que é o padrão de quem nunca escolheu.
 *
 * Só roda no navegador — este módulo é importado também por um Server
 * Component, mas nada aqui é executado em tempo de módulo, então `localStorage`
 * nunca é tocado no servidor.
 */
export function lerPreferenciaRecolhida(): boolean {
  try {
    return localStorage.getItem(CHAVE_SIDEBAR) === VALOR_RECOLHIDA;
  } catch {
    // Armazenamento bloqueado (modo privado, cookies de terceiros desligados):
    // a barra abre expandida em vez de a leitura derrubar o render.
    return false;
  }
}

/**
 * Escreve o estado no `<html>` — a MESMA coisa que `sidebarInitScript` faz,
 * porque é o mesmo par atributo/valor.
 *
 * Duas entradas para o mesmo efeito, e as duas são necessárias: o script cobre o
 * carregamento completo de página (antes da pintura, sem pisca-pisca) e esta
 * função cobre o que o script não alcança — o clique no botão e a montagem da
 * barra numa navegação do LADO DO CLIENTE, quando o documento já existe e o
 * script pode nunca ter rodado (por exemplo entrando pelo /login, que fica fora
 * de (app)). Aplicar de novo o que já está aplicado não custa nada.
 */
export function aplicarRecolhidaNoDocumento(recolhida: boolean): void {
  const el = document.documentElement;
  if (recolhida) el.setAttribute(ATRIBUTO_SIDEBAR, VALOR_RECOLHIDA);
  else el.removeAttribute(ATRIBUTO_SIDEBAR);
}

/** Guarda a escolha. Falha em silêncio: recolher agora vale mais que lembrar. */
export function guardarPreferenciaRecolhida(recolhida: boolean): void {
  try {
    localStorage.setItem(CHAVE_SIDEBAR, recolhida ? VALOR_RECOLHIDA : VALOR_EXPANDIDA);
  } catch {
    // Sem armazenamento a barra recolhe agora e esquece no próximo
    // carregamento. Deixar a exceção subir quebraria o clique inteiro.
  }
}

/*
 * -----------------------------------------------------------------------------
 * AS CLASSES DO ESTADO RECOLHIDO
 * -----------------------------------------------------------------------------
 * `[[data-sidebar=recolhida]_&]:x` é variante arbitrária do Tailwind: vira o
 * seletor `[data-sidebar=recolhida] .classe`. Como o atributo está no `<html>`,
 * ele alcança qualquer elemento da página — inclusive o `<main>`, que é irmão da
 * barra e precisa reagir junto (ver `(app)/layout.tsx`).
 *
 * ⚠️ AS STRINGS ABAIXO NÃO PODEM SER MONTADAS COM `${VALOR_RECOLHIDA}`.
 * O Tailwind não executa código: ele varre o CÓDIGO-FONTE procurando nomes de
 * classe COMPLETOS. Um template literal produziria a classe certa em tempo de
 * execução e nenhum CSS correspondente em tempo de compilação — a barra
 * simplesmente não recolheria, sem erro nenhum em lugar nenhum. A duplicação da
 * palavra "recolhida" aqui é deliberada e é o preço de o CSS ser estático.
 *
 * A especificidade sai de graça e a favor: o seletor tem duas partes (0,2,0) e
 * por isso vence `w-64`, `flex` e companhia (0,1,0) independentemente da ordem em
 * que o Tailwind emitir as regras.
 *
 * ⚠️ ISSO PASSOU A SUSTENTAR UMA SEGUNDA COISA. Desde o DS 1.0 a barra tem duas
 * larguras (`w-64 2xl:w-80` — ver AppSidebar.tsx), e o estado recolhido precisa
 * ser 4rem nos DOIS regimes. Não existe um `2xl:` na regra de recolhimento
 * justamente porque estes (0,2,0) já vencem o `2xl:w-80`, que é (0,1,0) — media
 * query não acrescenta especificidade. Escrever o par `2xl:` seria redundante;
 * baixar a especificidade daqui quebraria a barra recolhida acima de 1536px.
 */

/** Some quando a barra recolhe: rótulos, textos de apoio, o bloco de conta. */
export const AO_RECOLHER_OCULTA = "[[data-sidebar=recolhida]_&]:hidden";

/**
 * Linha de navegação que vira só ícone.
 *
 * `h-13` = 52px, a MESMA altura do item expandido (DS §7). A altura é fixada aqui
 * porque o `px-0` abaixo zera o padding horizontal, e sem uma altura declarada o
 * item recolhido passaria a depender só do `py-4` — que sobrevive, mas deixa a
 * medida do trilho refém de uma classe que mora noutro arquivo.
 *
 * Igualar os dois estados é o ponto: recolher a barra não pode mudar a altura das
 * linhas, senão a lista inteira salta no clique e o olho perde o item que estava
 * seguindo. Fica acima dos 44px de alvo mínimo por consequência, não por sorte.
 */
export const AO_RECOLHER_SO_ICONE =
  "[[data-sidebar=recolhida]_&]:h-13 [[data-sidebar=recolhida]_&]:justify-center [[data-sidebar=recolhida]_&]:gap-0 [[data-sidebar=recolhida]_&]:px-0";
