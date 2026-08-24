import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchAsosObservation,
  fetchAsosObservationWindow,
  fetchKmaAsosStations,
  parseAsosDailyObservation,
  parseKmaStationCatalog,
} from "./kma.ts";

test("KMA station catalog parser keeps active South Korean ASOS coordinates", () => {
  const body = `# STN_ID LON LAT STN_SP HT HT_PA HT_TA HT_WD HT_RN STN_CD STN_KO STN_EN STN_AD FCT_ID LAW_ID BASIN
90 128.5647 38.2509 11 17.5 18.7 1.7 10.0 0.4 90 속초 Sokcho 90 11D20401 5121025021 0
108 126.9658 37.5714 11 85.7 86.7 1.5 10.0 0.5 108 서울 Seoul 108 11B10101 1111010100 0
#777 0 0 0 0 0 0 0 0 0 ignored ignored 0 0 0 0`;

  assert.deepEqual(parseKmaStationCatalog(body, new Date("2026-08-13T06:00:00+09:00")), [
    {
      id: "90",
      name: "속초",
      network: "ASOS",
      latitude: 38.2509,
      longitude: 128.5647,
      elevationM: 17.5,
      activeFrom: "2026-08-13",
      activeTo: null,
    },
    {
      id: "108",
      name: "서울",
      network: "ASOS",
      latitude: 37.5714,
      longitude: 126.9658,
      elevationM: 85.7,
      activeFrom: "2026-08-13",
      activeTo: null,
    },
  ]);
});

test("ASOS observation parser distinguishes a dry day from a missing row", () => {
  assert.equal(
    parseAsosDailyObservation({
      response: { body: { items: { item: [{ tm: "2026-08-12", stnId: "108", sumRn: "" }] } } },
    }),
    0,
  );
  assert.equal(
    parseAsosDailyObservation({
      response: { body: { items: { item: { tm: "2026-08-12", stnId: "108", sumRn: "12.4" } } } },
    }),
    12.4,
  );
  assert.equal(parseAsosDailyObservation({ response: { body: {} } }), null);
});

test("KMA performance readers reject oversized upstream bodies", async () => {
  const previousCatalogKey = process.env.KMA_APIHUB_KEY;
  const previousObservationKey = process.env.KMA_OBSERVATION_API_KEY;
  process.env.KMA_APIHUB_KEY = "test-key";
  process.env.KMA_OBSERVATION_API_KEY = "test-key";
  const oversized = async () => new Response(" ".repeat(1_048_577), { status: 200 });

  try {
    await assert.rejects(
      () => fetchKmaAsosStations(new Date("2026-08-13T06:00:00+09:00"), oversized as typeof fetch),
      /body too large/,
    );
    await assert.rejects(
      () => fetchAsosObservation(
        "108",
        "2026-08-12",
        new Date("2026-08-13T06:00:00+09:00"),
        oversized as typeof fetch,
      ),
      /body too large/,
    );
  } finally {
    if (previousCatalogKey === undefined) delete process.env.KMA_APIHUB_KEY;
    else process.env.KMA_APIHUB_KEY = previousCatalogKey;
    if (previousObservationKey === undefined) delete process.env.KMA_OBSERVATION_API_KEY;
    else process.env.KMA_OBSERVATION_API_KEY = previousObservationKey;
  }
});

