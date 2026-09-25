/**
 * PNG 下載按鈕：將圖表 SVG 轉為 PNG，交給 saveFile 存檔（Tauri 裡是原生另存新檔）。
 */

import { useState, useCallback } from "react";
import type { RefObject } from "react";
import { useI18n } from "../../i18n";
import { saveFile } from "../../utils/saveFile";

// 用 FileReader 而不是 blob.arrayBuffer()：兩者在 WebView 裡都有，但測試用的 jsdom 只有前者
function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

interface ChartDownloadButtonProps {
  chartRef: RefObject<HTMLDivElement | null>;
}

export function ChartDownloadButton({ chartRef }: ChartDownloadButtonProps) {
  const { t } = useI18n();
  const [error, setError] = useState(false);

  const handleDownload = useCallback(() => {
    setError(false);

    const container = chartRef.current;
    if (!container) {
      setError(true);
      return;
    }

    // 主圖表是 .recharts-wrapper 的直接子元素。圖例的色點也是 svg.recharts-surface，
    // 而且排在前面：直接取第一個 svg 會下載到 14×14 的色點
    const svg =
      container.querySelector<SVGSVGElement>(".recharts-wrapper > svg.recharts-surface") ??
      container.querySelector("svg");
    if (!svg) {
      setError(true);
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const w = svg.clientWidth || svg.getBoundingClientRect().width;
      const h = svg.clientHeight || svg.getBoundingClientRect().height;
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError(true);
        return;
      }

      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);

      canvas.toBlob((blob) => {
        if (!blob) {
          setError(true);
          return;
        }
        // 取消對話框不是錯誤；只有存檔真的失敗才顯示
        void blobToBytes(blob)
          .then((bytes) => saveFile("comparison-chart.png", bytes))
          .catch(() => setError(true));
      }, "image/png");
    };
    img.onerror = () => setError(true);
    // data: 而不是 blob:：tauri.conf.json 的 CSP img-src 允許 data:、不允許 blob:，
    // 用 blob: 的話正式版的圖片載入會被擋，只會走到 onerror
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`;
  }, [chartRef]);

  return (
    <span className="compare-download-wrapper">
      <button
        className="btn btn-sm compare-download-btn"
        onClick={handleDownload}
        data-testid="compare-download-btn"
      >
        {t.compare.download}
      </button>
      {error && (
        <span className="compare-download-error" role="alert">
          {t.compare.downloadFailed}
        </span>
      )}
    </span>
  );
}
