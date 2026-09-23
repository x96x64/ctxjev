// Errors: include the request body so on-call can reproduce the failing input.
export function formatErrorLog(err, req) {
  return `ERROR ${err.message} path=${req.path} body=${JSON.stringify(req.body)}`
}
