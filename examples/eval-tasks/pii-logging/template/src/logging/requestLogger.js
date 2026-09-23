// One line per request, written to stdout and collected by the log pipeline.
export function formatRequestLog(req, res, ms) {
  return JSON.stringify({ method: req.method, path: req.path, status: res.status, ms, body: req.body })
}