test("KMA station catalog decodes the EUC-KR names apihub actually serves", async () => {
  const previousCatalogKey = process.env.KMA_APIHUB_KEY;
  process.env.KMA_APIHUB_KEY = "test-key";
  // apihub serves typ01 text as EUC-KR: 속초 is bc d3 c3 ca, 서울 is bc ad bf ef.
  const row = (id: string, lon: string, lat: string, name: number[]): number[] => [
    ...[...`${id} ${lon} ${lat} 11 17.5 18.7 1.7 10.0 0.4 ${id} `].map((c) => c.charCodeAt(0)),
    ...name,
    ...[...` Sokcho ${id} 11D20401 5121025021 0\n`].map((c) => c.charCodeAt(0)),
  ];
  const body = new Uint8Array([
    ...row("90", "128.5647", "38.2509", [0xbc, 0xd3, 0xc3, 0xca]),
    ...row("108", "126.9658", "37.5714", [0xbc, 0xad, 0xbf, 0xef]),
  ]);
  const respond = async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "text/plain;charset=EUC-KR" },
    });

  try {
    const stations = await fetchKmaAsosStations(
      new Date("2026-08-13T06:00:00+09:00"),
      respond as typeof fetch,
    );
    assert.deepEqual(stations.map((station) => station.name), ["속초", "서울"]);
  } finally {
    if (previousCatalogKey === undefined) delete process.env.KMA_APIHUB_KEY;
    else process.env.KMA_APIHUB_KEY = previousCatalogKey;
  }
});

test("KMA station catalog retries a dropped connection but not a refusal", async () => {
  const previousCatalogKey = process.env.KMA_APIHUB_KEY;
  process.env.KMA_APIHUB_KEY = "test-key";
  const body = "90 128.5647 38.2509 11 17.5 18.7 1.7 10.0 0.4 90 속초 Sokcho 90 11D20401 5121025021 0";

  try {
    let transportAttempts = 0;
    const flaky = async () => {
      transportAttempts += 1;
      if (transportAttempts < 3) throw new TypeError("fetch failed");
      return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
    };
    const stations = await fetchKmaAsosStations(
      new Date("2026-08-13T06:00:00+09:00"),
      flaky as unknown as typeof fetch,
      async () => {},
    );
    assert.equal(transportAttempts, 3);
    assert.deepEqual(stations.map((station) => station.id), ["90"]);

    let refusedAttempts = 0;
    const refused = async () => {
      refusedAttempts += 1;
      return new Response("denied", { status: 403 });
    };
    await assert.rejects(
      () => fetchKmaAsosStations(
        new Date("2026-08-13T06:00:00+09:00"),
        refused as unknown as typeof fetch,
      ),
      /HTTP 403/,
    );
    assert.equal(refusedAttempts, 1, "a refusal is terminal and must not be retried");
  } finally {
    if (previousCatalogKey === undefined) delete process.env.KMA_APIHUB_KEY;
    else process.env.KMA_APIHUB_KEY = previousCatalogKey;
  }
});

test("the catalog waits between attempts instead of retrying inside the same blip", async () => {
  // Three back-to-back attempts all land inside a network blip that lasts a few
  // seconds, which is the shape of the runner failures this retry exists for.
  const previousCatalogKey = process.env.KMA_APIHUB_KEY;
  process.env.KMA_APIHUB_KEY = "test-key";
  const body = "90 128.5647 38.2509 11 17.5 18.7 1.7 10.0 0.4 90 속초 Sokcho 90 11D20401 5121025021 0";

  try {
    const waits: number[] = [];
    let attempts = 0;
    const flaky = async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("fetch failed");
      return new Response(body, { status: 200, headers: { "content-type": "text/plain" } });
    };
    await fetchKmaAsosStations(
      new Date("2026-08-13T06:00:00+09:00"),
      flaky as unknown as typeof fetch,
      async (ms) => { waits.push(ms); },
    );
    assert.equal(waits.length, 2, "a wait precedes every attempt after the first");
    assert.ok(waits[0] > 0, "the first retry does not fire immediately");
    assert.ok(waits[1] > waits[0], "the wait grows so the attempts span more than one blip");

    const waitsBeforeSuccess: number[] = [];
    await fetchKmaAsosStations(
      new Date("2026-08-13T06:00:00+09:00"),
      (async () => new Response(body, { status: 200, headers: { "content-type": "text/plain" } })) as unknown as typeof fetch,
      async (ms) => { waitsBeforeSuccess.push(ms); },
    );
    assert.deepEqual(waitsBeforeSuccess, [], "a catalog that answers first time never waits");
  } finally {
    if (previousCatalogKey === undefined) delete process.env.KMA_APIHUB_KEY;
    else process.env.KMA_APIHUB_KEY = previousCatalogKey;
  }
});

