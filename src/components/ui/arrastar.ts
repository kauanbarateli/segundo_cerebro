"use client";

import { KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

/**
 * Os sensores de arrasto do aplicativo, num lugar só.
 *
 * Estava escrito idêntico em `TaskBoard.tsx` e em `SettingsPanels.tsx`. Duas
 * cópias de uma configuração de acessibilidade divergem em silêncio: um dia
 * alguém ajusta a distância de ativação num arquivo, o outro continua como
 * estava, e o quadro passa a responder diferente da lista de módulos sem que
 * nada quebre.
 *
 * `PointerSensor` com `distance: 6` — sem essa margem, todo CLIQUE num card
 * vira um micro-arrasto e o clique nunca chega ao `onClick`. Seis pixels é o
 * bastante para separar a intenção sem exigir firmeza de quem usa touchpad.
 *
 * `KeyboardSensor` é o que mantém o arrasto utilizável SEM MOUSE: espaço pega,
 * as setas movem entre irmãos (é o que `sortableKeyboardCoordinates` traduz),
 * espaço solta, Esc cancela. Sem ele, reordenar seria um gesto exclusivo de
 * quem consegue apontar e manter pressionado.
 *
 * ⚠️ A detecção de colisão NÃO está aqui de propósito: o quadro usa
 * `closestCorners` (colunas lado a lado, o canto diz mais) e a lista de módulos
 * usa `closestCenter` (uma coluna só). Unificá-la pioraria os dois.
 */
export function useSensoresDeArrastar() {
  return useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
