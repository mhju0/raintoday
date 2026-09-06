import LocalForecastExperience from "@/components/local/LocalForecastExperience";

/**
 * The forecast is the site, so it is served at the root. It briefly lived
 * under a path named for the cinematic Seoul sky scene this grew out of; that
 * scene is retired, and the name outlived the thing it named.
 *
 * No page-level `metadata` export: the root layout already declares the same
 * title and description, and a second copy here could only drift from it.
 */
export default function HomePage() {
  return (
    <>
      <LocalForecastExperience />

      <noscript>
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1.25rem",
            padding: "2rem",
            textAlign: "center",
            background: "#0b0f14",
            color: "#e6edf3",
            fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
          }}
        >
          <p style={{ fontSize: "0.7rem", letterSpacing: "0.24em", color: "#8a97a6" }}>
            오늘비 · KOREA
          </p>
          <h1 style={{ fontSize: "clamp(1.8rem, 6vw, 3rem)", fontWeight: 300, margin: 0 }}>
            비, 여기서는 어떨까요?
          </h1>
          <p style={{ maxWidth: "40ch", lineHeight: 1.7, color: "#b7c2ce", margin: 0 }}>
            내 위치의 오늘과 내일 비 예보를 확인하세요. 내일 예보는 관측 기록이 충분하고 비교 기준을 통과하면 서비스별 비중을 조정합니다.
          </p>
          <p style={{ fontSize: "0.85rem", letterSpacing: "0.18em", color: "#8a97a6", margin: 0 }}>
            대한민국 · 오늘과 내일 비 예보
          </p>
          <p style={{ maxWidth: "44ch", fontSize: "0.8rem", lineHeight: 1.7, color: "#8996a5", margin: 0 }}>
            위치 선택과 예보를 보려면 JavaScript를 켜 주세요. 예보: Open-Meteo ·
            기상청 외. 관측 검증: 기상청 ASOS.
          </p>
        </div>
      </noscript>
    </>
  );
}
