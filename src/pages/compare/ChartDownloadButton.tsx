/**
 * PNG 下載按鈕：將圖表 SVG 轉為 PNG 並下載。
 */

import { useState, useCallback } from "react";
import type { RefObject } from "react";
import { useI18n } from "../../i18n";

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

    const svg = container.querySelector("svg");
    if (!svg) {
      setError(true);
      return;
    }

    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const w = svg.clientWidth || svg.getBoundingClientRect().width;
      const h = svg.clientHeight || svg.getBoundingClientRect().height;
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        setError(true);
        return;
      }

      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);

      canvas.toBlob((blob) => {
        if (!blob) {
          setError(true);
          return;
        }
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = "comparison-chart.png";
        a.click();
        URL.revokeObjectURL(blobUrl);
      }, "image/png");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(true);
    };
    img.src = url;
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
