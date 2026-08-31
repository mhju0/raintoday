import type { Metadata } from "next";
import Link from "next/link";
import { RecordStationPicker } from "@/components/local/RecordStationPicker";
import { buildBehindTheDataView, resolveRecordLocation } from "@/lib/behindTheData";
import { captureCohortAt, readDatabaseEvidence } from "@/lib/localForecast";

export const metadata: Metadata = {
  title: "이 예보를 어떻게 채점하는가 — 오늘비",
  description:
    "오늘비가 자기 학습을 언제 믿고 언제 정지시키는지, 그 판정을 실제 기록으로 확인합니다.",
};

// The evidence is read per request: a stale verdict on a page whose whole point
// is today's verdict would be worse than no page.
export const dynamic = "force-dynamic";

function seoulTimestamp(now: Date): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "long",
    timeStyle: "short",
  }).format(now);
}

function brier(value: number | null): string {
  return value === null ? "—" : value.toFixed(3);
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
  const { location, requested } = resolveRecordLocation(await searchParams);
  const evidence = await readDatabaseEvidence(location, null, captureCohortAt(now), now);
  const view = buildBehindTheDataView(evidence);
  const { status, policy } = view;
  const influenceCopy = {
    learned: "라이브 학습",
    seed: "과거 기록 (절반 세기)",
    none: "없음 · 똑같은 비중",
  }[status.influenceSource];

  return (
    <div className="btd-page">
    <main className="btd">
      <header className="btd-mast">
        <p className="local-eyebrow">오늘비 · 채점 기록</p>
        <h1>이 예보를 어떻게 채점하는가</h1>
        <p className="btd-lede">
          오늘비는 여러 날씨 서비스의 예보를 섞어 보여줍니다. 어느 서비스에 더 큰 비중을 줄지는
          이 지역에서 최근에 누가 더 잘 맞혔는지로 정합니다. 이 페이지는 그 채점이 지금 어떤
          상태인지, 그리고 <strong>언제 채점을 믿지 않고 스스로 멈추는지</strong>를 실제 기록으로
          보여줍니다.
        </p>
      </header>

      {/* ── Layer 1: the state, and one sentence anyone can act on ── */}
      <section className="btd-now" aria-labelledby="btd-now-heading">
        <p className="local-kicker">
          지금 상태{" "}
          <span>
            — {requested ? `${location.name} ` : ""}
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
                ? "—"
                : `${status.benchmarkSampleCount} / ${policy.minimumSamples}건`}
            </dd>
          </div>
          {view.station ? (
            <div>
              <dt>관측소</dt>
              <dd>{view.station.name} · {view.station.distanceKm}km</dd>
            </div>
          ) : null}
          <div>
            <dt>읽은 시각</dt>
            <dd>{seoulTimestamp(now)}</dd>
          </div>
        </dl>
        <RecordStationPicker stationName={view.station?.name ?? null} />
        <p className="btd-plain">
          이 앱은 학습한 가중치가 단순 평균을 이긴다고 <em>판정될 때만</em> 그 가중치를 씁니다.
          아직 판정하지 못했거나 지고 있으면 학습을 끕니다. 여기까지가 답이고, 아래는 그 판정이
          어떻게 이뤄지는지에 대한 근거입니다.
        </p>
      </section>

      {/* ── Layer 2: how to read anything on this site, then live evidence ── */}
      <section className="btd-section" aria-labelledby="btd-rules-heading">
        <p className="local-kicker">숫자 읽는 법 <span>— 이 사이트의 모든 수치에 적용됩니다</span></p>
        <h2 id="btd-rules-heading">세 가지 규칙</h2>
        <ol className="btd-rules">
          <li>
            <h3>아무도 발표하지 않은 값은 0%가 아니라 빈칸입니다.</h3>
            <p>
              어떤 서비스도 예보하지 않은 시간대는 빗금으로 비워 둡니다. 0%는 “비가 오지 않는다는
              예보”이지 “예보가 없다”가 아닙니다. 발표된 0%는 얇더라도 실제 막대로 그립니다.
            </p>
          </li>
          <li>
            <h3>“오늘” 숫자에는 학습 가중치가 적용되지 않습니다.</h3>
            <p>
              학습된 영향력은 “내일”에만 적용됩니다. 채점 코호트가 실제로 측정하는 리드타임이
              내일이기 때문입니다. 오늘과 모레 이후는 균등 평균입니다.
            </p>
          </li>
          <li>
            <h3>시간대 그래프는 여러 서비스를 섞은 값이 아닙니다.</h3>
            <p>
              가로 그래프는 <em>한 서비스</em>의 시계열이고 누구의 예보인지 표기합니다. 그 옆의
              오늘·내일 숫자는 여러 서비스를 섞은 값입니다. 둘을 같은 주장으로 읽으면 안 됩니다.
            </p>
          </li>
        </ol>
      </section>

      <section className="btd-section" aria-labelledby="btd-evidence-heading">
        <p className="local-kicker">지금 이 순간의 증거 <span>— 페이지를 열 때 데이터베이스에서 읽습니다</span></p>
        <h2 id="btd-evidence-heading">서비스별 채점 기록</h2>
        {view.providers.length === 0 ? (
          <p className="btd-empty">
            지금은 표로 보여줄 채점 기록이 없습니다. 위의 상태 문장이 그 이유입니다.
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
                    <td>{row.influence === null ? "—" : `${Math.round(row.influence * 100)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="btd-note">
          Brier는 낮을수록 좋습니다. 적격이 아닌 서비스는 <em>못 맞혀서</em>가 아니라 아직 판정할
          표본이 모이지 않아서입니다. 영향력은 {policy.weightFloorPercent}%에서{" "}
          {policy.weightCapPercent}% 사이로 제한되어, 한 서비스가 화면을 지배할 수 없습니다.
        </p>

        <h3 className="btd-subhead">같은 표본 위에서의 비교</h3>
        {view.benchmarkRows.length === 0 ? (
          <p className="btd-empty">
            아직 두 방식을 비교할 만큼 완료된 표본이 없습니다. 비교가 불가능한 동안에는 학습을
            쓰지 않습니다.
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
          단독 서비스 행을 일부러 함께 싣습니다. 섞은 값이 가장 좋은 단일 서비스보다 나은지를
          독자가 직접 확인할 수 있어야 하고, 그 비교는 오늘비에 불리하게 나올 수도 있습니다.
        </p>
      </section>

      {/* ── Layer 3: the mechanism ── */}
      <section className="btd-section" aria-labelledby="btd-cycle-heading">
        <p className="local-kicker">채점 사이클 <span>— 하루 두 번, 06:10 · 18:10 KST 예약</span></p>
        <h2 id="btd-cycle-heading">결과가 나오기 전에 얼립니다</h2>
        <p>
          읽을 수 있는 모든 활성 ASOS 관측소에 대해, 한 번의 실행이 네 가지를 합니다. 완료된 일강수
          관측을 저장하고, 각 서비스의 내일 강수 확률과 강수량을 포착하고, 성능을 반영한 예측과
          단순 평균 예측을 <em>둘 다</em> 그 자리에서 얼리고, 그 기록을 PostgreSQL에 씁니다.
        </p>
        <p className="btd-line">
          결과가 나온 뒤에 유리한 쪽을 고를 수 없도록, 결과가 존재하기 전에 둘 다 얼립니다.
        </p>
        <p>
          06시 발표와 18시 발표는 같은 “내일”을 서로 다른 리드타임으로 예보합니다. 섞으면 리드타임
          효과가 서비스 실력으로 오독되기 때문에, 두 코호트는 끝까지 따로 채점됩니다.
        </p>
        <p className="btd-note">
          다만 코호트 이름은 <em>예약된 시간대</em>를 가리키는 것이지, 실제로 포착한 시각을 보장하지
          않습니다. GitHub의 예약 실행은 최선 노력 방식이라 몇 시간씩 늦게 시작되기도 합니다. 그래서
          같은 코호트 안에서도 리드타임이 흔들리고, 코드는 그 시각을 강제하지 않습니다. 숨기는 대신
          재보니 아래와 같습니다.
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
            아직 채점된 기록이 없어 리드타임을 잴 수 없습니다.
          </p>
        )}
        <p className="btd-note">
          이 값이 흔들려도 서비스끼리의 비교는 그대로 성립합니다. 한 포착 안에서는 네 서비스가 모두
          같은 리드타임을 쓰기 때문에, 흔들림은 비교의 <em>잡음</em>이지 어느 한 서비스에 유리하게
          작용하는 <em>편향</em>이 아닙니다. 다만 “18시 발표의 성적”이라는 말 자체는 그만큼 느슨해집니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-gate-heading">
        <p className="local-kicker">증거 게이트 <span>— 언제 학습을 쓰는가</span></p>
        <h2 id="btd-gate-heading">쓸 수 있을 때까지 쓰지 않습니다</h2>
        <ul className="btd-facts">
          <li>
            <strong>서비스 적격</strong> 표본 {policy.minimumSamples}건 이상이고, 비 온 날과 안 온
            날이 모두 있어야 합니다. 한쪽만 있는 지역은 “잘 예측한 것”과 “그 계절이 그랬던 것”을
            구분할 수 없습니다.
          </li>
          <li>
            <strong>프로파일 준비</strong> 적격 서비스가 두 곳 이상이어야 합니다.
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
            {policy.weightFloorPercent}–{policy.weightCapPercent}%로 제한. 지수 변환은 단조라
            순위를 바꾸지 못하고, 증거가 이미 보여준 격차만 넓힙니다.
          </li>
        </ul>
        <p>
          비 온 날만이 아니라 안 온 날도 채점합니다. Brier는 안 온 날에 낮은 확률을 준 것도 정당하게
          보상하므로, 비 예보를 남발해서 점수를 얻을 수 없습니다. 확률 정확도와 강수량 오차는 절대
          서로를 대체하지 않으며, 언제나 따로 보고합니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-benchmark-heading">
        <p className="local-kicker">정지 조건 <span>— 이 페이지에서 가장 중요한 부분</span></p>
        <h2 id="btd-benchmark-heading">이기지 못하면 끕니다</h2>
        <p>
          백테스트가 아닙니다. 포착 시점에 성능 반영 확률과 단순 평균 확률을 둘 다 얼려 두었다가,
          나중에 <em>동일한</em> 완료 표본 위에서 두 Brier를 비교합니다. 판정은 세 가지입니다.
        </p>
        <ul className="btd-facts">
          <li><strong>insufficient</strong> 비교 가능한 표본이 {policy.minimumSamples}건에 못 미침 → 정지</li>
          <li><strong>passing</strong> 성능 반영 쪽이 단순 평균 이하의 Brier → 학습 사용</li>
          <li><strong>regression</strong> 성능 반영 쪽이 더 나쁨 → 정지</li>
        </ul>
        <p>
          정지되면 균등 가중치로 서빙합니다. 다시 말해 “학습이 실제로 이기고 있다”가 계속 재확인되지
          않으면 학습을 쓰지 않습니다. 그리고 이것이 성립하려면 포착 경로와 서빙 경로가 반드시 같은
          블렌드를 계산해야 하므로, 두 경로는 같은 모듈 하나를 통해서만 영향력을 구합니다.
        </p>
        <p className="btd-quote">
          those two must agree by construction rather than by coincidence.
          <span>우연히 같은 것이 아니라, 구조적으로 같게 만들었습니다. — lib/performance/influence.ts</span>
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-seed-heading">
        <p className="local-kicker">콜드 스타트 <span>— 기록이 하나도 없는 지역</span></p>
        <h2 id="btd-seed-heading">과거 기록은 절반의 세기로만</h2>
        <p>
          새 지역은 라이브 포착이 0건이라 영원히 균등에 머뭅니다. 이걸 공개 아카이브로 메우되,
          세 가지 규칙이 전부 하중을 받습니다.
        </p>
        <ul className="btd-facts">
          <li><strong>하루 전 발표분만</strong> 당일 값을 쓰면 사실상 실황이라 모든 서비스를 부풀리고 순위를 왜곡합니다.</li>
          <li><strong>강수량만</strong> 아카이브는 강수 확률을 발표하지 않으므로, 과거 기록은 확률 채점과 정지 판정에 절대 들어가지 않습니다.</li>
          <li><strong>모델 프록시는 추정이 아니라 명시</strong> 공개된 모델 계보가 없는 서비스에는 프록시를 붙이지 않습니다. 찍어 맞추면 그 순간 조작된 측정이 됩니다.</li>
        </ul>
        <p>
          영향력은 균등 쪽으로 절반만 이동합니다. 그리고 <strong>과거 기록은 정지를 구제하지
          못합니다</strong>. 정지는 성능 반영이 지금 단순 평균보다 나쁘다는 라이브 판정이고,
          회고적 증거는 그 판정을 뒤집을 근거가 되지 못합니다. 증거의 등급을 코드가 알고 있습니다.
        </p>
      </section>

      <section className="btd-section" aria-labelledby="btd-nulls-heading">
        <p className="local-kicker">주장하지 않는 것 <span>— 지지되지 않는 문장은 쓰지 않습니다</span></p>
        <h2 id="btd-nulls-heading">여기까지만 주장합니다</h2>
        <ul className="btd-facts">
          <li>
            <strong>“오늘비가 더 정확하다”고 주장하지 않습니다.</strong> 지금 지지되는 주장은 “최근
            관측된 지역 성능으로 가중한다”까지입니다. 그 이상은 누적된 판정이 필요하고, 쌓이기
            전까지는 위의 정지 조건이 학습을 꺼 둡니다.
          </li>
          <li>
            <strong>MET Norway는 비교에서 제외했습니다.</strong> 한국에 강수 확률을 발표하지 않는데,
            두 채점 게이트가 모두 내일 확률을 요구하기 때문입니다. 소스가 많은 게 나은 것이 아니라,
            채점할 수 없는 소스는 채점 체계를 깨뜨립니다.
          </li>
          <li>
            <strong>모레 이후 예보는 학습되지 않았습니다.</strong> 채점 코호트가 “내일”만
            측정하기 때문입니다.
          </li>
        </ul>
      </section>

      <section className="btd-section" aria-labelledby="btd-limits-heading">
        <p className="local-kicker">한계 <span>— 알고 있는 약점</span></p>
        <h2 id="btd-limits-heading">이 방법이 못 하는 것</h2>
        <ul className="btd-facts">
          <li>
            <strong>관측소는 당신의 위치가 아닙니다.</strong> 채점은 가장 가까운 공식 ASOS
            관측소에서 이뤄집니다. 실측 결과 사람이 사는 곳 중 관측소에서 30km를 넘는 곳은 없어,
            거리는 자격이 아니라 화면에 쓰는 <em>표현</em>을 고르는 데 씁니다.
          </li>
          <li>
            <strong>서비스 영역 경계는 단순화되어 있습니다.</strong> 해안선 부근에서는 판정이
            어긋날 수 있습니다.
          </li>
          <li>
            <strong>기록 저장소가 죽어도 예보는 계속 동작합니다.</strong> 다만 그때는 “균등 가중치”
            라고 화면에 밝힙니다. 조용히 넘어가지 않습니다.
          </li>
        </ul>
      </section>

      <footer className="btd-foot">
        <p className="local-kicker">출처</p>
        <p>
          예보: Open-Meteo · 기상청 단기예보 · Pirate Weather · WeatherAPI. 관측:
          기상청 ASOS 일자료. 행정구역 검색: Kakao Map. 서비스 영역: SGIS 시도 경계.
        </p>
        <p className="btd-foot-meta">
          <Link href="/">← 예보로 돌아가기</Link>
          <span>읽은 시각 {seoulTimestamp(now)}</span>
        </p>
      </footer>
    </main>
    </div>
  );
}
