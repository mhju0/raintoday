"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  HOURLY_ALIGNMENT,
  hourlyBlocks,
  hourlyExtremes,
  hourlyMean,
  hourlyRows,
  kstStamp,
  type DetailedReading,
  type HourlyComparison,
  type HourlyMode,
  type HourlyProviderSeries,
  type HourlyRow,
} from "@/lib/forecast/hourlyComparison";

const number = new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 5 });
const clock = (stamp: number) => kstStamp(stamp).slice(11);
const dated = (stamp: number) => kstStamp(stamp).replace("T", " ");
const probability = (value: number | null) => value === null ? "미발표" : `${number.format(value)}%`;

function amountText(value: DetailedReading["amount"] | undefined) {
  if (value === "invalid") return "값 확인 불가";
  if (value == null) return "미발표";
  if (typeof value === "number") return `${number.format(value)} mm`;
  if (value.highMm === null) return `${number.format(value.lowMm)} mm 이상`;
  if (value.lowMm === 0) return `${number.format(value.highMm)} mm 미만`;
  return `${number.format(value.lowMm)}~${number.format(value.highMm)} mm`;
}

function ChanceBar({ high, low = 0 }: { high: number | null; low?: number }) {
  return (
    <span className="local-hourly-track" aria-hidden="true">
      {high !== null && (
        <i style={{ marginInlineStart: `${low}%`, width: `${high - low}%` }} />
      )}
    </span>
  );
}

function ChanceReading({ value }: { value: DetailedReading["chance"] | undefined }) {
  if (typeof value !== "number") return value === "invalid" ? "값 확인 불가" : "미발표";
  return <span className="local-hourly-chance"><ChanceBar high={value} />{probability(value)}</span>;
}

function hourLabel(row: HourlyRow, native: boolean) {
  return native ? clock(row.start) : `${clock(row.start)}–${clock(row.end)}`;
}

