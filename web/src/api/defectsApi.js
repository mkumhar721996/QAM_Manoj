export function createDefectsApi({ baseUrl, getUserId, fetchImpl = fetch }) {
  function headers() {
    return {
      "content-type": "application/json",
      "x-user-id": getUserId(),
    };
  }

  async function getOptions() {
    const response = await fetchImpl(`${baseUrl}/api/defects/options`, { headers: headers() });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: body.error };
    }
    return { ok: true, options: { severity: body.severity, environment: body.environment } };
  }

  async function createDefect(payload) {
    const response = await fetchImpl(`${baseUrl}/api/defects`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, errors: body.errors };
    }
    return { ok: true, defect: body };
  }

  async function getDefect(id) {
    const response = await fetchImpl(`${baseUrl}/api/defects/${id}`, { headers: headers() });
    const body = await response.json();
    if (!response.ok) {
      return { ok: false, error: body.error };
    }
    return { ok: true, defect: body };
  }

  return { getOptions, createDefect, getDefect };
}
