"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { periodNameForHour } from "@/lib/forecast/blocks";
import {
  HOUR_MS,
  hourlyComparisonEnd,
  hourlyExtremes,
  hourlyMean,
  hourlyRibbon,
  hourlySourceReading,
  kstStamp,
  type HourlyComparison,
  type HourlyProviderSeries,
  type HourlyRibbonBlock,
  type HourlyRow,
} from "@/lib/forecast/hourlyComparison";
import { RAIN_ONSET_PROBABILITY } from "@/lib/localForecastView";

const number = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 2, useGrouping: false });
const exact = new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 5 });
const clock = (stamp: number) => kstStamp(stamp).slice(11);
const dated = (stamp: number) => kstStamp(stamp).replace("T", " ");
const day = (stamp: number) => {
  const [month, date] = kstStamp(stamp).slice(5, 10).split("-").map(Number);
  return `${month}월 ${date}일`;
};
const rangeLabel = (start: number, end: number) => `${clock(start)}–${clock(end)}`;
const wet = (value: number | null) => value !== null && value >= RAIN_ONSET_PROBABILITY;

function probability(value: number | "invalid" | null) {
  if (value === "invalid") return "값 확인 불가";
  if (value === null) return "미발표";
  if (value > 0 && value < 0.01) return "<0.01%";
  const rounded = number.format(value);
  if (value < 100 && rounded === "100") return "<100%";
  if (!wet(value) && rounded === String(RAIN_ONSET_PROBABILITY)) return `<${RAIN_ONSET_PROBABILITY}%`;
  return `${rounded}%`;
}

function amountText(value: NonNullable<ReturnType<typeof hourlySourceReading>>["value"], raw = false): string {
  if (value === "invalid") return "값 확인 불가";
  if (value === null) return "미발표";
  if (typeof value === "number") {
    if (!raw && value > 0 && value < 0.01) return "<0.01 mm";
    return `${(raw ? exact : number).format(value)} mm`;
  }
  if (value.highMm === null) return `${exact.format(value.lowMm)} mm 이상`;
  if (value.lowMm === 0) return `${exact.format(value.highMm)} mm 미만`;
  return `${exact.format(value.lowMm)}~${exact.format(value.highMm)} mm 미만`;
}

function periodAmount(block: HourlyRibbonBlock) {
  return block.sum === null && block.completeHours < 3 ? "합계 없음" : amountText(block.sum);
}

export function useHourlyRibbon(data: HourlyComparison | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!data) return;
    let timer: number | undefined;
    const sync = () => {
      window.clearTimeout(timer);
      if (document.visibilityState === "hidden") return;
      const time = Date.now();
      setNow(time);
      // A whole interval starts at :00:00.000 and becomes partial just after.
      const offset = time % HOUR_MS;
      timer = window.setTimeout(sync, offset === 0 ? 1 : HOUR_MS - offset);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pageshow", sync);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, [data]);
  return useMemo(() => {
    if (!data) return null;
    const viewedAt = Math.max(now, data.asOf);
    const blocks = hourlyRibbon(data, viewedAt);
    const hasAverage = blocks.some(({ hours }) => hours.some((row) => row.chance.length >= 2 || row.amount.length >= 2));
    const responseEnd = hourlyComparisonEnd(data);
    const expired = kstStamp(viewedAt).slice(0, 10) > data.dates[1] ||
      (responseEnd !== null && responseEnd > data.asOf && viewedAt >= responseEnd);
    const agedEmptyAverage = !hasAverage && viewedAt - data.asOf >= HOUR_MS;
    const refreshReason = expired ? "이 응답에서 유효한 예보 시간이 지났습니다."
      : agedEmptyAverage ? "이전 응답에서 비교할 수 있는 시간대 예보가 없습니다." : null;
    return { blocks, hasAverage, refreshReason };
  }, [data, now]);
}

