import test from "node:test";
import assert from "node:assert/strict";
import { createDefectsApi } from "../src/api/defectsApi.js";

function fakeFetch(responses) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, options });
    const match = responses.find((r) => r.url === url && (!r.method || r.method === (options.method ?? "GET")));
    if (!match) {
      throw new Error(`no fake response configured for ${options.method ?? "GET"} ${url}`);
    }
    return {
      ok: match.status >= 200 && match.status < 300,
      status: match.status,
      json: async () => match.body,
    };
  };
  impl.calls = calls;
  return impl;
}

test("getOptions() requests the options endpoint with the auth header and returns the parsed body", async () => {
  const fetchImpl = fakeFetch([
    {
      url: "http://api.test/api/defects/options",
      method: "GET",
      status: 200,
      body: { severity: ["Low"], environment: ["Staging"] },
    },
  ]);
  const api = createDefectsApi({ baseUrl: "http://api.test", getUserId: () => "jane.doe", fetchImpl });

  const options = await api.getOptions();

  assert.deepEqual(options, { severity: ["Low"], environment: ["Staging"] });
  assert.equal(fetchImpl.calls[0].options.headers["x-user-id"], "jane.doe");
});

test("createDefect() posts the payload as JSON and returns the created defect on success", async () => {
  const payload = { title: "t" };
  const created = { id: "1", title: "t", status: "Open" };
  const fetchImpl = fakeFetch([
    { url: "http://api.test/api/defects", method: "POST", status: 201, body: created },
  ]);
  const api = createDefectsApi({ baseUrl: "http://api.test", getUserId: () => "jane.doe", fetchImpl });

  const result = await api.createDefect(payload);

  assert.deepEqual(result, { ok: true, defect: created });
  const call = fetchImpl.calls[0];
  assert.equal(call.options.method, "POST");
  assert.deepEqual(JSON.parse(call.options.body), payload);
  assert.equal(call.options.headers["x-user-id"], "jane.doe");
  assert.equal(call.options.headers["content-type"], "application/json");
});

test("createDefect() returns validation errors from the server without throwing", async () => {
  const errors = { title: "title is required" };
  const fetchImpl = fakeFetch([
    { url: "http://api.test/api/defects", method: "POST", status: 400, body: { errors } },
  ]);
  const api = createDefectsApi({ baseUrl: "http://api.test", getUserId: () => "jane.doe", fetchImpl });

  const result = await api.createDefect({});

  assert.deepEqual(result, { ok: false, errors });
});

test("getDefect() fetches a defect by id", async () => {
  const defect = { id: "42", title: "t", status: "Open" };
  const fetchImpl = fakeFetch([
    { url: "http://api.test/api/defects/42", method: "GET", status: 200, body: defect },
  ]);
  const api = createDefectsApi({ baseUrl: "http://api.test", getUserId: () => "jane.doe", fetchImpl });

  const result = await api.getDefect("42");

  assert.deepEqual(result, { ok: true, defect });
});
