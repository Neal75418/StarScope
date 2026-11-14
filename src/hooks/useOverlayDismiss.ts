/**
 * 對話框遮罩的「點空白處關閉」：按下與放開都在遮罩本身才算。
 */

import { useRef } from "react";
import type { MouseEvent } from "react";

interface OverlayDismissProps {
  onMouseDown: (event: MouseEvent) => void;
  onMouseUp: (event: MouseEvent) => void;
  onClick: (event: MouseEvent) => void;
}

/** 一次點擊走到哪一步：還沒在遮罩上按下、按下了、也在遮罩上放開了 */
type PressStage = "none" | "pressed" | "released";

/**
 * 回傳要展開到遮罩元素上的事件處理。
 *
 * 只看 click 會誤關：在框內按下、拖到框外才放開（拖曳選取文字時很常見），或反過來在遮罩按下、
 * 拖進框內才放開，瀏覽器都把 click 發給按下與放開兩處的共同祖先，也就是遮罩。
 */
export function useOverlayDismiss(onDismiss: () => void, enabled = true): OverlayDismissProps {
  const stage = useRef<PressStage>("none");

  return {
    onMouseDown: (event) => {
      stage.current = event.target === event.currentTarget ? "pressed" : "none";
    },
    onMouseUp: (event) => {
      // 放開只算給它前面那一次按下
      const pressedOnOverlay = stage.current === "pressed";
      stage.current =
        pressedOnOverlay && event.target === event.currentTarget ? "released" : "none";
    },
    onClick: (event) => {
      const pressedAndReleasedOnOverlay = stage.current === "released";
      stage.current = "none";
      if (enabled && pressedAndReleasedOnOverlay && event.target === event.currentTarget) {
        onDismiss();
      }
    },
  };
}