function HourlySummary({ blocks }: { blocks: HourlyRibbonBlock[] }) {
  const first = blocks.find((block) => wet(block.peak));
  const peak = blocks.reduce<HourlyRibbonBlock | null>((best, block) =>
    block.peak !== null && (best?.peak == null || block.peak > best.peak) ? block : best, null);
  const firstLabel = first && (first === blocks[0] ? "지금 구간" :
    `${day(first.start) === day(blocks[0].start) ? "" : `${day(first.start)} `}${rangeLabel(first.start, first.end)} 구간`);
  return (
    <>
      <p className="local-hourly-summary">
        {firstLabel ? <><b>{firstLabel}</b>에 비 예상</> : peak
          ? `확인된 시간은 ${RAIN_ONSET_PROBABILITY}% 미만이에요`
          : "평균 강수확률 자료가 부족해요"}
      </p>
      {peak && <p className="local-hourly-note">
        시간별 최고 <strong>{probability(peak.peak)}</strong> · {day(peak.start)} {rangeLabel(peak.start, peak.end)}
      </p>}
    </>
  );
}

function Members({ members }: { members: HourlyRow["chance"] }) {
  return <small>{members.length}곳{members.length > 0 && ` · ${members.map(({ source }) => source.name).join(", ")}`}</small>;
}

function SourceMetric({ data, source, row, metric }: {
  data: HourlyComparison;
  source: HourlyProviderSeries;
  row: HourlyRow;
  metric: "chance" | "amount";
}) {
  const reading = hourlySourceReading(data, source, row.start, metric);
  if (!reading) return "응답 범위 밖";
  const { aligned, stamp, value } = reading;
  return (
    <>
      {metric === "chance" ? probability(typeof value === "object" ? null : value) : amountText(value, true)}
      <small>{clock(stamp)} {aligned ? "종료" : "제공사 시각"}</small>
    </>
  );
}

