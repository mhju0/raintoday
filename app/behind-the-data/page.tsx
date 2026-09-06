import type { Metadata } from "next";
import Link from "next/link";
import { RecordStationPicker } from "@/components/local/RecordStationPicker";
import { buildBehindTheDataView, resolveRecordLocation } from "@/lib/behindTheData";
import { captureCohortAt, readRecordEvidence } from "@/lib/localForecast";
import { evidenceProximity } from "@/lib/performance/stations";

export const metadata: Metadata = {
  title: "이 예보를 어떻게 채점하는가: 오늘비",
  description:
    "관측소의 예보 채점 기록과 서비스별 비중, 가중치를 적용하거나 중지하는 조건을 확인합니다.",
};

// Rendered per request, because the coordinate arrives in the query string. The
// evidence read behind it is shared for ten minutes and the page states the age
// it actually served — a cohort writes twice a day, so that cannot hide a change
// of verdict, and paying for the database on every visit could not be justified
// on a page that is mostly text (#123).
export const dynamic = "force-dynamic";

function seoulTimestamp(now: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "long",
    timeStyle: "short",
  }).format(now);
}

function brier(value: number | null): string {
  return value === null ? "기록 없음" : value.toFixed(3);
}

const INELIGIBLE_COPY = {
  "too-few-samples": "표본 부족",
  "no-wet-day": "비 온 날 없음",
  "no-dry-day": "안 온 날 없음",
} as const;