const asosBody = (resultCode: string, sumRn = ""): string => JSON.stringify({
  response: {
    header: { resultCode, resultMsg: "test" },
    body: { dataType: "JSON", items: { item: [{ stnId: "108", sumRn }] } },
  },
});

function withObservationKey<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.KMA_OBSERVATION_API_KEY;
  process.env.KMA_OBSERVATION_API_KEY = "test-key";
  return run().finally(() => {
    if (previous === undefined) delete process.env.KMA_OBSERVATION_API_KEY;
    else process.env.KMA_OBSERVATION_API_KEY = previous;
  });
}

const AT = new Date("2026-08-24T06:10:00+09:00");
const read = (impl: unknown, delay?: (ms: number) => Promise<void>) =>
  fetchAsosObservation("108", "2026-08-23", AT, impl as typeof fetch, delay);

test("a refused ASOS observation is reported, not silently dropped", async () => {
  // 87 of 97 observations vanished from a run that reported no failures at all,
  // because every error path returned the same bare null as a genuine absence.
  await withObservationKey(async () => {
    const noWait = async () => {};
    const rateLimited = await read(async () => new Response(asosBody("22"), { status: 200 }), noWait);
    assert.equal(rateLimited.status, "failed");
    assert.match(rateLimited.reason ?? "", /rate-limited/);

    const forbidden = await read(async () => new Response(asosBody("30"), { status: 200 }));
    assert.equal(forbidden.status, "failed");
    assert.match(forbidden.reason ?? "", /forbidden/);

    const dropped = await read(async () => { throw new TypeError("fetch failed"); }, noWait);
    assert.equal(dropped.status, "failed");
    assert.match(dropped.reason ?? "", /fetch failed/);
  });
});

test("a station ASOS has no row for is absent, which is not a failure", async () => {
  // NODATA is a real answer. Scoring must skip the day without reporting a fault,
  // or every genuinely quiet station would turn the nationwide run red.
  await withObservationKey(async () => {
    const nodata = await read(async () => new Response(asosBody("03"), { status: 200 }));
    assert.equal(nodata.status, "absent");

    // A blank sumRn is a dry day, not an absence: KMA publishes the row.
    const dry = await read(async () => new Response(asosBody("00", ""), { status: 200 }));
    assert.equal(dry.status, "observed");
    assert.equal(dry.observation?.observedMm, 0);

    const wet = await read(async () => new Response(asosBody("00", "3.5"), { status: 200 }));
    assert.equal(wet.status, "observed");
    assert.equal(wet.observation?.observedMm, 3.5);
  });
});

test("a throttled ASOS observation is retried with backoff, but a refusal is not", async () => {
  await withObservationKey(async () => {
    let attempts = 0;
    const waits: number[] = [];
    const flaky = async () => {
      attempts += 1;
      if (attempts < 3) return new Response(asosBody("22"), { status: 200 });
      return new Response(asosBody("00", "1.2"), { status: 200 });
    };
    const recovered = await read(flaky, async (ms) => { waits.push(ms); });
    assert.equal(recovered.status, "observed");
    assert.equal(attempts, 3);
    assert.equal(waits.length, 2, "a wait precedes every attempt after the first");
    assert.ok(waits[1] > waits[0], "the wait grows so the attempts span more than one burst");

    // A key the service refuses will be refused again; retrying only spends quota.
    let refusals = 0;
    const refused = await read(async () => {
      refusals += 1;
      return new Response(asosBody("30"), { status: 200 });
    }, async () => {});
    assert.equal(refused.status, "failed");
    assert.equal(refusals, 1, "a refusal is terminal");
  });
});