function ComparisonRows({ data, block, source }: { data: HourlyComparison; block: HourlyRibbonBlock; source: HourlyProviderSeries | undefined }) {
  return (
    <table className="local-hourly-table">
      <caption>{day(block.start)} {rangeLabel(block.start, block.end)} KST</caption>
      <colgroup><col className="local-hourly-time-col" /><col /><col /></colgroup>
      <thead>
        <tr>
          <th scope="col">시간</th>
          <th scope="col">확률{!source && <small>범위</small>}</th>
          <th scope="col">강수량{!source && <small>평균</small>}</th>
        </tr>
      </thead>
      <tbody>
        {block.hours.map((row) => {
          const spread = hourlyExtremes(row.chance);
          return (
            <tr key={row.start}>
              <th scope="row"><span>{clock(row.start)}</span>–<wbr /><span>{clock(row.end)}</span></th>
              {row.state !== "complete" ? (
                <td colSpan={2}>{row.state === "elapsed" ? "지난 시간" : "진행 중인 시간"} · 평균 제외</td>
              ) : source ? (
                <>
                  <td><SourceMetric data={data} source={source} row={row} metric="chance" /></td>
                  <td><SourceMetric data={data} source={source} row={row} metric="amount" /></td>
                </>
              ) : (
                <>
                  <td>
                    {spread ? spread.low === spread.high ? probability(spread.high) : `${probability(spread.low)}–${probability(spread.high)}` : "두 곳 미만"}
                    <Members members={row.chance} />
                  </td>
                  <td>{row.amount.length === 1 ? "두 곳 미만" : amountText(hourlyMean(row.amount))}<Members members={row.amount} /></td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function HourlyForecastComparison({ data, blocks, hasAverage, refreshReason, onRefresh }: {
  data: HourlyComparison;
  blocks: HourlyRibbonBlock[];
  hasAverage: boolean;
  refreshReason: string | null;
  onRefresh(): void;
}) {
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [choice, setChoice] = useState("compare");
  const [atEnd, setAtEnd] = useState(false);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const selectedIndex = Math.max(0, blocks.findIndex(({ start }) => start === selectedStart));
  const selected = blocks[selectedIndex];
  const source = data.sources.find(({ id }) => id === choice);
  const hasComparison = data.sources.some(({ status, hours }) => status !== "unavailable" && Object.keys(hours).length > 0);

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: blocks.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const target = Math.max(0, Math.min(next, blocks.length - 1));
    const button = buttons.current[target];
    if (!button || !scroller.current) return;
    const column = button.getBoundingClientRect();
    const viewport = scroller.current.getBoundingClientRect();
    button.focus({ preventScroll: true });
    scroller.current.scrollBy({ left: column.left < viewport.left ? column.left - viewport.left : Math.max(0, column.right - viewport.right) });
    setSelectedStart(blocks[target].start);
  }

  return (
    <section className="local-ribbon local-hourly" aria-labelledby="local-hourly-heading" onKeyDown={(event) => {
      if (event.key === "Escape" && disclosure.current?.open) {
        disclosure.current.open = false;
        summary.current?.focus();
      }
    }}>
      <div className="local-ribbon-head">
        <h2 id="local-hourly-heading" className="local-ribbon-src"><i aria-hidden />시간대별 강수 예보</h2>
        <span className="local-ribbon-note">{hasAverage ? "서비스 평균" : "평균 자료 부족"} · {day(blocks[0].start)} KST</span>
      </div>
      <HourlySummary blocks={blocks} />
      <p className="local-hourly-swipe">
        {atEnd ? <><span aria-hidden="true">←</span> 앞 시간 보기</> : <>옆으로 넘겨 다음 시간 보기 <span aria-hidden="true">→</span></>}
      </p>
      <p id="local-hourly-keys" className="sr-only">좌우 화살표로 이동하고 Home과 End 키로 처음과 마지막 구간을 확인할 수 있습니다.</p>
      <div ref={scroller} className="local-ribbon-scroll" onScroll={({ currentTarget: track }) => {
        setAtEnd(track.scrollLeft > 0 && track.scrollWidth - track.clientWidth - track.scrollLeft < 2);
      }}>
        <ol className="local-ribbon-grid local-hourly-grid" role="list" aria-label="연속된 3시간 구간 8개" aria-describedby="local-hourly-keys"
          style={{ "--cols": 8, "--threshold": `${RAIN_ONSET_PROBABILITY}%` } as CSSProperties}>
          {blocks.map((block, index) => {
            const { start, end, peak, chanceHours, completeHours } = block;
            const startHour = Number(clock(start).slice(0, 2));
            const label = index === 0 ? "지금" : periodNameForHour(startHour);
            const daybreak = index > 0 && startHour === 0;
            const inspected = selectedStart !== null && selected.start === start;
            const isWet = wet(peak);
            const qualifier = completeHours < 3
              ? chanceHours ? `남은 ${chanceHours}시간 반영` : completeHours ? "남은 시간 자료 부족" : "온전히 남은 시간 없음"
              : chanceHours > 0 && chanceHours < 3 ? `확률 ${chanceHours}/3시간` : "";
            const accessible = [label, `${day(start)} ${rangeLabel(start, end)}`, `최고 확률 ${probability(peak)}`,
              `강수량 ${periodAmount(block)}`, qualifier, isWet ? "비 예상" : ""].filter(Boolean).join(", ");
            return (
              <li key={start} className={`local-ribbon-col${isWet ? " is-wet" : ""}${daybreak ? " is-daybreak" : ""}${inspected ? " is-scrubbed" : ""}`}
                aria-current={index === 0 ? "time" : undefined}>
                <span className="local-hourly-day" aria-hidden="true">{daybreak ? day(start) : ""}</span>
                <span className="local-ribbon-chead" aria-hidden="true">
                  <span className="local-ribbon-per">{label}</span>
                  <b className="local-ribbon-rng">{rangeLabel(start, end)}</b>
                </span>
                <span className={`local-ribbon-track${peak === null ? " is-na" : ""}`} aria-hidden="true">
                  {index === 0 && <span className="local-ribbon-rule">{RAIN_ONSET_PROBABILITY}%</span>}
                  {peak !== null && peak > 0 && <span className="local-ribbon-bar" style={{ "--h": `${peak}%` } as CSSProperties} />}
                </span>
                <span className="local-ribbon-cfoot" aria-hidden="true">
                  <strong className={`local-ribbon-val${peak === null || peak === 0 ? " is-na" : ""}`}>{probability(peak)}</strong>
                  <span className={`local-hourly-mm${block.sum === null || block.sum === 0 ? " is-quiet" : ""}`}>{periodAmount(block)}</span>
                  {qualifier && <small className="local-ribbon-hint">{qualifier}</small>}
                </span>
                <button type="button" ref={(element) => { buttons.current[index] = element; }} className="local-hourly-hit"
                  aria-label={accessible} aria-pressed={inspected} tabIndex={index === selectedIndex ? 0 : -1}
                  onClick={() => setSelectedStart(start)} onKeyDown={(event) => move(event, index)} />
              </li>
            );
          })}
        </ol>
      </div>
      {selectedStart === selected.start && (
        <p className="local-hourly-readout" role="status"><b>{day(selected.start)} {rangeLabel(selected.start, selected.end)}</b>{" "}
          · 최고 확률 {probability(selected.peak)} · 강수량 {periodAmount(selected)}
        </p>
      )}
      <p className="local-hourly-note">
        <b>{RAIN_ONSET_PROBABILITY}% 이상</b>을 비 예상 구간으로 봅니다. 확률은 구간 안의 시간별 평균 중 최고값입니다.
        강수량은 온전한 세 시간의 평균값이 모두 있을 때 합산합니다.
      </p>
      {(blocks[0].completeHours < 3 || !hasAverage) && (
        <p className="local-hourly-note">
          {!hasAverage ? "같은 시간에 두 곳 이상 발표한 수치가 있어야 평균을 표시합니다." : "지금 구간은 지난 시간과 진행 중인 시간을 뺍니다."}
        </p>
      )}
      {refreshReason && (
        <div className="local-error-actions">
          <p className="local-hourly-note" role="status">{refreshReason}</p>
          <button type="button" onClick={onRefresh}>예보 다시 불러오기</button>
        </div>
      )}
      {hasComparison && (
        <details className="local-hourly-all" ref={disclosure}>
          <summary ref={summary}>서비스별 예보</summary>
          <div className="local-hourly-detail">
            <label>
              <span>서비스별 예보 보기</span>
              <select value={source?.id ?? "compare"} onChange={(event) => setChoice(event.target.value)}>
                <option value="compare">서비스 비교</option>
                {data.sources.map(({ id, name, status }) => (
                  <option key={id} value={id}>{name}{status === "stale" ? " · 이전 응답" : status === "unavailable" ? " · 응답 없음" : ""}</option>
                ))}
              </select>
            </label>
            <p className="local-hourly-note">
              {source?.status === "stale" ? "이전 응답입니다. 평균에서 제외합니다. " : source?.status === "unavailable" ? "서비스 응답이 없습니다. " : ""}
              {source ? "종료로 표시한 값은 해당 한 시간의 예보입니다. 제공사 시각은 값의 적용 구간을 확인할 수 없습니다."
                : "리본에서 고른 구간을 봅니다. 지표별로 같은 시간에 발표된 최신 수치를 같은 비중으로 평균합니다."}
            </p>
            <ComparisonRows data={data} block={selected} source={source} />
          </div>
        </details>
      )}
      <p className="local-hourly-note">조회 기준 <time dateTime={new Date(data.asOf).toISOString()}>{dated(data.asOf)} KST</time></p>
    </section>
  );
}