export default async function BehindTheDataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const now = new Date();
  const params = await searchParams;
  const stationId = Array.isArray(params.station) ? params.station[0] : params.station;
  const { location, requested } = resolveRecordLocation(params);
  const { evidence, readAt } = await readRecordEvidence(stationId ?? location, captureCohortAt(now), now);
  const view = buildBehindTheDataView(evidence);
  const { status, policy } = view;
  const influenceCopy = {
    learned: "최근 비교 기록",
    seed: "과거 모델 기록 (조정 폭 절반)",
    none: "없음 · 똑같은 비중",
  }[status.influenceSource];

  return (
    <div className="btd-page">
    <main className="btd">
      <header className="btd-mast">
        <p className="local-eyebrow">오늘비 · 채점 기록</p>
        <h1>이 예보를 어떻게 채점하는가</h1>
        <p className="btd-lede">
          내일 예보에 반영하는 서비스별 비중과 그 근거를 보여드립니다. 관측소의
          비교 기록이 충분하면 최근 채점 결과를 쓰고, 기록이 부족한 동안에는 과거 모델
          자료를 일부 반영하거나 같은 비중으로 평균합니다.
        </p>
      </header>

      {/* ── Layer 1: the state, and one sentence anyone can act on ── */}
      <section className="btd-now" aria-labelledby="btd-now-heading">
        <p className="local-kicker">
          지금 상태{" "}
          <span>
            : {requested && stationId === undefined ? `${location.name} ` : ""}
            {view.station ? `${view.station.name} 관측소 기준` : "기준 관측소 없음"}
          </span>
        </p>
        <h2 id="btd-now-heading" className="btd-status-label">{status.label}</h2>
        <p className="btd-status-detail">{status.detail}</p>
        <dl className="btd-meta">
          <div>
            <dt>지금 반영 중</dt>
            <dd>{influenceCopy}</dd>
          </div>
          <div>
            {/* The bar travels with the count: "7건" alone reads as enough. */}
            <dt>비교 표본</dt>
            <dd>
              {status.benchmarkSampleCount === null
                ? "확인할 수 없음"
                : `${status.benchmarkSampleCount} / ${policy.minimumSamples}건`}
            </dd>
          </div>
          {view.station ? (
            <div>
              <dt>관측소</dt>
              <dd>{view.station.name}{stationId === undefined ? ` · ${view.station.distanceKm.toFixed(1)}km · ${evidenceProximity(view.station.distanceKm) === "local" ? "지역 기록" : "광역 기록"}` : ""}</dd>
            </div>
          ) : null}
          <div>
            <dt>읽은 시각</dt>
            <dd>{seoulTimestamp(readAt)}</dd>
          </div>
        </dl>
        <RecordStationPicker stationName={view.station?.name ?? null} />
        <p className="btd-plain">
          최근 기록으로 계산한 가중치는 필요한 표본이 모이고, 단순 평균보다 점수가
          나쁘지 않을 때 적용합니다. 표본이 부족하거나 점수가 더 나쁘면 적용을 중지합니다.
        </p>
      </section>

      {/* ── Layer 2: how to read anything on this site, then live evidence ── */}
      <section className="btd-section" aria-labelledby="btd-rules-heading">
        <p className="local-kicker">숫자 읽는 법 <span>: 이 사이트의 모든 수치에 적용됩니다</span></p>
        <h2 id="btd-rules-heading">세 가지 규칙</h2>
        <ol className="btd-rules">
          <li>
            <h3>발표되지 않은 값은 ‘미발표’로 표시합니다.</h3>
            <p>
              그래프에 쓰는 서비스가 확률을 발표하지 않은 시간대는 빗금으로 표시합니다.
              발표된 0%는 숫자와 얇은 막대로 표시해 누락된 값과 구분합니다.
            </p>
          </li>
          <li>
            <h3>“오늘” 숫자에는 학습 가중치가 적용되지 않습니다.</h3>
            <p>
              채점 대상은 미리 저장한 내일 예보입니다. 그래서 가중치는 내일에만 적용하고,
              오늘과 모레 이후는 응답한 서비스를 같은 비중으로 평균합니다.
            </p>
          </li>
          <li>
            <h3>시간대 그래프는 여러 서비스를 섞은 값이 아닙니다.</h3>
            <p>
              시간대 그래프는 제목에 적힌 <em>한 서비스</em>의 예보입니다.
              오늘·내일 카드는 여러 서비스의 예보를 평균한 값입니다.
            </p>
          </li>
        </ol>
      </section>

      <section className="btd-section" aria-labelledby="btd-evidence-heading">
        <p className="local-kicker">최근에 읽은 채점 기록 <span>: 최대 10분 동안 같은 기록을 보여줍니다</span></p>
        <h2 id="btd-evidence-heading">서비스별 채점 기록</h2>
        {view.providers.length === 0 ? (
          <p className="btd-empty">
            지금은 표로 보여줄 채점 기록을 읽을 수 없습니다. 현재 상태에서 이유를 확인해 주세요.
          </p>
        ) : (
          <div className="btd-table-scroll">
            <table className="btd-table">
              <thead>
                <tr>
                  <th scope="col">서비스</th>
                  <th scope="col">표본</th>
                  <th scope="col">비 온 날</th>
                  <th scope="col">안 온 날</th>
                  <th scope="col">Brier</th>
                  <th scope="col">최근 7일</th>
                  <th scope="col">적격</th>
                  <th scope="col">영향력</th>
                </tr>
              </thead>
              <tbody>
                {view.providers.map((row) => (
                  <tr key={row.provider}>
                    <th scope="row">{row.name}</th>
                    <td>{row.sampleCount}</td>
                    <td>{row.wetDays}</td>
                    <td>{row.dryDays}</td>
                    <td>{brier(row.brierScore)}</td>
                    <td>{brier(row.last7DaysBrier)}</td>
                    <td>
                      {row.eligible
                        ? "적격"
                        : INELIGIBLE_COPY[row.ineligibleReason ?? "too-few-samples"]}
                    </td>
                    <td>{row.influence === null ? "기록 없음" : `${Math.round(row.influence * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="btd-note">
          Brier는 예보 확률과 실제 결과의 차이를 나타내며 낮을수록 좋습니다. 적격 여부는
          표본 수와 비 온 날·안 온 날 기록으로 정합니다. 학습 가중치는 {policy.weightFloorPercent}%에서{" "}
          {policy.weightCapPercent}% 사이로 제한합니다. 실제 예보에서는 응답한 서비스끼리 비중을 다시 나눕니다.
          과거 기록을 적용 중일 때는 표의 최근 Brier 점수가 현재 비중의 근거가 아닙니다.
        </p>

        <h3 className="btd-subhead">같은 표본 위에서의 비교</h3>
        {view.benchmarkRows.length === 0 ? (
          <p className="btd-empty">
            지금은 두 계산법의 비교 결과를 보여줄 수 없습니다. 최근 기록을 이용한 가중치는 적용하지 않습니다.
          </p>
        ) : (
          <div className="btd-table-scroll">
            <table className="btd-table">
              <thead>
                <tr>
                  <th scope="col">방식</th>
                  <th scope="col">Brier</th>
                  <th scope="col">판정</th>
                </tr>
              </thead>
              <tbody>
                {view.benchmarkRows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{brier(row.brierScore)}</td>
                    <td>{row.verdict}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="btd-note">
          Open-Meteo와 기상청 단독 예보 점수도 함께 표시합니다.
          각 서비스가 확률을 발표한 기록만 해당 서비스 점수에 포함됩니다.
        </p>
      </section>

      {/* ── Layer 3: the mechanism ── */}
      <section className="btd-section" aria-labelledby="btd-cycle-heading">
        <p className="local-kicker">채점 사이클 <span>: 하루 두 번, 06:10 · 18:10 KST 예약</span></p>
        <h2 id="btd-cycle-heading">내일 예보를 미리 저장합니다</h2>
        <p>
          활성 ASOS 관측소마다 각 서비스의 내일 강수확률과 강수량을 수집합니다.
          성능 반영 평균과 단순 평균을 함께 저장하고, 이후 관측 결과와 비교합니다.
        </p>
        <p className="btd-line">
          저장한 예보는 관측 결과가 나온 뒤에도 수정하지 않습니다.
        </p>
        <p>
          오전과 오후에 수집한 예보는 따로 채점합니다. 수집 시각에 따라 대상일까지 남은
          시간이 달라지기 때문입니다.
        </p>
        <p className="btd-note">
          수집 그룹은 예약된 시간대로 나눕니다. 예약 작업이 늦게 시작되면 같은 그룹에서도
          실제 수집 시각이 달라집니다. 아래는 대상일 시작을 기준으로 얼마나 일찍 수집했는지입니다.
        </p>
        {view.leadTime ? (
          <dl className="btd-meta">
            <div>
              <dt>가장 이른 예보</dt>
              <dd>{view.leadTime.maxHours}시간 전</dd>
            </div>
            <div>
              <dt>중간값</dt>
              <dd>{view.leadTime.medianHours}시간 전</dd>
            </div>
            <div>
              <dt>가장 늦은 예보</dt>
              <dd>
                {view.leadTime.minHours >= 0
                  ? `${view.leadTime.minHours}시간 전`
                  : `대상일 시작 ${Math.abs(view.leadTime.minHours)}시간 후`}
              </dd>
            </div>
            <div>
              <dt>측정한 기록</dt>
              <dd>{view.leadTime.sampleCount}건</dd>
            </div>
          </dl>
        ) : (
          <p className="btd-empty">
            예보를 얼마나 일찍 수집했는지 보여줄 기록이 없습니다.
          </p>
        )}
        <p className="btd-note">
          같은 수집에 포함된 서비스는 같은 시점의 관측 결과와 비교합니다. 다만 서비스별
          예보 갱신 시각과 예측 기간이 달라, 수집 지연이 상대적인 점수에 미치는 영향은 남아 있습니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-gate-heading">
        <p className="local-kicker">가중치 적용 조건</p>
        <h2 id="btd-gate-heading">비교 기록이 충분한지 확인합니다</h2>
        <ul className="btd-facts">
          <li>
            <strong>서비스 적격</strong> 표본 {policy.minimumSamples}건 이상이고, 비 온 날과 안 온
            날이 모두 있어야 합니다. 비가 온 경우와 오지 않은 경우를 함께 평가합니다.
          </li>
          <li>
            <strong>비교할 서비스</strong> 조건을 충족하는 서비스가 두 곳 이상이어야 합니다.
          </li>
          <li>
            <strong>반영 폭</strong> 표본 {policy.minimumSamples}건에서 {policy.fullInfluenceSamples}건
            사이를 지나며 균등에서 학습으로 선형으로 옮겨갑니다.
          </li>
          <li>
            <strong>운영 창</strong> 최근 {policy.windowDays}일, {policy.halfLifeDays}일 반감기의
            지수 가중. 최근 예보일수록 크게 반영됩니다.
          </li>
          <li>
            <strong>가중치 변환</strong> <code>exp(-{policy.scoreSharpness} × Brier)</code>, 이후{" "}
            {policy.weightFloorPercent}–{policy.weightCapPercent}%로 제한합니다. Brier가 낮은
            서비스에 더 큰 비중을 줍니다.
          </li>
        </ul>
        <p>
          비가 오지 않은 날에 높은 확률을 예보하면 Brier 점수가 나빠집니다.
          강수량 오차는 별도로 보고하며, 확률 점수를 대신하지 않습니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-benchmark-heading">
        <p className="local-kicker">가중치 중지 조건</p>
        <h2 id="btd-benchmark-heading">단순 평균보다 나쁘면 중지합니다</h2>
        <p>
          미리 저장한 두 계산법의 확률을 같은 관측 결과로 채점합니다. 비교 가능한 표본 수와
          Brier 점수로 다음과 같이 판정합니다.
        </p>
        <ul className="btd-facts">
          <li><strong>판정 전</strong> 비교 가능한 표본이 {policy.minimumSamples}건에 못 미치면 적용을 중지합니다.</li>
          <li><strong>기준 통과</strong> 성능 반영 쪽의 Brier가 단순 평균보다 낮거나 같으면 비교 기준을 통과합니다.</li>
          <li><strong>기준 미달</strong> 성능 반영 쪽의 Brier가 더 높으면 적용을 중지합니다.</li>
        </ul>
        <p>
          중지된 동안에는 응답한 서비스를 같은 비중으로 평균합니다. 기록을 읽을 때 조건을 다시
          확인합니다. 미리 저장하는 예보와 화면에 제공하는 예보는 같은 가중치 계산법을 씁니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-seed-heading">
        <p className="local-kicker">최근 비교 기록이 부족할 때</p>
        <h2 id="btd-seed-heading">과거 모델 자료를 일부 반영합니다</h2>
        <p>
          최근 비교 기록이 충분히 쌓이기 전까지, 공개된 과거 모델 예보와 관측을 비교한 자료를
          임시로 사용할 수 있습니다. 이 자료도 없으면 같은 비중으로 평균합니다.
        </p>
        <ul className="btd-facts">
          <li><strong>하루 전 예보만</strong> 관측일보다 하루 앞서 발표된 모델 예보를 비교합니다.</li>
          <li><strong>강수량만</strong> 이 비교에 쓰는 아카이브는 강수확률을 제공하지 않습니다. 과거 자료는 확률 채점과 중지 판정에 포함하지 않습니다.</li>
          <li><strong>출처가 확인된 모델 자료만</strong> 서비스가 사용하는 모델을 확인할 수 있어야 합니다. 모델 예보는 서비스가 실제 발표한 예보와 다를 수 있습니다.</li>
        </ul>
        <p>
          같은 비중에서 과거 자료로 계산한 비중까지 차이의 절반만 반영합니다.
          최근 기록이 충분해지면 과거 자료를 대체합니다. 최근 비교에서 표본 부족이나 성능 저하로
          적용이 중지된 경우에는 과거 자료로 대신 가중하지 않습니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-nulls-heading">
        <p className="local-kicker">비교 범위</p>
        <h2 id="btd-nulls-heading">이 기록으로 알 수 있는 것</h2>
        <ul className="btd-facts">
          <li>
            <strong>전체적인 정확도 향상은 아직 확인되지 않았습니다.</strong> 위 점수는 표시된
            관측소와 비교 기록에 해당합니다. 모든 지역과 계절에서 더 정확하다는 뜻은 아닙니다.
          </li>
          <li>
            <strong>MET Norway는 비교에서 제외했습니다.</strong> 현재 채점에 필요한 한국의
            내일 강수확률을 제공하지 않기 때문입니다.
          </li>
          <li>
            <strong>모레 이후는 같은 비중으로 평균합니다.</strong> 현재 채점 대상은 내일 예보입니다.
          </li>
        </ul>
      </section>

      <section className="btd-section" aria-labelledby="btd-limits-heading">
        <p className="local-kicker">한계 <span>: 알고 있는 약점</span></p>
        <h2 id="btd-limits-heading">이 방법이 못 하는 것</h2>
        <ul className="btd-facts">
          <li>
            <strong>선택한 위치와 관측소의 날씨는 다를 수 있습니다.</strong> 채점에는 선택된 ASOS
            관측소의 기록을 씁니다. 거리와 고도 차이가 비교 조건을 충족해야 합니다.
          </li>
          <li>
            <strong>서비스 영역 경계는 단순화되어 있습니다.</strong> 해안선 부근에서는 판정이
            어긋날 수 있습니다.
          </li>
          <li>
            <strong>채점 기록을 읽지 못하면 같은 비중으로 평균합니다.</strong> 날씨 서비스도
            응답하지 않아 예보를 불러올 수 없는 경우에는 오류와 다시 시도할 방법을 표시합니다.
          </li>
        </ul>
      </section>

      <footer className="btd-foot">
        <p className="local-kicker">출처</p>
        <p>
          예보: Open-Meteo · 기상청 단기예보 · Pirate Weather · WeatherAPI · Visual Crossing. 관측:
          기상청 ASOS 일자료. 행정구역 검색: Kakao Map. 서비스 영역: SGIS 시도 경계.
        </p>
        <p className="btd-foot-meta">
          <Link href="/">← 예보로 돌아가기</Link>
          <span>읽은 시각 {seoulTimestamp(readAt)}</span>
        </p>
      </footer>
    </main>
    </div>
  );
}