test("a missing observation key is a reported fault, not a silent absence", async () => {
  const previousObservation = process.env.KMA_OBSERVATION_API_KEY;
  const previousShortTerm = process.env.KMA_SHORT_TERM_API_KEY;
  delete process.env.KMA_OBSERVATION_API_KEY;
  delete process.env.KMA_SHORT_TERM_API_KEY;
  try {
    const result = await read(async () => new Response(asosBody("00", "1.0"), { status: 200 }));
    assert.equal(result.status, "failed");
    assert.match(result.reason ?? "", /KMA_OBSERVATION_API_KEY/);
  } finally {
    if (previousObservation !== undefined) process.env.KMA_OBSERVATION_API_KEY = previousObservation;
    if (previousShortTerm !== undefined) process.env.KMA_SHORT_TERM_API_KEY = previousShortTerm;
  }
});

const asosRangeBody = (rows: { tm: string; sumRn: string }[]): string => JSON.stringify({
  response: {
    header: { resultCode: "00", resultMsg: "NORMAL_SERVICE" },
    body: { dataType: "JSON", items: { item: rows.map((row) => ({ stnId: "108", ...row })) } },
  },
});

test("an observation window returns every published day and omits the ones ASOS has no row for", async () => {
  await withObservationKey(async () => {
  const requests: string[] = [];
  const read = await fetchAsosObservationWindow(
    "108",
    "2026-08-21",
    "2026-08-23",
    new Date("2026-08-25T09:00:00+09:00"),
    async (url) => {
      requests.push(String(url));
      // The middle day has a row with a blank total — a measured dry day, not a gap.
      // The last day has no row at all, which the caller must see as an absence.
      return new Response(
        asosRangeBody([
          { tm: "2026-08-21", sumRn: "12.5" },
          { tm: "2026-08-22", sumRn: "  " },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  );

  assert.equal(read.status, "observed");
  assert.equal(requests.length, 1, "a whole window costs one request, not one per day");
  assert.match(requests[0], /startDt=20260821&endDt=20260823/);
  assert.deepEqual(
    read.observations?.map((observation) => [observation.date, observation.observedMm]),
    [["2026-08-21", 12.5], ["2026-08-22", 0]],
  );
  assert.equal(read.observations?.[0]?.stationId, "108");
  assert.equal(read.observations?.[0]?.source, "kma-asos");
  });
});

test("a window ASOS refuses is a fault, never an empty window that reads as no rain", async () => {
  // The seed path answers an unusable window with an empty map on purpose, because a
  // skipped seed window costs only evidence. A backfilled observation is benchmark
  // ground truth: an empty window that looks the same as a dry one would write
  // nothing and leave a hole that every later read reports as filled.
  await withObservationKey(async () => {
  let attempts = 0;
  const refused = await fetchAsosObservationWindow(
    "108",
    "2026-08-21",
    "2026-08-22",
    new Date("2026-08-25T09:00:00+09:00"),
    async () => {
      attempts += 1;
      return new Response(asosBody("30"), { status: 200 });
    },
    async () => {},
  );
  assert.equal(refused.status, "failed");
  assert.equal(attempts, 1, "a refusal is terminal — retrying it only spends quota");

  let dropped = 0;
  const unreachable = await fetchAsosObservationWindow(
    "108",
    "2026-08-21",
    "2026-08-22",
    new Date("2026-08-25T09:00:00+09:00"),
    async () => {
      dropped += 1;
      throw new Error("socket hang up");
    },
    async () => {},
  );
  assert.equal(unreachable.status, "failed");
  assert.match(unreachable.reason ?? "", /socket hang up/);
  assert.equal(dropped, 3, "a dropped connection is retried");
  });
});

test("a window ASOS has no rows at all for is an absence, which is not a fault", async () => {
  await withObservationKey(async () => {
  const read = await fetchAsosObservationWindow(
    "108",
    "2026-08-21",
    "2026-08-22",
    new Date("2026-08-25T09:00:00+09:00"),
    async () => new Response(asosBody("03"), { status: 200 }),
  );
  assert.equal(read.status, "observed");
  assert.deepEqual(read.observations, []);
  });
});