function SourceTable({ row }: { row: HourlyRow }) {
  return (
    <table className="local-hourly-table">
      <caption className="sr-only">선택한 시간의 서비스별 강수 예보</caption>
      <thead><tr><th scope="col">서비스</th><th scope="col">강수확률</th><th scope="col">강수량</th></tr></thead>
      <tbody>
        {row.details.map(({ source, chance, amount }) => (
          <tr key={source.id}>
            <th scope="row">
              {source.name}
              {source.status === "stale" && <small>이전 응답 · 집계 제외</small>}
              {source.status === "unavailable" && <small>응답 없음</small>}
            </th>
            <td>{HOURLY_ALIGNMENT[source.id].chance ? <ChanceReading value={chance} /> : "제공사 시각"}</td>
            <td>{HOURLY_ALIGNMENT[source.id].amount ? amountText(amount) : "제공사 시각"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Reading({ row, mode, source }: { row: HourlyRow; mode: HourlyMode; source?: HourlyProviderSeries }) {
  if (row.elapsed) return <p>지난 시간</p>;
  if (source) {
    return (
      <dl className="local-hourly-reading">
        <div><dt>강수확률</dt><dd><ChanceReading value={row.reading?.chance} /></dd></div>
        <div><dt>강수량</dt><dd>{amountText(row.reading?.amount)}</dd></div>
      </dl>
    );
  }
  if (mode === "average") {
    return (
      <dl className="local-hourly-reading">
        <div>
          <dt>강수확률 · {row.chance.length}곳</dt>
          <dd>{probability(hourlyMean(row.chance))}</dd>
        </div>
        <div>
          <dt>강수량 · {row.amount.length}곳</dt>
          <dd>{amountText(hourlyMean(row.amount))}</dd>
        </div>
      </dl>
    );
  }
  const chance = hourlyExtremes(row.chance);
  const amount = hourlyExtremes(row.amount);
  return (
    <dl className="local-hourly-reading">
      <div><dt>강수확률 차이 · {row.chance.length}곳</dt><dd>{chance ? `${number.format(chance.high - chance.low)}%p` : "두 곳 미만"}</dd></div>
      <div><dt>강수량 차이 · {row.amount.length}곳</dt><dd>{amount ? amountText(amount.high - amount.low) : "두 곳 미만"}</dd></div>
    </dl>
  );
}

function FullDayTable({ rows, mode, source, native, onInspect }: {
  rows: HourlyRow[];
  mode: HourlyMode;
  source?: HourlyProviderSeries;
  native: boolean;
  onInspect: (hour: number) => void;
}) {
  return (
    <details className="local-hourly-all">
      <summary>{native ? "제공사 시각 수치 표" : "시간별 수치 표"}</summary>
      <table className="local-hourly-table">
        <caption className="sr-only">선택한 날짜의 시간별 강수 예보</caption>
        <thead><tr><th scope="col">{native ? "제공사 시각" : "유효 시간"}</th><th scope="col">강수확률</th><th scope="col">강수량</th></tr></thead>
        <tbody>
          {rows.map((row, hour) => {
            const chance = hourlyExtremes(row.chance);
            const amount = hourlyExtremes(row.amount);
            return (
              <tr key={row.start}>
                <th scope="row">
                  <button type="button" onClick={() => onInspect(hour)}>{hourLabel(row, native)}</button>
                </th>
                {row.elapsed ? <td colSpan={2}>지난 시간</td> : source ? (
                  <><td><ChanceReading value={row.reading?.chance} /></td><td>{amountText(row.reading?.amount)}</td></>
                ) : mode === "average" ? (
                  <><td>{probability(hourlyMean(row.chance))}<small>{row.chance.length}곳</small></td>
                    <td>{amountText(hourlyMean(row.amount))}<small>{row.amount.length}곳</small></td></>
                ) : (
                  <><td>{chance ? `${probability(chance.low)}–${probability(chance.high)}` : "두 곳 미만"}<small>{row.chance.length}곳</small></td>
                    <td>{amount ? `${number.format(amount.low)}~${amountText(amount.high)}` : "두 곳 미만"}<small>{row.amount.length}곳</small></td></>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </details>
  );
}

function providerCount(rows: HourlyRow[], metric: "chance" | "amount") {
  const counts = rows.filter((row) => !row.elapsed).map((row) => row[metric].length);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  return min === max ? `${min}곳` : `${min}–${max}곳`;
}

function availableSources(data: HourlyComparison, date: string) {
  return data.sources.filter((source) => source.status !== "unavailable" &&
    hourlyRows(data, date, source).some(({ reading }) => reading && (reading.chance !== null || reading.amount !== null)));
}

export function HourlyForecastComparison({ data, children }: { data?: HourlyComparison; children: ReactNode }) {
  return data ? <HourlyForecastModes data={data}>{children}</HourlyForecastModes> : children;
}

function HourlyForecastModes({ data, children }: { data: HourlyComparison; children: ReactNode }) {
  const [mode, setMode] = useState<HourlyMode>(children ? "primary" : "average");
  const [date, setDate] = useState(data.dates[0]);
  const [hour, setHour] = useState<number | null>(null);
  const sources = useMemo(() => availableSources(data, date), [data, date]);
  const source = sources.find(({ id }) => id === mode);
  const native = source !== undefined && !HOURLY_ALIGNMENT[source.id].chance;
  const rows = useMemo(() => hourlyRows(data, date, source), [data, date, source]);
  const firstAvailable = rows.findIndex((row) => !row.elapsed &&
    (source ? row.reading && (row.reading.chance !== null || row.reading.amount !== null) : row.chance.length || row.amount.length));
  const selectedHour = hour ?? Math.max(firstAvailable, rows.findIndex((row) => !row.elapsed), 0);
  const selected = rows[selectedHour];

  function changeDate(next: string) {
    setDate(next);
    setHour(null);
    if (source && !availableSources(data, next).some(({ id }) => id === source.id)) setMode("compare");
  }

  function inspectHour(next: number) {
    setHour(next);
    document.getElementById("local-hourly-hour")?.focus();
  }

  return (
    <section className="local-hourly" aria-labelledby="local-hourly-heading">
      <div className="local-card-head">
        <h2 id="local-hourly-heading">시간대별 강수 예보</h2>
      </div>
      <div className="local-hourly-controls">
        <label>
          <span>시간별 예보 보기</span>
          <select value={mode} onChange={(event) => { setMode(event.target.value as HourlyMode); setHour(null); }}>
            {children && <option value="primary">기본 · 단독 예보</option>}
            <option value="average">평균 · 같은 시간</option>
            <option value="compare">서비스 비교</option>
            {sources.map(({ id, name }) => (
              <option key={id} value={id}>{id === "kma" ? "기상청" : name}</option>
            ))}
          </select>
        </label>
        {mode !== "primary" && (
          <label>
            <span>예보 날짜</span>
            <select value={date} onChange={(event) => changeDate(event.target.value)}>
              {data.dates.map((value, index) => <option key={value} value={value}>{index === 0 ? "오늘" : "내일"}</option>)}
            </select>
          </label>
        )}
      </div>
      {mode === "primary" ? children : (
        <>
          <p className="local-hourly-note">
            {mode === "average" ? "같은 한 시간의 수치를 같은 비중으로 평균합니다. 확률과 양은 각각 두 곳 이상일 때 표시합니다. 내일 정확도 가중치는 일별 예보에 적용합니다."
              : mode === "compare" ? "같은 한 시간에 맞춘 값만 비교합니다. 제공사 시각으로 표시된 값은 개별 보기에서 확인할 수 있습니다."
              : native ? `${source.name} 제공사 시각 · ${HOURLY_ALIGNMENT[source.id].amount ? "강수확률의 적용 구간 미확인" : "확률과 양의 적용 구간 미확인"}`
              : `${source?.name} · 한국 시간 유효 구간`}
            {source?.status === "stale" && " · 이전 응답"}
          </p>
          <p className="local-hourly-date"><time dateTime={date}>{date}</time> <span>KST</span></p>
          <ol className="local-hourly-grid" aria-label="하루 여덟 구간">
            {hourlyBlocks(rows, mode, source).map(({ hours, peak, sum, chanceHours, amountHours, hasRange }) => {
              const [first, , last] = hours;
              const elapsed = hours.every((row) => row.elapsed);
              const label = `${clock(first.start)}–${native ? clock(last.start) : clock(last.end)}`;
              const range = peak?.range;
              return (
                <li key={first.start} className={hours.includes(selected) ? "is-inspected" : undefined}>
                  <span className="local-hourly-period">{!native && last.end === rows[23].end ? `${clock(first.start)}–24:00` : label}</span>
                  <div className="local-hourly-tile">
                    <ChanceBar low={range?.low} high={peak?.value ?? null} />
                    <strong>{elapsed ? "지난 구간" : range
                      ? `${probability(range.low)}–${probability(range.high)}`
                      : probability(peak?.value ?? null)}</strong>
                    {!elapsed && range && <span>차이 {number.format(range.high - range.low)}%p</span>}
                    {!elapsed && mode !== "compare" && !native && (
                      <span>{sum !== null ? amountText(sum) : hasRange ? "양 범위 개별 확인" : "구간 양 자료 부족"}</span>
                    )}
                    {!elapsed && chanceHours < 3 && <small>확률 {chanceHours}/3시간</small>}
                    {!elapsed && !source && <small>확률 {providerCount(hours, "chance")}</small>}
                    {!elapsed && mode === "average" && (
                      <small>양 {providerCount(hours, "amount")}{amountHours < 3 && ` · ${amountHours}/3시간`}</small>
                    )}
                    {!elapsed && hours.some((row) => row.elapsed) && <small>지난 시간 포함</small>}
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="local-hourly-note">
            {native ? "막대 0–100% · 제공사 시각을 세 개씩 묶고 그중 가장 높은 강수확률을 표시합니다."
              : mode === "compare" ? "막대 0–100% · 각 구간에서 비교 가능한 시간별 강수확률 중 최댓값이 나온 한 시간의 범위입니다."
              : "막대 0–100% · 구간 안에서 가장 높은 시간별 강수확률입니다. 양은 세 시간의 수치가 모두 있을 때 더합니다."}
          </p>
          <div className="local-hourly-exact">
            <label>
              <span>{native ? "정확한 제공사 시각" : "정확한 한 시간"}</span>
              <select id="local-hourly-hour" value={selectedHour} onChange={(event) => setHour(Number(event.target.value))}>
                {rows.map((row, index) => (
                  <option key={row.start} value={index}>{hourLabel(row, native)}{row.elapsed ? " · 지난 시간" : ""}</option>
                ))}
              </select>
            </label>
            <p className="local-hourly-valid" aria-live="polite">
              {dated(selected.start)}{!native && `–${dated(selected.end)}`} KST
            </p>
            {source?.id === "visual-crossing" && (
              <p className="local-hourly-note">
                양 유효 구간 {dated(selected.start - (selected.end - selected.start))}–{dated(selected.start)} KST
              </p>
            )}
            <Reading row={selected} mode={mode} source={source} />
            {!source && !selected.elapsed && (mode === "average" ? (
              <details className="local-hourly-all">
                <summary>서비스별 값과 제외 항목</summary>
                <SourceTable row={selected} />
              </details>
            ) : <SourceTable row={selected} />)}
          </div>
          <FullDayTable rows={rows} mode={mode} source={source} native={native} onInspect={inspectHour} />
          <p className="local-hourly-note">조회 기준 {dated(data.asOf)} KST</p>
        </>
      )}
    </section>
  );
}
